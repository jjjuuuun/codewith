import { chromium } from "playwright";
import { runtimeConfig } from "./server/runtime-config.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createClaudeAuth } from "./server/claude-auth.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "./server/index.mjs";
import { TestPool } from "./tests/fixtures.mjs";
const root = path.dirname(fileURLToPath(import.meta.url)),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codewith-browser-")),
  pool = new TestPool(),
  nativeProjectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cw-native-project-"),
  );
let claudeAuthenticated = false;
const claudeCode = createClaudeAuth({
  dataDir: dir,
  spawnProcess(_bin, args) {
    const child = new EventEmitter();
    for (const name of ["stdout", "stderr", "stdin"])
      child[name] = new PassThrough();
    child.kill = () => {};
    setTimeout(() => {
      if (args[1] === "login")
        child.stdout.write(
          "Opening browser to sign in…\nIf the browser did not open, visit: https://claude.com/cai/oauth/authorize?test=1\nPaste code here if prompted > ",
        );
      else {
        child.stdout.write(
          JSON.stringify({
            loggedIn: claudeAuthenticated,
            email: claudeAuthenticated ? "test@example.com" : null,
          }),
        );
        child.emit("close", claudeAuthenticated ? 0 : 1);
      }
    }, 10);
    return child;
  },
});
const createFrontendApplication = process.argv.includes("--dev")
  ? (await import("./scripts/dev-application.mjs")).createDevelopmentApplication
  : createApplication;
const { server, store, vite } = await createFrontendApplication({
  mode: "server",
  dataDir: dir,
  codexPool: pool,
  claudeCode,
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const chrome = process.env.CODING_CHROMIUM || chromium.executablePath();
const proc = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--no-proxy-server",
    "--remote-debugging-pipe",
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let seq = 0,
  buffer = "",
  session;
const pending = new Map(),
  errors = [],
  checks = [];
let acceptReloadDialog = false;
proc.stderr.on("data", () => {});
proc.on("error", (e) => {
  throw e;
});
proc.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!raw) continue;
    const m = JSON.parse(raw);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error
          ? p.reject(new Error(JSON.stringify(m.error)))
          : p.resolve(m.result);
      }
    } else if (
      m.method === "Page.javascriptDialogOpening" &&
      acceptReloadDialog
    ) {
      void call("Page.handleJavaScriptDialog", { accept: true }, m.sessionId);
    } else if (
      m.method === "Log.entryAdded" &&
      m.params.entry.level === "error" &&
      m.params.entry.source !== "network"
    ) {
      errors.push(m.params.entry);
      console.error("Browser log", m.params.entry);
    } else if (
      m.method === "Runtime.consoleAPICalled" &&
      m.params.type === "error"
    ) {
      errors.push(m.params.args);
      console.error("Browser console", m.params.args);
    } else if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails);
  }
});
function call(method, params = {}, sid = session) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, method });
    proc.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sid ? { sessionId: sid } : {}),
      }) + "\0",
    );
  });
}
async function ev(expression) {
  const r = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function wait(
  expression,
  label = expression,
  timeoutMs = vite ? 30000 : 5000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await ev(expression)) return;
    } catch (error) {
      // A read-only condition may race a navigation between test origins.
      if (
        !/Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id/.test(
          error.message,
        )
      )
        throw error;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    "Timeout: " +
      label +
      " " +
      (await ev(
        `document.querySelector('#dialog-error')?.textContent||document.querySelector('#toast')?.textContent`,
      )),
  );
}
const click = async (selector) => {
    await wait(
      `!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
      selector,
    );
    return ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
  },
  fill = async (name, value) => {
    const find = `[...document.querySelectorAll('[name="'+${JSON.stringify(name)}+'"]')].find(x=>x.getClientRects().length||x.closest('.rich-editor')?.getClientRects().length)`;
    await wait(`!!(${find})`);
    return ev(
      `(async()=>{const area=(${find});if(area.closest('.rich-editor')){const {setRichText}=await import('/text-editor.js');setRichText(area,${JSON.stringify(value)});}else {area.value=${JSON.stringify(value)};area.dispatchEvent(new Event("input",{bubbles:true}));area.dispatchEvent(new Event("change",{bubbles:true}));}})()`,
    );
  },
  submit = () =>
    ev(
      `(document.querySelector('#inline-form')||document.querySelector('#dialog-form')).requestSubmit()`,
    );
function assert(ok, message) {
  if (!ok) throw new Error(message);
  checks.push(message);
}
async function closeSaved() {
  await wait(
    `!document.querySelector('dialog').open&&!document.querySelector('#inline-editor')`,
  );
}
async function shortcut(selector, key, code, modifiers = 2) {
  await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode:
      {
        Escape: 27,
        ArrowDown: 40,
        ArrowUp: 38,
        Home: 36,
        End: 35,
        Tab: 9,
        Enter: 13,
      }[key] || key.toUpperCase().charCodeAt(0),
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    modifiers,
    windowsVirtualKeyCode:
      {
        Escape: 27,
        ArrowDown: 40,
        ArrowUp: 38,
        Home: 36,
        End: 35,
        Tab: 9,
        Enter: 13,
      }[key] || key.toUpperCase().charCodeAt(0),
  });
}
let loginKey;
async function browserLogin() {
  await click('[data-action="access-key-login"]');
  await fill("accessKey", loginKey);
  await submit();
  await wait(
    `!!document.querySelector('.shell')&&!document.querySelector('dialog').open`,
  );
}

const extraApps = [];
const deadline = setTimeout(() => {
  proc.kill();
  server.close();
  console.error(
    "Browser test timeout",
    [...pending.values()].map((p) => p.method),
  );
  process.exit(1);
}, 180000);
try {
  const target = await call(
    "Target.createTarget",
    { url: "about:blank" },
    null,
  );
  session = (
    await call(
      "Target.attachToTarget",
      { targetId: target.targetId, flatten: true },
      null,
    )
  ).sessionId;
  await call("Runtime.enable");
  await call("Log.enable");
  await call("Page.enable");
  // This regression suite checks the existing Korean UI; i18n has its own suite.
  if (!process.argv.includes("--i18n") && !process.argv.includes("--readme"))
    await call("Page.addScriptToEvaluateOnNewDocument", {
      source:
        'if (window === window.top) { localStorage.setItem("codewith.locale", "ko"); }',
    });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: origin + "/auth/wait" });
  await wait(`!!document.querySelector('#login-title')`);
  fs.mkdirSync(path.join(root, "data/screenshots"), { recursive: true });
  {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/auth-wait.png"),
      Buffer.from(shot.data, "base64"),
    );
  }
  await call("Page.navigate", { url: origin });
  await wait(
    `!!document.querySelector('[data-action="access-key-login"]')`,
    "Frontend boot",
    vite ? 60000 : 10000,
  );
  fs.mkdirSync(path.join(root, "data/screenshots"), { recursive: true });
  {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/login.png"),
      Buffer.from(shot.data, "base64"),
    );
  }
  if (vite) {
    await ev(
      `(async()=>{window.codewithHmrVerified=false;const {createHotContext}=await import('/@vite/client');createHotContext('/src/verification-probe.js').on('codewith:verification',()=>window.codewithHmrVerified=true);})()`,
    );
    vite.ws.send({ type: "custom", event: "codewith:verification", data: {} });
    await wait("window.codewithHmrVerified");
    assert(true, "Vite HMR은 API와 같은 출처의 WebSocket으로 연결");
  }
  // Exercise actual hit targets, not DOM .click(), after both panels are hidden.
  async function pointerClick(selector) {
    await call("Page.bringToFront");
    const point = await ev(
      `(()=>{const b=document.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect();if(!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('버튼이 가려짐');return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
  }

  async function chooseTheme(value) {
    if (await ev(`!!document.querySelector('dialog[open]')`))
      return ev(`window.CodeWithTheme.set(${JSON.stringify(value)})`);
    await pointerClick(".theme-control .v-field");
    await wait(
      `!!document.querySelector('.v-overlay--active [role="listbox"]')`,
    );
    const label = { system: "시스템 설정", light: "라이트", dark: "다크" }[
      value
    ];
    await ev(
      `[...document.querySelectorAll('.v-overlay--active [role="option"]')].find(x=>x.textContent.includes(${JSON.stringify(label)})).click()`,
    );
    await wait(
      `!document.querySelector('.v-overlay--active [role="listbox"]')`,
    );
  }

  if (process.argv.includes("--readme")) {
    const { captureReadme } = await import("./tests/readme-demo.mjs");
    await captureReadme({
      ev,
      call,
      wait,
      assert,
      click,
      fill,
      submit,
      closeSaved,
      root,
      origin,
      store,
    });
    assert(!errors.length, "README capture has no browser errors");
  } else if (process.argv.includes("--i18n")) {
    const { verifyI18n } = await import("./tests/browser-i18n.mjs");
    await verifyI18n({
      ev,
      call,
      wait,
      assert,
      pointerClick,
      click,
      fill,
      submit,
      closeSaved,
      root,
      origin,
    });
    assert(!errors.length, "No browser errors in either locale");
    console.log(JSON.stringify({ checks: checks.length, errors }));
  } else {
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await wait(`document.documentElement.dataset.theme==='dark'`);
    assert(
      await ev(
        `document.documentElement.dataset.themeMode==='system'&&document.querySelector('[data-theme-select]').dataset.value==='system'&&getComputedStyle(document.body).backgroundColor==='rgb(23, 23, 33)'`,
      ),
      "테마 기본값은 시스템 설정이며 다크 환경을 자동 반영",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/dark-login.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await pointerClick(".theme-control .v-field");
    await wait(
      `!!document.querySelector('.v-overlay--active [role="listbox"]')`,
    );
    assert(
      await ev(
        `getComputedStyle(document.querySelector('.v-overlay--active [role="listbox"]')).borderRadius==='16px'&&document.querySelector('.theme-control input').getAttribute('aria-expanded')==='true'`,
      ),
      "테마 셀렉트는 둥근 앱 메뉴로 열림",
    );
    await new Promise((r) => setTimeout(r, 350));
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/dark-select-menu.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    assert(
      await ev(
        `!!document.querySelector('.theme-control .v-icon svg path')&&getComputedStyle(document.querySelector('.theme-control .v-icon'),'::after').content==='none'`,
      ),
      "선택 화살표는 문자 대체 없이 SVG로 표시",
    );
    await shortcut(".theme-control input", "Escape", "Escape", 0);
    assert(
      await ev(
        `!document.querySelector('.v-overlay--active [role="listbox"]')&&document.activeElement===document.querySelector('.theme-control input')`,
      ),
      "Escape로 셀렉트 메뉴만 닫고 포커스 유지",
    );
    await chooseTheme("light");
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    assert(
      await ev(
        `document.documentElement.dataset.theme==='light'&&localStorage.getItem('codewith.theme')==='light'`,
      ),
      "직접 고른 라이트 모드는 시스템 변경보다 우선",
    );
    const themeTime = await ev("performance.timeOrigin");
    await call("Page.reload");
    await wait(
      `performance.timeOrigin!==${themeTime}&&!!document.querySelector('[data-theme-select]')`,
    );
    assert(
      await ev(
        `document.documentElement.dataset.theme==='light'&&document.querySelector('[data-theme-select]').dataset.value==='light'`,
      ),
      "새로고침 후 테마 선택 유지",
    );
    await chooseTheme("system");
    await wait(`document.documentElement.dataset.theme==='dark'`);
    assert(
      await ev(`!localStorage.getItem('codewith.theme')`),
      "시스템 설정 재선택 시 직접 지정 값 해제",
    );
    for (const guide of [
      "/guide",
      "/guide/deployment",
      "/guide/ai",
      "/auth/wait",
    ]) {
      await call("Page.navigate", { url: origin + guide });
      await wait(`!!document.querySelector('[data-theme-select]')`);
      assert(
        await ev(
          `document.documentElement.dataset.theme==='dark'&&getComputedStyle(document.body).backgroundColor==='rgb(23, 23, 33)'`,
        ),
        "안내·로그인 대기 페이지 시스템 다크 적용 " + guide,
      );
      assert(
        await ev(
          `document.querySelector('link[rel="icon"]')?.getAttribute('href')==='/logo.svg'`,
        ),
        "별도 페이지는 공통 로고를 탭 아이콘으로 사용 " + guide,
      );
      if (guide.startsWith("/guide")) {
        await wait(`!!document.querySelector('#app .guide-content h1')`);
        assert(
          await ev(
            `document.querySelectorAll('.guide-navigation a').length===3&&document.querySelector('.guide-navigation [aria-current="page"]').getAttribute('href')===${JSON.stringify(guide)}`,
          ),
          "안내 문서는 로그인 없이 공통 Vue 레이아웃으로 표시 " + guide,
        );
        if (guide === "/guide") {
          await new Promise((r) => setTimeout(r, 200));
          const shot = await call("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(
            path.join(root, "data/screenshots/guide-desktop.png"),
            Buffer.from(shot.data, "base64"),
          );
          await call("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          assert(
            await ev(`document.documentElement.scrollWidth<=390`),
            "모바일 안내 화면 가로 넘침 없음",
          );
          const mobile = await call("Page.captureScreenshot", {
            format: "png",
          });
          fs.writeFileSync(
            path.join(root, "data/screenshots/guide-mobile.png"),
            Buffer.from(mobile.data, "base64"),
          );
          await call("Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 1050,
            deviceScaleFactor: 1,
            mobile: false,
          });
        }
      }
    }
    await call("Page.navigate", { url: origin + "/guide#format" });
    await wait(
      `!!document.getElementById('format')&&Math.abs(document.getElementById('format').getBoundingClientRect().top-24)<5`,
    );
    assert(true, "안내 화면의 직접 목차 링크는 지연 로딩 후 해당 절로 이동");
    await call("Page.navigate", { url: origin });
    await wait(`!!document.querySelector('[data-action="access-key-login"]')`);
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await wait(`document.documentElement.dataset.theme==='light'`);
    assert(
      await ev(
        `[...document.querySelectorAll('.auth-links a[href^="/guide"],.auth-nav a[href^="/guide"]')].every(a=>a.target==='_blank')&&document.querySelector('a[href="/guide"]').target==='_blank'`,
      ),
      "앱의 도움말은 새 브라우저 탭에서 열림",
    );
    for (const old of [
      "/guide.html",
      "/deployment.html",
      "/ai-guide.html",
      "/local-ai.html",
    ])
      assert(
        (await ev(`fetch(${JSON.stringify(old)}).then(r=>r.status)`)) === 404,
        "이전 HTML 안내 주소 제거 " + old,
      );
    await click('[data-action="access-create"]');
    await fill("accessName", "김개발");
    await submit();
    await wait(`!!document.querySelector('.access-secret code')`);
    loginKey = await ev(
      `document.querySelector('.access-secret code').textContent`,
    );
    assert(loginKey.startsWith("cwk_"), "CodeWith 계정용 개인 로그인 키 발급");
    await submit();
    await closeSaved();
    assert(
      store.db.users.length === 1 && !store.db.users[0].aiConnections,
      "AI 없이 CodeWith 계정 생성",
    );
    await click('[data-action="personal-settings"]');
    await wait(
      `document.querySelector('dialog').open&&!!document.querySelector('dialog .ProseMirror')`,
    );
    await shortcut("dialog .ProseMirror", "Escape", "Escape", 0);
    assert(
      await ev(`!document.querySelector('dialog').open`),
      "미변경 모달은 Esc로 닫기",
    );
    await click('[data-action="personal-settings"]');
    await fill("instructions", "저장되지 않은 지침");
    await chooseTheme("dark");
    assert(
      await ev(
        `document.querySelector('[name=instructions]').value.includes('저장되지 않은 지침')&&getComputedStyle(document.querySelector('dialog')).backgroundColor==='rgb(33, 33, 47)'`,
      ),
      "테마 변경 시 미저장 에디터·모달 내용 유지",
    );
    await chooseTheme("system");
    await shortcut("dialog .ProseMirror", "Escape", "Escape", 0);
    assert(
      await ev(
        `document.querySelector('dialog').open&&!!document.querySelector('#modal-unsaved')`,
      ),
      "Esc로 미저장 입력이 사라지지 않음",
    );
    await wait(`document.querySelector('#modal-unsaved')?.open`);
    assert(
      await ev(
        `document.querySelector('#modal-unsaved').getAttribute('role')==='alertdialog'&&!document.querySelector('#modal').contains(document.querySelector('#modal-unsaved'))&&document.querySelectorAll('dialog[open]').length===2&&document.activeElement.dataset.action==='keep-modal'`,
      ),
      "미저장 확인은 별도 모달이며 계속 작성에 우선 포커스",
    );
    await pointerClick('[data-action="keep-modal"]');
    await wait(`!document.querySelector('#modal-unsaved')`);
    assert(
      await ev(
        `document.querySelector('#modal').open&&document.querySelector('[name=instructions]').value.includes('저장되지 않은 지침')&&document.querySelector('#modal').contains(document.activeElement)`,
      ),
      "계속 작성은 입력과 원래 모달 포커스를 유지",
    );
    await shortcut("#modal .ProseMirror", "Escape", "Escape", 0);
    await wait(`document.querySelector('#modal-unsaved')?.open`);
    await shortcut('[data-action="keep-modal"]', "Escape", "Escape", 0);
    await wait(`!document.querySelector('#modal-unsaved')`);
    assert(
      await ev(
        `document.querySelector('#modal').open&&document.querySelector('[name=instructions]').value.includes('저장되지 않은 지침')`,
      ),
      "확인 모달의 Esc는 확인만 닫고 입력 유지",
    );
    await shortcut("#modal .ProseMirror", "Escape", "Escape", 0);
    await wait(`document.querySelector('#modal-unsaved')?.open`);
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      assert(
        await ev(
          `(()=>{const d=document.querySelector('#modal-unsaved'),r=d.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth&&[...d.querySelectorAll('button')].every(b=>{const x=b.getBoundingClientRect();return x.left>=r.left&&x.right<=r.right&&x.bottom<=r.bottom;});})()`,
        ),
        `미저장 확인 모달과 버튼이 화면 안에 표시 ${width}`,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots", `confirm-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pointerClick('[data-action="discard-modal"]');
    await wait(
      `!document.querySelector('#modal-unsaved')&&!document.querySelector('#modal').open`,
    );
    assert(
      !store.db.users[0].commonSettings?.instructions,
      "명시적으로 버릴 때만 모달 입력 취소",
    );
    await click('[data-action="personal-settings"]');
    await wait(
      `document.querySelector('dialog').open&&!!document.querySelector('dialog .ProseMirror')`,
    );
    assert(
      await ev(
        `(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<2&&Math.abs(r.y+r.height/2-innerHeight/2)<2;})()`,
      ),
      "Vuetify 초기화 후에도 편집 모달은 화면 중앙에 표시",
    );
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 2,
      y: 2,
      button: "left",
      clickCount: 1,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 2,
      y: 2,
      button: "left",
      clickCount: 1,
    });
    assert(
      await ev(`!document.querySelector('dialog').open`),
      "미변경 모달은 바깥 클릭으로 닫기",
    );
    await click('[data-action="personal-settings"]');
    await wait(
      `document.querySelector('dialog').open&&!!document.querySelector('dialog .ProseMirror')`,
    );
    await ev(
      `new Promise(resolve=>requestAnimationFrame(()=>{document.querySelector('dialog .ProseMirror').focus();requestAnimationFrame(resolve);}));`,
    );
    await call("Input.insertText", { text: "/" });
    await wait(`!document.querySelector('dialog .rich-menu').hidden`);
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await call("Input.insertText", { text: "직접 작성하는 제목" });
    assert(
      await ev(
        `document.querySelector('dialog .ProseMirror h2')?.textContent==='직접 작성하는 제목'&&!document.querySelector('dialog .ProseMirror').textContent.includes('/')`,
      ),
      "슬래시 메뉴와 키보드로 제목 블록 작성",
    );
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await call("Input.insertText", { text: "본문을 직접 편집합니다." });
    const beforeUndo = await ev(
      `document.querySelector('[name=instructions]').value`,
    );
    await shortcut("dialog .ProseMirror", "z", "KeyZ");
    assert(
      await ev(
        `document.querySelector('[name=instructions]').value!==${JSON.stringify(beforeUndo)}`,
      ),
      "리치 텍스트 실제 입력 실행 취소",
    );
    await shortcut("dialog .ProseMirror", "z", "KeyZ", 10);
    assert(
      await ev(
        `document.querySelector('[name=instructions]').value===${JSON.stringify(beforeUndo)}`,
      ),
      "리치 텍스트 다시 실행",
    );
    await shortcut("dialog .ProseMirror", "8", "Digit8", 10);
    assert(
      await ev(`!!document.querySelector('dialog .ProseMirror ul li')`),
      "문단을 목록 블록으로 변경",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/rich-editor.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await ev(
      `(()=>{const dt=new DataTransfer();dt.setData('text/html','<p><a href="javascript:alert(1)">위험 링크</a><img src="x" onerror="window.pasteExecuted=true"></p>');document.querySelector('dialog .ProseMirror').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`,
    );
    assert(
      await ev(
        `!document.querySelector('dialog .ProseMirror a[href^="javascript:"]')&&!document.querySelector('dialog .ProseMirror [onerror]')&&!window.pasteExecuted`,
      ),
      "붙여넣기에서 실행 HTML과 위험 링크 제거",
    );
    await shortcut("dialog .ProseMirror", "k", "KeyK");
    await ev(
      `const urlInput=document.querySelector('dialog .rich-link-editor input');urlInput.value='https://example.com/guide';urlInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`,
    );
    assert(
      await ev(
        `document.querySelector('dialog').open&&!!document.querySelector('dialog .ProseMirror a[href="https://example.com/guide"]')`,
      ),
      "링크 입력 Enter는 문서를 저장하지 않고 링크 적용",
    );
    await fill("instructions", "나의 공통 지침 테스트");
    await ev(
      `(async()=>{const {richEditorFor}=await import('/text-editor.js');const v=richEditorFor(document.querySelector('[name=instructions]')).view;v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc,1,v.state.doc.content.size-1)));})()`,
    );
    await shortcut("dialog .ProseMirror", "b", "KeyB");
    assert(
      await ev(
        `document.querySelector('dialog .ProseMirror strong')?.textContent==='나의 공통 지침 테스트'&&!document.querySelector('[data-editor-action=preview]')`,
      ),
      "작성 화면에서 즉시 굵은 서식 표시",
    );
    await submit();
    await closeSaved();
    assert(
      store.db.users[0].commonSettings.instructions ===
        "**나의 공통 지침 테스트**",
      "홈에서 개인 공통 설정 저장",
    );
    await click('[data-action="access-account"]');
    await wait(
      `document.querySelector('dialog').open&&document.querySelector('.modal-head h2')?.textContent==='계정 설정'`,
    );
    assert(
      await ev(
        `document.querySelector('.modal-head h2')?.textContent==='계정 설정'&&!document.querySelector('[data-action="ai-settings"]')`,
      ),
      "공유·서버 계정 설정에서 중복 AI 연결 메뉴 제거",
    );
    await click('.modal-foot [data-action="close"]');

    assert(
      await ev(
        `!document.querySelector('.rail')&&!document.querySelector('[data-action="toggle-nav"]')`,
      ),
      "선택 전 홈에는 프로젝트 메뉴 없음",
    );
    await click('[data-action="join-dialog"]');
    assert(
      await ev(
        `!!document.querySelector('[name=invite]')&&!document.querySelector('[name=workspaceName]')`,
      ),
      "초대 코드 참여는 별도 창",
    );
    await click('.modal-head [data-action="close"]');
    await click('[data-action="new-workspace"]');
    assert(
      await ev(
        `!document.querySelector('[name=invite]')&&document.querySelector('.modal-foot [data-action="close"]').textContent==='취소'&&!document.querySelector('.modal-foot [data-action="close"] svg')`,
      ),
      "생성 창은 초대 입력 없이 텍스트 취소 버튼 제공",
    );
    await fill("workspaceName", "CodeWith Java 프로젝트");
    await submit();
    await closeSaved();
    await wait(`!!document.querySelector('.workspace-overview')`);
    assert(
      await ev(`!!document.querySelector('.rail')`),
      "선택 후 좌측 프로젝트 메뉴 표시",
    );
    assert(store.db.workspaces.length === 1, "워크스페이스 생성");
    assert(
      await ev(
        `!document.querySelector('.rail [data-view=home]')&&!!document.querySelector('.rail [data-view=workspace]')`,
      ),
      "중복 목록 메뉴 제거와 기본 설정 메뉴",
    );
    const pickerPath = await ev("location.pathname");
    await click(".workspace-switch");
    await wait(`document.querySelector('#workspace-menu')?.hidden===false`);
    assert(
      await ev(
        `location.pathname===${JSON.stringify(pickerPath)}&&!!document.querySelector('#workspace-menu [aria-current=true]')`,
      ),
      "워크스페이스 선택기는 이동 없이 목록을 표시",
    );
    await ev(
      `document.querySelector('.workspace-switch').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    );
    assert(
      await ev(`document.querySelector('#workspace-menu').hidden`),
      "선택기 Escape 닫기",
    );
    assert(
      store.db.workspaces[0].document.specs.length === 0,
      "빈 워크스페이스에는 자동 생성 명세 없음",
    );
    assert(
      await ev(`!!document.querySelector('.workspace-overview')`),
      "생성 후 해당 워크스페이스 열기",
    );
    assert(
      await ev(`location.pathname.startsWith('/workspaces/')`),
      "워크스페이스 전용 URL",
    );
    await ev("history.back()");
    await wait(
      `location.pathname==='/'&&!!document.querySelector('.workspace-home')`,
    );
    assert(true, "워크스페이스에서 뒤로가면 홈 목록");
    await ev("history.forward()");
    await wait(`!!document.querySelector('.workspace-overview')`);
    assert(true, "앞으로가면 선택한 워크스페이스 복원");
    await click('[data-action="new-spec"]');
    await fill("title", "첫 개발 단위");
    await submit();
    await closeSaved();
    await click('[data-action="edit-spec"]');
    await fill("id", "SPEC-REG");
    await fill("title", "행사 참가 등록");
    assert(
      await ev(
        `document.querySelectorAll('#dialog-form input:not([type=hidden]),#dialog-form textarea').length===2&&!document.querySelector('[name=subtitle]')`,
      ),
      "명세 정보는 이름과 식별번호 두 항목",
    );
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].id === "SPEC-REG",
      "사용자 지정 명세 ID",
    );
    await click('[data-action="new-requirement"]');
    assert(
      await ev(
        `document.querySelector('#modal').open&&!!document.querySelector('#dialog-form')&&!document.querySelector('#inline-form')`,
      ),
      "요구사항은 중앙 모달에서 작성",
    );
    assert(
      await ev(
        `!!document.querySelector('[data-list=criteria] input')&&!document.querySelector('[data-list=criteria] .ProseMirror')`,
      ),
      "완료 기준은 항목별 단순 입력 유지",
    );
    await fill("id", "TEAM-REG-001");
    await fill("title", "같은 이메일의 중복 등록 방지");
    await fill(
      "body",
      "이미 등록된 이메일로 참가를 요청하면 중복 오류를 반환하고 기존 등록을 유지해야 한다.",
    );
    await ev(
      `document.querySelector('[data-row-id]').value='TEAM-AC-001';document.querySelector('[data-row-id]').dispatchEvent(new Event("input",{bubbles:true}));document.querySelector('[data-row-text]').value='처음 요청한 이메일은 등록된다.';document.querySelector('[data-row-text]').dispatchEvent(new Event("input",{bubbles:true}))`,
    );
    await click('[data-action="repeat-add"]');
    await ev(
      `document.querySelectorAll('[data-row-id]')[1].value='TEAM-AC-002';document.querySelectorAll('[data-row-id]')[1].dispatchEvent(new Event("input",{bubbles:true}));document.querySelectorAll('[data-row-text]')[1].value='두 번째 요청에서 참가자 수는 증가하지 않는다.';document.querySelectorAll('[data-row-text]')[1].dispatchEvent(new Event("input",{bubbles:true}))`,
    );
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].requirements[0].criteria
        .length === 2,
      "수용 조건 독립 목록 편집과 직접 지정 ID",
    );
    await click('[data-action="resources"]');
    assert(
      await ev(
        `document.querySelector('#inline-editor').parentElement.classList.contains('resource-section')&&document.querySelector('#inline-editor').closest('.requirement-card')!==null`,
      ),
      "자료 관리 화면은 해당 요구사항 안에 표시",
    );
    await click('[data-action="resource-new"][data-type="table"]');
    assert(
      await ev(
        `document.querySelector('#inline-editor').parentElement.dataset.requirement==='TEAM-REG-001'`,
      ),
      "자료 추가 편집기도 해당 요구사항에 유지",
    );
    await click('[data-action="toggle-nav"]');
    assert(
      await ev(
        `document.querySelector('#inline-editor').parentElement.dataset.requirement==='TEAM-REG-001'`,
      ),
      "패널을 접어도 자료 편집기 위치 유지",
    );
    await click('[data-action="toggle-nav"]');
    await fill("title", "등록 요청별 기대 결과");
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].requirements[0].resources
        .length === 1,
      "요구사항 표 자료 작성과 저장",
    );
    await click('[data-action="resources"]');
    await click('[data-action="resource-new"][data-type="flow"]');
    await fill("title", "등록 처리 흐름");
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].requirements[0].resources
        .length === 2,
      "흐름도 단계 편집과 렌더링",
    );
    await click('[data-action="view"][data-view="requirements"]');
    assert(
      await ev(
        `document.querySelector('#aggregate').textContent.includes('TEAM-REG-001')`,
      ),
      "프로젝트 전체 요구사항 집계",
    );
    await click('[data-action="edit-requirement"]');
    await fill("id", "PROJECT-REG-100");
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].requirements[0].id ===
        "PROJECT-REG-100",
      "집계 화면에서 원본 요구사항 ID 변경",
    );
    await click('a.brand[href="/"]');
    await click('[data-action="edit-workspace"]');
    await wait(
      `document.querySelector('dialog').open&&!!document.querySelector('[name=workspaceName]')`,
    );
    const priorName = await ev(
      `document.querySelector('[name=workspaceName]').value`,
    );
    await fill("workspaceName", "이름 수정 테스트");
    await submit();
    await closeSaved();
    assert(
      await ev(
        `document.querySelector('.workspace-tile h2').textContent==='이름 수정 테스트'`,
      ),
      "목록에서 워크스페이스 이름 변경",
    );
    await click('[data-action="switch-workspace"]');
    await wait(`!!document.querySelector('.workspace-overview')`);
    assert(
      await ev(
        `(()=>{return !!document.querySelector('.workspace-basics')&&document.querySelectorAll('.workspace-overview .page-actions button').length===1&&!document.querySelector('.workspace-overview [data-action=new-spec]')&&!document.querySelector('.workspace-overview [data-action=delete-workspace]');})()`,
      ),
      "워크스페이스 메인은 기본 설정과 편집 버튼만 표시",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/workspace-settings.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await click('[data-action="edit-workspace"]');
    await fill("workspaceName", priorName);
    await submit();
    await closeSaved();
    await click('[data-action="view"][data-view="project"]');
    await click('[data-action="edit-project"]');
    await fill(
      "purpose",
      "팀이 합의한 명세를 기준으로 직접 Java 코드를 구현하고 검증한다.",
    );
    await fill("instructions", "워크스페이스 공통 지침 테스트");
    await click('[data-list-name="principles"]');
    await ev(
      `document.querySelector('[data-list="principles"] [data-row-text]').value='요구사항 변경은 구현 전에 다시 합의한다.';document.querySelector('[data-list="principles"] [data-row-text]').dispatchEvent(new Event("input",{bubbles:true}))`,
    );
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.projectSpec.principles.length === 1,
      "프로젝트 공통 기준 작성",
    );
    assert(
      await ev(`!document.querySelector('.evaluation-policy-fields')`),
      "공통 설정 편집에서 평가 기준 분리",
    );
    assert(
      await ev(
        `document.querySelector('.common-settings').nextElementSibling.classList.contains('workspace-evaluation') && document.querySelector('.workspace-evaluation').nextElementSibling.classList.contains('project-instructions')`,
      ),
      "공통 설정과 스킬 사이에 평가 기준 배치",
    );
    await click('[data-action="spec"]');
    await click('[data-tab="design"]');
    await click('[data-action="edit-spec-evaluation"]');
    assert(
      await ev(
        `document.querySelector('.v-select:has(#f-evaluationMode)').textContent.includes('워크스페이스 설정 사용') && document.querySelector('#evaluation-inherited').textContent.includes('시스템 기본값을 이어받고') && document.querySelector('#evaluation-inherited').textContent.includes('90점')`,
      ),
      "워크스페이스 미설정이어도 계획은 워크스페이스를 통해 시스템 기준 상속",
    );
    await click('.modal-foot [data-action="close"]');
    await closeSaved();
    await click('[data-tab="requirements"]');
    await click('[data-action="view"][data-view="project"]');
    await click('[data-action="edit-workspace-evaluation"]');
    assert(
      await ev(
        `document.querySelector('.evaluation-policy-fields').tagName === "SECTION"`,
      ),
      "평가 기준 편집은 추가 펼치기 없이 표시",
    );
    assert(
      await ev(
        `document.querySelector('#evaluation-inherited').textContent.includes('90점') && document.querySelector('#f-evaluationTarget').disabled`,
      ),
      "워크스페이스 평가 기준은 시스템 기본값 상속",
    );
    for (const [width, theme] of [
      [1440, "light"],
      [1440, "dark"],
      [390, "light"],
      [390, "dark"],
    ]) {
      await chooseTheme(theme);
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await ev(
        `document.querySelector('#evaluation-inherited').scrollIntoView({block:'start'})`,
      );
      await new Promise((r) => setTimeout(r, 250));
      assert(
        await ev(
          `(() => { const el = document.querySelector('#evaluation-inherited'); return el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll('li')].every(row => row.scrollWidth <= row.clientWidth + 1); })()`,
        ),
        `상속 기준 요약과 배점 가로 넘침 없음 ${width} ${theme}`,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(
          root,
          "data/screenshots",
          `evaluation-inheritance-${width}-${theme}.png`,
        ),
        Buffer.from(shot.data, "base64"),
      );
    }
    await chooseTheme("light");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await ev(
      `document.querySelector('.v-select:has(#f-evaluationMode)').scrollIntoView({block:"center"})`,
    );
    await new Promise((r) => setTimeout(r, 250));
    await pointerClick(".v-select:has(#f-evaluationMode) .v-field");
    await ev(
      `[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.includes('직접 설정')).click()`,
    );
    await wait(`!document.querySelector('#f-evaluationTarget').disabled`);
    await ev(
      `(() => {const e=document.querySelector('#f-evaluationTarget');e.value='85';e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    const policyShot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/evaluation-policy-workspace.png"),
      Buffer.from(policyShot.data, "base64"),
    );

    await chooseTheme("dark");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 250));
    await ev(
      `document.querySelector('#evaluation-custom').scrollIntoView({block:'start'})`,
    );
    assert(
      await ev(
        `(() => {const el=document.querySelector('#modal');return el.scrollWidth<=el.clientWidth+1;})()`,
      ),
      "평가 기준 편집 모바일 다크 가로 넘침 없음",
    );
    const policyMobile = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/evaluation-policy-mobile-dark.png"),
      Buffer.from(policyMobile.data, "base64"),
    );
    await chooseTheme("light");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await ev(
      `(() => {const e=document.querySelector('#f-evaluationPoints0');e.value='29';e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await submit();
    await wait(
      `document.querySelector('#modal').textContent.includes('배점 합계 100점')`,
    );
    assert(
      await ev(`document.querySelector('#modal').open`),
      "100점이 아닌 배점 저장 차단",
    );
    await ev(
      `(() => {const e=document.querySelector('#f-evaluationPoints0');e.value='30';e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click('[data-action="evaluation-add"]');
    await wait(`document.activeElement?.id === 'f-evaluationLabel5'`);
    await fill("evaluationLabel5", "운영 준비");
    await fill(
      "evaluationDescription5",
      "관측 지표와 장애 복구 절차가 구체적인가",
    );
    await fill("evaluationPoints5", "5");
    await fill("evaluationPoints0", "25");
    await wait(
      `document.querySelector('#evaluation-total').textContent.includes('100 / 100점')`,
    );
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.projectSpec.evaluationPolicy.criteria
        .length === 6,
      "6번째 평가 항목과 배점 저장",
    );
    await click('[data-action="edit-workspace-evaluation"]');
    assert(
      await ev(
        `document.querySelector('#f-evaluationLabel5').value === '운영 준비' && document.querySelector('#f-evaluationPoints0').value === '25'`,
      ),
      "추가 항목과 기존 배점 다시 열기 보존",
    );
    await ev(
      `document.querySelectorAll('[data-action="evaluation-remove"]')[5].click()`,
    );
    await wait(`!document.querySelector('#f-evaluationLabel5')`);
    await fill("evaluationPoints0", "30");
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.projectSpec.evaluationPolicy
        .targetScore === 85,
      "워크스페이스 기준 저장",
    );
    await click(
      '[data-action="instruction-edit"][data-id="codewith-html-plan"]',
    );
    await wait(`document.querySelector('#modal').open`);
    assert(
      await ev(
        `!!document.querySelector('.modal-head input[role="switch"][name="enabled"]')&&!document.querySelector('.modal-body [name="enabled"]')&&!document.querySelector('#instruction-import')`,
      ),
      "기존 스킬은 제목 옆 활성화 스위치와 가져오기 없는 본문 표시",
    );
    await click('.modal-head [role="switch"]');
    await click('.modal-foot [data-action="close"]');
    await wait(`!!document.querySelector('#modal-unsaved')`);
    await click('[data-action="keep-modal"]');
    await click('.modal-head [role="switch"]');

    assert(
      await ev(
        `!!document.querySelector('.modal-foot [data-action="instruction-delete"]') && !document.querySelector('.modal-body [data-action="instruction-delete"]')`,
      ),
      "스킬 삭제는 본문 밖 공통 푸터에 배치",
    );
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await ev(`document.querySelector('.modal-body').scrollTop = 100000`);
      await wait(
        `(()=>{const r=document.querySelector('.modal-foot').getBoundingClientRect();return r.bottom<=innerHeight&&r.top>0;})()`,
      );
      assert(
        await ev(`document.documentElement.scrollWidth<=innerWidth`),
        "스킬 작업 푸터 화면 내 표시 " + width,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/skill-actions-" + width + ".png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await click('.modal-foot [data-action="close"]');
    await click('[data-action="instruction-new"][data-kind="skills"]');
    assert(
      await ev(
        `!!document.querySelector('#instruction-import')&&document.querySelector('.modal-head [role="switch"]').checked`,
      ),
      "새 스킬은 파일 가져오기와 기본 활성화 제공",
    );
    await fill("id", "java-review");
    await fill("name", "Java 검토");
    await fill("description", "동등 비교를 검토한다.");
    assert(
      await ev(`!document.querySelector('[name=scope]')`),
      "스킬 적용 대상 필드 제거",
    );
    await fill("content", "문자열 비교는 equals와 ==의 차이를 설명한다.");
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.projectSpec.skills.length === 5,
      "프로젝트 스킬 저장",
    );
    assert(
      store.db.workspaces[0].document.projectSpec.skills.find(
        (x) => x.id === "java-review",
      ).enabled === true,
      "새 스킬의 활성화 스위치 기본값 보존",
    );
    await click('[data-action="spec"]');
    await click('[data-action="edit-requirement"]');
    assert(
      await ev(`!document.querySelector('.evaluation-policy-fields')`),
      "하위 요구사항 편집에서 평가 기준 제거",
    );
    assert(
      await ev(
        `!document.querySelector('#inline-editor [name=status]')&&!document.querySelector('[data-action=spec-status]')`,
      ),
      "요구사항 상태 선택과 명세 합의 버튼 제거",
    );
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].status === "pending",
      "생성한 요구사항은 구현 이전",
    );
    assert(
      await ev(
        `document.querySelector('.spec-link .state-icon.pending')&&document.querySelector('.requirement-nav .state-icon.pending')&&!document.querySelector('.spec-link').textContent.includes('구현 이전')&&document.querySelector('.spec-link .nav-identifier').previousElementSibling.classList.contains('state-icon')`,
      ),
      "좌측 아이콘·식별번호·이름과 빨간 구현 이전 표시",
    );

    await click('[data-action="ai-settings"]');
    await wait(`!!document.querySelector('[data-service="claude"]')`);
    assert(
      await ev(
        `!!document.querySelector('[data-service="claude"]')&&!document.querySelector('#f-apiKey')`,
      ),
      "AI 연결은 서비스 선택부터 시작",
    );
    await click('[data-service="openai"]');
    await click('[data-method="subscription"]');
    await wait(`!!document.querySelector('[data-action="official-login"]')`);
    await click('[data-action="official-login"]');
    await wait(
      `document.querySelector('#official-login-info')?.textContent.includes('로그인 완료를 기다리는')`,
    );
    await closeSaved();
    await wait(
      `document.querySelector('#model-select').closest('.v-select').dataset.value==='test-codex'`,
    );
    await pointerClick(".composer-models .v-select:nth-child(2) .v-field");
    await wait(
      `!!document.querySelector('.v-overlay--active [role="option"]')&&getComputedStyle(document.querySelector('.v-overlay--active .v-overlay__content')).pointerEvents!=='none'`,
    );
    await shortcut("#effort-select", "End", "End", 0);
    await wait(`document.activeElement?.textContent.trim()==='high'`);
    assert(
      await ev(`document.activeElement?.textContent.trim()==='high'`),
      "End키로 마지막 옵션에 이동",
    );
    await shortcut(
      '.v-overlay--active [role="option"][aria-posinset="3"]',
      "Enter",
      "Enter",
      0,
    );
    await wait(
      `document.querySelector('#effort-select').closest('.v-select').dataset.value==='high'&&!document.querySelector('.v-overlay--active [role="listbox"]')`,
    );
    assert(
      await ev(
        `document.querySelector('#effort-select').closest('.v-select').textContent.includes('high')`,
      ),
      "추론 강도는 키보드로 선택하고 기존 모델 설정에 반영",
    );
    assert(
      await ev(`document.querySelectorAll('[data-mode]').length===0`),
      "웹 AI 역할 선택 제거",
    );
    await click('[data-action="ai-options"]');
    await wait(
      `!!document.querySelector('dialog[open] .v-select input[role=combobox]')`,
    );
    assert(
      await ev(
        `document.querySelector('dialog[open]').textContent.includes('외부 문서 검색')&&document.querySelector('dialog[open]').textContent.includes('자동 · 필요할 때 검색')`,
      ),
      "채팅 응답 설정에서 자동 외부 문서 검색 제공",
    );
    await pointerClick('button[aria-label="외부 문서 검색 설명"]');
    await wait(`!!document.querySelector('dialog[open] [role="tooltip"]')`);
    assert(
      await ev(
        `(()=>{const tip=document.querySelector('dialog[open] [role="tooltip"]');const t=tip.getBoundingClientRect(),label=tip.closest('label').getBoundingClientRect(),modal=document.querySelector('dialog[open]').getBoundingClientRect();return Math.abs(t.top-label.bottom)<2&&t.bottom<modal.bottom&&tip.contains(document.elementFromPoint(t.x+t.width/2,t.y+t.height/2));})()`,
      ),
      "외부 문서 검색 툴팁은 라벨 바로 아래에서 가려지지 않고 표시",
    );
    await shortcut(
      'button[aria-label="외부 문서 검색 설명"]',
      "Escape",
      "Escape",
      0,
    );
    await wait(`!document.querySelector('dialog[open] [role="tooltip"]')`);
    await pointerClick("dialog[open] .v-select .v-field");
    await wait(
      `!!document.querySelector('dialog[open] .v-overlay--active [role=listbox]')`,
    );
    await wait(
      `(()=>{const items=[...document.querySelectorAll('dialog[open] .v-overlay--active [role=option]')];return items.length>0&&items.every(item=>{const r=item.getBoundingClientRect();return item.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})})()`,
    );
    assert(
      await ev(
        `!document.querySelector('dialog[open] .v-field .v-overlay--active')`,
      ),
      "모달 선택 목록은 하단 입력에 가려지지 않고 모든 항목 클릭 가능",
    );
    const settingsMenuShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/chat-settings-menu.png"),
      Buffer.from(settingsMenuShot.data, "base64"),
    );
    await shortcut(
      "dialog[open] .v-select input[role=combobox]",
      "Escape",
      "Escape",
      0,
    );
    assert(
      await ev(
        `document.querySelector('dialog').open&&!document.querySelector('dialog[open] .v-overlay--active [role=listbox]')`,
      ),
      "모달 안에서 Escape는 셀렉트 메뉴부터 닫음",
    );
    await click('.modal-foot [data-action="close"]');
    await closeSaved();
    await ev(
      `document.querySelector('#chat-input').value='/java-review 중복 요청 검증을 요구사항으로 추가해줘. 완료 기준도 포함해줘.';document.querySelector('#chat-input').dispatchEvent(new Event("input",{bubbles:true}))`,
    );
    await ev(
      `window.originalRandomUUID=crypto.randomUUID;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined})`,
    );
    await ev(
      `document.querySelector('#chat-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.rich-chat .ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`,
    );
    await wait(`!!document.querySelector('[data-action="review-proposal"]')`);
    assert(
      await ev(`typeof crypto.randomUUID==='undefined'`),
      "LAN HTTP처럼 randomUUID가 없어도 채팅 전송과 응답 완료",
    );
    await ev(
      `Object.defineProperty(crypto,'randomUUID',{configurable:true,value:window.originalRandomUUID});delete window.originalRandomUUID`,
    );
    assert(
      Object.keys(store.db.workspaces[0].document.files).length === 0,
      "명세 AI는 코드 파일을 생성하지 않음",
    );
    await click('[data-action="review-proposal"]');
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].requirements.length === 2,
      "AI 요구사항 제안 편집 후 반영",
    );
    assert(pool.calls[0].effort === "high", "모델 추론 강도 전달");
    assert(
      store.db.chats.length === 2 &&
        store.db.users[0].aiSettings.effort === "high",
      "서버에 개인 대화와 모델 설정 저장",
    );
    assert(
      await ev(
        `!!document.querySelector('.bubble.assistant .code-block pre code')`,
      ),
      "AI 답변에 코드 블록 렌더링",
    );
    await ev(
      `window.copiedCode='';window.originalWriteText=navigator.clipboard.writeText;navigator.clipboard.writeText=async text=>{window.copiedCode=text;}`,
    );
    await click('.bubble.assistant [data-action="copy-code"]');
    assert(
      await ev(`window.copiedCode.includes('java.util.Objects.equals')`),
      "Vue Markdown 컴포넌트의 코드 복사 동작",
    );
    await ev(`navigator.clipboard.writeText=window.originalWriteText`);
    assert(
      await ev(
        `!document.querySelector('[data-view="files"]')&&!document.querySelector('[data-action="context-files"]')&&!!document.querySelector('.spec-parent [data-view="requirements"]')`,
      ),
      "참고 코드 제거와 전체 요구사항 아래 명세 배치",
    );
    assert(
      pool.calls[0].prompt.includes("문자열 비교는 equals"),
      "슬래시 스킬의 실제 AI 문맥 반영",
    );
    assert(
      pool.calls[0].prompt.includes("나의 공통 지침 테스트") &&
        pool.calls[0].prompt.includes("워크스페이스 공통 지침 테스트"),
      "개인 및 워크스페이스 공통 지침을 실제 AI 요청에 전달",
    );
    await click("[data-view=workspace]");
    await wait(
      `!document.querySelector('#chat-input').disabled&&document.querySelector('.chat-context').textContent.includes('워크스페이스 전체')`,
    );
    await ev(
      `document.querySelector('#chat-input').value='워크스페이스 전반 질문';document.querySelector('#chat-input').dispatchEvent(new Event("input",{bubbles:true}));document.querySelector('#chat-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.rich-chat .ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`,
    );
    await wait(
      `document.querySelectorAll('.bubble').length===2&&!document.querySelector('[data-action=cancel-chat]')`,
    );
    assert(
      pool.calls.at(-1).prompt.includes("워크스페이스 협의자"),
      "명세 클릭 없이 워크스페이스 AI 대화",
    );
    assert(
      await ev(
        `!document.querySelector('[data-action=review-proposal]')&&!document.querySelector('.composer').textContent.includes('Shift+Enter')`,
      ),
      "전체 대화에 특정 명세 반영 버튼과 하단 안내 없음",
    );
    await click("[data-action=spec]");
    await wait(
      `document.querySelector('.chat-context').textContent.includes('명세 대화')&&document.querySelectorAll('.bubble').length===2`,
    );
    assert(
      await ev(
        `!document.querySelector('#chat-list').textContent.includes('워크스페이스 전반 질문')`,
      ),
      "명세로 전환하면 해당 대화 기록 복원",
    );
    await click('[data-action="view"][data-view="history"]');
    assert(
      await ev(
        `document.querySelector('.timeline').textContent.includes('요구사항 추가')`,
      ),
      "워크스페이스 전역 커밋 이력",
    );
    await click('[data-action="spec"]');
    await wait(`!!document.querySelector('.resource')`);
    assert(
      await ev(`document.querySelectorAll('.tabs button').length===2`),
      "명세는 요구사항과 계획 두 탭",
    );
    await click('[data-tab="design"]');
    assert(
      await ev(
        `!!document.querySelector('.plan-empty [data-action=plan-generate]')&&!document.querySelector('[data-action=edit-design]')&&!document.querySelector('.plan-empty img')&&!document.querySelector('[data-action=plan-import]')`,
      ),
      "계획은 AI 생성 버튼으로 시작",
    );
    assert(
      await ev(
        `document.querySelectorAll('.plan-skill-card').length===4&&!!document.querySelector('.plan-skill-footer [data-action="plan-reset-skills"]')`,
      ),
      "계획 스킬 네 개를 카드와 공통 하단 작업 영역으로 정렬",
    );
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      if (width === 390) await click('.topbar [data-action="toggle-ai"]');
      await ev(
        `document.querySelector('.plan-skills').closest('details').open=true;document.querySelector('.plan-skills').scrollIntoView({block:'center'})`,
      );
      assert(
        await ev(
          `(()=>{const e=document.querySelector('.plan-skills');return e.scrollWidth<=e.clientWidth&&[...e.querySelectorAll('.plan-skill-card')].every(c=>c.scrollWidth<=c.clientWidth)})()`,
        ),
        `계획 스킬 카드 넘침 없음 ${width}`,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots", `plan-skills-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
      if (width === 390) await click('.topbar [data-action="toggle-ai"]');
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await ev(`document.querySelector('.plan-heading').scrollIntoView()`);
    await click('[data-action="edit-spec-evaluation"]');
    assert(
      await ev(
        `document.querySelector('.evaluation-policy-fields').tagName === "SECTION"`,
      ),
      "평가 기준 편집은 추가 펼치기 없이 표시",
    );
    assert(
      await ev(
        `document.querySelector('#evaluation-inherited').textContent.includes('85점') && document.querySelector('#evaluation-inherited').textContent.includes('워크스페이스')`,
      ),
      "명세는 워크스페이스 평가 기준 상속",
    );
    await ev(
      `document.querySelector('.v-select:has(#f-evaluationMode)').scrollIntoView({block:"center"})`,
    );
    await new Promise((r) => setTimeout(r, 250));
    await pointerClick(".v-select:has(#f-evaluationMode) .v-field");
    await ev(
      `[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.includes('직접 설정')).click()`,
    );
    await wait(`!document.querySelector('#f-evaluationTarget').disabled`);
    await ev(
      `(() => {const e=document.querySelector('#f-evaluationTarget');e.value='90';e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].evaluationPolicy.targetScore ===
        90,
      "명세 계획 전체 평가 기준 저장",
    );
    await click('[data-action="edit-spec-evaluation"]');
    assert(
      await ev(`document.querySelector('#f-evaluationTarget').value === '90'`),
      "명세 기준 다시 열기",
    );
    await submit();
    await closeSaved();
    await click('[data-action="plan-settings"]');
    await wait(`document.querySelector('#f-mode')`);
    assert(
      await ev(
        `!document.querySelector('#f-targetScore') && document.querySelector('#modal').textContent.includes('워크스페이스 공통 설정')`,
      ),
      "실행 설정은 평가 기준 상속 안내 제공",
    );
    assert(
      await ev(`!document.querySelector('#f-mode').closest('details')`),
      "실행 설정의 모델 선택 바로 표시",
    );
    await pointerClick(".v-select:has(#f-mode) .v-field");
    await wait(
      `[...document.querySelectorAll('[role=option]')].some(x=>x.textContent.includes('여러 설계 후보 비교'))`,
    );
    await ev(
      `[...document.querySelectorAll('[role=option]')].find(x=>x.textContent.includes('여러 설계 후보 비교')).click()`,
    );
    await wait(`!document.querySelector('#plan-writer-1').hidden`);
    assert(
      await ev(
        `!document.querySelector('#plan-writer-1').hidden&&!document.querySelector('#plan-judge-1').hidden&&document.querySelector('#plan-writer-2').hidden`,
      ),
      "계획 구성에 맞춰 작성자·평가자 모델 선택 표시",
    );
    assert(
      await ev(
        `!!document.querySelector('#f-maxCalls')&&!!document.querySelector('#f-runMinutes')&&!document.querySelector('#f-rounds')&&!document.querySelector('#plan-call-estimate')&&!document.querySelector('#plan-mode-description')`,
      ),
      "계획 설정은 고정 반복 횟수 대신 호출·시간 예산 표시",
    );
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      assert(
        await ev(
          `(()=>{const d=document.querySelector('#modal'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth;})()`,
        ),
        `계획 실행 설정 화면 경계 ${width}`,
      );
      await ev(`document.querySelector('#plan-mode-help button').focus()`);
      await wait(
        `document.querySelector('[role="tooltip"]')?.textContent.includes('독립 평가')`,
      );
      assert(
        await ev(
          `(()=>{const r=document.querySelector('[role="tooltip"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`,
        ),
        `선택에 따른 진행 방식 툴팁 경계 ${width}`,
      );

      await ev(`document.activeElement.blur()`);

      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots", `plan-settings-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await submit();
    await closeSaved();
    let finishPlan;
    pool.planWait = async (opts) => {
      if (opts.session?.id !== "writer-1") return;
      if (!opts.prompt.includes("기존 등록은 보존하고 중복 요청만 거절합니다."))
        return {
          text: JSON.stringify({
            message: "확인 필요",
            proposal: null,
            files: [
              {
                path: "questions.json",
                content: JSON.stringify({
                  questions: [
                    "중복 요청이 오면 기존 등록을 어떻게 처리할까요?",
                    "오류 안내는 어떻게 표시할까요?",
                  ],
                }),
              },
            ],
          }),
        };
      delete pool.planWait;
      opts.onEvent({
        type: "delta",
        text: '요구사항을 검토합니다.\n\n{"message":"계획 작성 테스트","files":[{"path":"unfinished.html","content":"미완성',
      });
      await new Promise((resolve, reject) => {
        finishPlan = resolve;
        opts.signal.addEventListener(
          "abort",
          () => reject(opts.signal.reason),
          {
            once: true,
          },
        );
      });
    };
    await click('[data-action="plan-generate"]');
    await wait(
      `document.querySelector('.plan-question-text')?.textContent.includes('기존 등록을 어떻게')`,
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.length === 0,
      "확인 질문 대기 중 부분 계획을 저장하지 않음",
    );
    await click('[data-action="stop-plan"]');
    await wait(
      `document.querySelector('#plan-progress').textContent.includes('중지')&&!document.querySelector('[data-action="stop-plan"]')`,
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.length === 0,
      "답변 대기 중 중지해도 부분 계획을 저장하지 않음",
    );
    await click('[data-action="restart-plan"]');
    await wait(
      `document.querySelector('.plan-question-text')?.textContent.includes('기존 등록을 어떻게')`,
    );

    assert(
      await ev(
        `!document.querySelector('[data-action="show-plan-progress"]')&&!document.querySelector('dialog[open]')`,
      ),
      "별도 계획 채팅 열기 버튼 없이 진행은 우측 채팅에서 처리",
    );
    assert(
      await ev(
        `document.querySelectorAll('.plan-question-text').length===1&&!!document.querySelector('#plan-progress [data-action="stop-plan"]')&&!document.querySelector('.compose-foot [data-action="stop-plan"]')&&!document.querySelector('[aria-label="계획 진행 대화 숨기기"]')&&parseFloat(getComputedStyle(document.querySelector('.plan-question-text')).fontSize)>=16`,
      ),
      "한 번에 질문 하나를 기본 크기로 표시하며 답변 대기 중에도 중지 제공",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'기존 등록은 보존하고 중복 요청만 거절합니다.');})()`,
    );
    await click('.topbar [data-action="toggle-ai"]');
    await wait(
      `document.querySelector('.shell').classList.contains('chat-hidden')`,
    );
    if (
      await ev(
        `document.querySelector('.shell').classList.contains('chat-hidden')`,
      )
    ) {
      await click('.topbar [data-action="toggle-ai"]');
    }
    await wait(
      `!document.querySelector('.shell').classList.contains('chat-hidden')`,
    );
    assert(
      await ev(
        `document.querySelector('#chat-input').value.includes('기존 등록은 보존')`,
      ),
      "채팅을 숨겼다가 다시 열어도 질문 답변 초안 유지",
    );
    await click('[data-action="send-chat"]');
    await wait(
      `document.querySelector('.plan-question-text')?.textContent.includes('오류 안내')`,
    );
    await click('.topbar [data-action="toggle-ai"]');
    await wait(
      `document.querySelector('.shell').classList.contains('chat-hidden')`,
    );
    if (
      await ev(
        `document.querySelector('.shell').classList.contains('chat-hidden')`,
      )
    ) {
      await click('.topbar [data-action="toggle-ai"]');
    }
    assert(
      store.db.aiRuns
        .at(-1)
        .events.some(
          (e) =>
            e.type === "plan-question-answered" &&
            e.answer.includes("기존 등록은 보존"),
        ),
      "답변을 즉시 서버의 해당 질문으로 전달",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'오류 메시지를 화면에 표시합니다.');})()`,
    );
    const questionJob = store.db.aiRuns.at(-1).id;
    await ev("window.__questionReloadMarker = true");
    acceptReloadDialog = true;
    await call("Page.reload", {});
    await wait(
      `!window.__questionReloadMarker&&document.querySelector('.plan-question-text')?.textContent.includes('오류 안내')&&document.querySelector('#chat-input')?.value==='오류 메시지를 화면에 표시합니다.'`,
    );
    acceptReloadDialog = false;
    assert(
      store.db.aiRuns.at(-1).id === questionJob,
      "질문 대기 중 새로고침해도 같은 작업과 답변 초안 복원",
    );
    const questionShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/plan-chat-question.png"),
      Buffer.from(questionShot.data, "base64"),
    );
    await click('[data-action="send-chat"]');
    await wait(
      `document.querySelector('#plan-progress')?.textContent.includes('응답 수신 86자')`,
    );
    assert(
      await ev(
        `document.querySelector('#plan-progress').textContent.includes('test-codex')&&document.querySelector('#plan-progress').textContent.includes('경과')`,
      ),
      "계획 채팅에서 단계·모델·경과·수신량 표시",
    );
    assert(
      await ev(`(() => {
      const bar = document.querySelector('#plan-progress .v-progress-linear');
      const details = document.querySelector('#plan-progress .plan-execution-details');
      return bar && details && details.getBoundingClientRect().top - bar.getBoundingClientRect().bottom >= 16;
    })()`),
      "계획 상태바와 실행 상세 사이 여백 확보",
    );
    await click("#plan-progress .plan-execution-details summary");
    await wait(
      `(() => { const el = document.querySelector('#plan-progress .plan-execution-details'); return el.open && !el.getAnimations().length; })()`,
    );
    assert(
      await ev(
        `document.querySelector('#plan-progress .plan-execution-details summary').getAttribute('aria-expanded') === 'true'`,
      ),
      "계획 상세 펼치기 상태 표시",
    );
    await click("#plan-progress .plan-execution-details summary");
    await wait(
      `!document.querySelector('#plan-progress .plan-execution-details').open`,
    );
    await ev(
      `(() => { const el = document.querySelector('#plan-progress .plan-execution-details summary'); el.click(); el.click(); el.click(); })()`,
    );
    await wait(
      `(() => { const el = document.querySelector('#plan-progress .plan-execution-details'); return el.open && !el.getAnimations().length; })()`,
    );
    assert(
      await ev(
        `document.querySelector('#plan-progress .plan-execution-details').getBoundingClientRect().height > 60`,
      ),
      "계획 상세 빠른 연속 전환 후 정상 펼침",
    );
    await click('.topbar [data-action="toggle-ai"]');
    await click('[data-tab="requirements"]');
    await wait(`!document.querySelector('.plan-heading')`);
    await click('[data-tab="design"]');
    if (
      await ev(
        `document.querySelector('.shell').classList.contains('chat-hidden')`,
      )
    ) {
      await click('.topbar [data-action="toggle-ai"]');
    }
    const progressShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/plan-progress.png"),
      Buffer.from(progressShot.data, "base64"),
    );
    await chooseTheme("dark");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await ev(
      `document.querySelector('#plan-progress .bubble.assistant').scrollIntoView({block: 'start'})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert(
      await ev(
        `(() => { const el = document.querySelector('#plan-progress .bubble.assistant'); return el.scrollWidth <= el.clientWidth + 1; })()`,
      ),
      "모바일 다크 계획 진행 카드 가로 넘침 없음",
    );
    await ev(
      `document.querySelector('#plan-progress .bubble.assistant').scrollIntoView({block: 'start'})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const mobileProgressShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/plan-progress-mobile-dark.png"),
      Buffer.from(mobileProgressShot.data, "base64"),
    );
    await chooseTheme("light");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await ev(
      `[...document.querySelectorAll('.agent-step')].find(b=>b.textContent.includes('진행 중')).click()`,
    );
    await wait(
      `document.querySelector('dialog[open] .agent-response-body')?.textContent.includes('계획 작성 테스트')`,
    );
    assert(
      await ev(
        `document.querySelectorAll('dialog[open] .agent-response-tabs button').length>=2`,
      ),
      "에이전트 모달에서 같은 세션의 질문·재개 요청을 선택하고 실시간 출력 확인",
    );
    assert(
      await ev(
        `(() => { const modal = document.querySelector('dialog[open]'); return !modal.querySelector('.agent-response-body').textContent.includes('unfinished.html') && !modal.querySelector('.agent-response-body').textContent.includes('미완성') && modal.querySelector('.agent-response-header .agent-response-tabs').textContent.includes('(test-codex)'); })()`,
      ),
      "완성된 응답 단위만 표시하고 단계와 모델을 상단 한 줄로 묶음",
    );
    await click('dialog[open] [aria-label="세션 정지"]');
    await wait(
      `!document.querySelector('dialog[open] [aria-label="세션 재시작"]').disabled`,
    );
    assert(
      await ev(
        `document.querySelector('dialog[open] [aria-label="세션 정지"]').disabled && document.querySelector('[data-action="stop-plan"]') !== null`,
      ),
      "세션 정지 후 전체 계획을 유지하며 재시작 제공",
    );
    const pausedShot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/agent-paused.png"),
      Buffer.from(pausedShot.data, "base64"),
    );
    await chooseTheme("dark");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert(
      await ev(
        `(() => { const modal = document.querySelector('dialog[open]'); const button = modal.querySelector('[aria-label="세션 재시작"]').getBoundingClientRect(); return modal.scrollWidth <= modal.clientWidth + 1 && button.left >= 0 && button.right <= innerWidth; })()`,
      ),
      "모바일 다크 모달의 세션 버튼과 응답이 가로 넘침 없이 표시",
    );
    const mobileAgent = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/agent-mobile-dark.png"),
      Buffer.from(mobileAgent.data, "base64"),
    );
    await chooseTheme("light");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    let invalidAttempts = 0;
    pool.planWait = async () => {
      if (++invalidAttempts > runtimeConfig.planValidationRetries)
        delete pool.planWait;
      return {
        text: JSON.stringify({
          message: "형식 오류 테스트",
          files: store.db.workspaces[0].document.specs[0].requirements.map(
            (r) => ({
              path: r.id + ".html",
              content: '{"implementation":"broken"',
            }),
          ),
        }),
      };
    };
    await click('dialog[open] [aria-label="세션 재시작"]');
    finishPlan();
    await wait(
      `document.querySelector('dialog[open] .agent-response')?.textContent.includes('오류 내용 보기') && !document.querySelector('dialog[open] [aria-label="세션 재시작"]').disabled`,
    );
    assert(
      await ev(
        `!!document.querySelector('[data-action="stop-plan"]') && document.querySelector('#plan-progress').textContent.includes('재시작 대기')`,
      ),
      "형식 오류는 해당 세션의 재시작 대기로 격리하고 전체 계획 유지",
    );
    assert(
      await ev(
        `!document.querySelector('dialog[open] .agent-response-body').textContent.includes('broken')`,
      ),
      "형식 오류인 본문의 깨진 JSON은 표시하지 않음",
    );
    assert(
      await ev(
        `!document.querySelector('#modal .agent-response').textContent.includes('JSON 문법이 올바르지 않습니다')`,
      ),
      "오류 설명은 응답 본문에서 분리",
    );
    await ev(
      `(() => { const button = document.querySelector('#modal [aria-label="오류 내용 보기"]'); button.focus(); button.click(); })()`,
    );
    await wait(`!!document.querySelector('.session-error-dialog[open]')`);
    assert(
      await ev(
        `(() => { const modal = document.querySelector('.session-error-dialog[open]'); const detail = modal.querySelector('.agent-failure-details')?.textContent || ''; return modal.textContent.includes('응답 형식 오류') && detail.includes('경과') && detail.includes('수신') && detail.includes('발생'); })()`,
      ),
      "실패 원인 분류와 발생 시각·경과 시간·수신량을 세션 모달에 표시",
    );
    const failedAgent = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/agent-failed.png"),
      Buffer.from(failedAgent.data, "base64"),
    );
    await chooseTheme("dark");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert(
      await ev(
        `(() => { const d = document.querySelector('.session-error-dialog[open]'); const r = d.getBoundingClientRect(); return d.scrollWidth <= d.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth; })()`,
      ),
      "오류 상세 모달 모바일 다크 표시와 가로 넘침 확인",
    );
    const mobileError = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/agent-error-mobile-dark.png"),
      Buffer.from(mobileError.data, "base64"),
    );
    await chooseTheme("light");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await wait(
      `!document.querySelector('.session-error-dialog[open]') && !!document.querySelector('#modal[open]')`,
    );
    assert(
      await ev(
        `document.activeElement?.textContent.includes('오류 내용 보기')`,
      ),
      "오류 모달 Escape 후 세션 응답 유지와 포커스 복귀",
    );
    await click('dialog[open] [aria-label="세션 재시작"]');
    await wait(
      `document.querySelector('dialog[open] .agent-response-body')?.textContent.includes('구현 방법')`,
    );
    assert(
      await ev(
        `document.querySelector('dialog[open] .agent-response-body').textContent.includes('변경 후 코드')&&!!document.querySelector('dialog[open] .agent-response-body .code-block')&&!document.querySelector('dialog[open] .agent-response-raw')`,
      ),
      "에이전트 응답을 본문·코드로 표시하고 원문 보기 제거",
    );
    const responseShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/agent-response.png"),
      Buffer.from(responseShot.data, "base64"),
    );
    await ev(
      `document.querySelector('dialog[open] [aria-label="닫기"]').click()`,
    );
    await wait('!document.querySelector("dialog[open]")');
    await wait(
      `!!document.querySelector('.plan-evaluation')&&!document.querySelector('[data-action="stop-plan"]')`,
    );
    assert(
      await ev(
        `document.querySelector('#plan-progress').textContent.includes('목표 달성')&&document.querySelector('#plan-progress').textContent.includes('독립 평가')`,
      ),
      "완료 후에도 계획 채팅에서 실행 기록 확인",
    );
    assert(
      await ev(
        `!document.querySelector('.chat-mode-tabs')&&document.querySelector('.chat-context').textContent.includes('계획 대화')`,
      ),
      "계획 페이지에서 전환 버튼 없이 계획 대화 표시",
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.length === 1,
      "AI HTML 계획을 서버에 첫 버전으로 저장",
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions[0].html.includes(
        'data-codewith-plan-ui="1"',
      ) &&
        store.db.workspaces[0].document.specs[0].plans.versions[0].html.match(
          /class="plan-card"/g,
        ).length === 10,
      "요구사항마다 동일한 다섯 섹션 공통 UI",
    );
    assert(
      pool.calls.at(-1).prompt.includes("계획서 공통 UI"),
      "UI 스킬이 실제 계획 요청에 포함",
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.finalVersionId === null,
      "첫 생성도 최종으로 자동 선택하지 않음",
    );
    assert(
      await ev(
        `document.querySelector('.plan-evaluation').textContent.includes('91.0 / 100점')&&document.querySelector('.plan-version-list').textContent.includes('91.0 / 100점')`,
      ),
      "HTML 버전별 실제 평균 점수 표시",
    );
    assert(
      await ev(
        `!document.querySelector('.plan-version-list').closest('details')`,
      ),
      "버전 목록은 접기 없이 바로 선택 가능",
    );
    assert(
      await ev(
        `document.querySelectorAll('.plan-actions .primary').length===1 && document.querySelector('.plan-actions .primary').textContent==='최종 승인'`,
      ),
      "목표 달성 시 최종 승인만 주요 버튼으로 강조",
    );
    assert(
      await ev(
        `(()=>{const a=document.querySelector('[data-action="plan-edit"]');return !!a.closest('.plan-version-head')&&!document.querySelector('.plan-actions [data-action="plan-revise"]')&&!document.querySelector('.plan-actions [data-action="plan-evaluate"]')&&a.tagName==='A'&&a.target==='_blank'&&!!a.querySelector('svg')&&!a.textContent.trim()&&a.getAttribute('aria-label').includes('직접 편집')})()`,
      ),
      "새 탭 편집은 접근성 이름을 가진 공통 아이콘 버튼",
    );
    assert(
      await ev(`(() => {
    const area = document.querySelector('.plan-evaluation');
    const metrics = area.querySelector('.criteria-metrics');
    const outcome = area.querySelector('.plan-outcome');
    const history = area.querySelector('.plan-improvement-history');
    const criteria = area.querySelector('.criteria-group');
    return metrics.nextElementSibling === outcome && outcome.nextElementSibling === history && history.open && !!(history.compareDocumentPosition(criteria) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`),
      "필수 기준·차단 문제 바로 아래 결과와 펼쳐진 개선 이력 배치",
    );
    assert(
      await ev(
        `(() => { const area = document.querySelector('.plan-evaluation'); return area.querySelector('.plan-outcome').textContent.includes('목표 달성') && !area.textContent.includes('마지막 시도 보기') && !area.querySelector('.evaluation-status') && !area.querySelector('.evaluation-blockers'); })()`,
      ),
      "결과 안내 통합 및 마지막 시도 버튼 제거",
    );
    for (const selector of [
      ".criteria-group",
      ".criteria-group .criterion-row",
      ".evaluation-candidates",
      ".evaluation-candidate",
    ]) {
      const before = await ev(`document.querySelector('${selector}').open`);
      await ev(`document.querySelector('${selector} > summary').click()`);
      await wait(
        `(() => { const el = document.querySelector('${selector}'); return el.open === ${!before} && !el.getAnimations().length; })()`,
      );
      assert(
        await ev(
          `document.querySelector('${selector} > summary').getAttribute('aria-expanded') === '${!before}'`,
        ),
        `계획 평가 상세 펼침 상태 동기화 ${selector}`,
      );
      if (selector === ".criteria-group") {
        await ev(`document.querySelector('${selector} > summary').click()`);
        await wait(
          `(() => { const el = document.querySelector('${selector}'); return el.open && !el.getAnimations().length; })()`,
        );
      }
    }
    await ev(
      `document.querySelector('.evaluation-candidates > summary').click()`,
    );
    await wait(`!document.querySelector('.evaluation-candidates').open`);
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      if (width === 390) await click('[data-action="toggle-ai"]');
      assert(
        await ev(
          `(()=>{const area=document.querySelector('.plan-actions');const bounds=area.getBoundingClientRect();return [...area.querySelectorAll('.v-btn')].every(b=>{const r=b.getBoundingClientRect();return Math.abs(r.height-36)<1&&r.left>=bounds.left-1&&r.right<=bounds.right+1})})()`,
        ),
        `계획 작업 버튼 높이와 화면 경계 통일 ${width}`,
      );
      await ev(
        `document.querySelector('.plan-action-area').scrollIntoView({block:'center'})`,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, `data/screenshots/plan-actions-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
      await ev(
        `document.querySelector('.criteria-metrics').scrollIntoView({block:'center'})`,
      );
      if (width === 390) await chooseTheme("dark");
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert(
        await ev(
          `(() => { const el = document.querySelector('.plan-evaluation'); return el.scrollWidth <= el.clientWidth + 1; })()`,
        ),
        `계획 평가 결과 가로 넘침 없음 ${width}`,
      );
      const summaryShot = await call("Page.captureScreenshot", {
        format: "png",
      });
      fs.writeFileSync(
        path.join(root, `data/screenshots/plan-result-${width}.png`),
        Buffer.from(summaryShot.data, "base64"),
      );
      await ev(
        `document.querySelector('.criteria-group .criterion-row').scrollIntoView({block:'center'})`,
      );
      const criterionShot = await call("Page.captureScreenshot", {
        format: "png",
      });
      fs.writeFileSync(
        path.join(root, `data/screenshots/plan-criterion-${width}.png`),
        Buffer.from(criterionShot.data, "base64"),
      );
      if (width === 390) await chooseTheme("light");
      if (width === 390) await click('[data-action="toggle-ai"]');
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const repairSpec = store.db.workspaces[0].document.specs[0];
    const repairCalls = repairSpec.plans.versions[0].execution.calls.length;
    // The fixture corrupts every requirement: each repair keeps the other files
    // unchanged, so the remaining invalid requirement needs its own correction.
    assert(
      repairCalls ===
        6 +
          runtimeConfig.planValidationRetries +
          repairSpec.requirements.length -
          1,
      `단계별 호출과 검사에서 지적한 요구사항별 자동 수정 횟수 확인 (${repairCalls})`,
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions[0].html.includes(
        'class="hljs-',
      ),
      "저장 HTML 코드에 구문 색상 포함",
    );

    assert(
      await ev(
        `!document.querySelector('.plan-preview, .plan-document, .plan-supporting') && !!document.querySelector('[data-action="plan-edit"][target="_blank"]')`,
      ),
      "본문 미리보기와 작성 환경 제거 후 새 탭 계획 열기 유지",
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions[0].html.match(
        /class="tab-state"/g,
      ).length === 2,
      "요구사항 두 개를 HTML 상단 탭으로 구성",
    );
    await chooseTheme("dark");
    await wait(`document.documentElement.dataset.theme==='dark'`);
    assert(
      await ev(
        `getComputedStyle(document.querySelector('.plan-view')).backgroundColor==='rgb(33, 33, 47)'&&getComputedStyle(document.querySelector('#assistant')).backgroundColor==='rgb(33, 33, 47)'`,
      ),
      "계획 화면과 AI 채팅 패널 다크 배경",
    );
    assert(
      await ev(
        `(()=>{const outer=getComputedStyle(document.querySelector('.composer'));const input=getComputedStyle(document.querySelector('.compose-box'));return outer.borderTopWidth==='0px'&&outer.backgroundColor==='rgba(0, 0, 0, 0)'&&input.borderTopWidth==='1px'&&parseFloat(input.borderTopLeftRadius)>0;})()`,
      ),
      "채팅 패널 외부 배경은 이어지고 내부 입력창 테두리는 유지",
    );
    assert(
      await ev(
        `(()=>{const badge=document.querySelector('.criterion-badge');return badge.dataset.planTone==='success'&&getComputedStyle(badge).color==='rgb(134, 239, 172)'&&document.querySelectorAll('.criteria-metric[data-plan-tone="success"]').length>=2})()`,
      ),
      "다크 모드에서도 충족 태그와 필수 기준·차단 문제 상태색 유지",
    );
    const darkPreview = await ev(
      `fetch("/api/workspaces/${store.db.workspaces[0].id}/plans/${repairSpec.id}/${repairSpec.plans.versions[0].id}.html?theme=dark").then(r=>r.text())`,
    );
    assert(
      darkPreview.includes('data-codewith-preview-theme="dark"') &&
        !store.db.workspaces[0].document.specs[0].plans.versions[0].html.includes(
          "data-codewith-preview-theme",
        ),
      "계획 미리보기만 다크로 표시하고 저장 원본 유지",
    );
    await new Promise((r) => setTimeout(r, 250));
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/dark-plans.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await chooseTheme("system");
    await click('[data-action="plan-select"]');
    await wait(`document.querySelector('#modal').open`);
    await submit();
    await closeSaved();
    await wait(
      `document.querySelector('.plan-version-head .pill').textContent==='승인됨'`,
    );
    await click('[data-tab="requirements"]');
    await ev(`document.querySelectorAll('.resource').forEach(d=>d.open=true)`);
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      if (width === 390) await click('.topbar [data-action="toggle-ai"]');
      await ev(`document.querySelector('.center').scrollTop=500`);
      await wait(
        `(()=>{const h=document.querySelector('.spec-header').getBoundingClientRect(),t=document.querySelector('.topbar').getBoundingClientRect();return Math.abs(h.top-t.bottom)<2})()`,
      );
      assert(
        await ev(
          `(()=>{const h=document.querySelector('.spec-header').getBoundingClientRect(),tabs=document.querySelector('.spec-header .tabs').getBoundingClientRect();return tabs.top>=h.top&&tabs.bottom<innerHeight})()`,
        ),
        `제목부터 요구사항·계획 탭까지 스크롤 고정 ${width}`,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots", `sticky-spec-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
      await ev(`document.querySelector('.center').scrollTop=0`);
      if (width === 390) await click('.topbar [data-action="toggle-ai"]');
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await shortcut("#composer-resizer", "End", "End", 0);
    assert(
      await ev(
        `(()=>{const p=document.querySelector('#assistant').getBoundingClientRect(),c=document.querySelector('.composer').getBoundingClientRect();return c.height<=p.height/2+1&&c.height>=p.height/2-2;})()`,
      ),
      "입력창 최대 높이는 채팅 패널의 절반",
    );
    const composerHandle = await ev(
      `(()=>{const r=document.querySelector('#composer-resizer').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,height:document.querySelector('.composer').getBoundingClientRect().height};})()`,
    );
    await call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: composerHandle.x,
      y: composerHandle.y,
      button: "left",
      clickCount: 1,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: composerHandle.x,
      y: composerHandle.y + 80,
      button: "left",
      buttons: 1,
    });
    await call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: composerHandle.x,
      y: composerHandle.y + 80,
      button: "left",
      clickCount: 1,
    });
    assert(
      await ev(
        `Math.abs(document.querySelector('.composer').getBoundingClientRect().height - ${composerHandle.height - 80})<2`,
      ),
      "입력창 경계를 드래그하면 높이가 조절됨",
    );
    const resizeShot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/composer-resize.png"),
      Buffer.from(resizeShot.data, "base64"),
    );
    await shortcut("#composer-resizer", "Home", "Home", 0);
    assert(
      await ev(
        `!document.querySelector('#plan-progress')&&document.querySelector('.chat-context').textContent.includes('명세 대화')&&document.querySelector('.composer').getBoundingClientRect().height>=240`,
      ),
      "요구사항 페이지는 일반 대화이며 입력창 최소 높이 유지",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),Array(60).fill('긴 메시지').join(String.fromCharCode(10)));})()`,
    );
    assert(
      await ev(
        `(()=>{const input=document.querySelector('.rich-chat .ProseMirror'),foot=document.querySelector('.compose-foot').getBoundingClientRect(),box=document.querySelector('.composer').getBoundingClientRect();return input.scrollHeight>input.clientHeight&&foot.bottom<=box.bottom&&input.getBoundingClientRect().bottom<=foot.top;})()`,
      ),
      "긴 메시지는 입력창 내부에서 스크롤되고 전송 버튼을 가리지 않음",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'#');})()`,
    );
    await shortcut(".rich-chat .ProseMirror", "Backspace", "Backspace", 0);
    assert(
      await ev(
        `!document.querySelector('.rich-chat .ProseMirror h1')&&document.querySelector('#chat-input').value===''`,
      ),
      "빈 제목에서 Backspace로 제목 서식 제거",
    );

    await ev(
      `document.querySelector('#chat-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}))`,
    );
    assert(
      await ev(
        `document.querySelector('#assistant').getBoundingClientRect().width<=innerWidth/2`,
      ),
      "대화창 너비는 화면 절반 이하",
    );
    await ev(
      `document.querySelector('#chat-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))`,
    );
    assert(
      await ev(
        `document.querySelector('#assistant').getBoundingClientRect().width>=360`,
      ),
      "채팅 패널 최소 너비 유지",
    );
    await click('[data-action="toggle-nav"]');
    assert(
      await ev(
        `getComputedStyle(document.querySelector('.rail')).display==='none'`,
      ),
      "좌측 메뉴 숨기기",
    );
    assert(
      await ev(
        `document.querySelector('.center').getBoundingClientRect().width>300`,
      ),
      "좌측 메뉴를 접어도 본문 너비 유지",
    );
    assert(
      await ev(
        `(()=>{const b=document.querySelector('[data-action="toggle-nav"]'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,
      ),
      "접은 메뉴 다시 열기 버튼이 화면에서 클릭 가능",
    );
    await click('[data-action="toggle-nav"]');
    await click('.topbar [data-action="toggle-ai"]');
    assert(
      await ev(
        `getComputedStyle(document.querySelector('#assistant')).display==='none'`,
      ),
      "우측 대화창 숨기기",
    );
    await click('.topbar [data-action="toggle-ai"]');
    assert(
      await ev(
        `!!document.querySelector('.compose-foot #model-select')&&!!document.querySelector('.compose-foot #effort-select')`,
      ),
      "모델과 effort는 보내기 근처에 배치",
    );
    const skillCalls = pool.calls.length;
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'');document.querySelector('.rich-chat .ProseMirror').focus();})()`,
    );
    await call("Input.insertText", { text: "$" });
    await wait(
      `!!document.querySelector('.rich-chat [data-skill="java-review"]')&&!document.querySelector('.rich-chat .rich-menu').hidden`,
    );
    assert(
      await ev(`!document.querySelector('.rich-chat .rich-menu [data-block]')`),
      "달러 입력은 블록 메뉴 대신 스킬 목록 표시",
    );
    for (let i = 0; i < 4; i++)
      await shortcut(".rich-chat .ProseMirror", "ArrowDown", "ArrowDown", 0);
    await shortcut(".rich-chat .ProseMirror", "Tab", "Tab", 0);
    assert(
      await ev(
        `document.querySelector('.rich-chat .ProseMirror').textContent.includes('$java-review')&&document.querySelector('.rich-chat .rich-menu').hidden`,
      ),
      "방향키와 Tab으로 스킬 삽입",
    );
    assert(
      pool.calls.length === skillCalls,
      "스킬 자동완성은 AI 요청을 전송하지 않음",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'');document.querySelector('.rich-chat .ProseMirror').focus();})()`,
    );
    await call("Input.insertText", { text: "검토할 내용 $ja" });
    await wait(
      `document.querySelectorAll('.rich-chat [data-skill]').length===1`,
    );
    await shortcut(".rich-chat .ProseMirror", "Enter", "Enter", 0);
    assert(
      await ev(
        `document.querySelector('.rich-chat .ProseMirror').textContent==='검토할 내용 $java-review '`,
      ),
      "문장 중간 스킬 검색·Enter 삽입은 앞 내용을 보존",
    );
    assert(
      pool.calls.length === skillCalls,
      "스킬 선택 Enter와 메시지 전송 구분",
    );
    await call("Input.insertText", { text: "다시 $java" });
    await wait(`!document.querySelector('.rich-chat .rich-menu').hidden`);
    await shortcut(".rich-chat .ProseMirror", "Escape", "Escape", 0);
    assert(
      await ev(
        `document.querySelector('.rich-chat .rich-menu').hidden&&document.querySelector('.rich-chat .ProseMirror').textContent.endsWith('$java')`,
      ),
      "Esc는 스킬 입력을 지우지 않고 후보만 닫기",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'');})()`,
    );
    await click('[data-action="command-menu"]');
    await wait(`!document.querySelector('.rich-chat .rich-menu').hidden`);
    assert(
      await ev(
        `document.querySelector('.rich-chat .ProseMirror').textContent===''&&document.querySelector('#chat-input').value===''&&!!document.querySelector('.rich-chat [data-skill]')`,
      ),
      "스킬 버튼은 달러 기호를 입력하지 않고 목록만 표시",
    );
    await shortcut(".rich-chat .ProseMirror", "Escape", "Escape", 0);
    assert(
      await ev(
        `document.querySelector('.rich-chat .rich-menu').hidden&&document.querySelector('#chat-input').value===''`,
      ),
      "스킬 선택 취소 후 빈 입력 유지",
    );
    await click('[data-action="command-menu"]');
    await wait(`!document.querySelector('.rich-chat .rich-menu').hidden`);
    await pointerClick(".assistant-head h2");
    assert(
      await ev(
        `document.querySelector('.rich-chat .rich-menu').hidden&&document.querySelector('#chat-input').value===''`,
      ),
      "스킬 목록 바깥 클릭도 달러 기호를 남기지 않음",
    );
    await ev(`document.querySelector('.rich-chat .ProseMirror').focus()`);
    await call("Input.insertText", { text: "검토 부탁해" });
    await click('[data-action="command-menu"]');
    await wait(`!document.querySelector('.rich-chat .rich-menu').hidden`);
    await shortcut(".rich-chat .ProseMirror", "Escape", "Escape", 0);
    assert(
      await ev(
        `document.querySelector('.rich-chat .ProseMirror').textContent==='검토 부탁해'`,
      ),
      "스킬 미선택은 기존 문장과 공백 보존",
    );
    await click('[data-action="command-menu"]');
    await wait(`!document.querySelector('.rich-chat .rich-menu').hidden`);
    await click('.rich-chat [data-skill="java-review"]');
    assert(
      await ev(
        `document.querySelector('.rich-chat .ProseMirror').textContent==='검토 부탁해 $java-review '`,
      ),
      "버튼에서 실제 스킬을 선택할 때만 달러와 스킬명 삽입",
    );

    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'');})()`,
    );
    await ev(`document.querySelector('.rich-chat .ProseMirror').focus()`);
    await call("Input.insertText", { text: "/" });
    await wait(`!document.querySelector('.rich-chat .rich-menu').hidden`);
    await click(".rich-chat [data-block=code]");
    assert(
      await ev(
        `!!document.querySelector('.rich-chat .ProseMirror pre')&&!document.querySelector('#composer-preview')`,
      ),
      "채팅에서 코드 블록을 직접 편집",
    );
    const countBefore = pool.calls.length;
    await ev(
      `document.querySelector('.rich-chat .ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));document.querySelector('.rich-chat .ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))`,
    );
    assert(
      pool.calls.length === countBefore,
      "Shift+Enter와 한글 조합 Enter는 전송하지 않음",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'');})()`,
    );
    // Vue keeps the editor instance and draft through panel changes, and disables
    // editing while an SSE request is active.
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'패널 전환 중 유지할 대화');})()`,
    );
    await click('[data-action="toggle-nav"]');
    await click('[data-action="toggle-nav"]');
    assert(
      await ev(
        `document.querySelector('.rich-chat .ProseMirror').textContent==='패널 전환 중 유지할 대화'`,
      ),
      "Vue 패널 갱신은 채팅 초안과 편집기 상태를 유지",
    );
    const streamedAnswer = "실시간 응답 내용입니다. ".repeat(12);
    let advanceStream, finishStream;
    pool.chatRun = async (opts) => {
      opts.onEvent({
        type: "delta",
        text: streamedAnswer.slice(0, 99),
      });
      await new Promise((resolve) => {
        advanceStream = resolve;
      });
      opts.onEvent({ type: "delta", text: streamedAnswer.slice(99, 120) });
      await new Promise((resolve) => {
        finishStream = resolve;
      });
      opts.onEvent({
        type: "delta",
        text: streamedAnswer.slice(120),
      });
      return {
        sources: [{ title: "Vue 공식 문서", url: "https://vuejs.org/guide/" }],
        text: JSON.stringify({
          message: streamedAnswer,
          proposal: null,
          specProposal: {
            title: "AI 제안 알림 명세",
            requirements: [
              {
                title: "알림 끄기",
                body: "비활성 계정에는 발송하지 않는다.",
                criteria: ["비활성 상태에서 메일이 발송되지 않는다."],
              },
            ],
          },
          files: [],
        }),
      };
    };
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'STREAM_QUEUE_TEST');})()`,
    );
    await ev(
      `{const e=document.querySelector('.chat-list');e.style.maxHeight='200px';e.scrollTop=0;e.dispatchEvent(new Event('scroll'));}`,
    );
    await wait(`!!document.querySelector('.chat-jump')`);
    await click('[data-action="send-chat"]');
    await wait(
      `document.querySelector('.chat-list .note')?.textContent.includes('99자')`,
    );
    await wait(`!document.querySelector('.chat-jump')`);
    assert(
      await ev(
        `(()=>{const e=document.querySelector('.chat-list');return e.scrollHeight-e.scrollTop-e.clientHeight<2})()`,
      ),
      "이전 메시지를 읽다가 전송하면 맨 아래로 이동",
    );
    await ev(`document.querySelector('.chat-list').style.maxHeight=''`);
    assert(
      await ev(
        `!document.querySelector('.chat-preview')&&!document.querySelector('#chat-input').disabled`,
      ),
      "100자 미만에는 진행 상태 표시, 응답 중 입력 가능",
    );
    await ev(`document.querySelector('.chat-list').scrollTop=0`);
    await wait(`!!document.querySelector('.chat-jump')`);
    advanceStream();
    await wait(
      `document.querySelector('.chat-preview')?.textContent.includes('실시간 응답')`,
    );
    assert(
      await ev(
        `!document.querySelector('.chat-preview').textContent.includes('message')`,
      ),
      "100자부터 응답 본문을 표시하고 JSON 포장은 숨김",
    );
    assert(
      await ev(`document.querySelector('.chat-list').scrollTop===0`),
      "응답이 도착해도 이전 메시지를 읽는 스크롤 위치 유지",
    );
    await click(".chat-jump");
    await wait(`!document.querySelector('.chat-jump')`);
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'다음 예약 질문');})()`,
    );
    const beforeQueueCalls = pool.calls.length;
    await ev(`document.querySelector('.chat-list').scrollTop=0`);
    await wait(`!!document.querySelector('.chat-jump')`);
    await click('[data-action="send-chat"]');
    await wait(
      `document.querySelector('.chat-queue')?.textContent.includes('다음 예약 질문')`,
    );
    await wait(`!document.querySelector('.chat-jump')`);
    assert(
      await ev(
        `(()=>{const e=document.querySelector('.chat-list');return e.scrollHeight-e.scrollTop-e.clientHeight<2})()`,
      ),
      "응답 중 예약 전송도 맨 아래로 이동",
    );
    assert(
      pool.calls.length === beforeQueueCalls,
      "응답 중에는 예약 질문을 서버로 중복 전송하지 않음",
    );
    const streamingShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/chat-stream-queue.png"),
      Buffer.from(streamingShot.data, "base64"),
    );

    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'작성 중인 새 초안');})()`,
    );
    finishStream();
    await wait(
      `!document.querySelector('[data-action="cancel-chat"]')&&!document.querySelector('.chat-queue')&&document.querySelector('.chat-list').textContent.includes('다음 예약 질문')`,
    );
    assert(
      pool.calls.length === beforeQueueCalls + 1,
      "응답 완료 후 대기 메시지를 한 번 자동 전송",
    );
    assert(
      pool.calls.at(-1).prompt.includes("AI 제안 알림 명세"),
      "예약 질문에는 직전 명세 제안의 내용을 문맥으로 포함",
    );
    assert(
      await ev(
        `(()=>{const card=document.querySelector('.spec-proposal');return !!card&&!card.parentElement.querySelector(':scope > .markdown')})()`,
      ),
      "명세 제안은 본문 중복 없이 추가 가능한 양식 하나로 표시",
    );
    assert(
      await ev(
        `!!document.querySelector('.chat-sources a[href="https://vuejs.org/guide/"][target="_blank"]')`,
      ),
      "웹 조회 출처는 명세 제안에서도 클릭 가능한 링크로 표시",
    );
    assert(
      await ev(
        `document.querySelector('#chat-input').value==='작성 중인 새 초안'`,
      ),
      "예약 전송 중에 작성한 초안 보존",
    );
    const proposalShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/chat-spec-proposal.png"),
      Buffer.from(proposalShot.data, "base64"),
    );
    const specCountBeforeProposal =
      store.db.workspaces[0].document.specs.length;
    await click('[data-action="add-spec-proposal"]');
    await wait(
      `document.querySelector('[data-action="add-spec-proposal"]').textContent.includes('추가됨')`,
    );
    assert(
      store.db.workspaces[0].document.specs.length ===
        specCountBeforeProposal + 1,
      "채팅 제안을 버튼 한 번으로 실제 명세에 추가",
    );
    const createdSpec = store.db.workspaces[0].document.specs.at(-1);
    assert(
      createdSpec.title === "AI 제안 알림 명세" &&
        createdSpec.requirements[0].criteria[0].text ===
          "비활성 상태에서 메일이 발송되지 않는다.",
      "제안의 명세·요구사항·완료 기준을 기존 양식에 저장",
    );
    await click('[data-action="chat-history"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent==='이전 대화'`,
    );
    assert(
      await ev(`document.querySelectorAll('.chat-history-entry').length>=2`),
      "워크스페이스·명세별 이전 대화 목록 표시",
    );
    await click('[data-action="load-chat-history"][data-spec=""]');
    await wait(
      `!document.querySelector('dialog').open&&document.querySelector('.chat-context').textContent.includes('워크스페이스 전체')&&document.querySelector('.chat-list').textContent.includes('워크스페이스 전반 질문')`,
    );
    assert(
      await ev(`document.querySelector('#chat-input').value===''`),
      "다른 대화를 불러올 때 원래 초안과 구분",
    );
    await click('[data-action="chat-history"]');
    await wait(
      `!!document.querySelector('[data-action="load-chat-history"][data-spec="SPEC-REG"]')`,
    );
    const historyShot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/chat-history.png"),
      Buffer.from(historyShot.data, "base64"),
    );
    await click('[data-action="load-chat-history"][data-spec="SPEC-REG"]');
    await wait(
      `!document.querySelector('dialog').open&&document.querySelector('#chat-input').value==='작성 중인 새 초안'&&document.querySelector('.chat-list').textContent.includes('다음 예약 질문')`,
    );
    assert(
      await ev(
        `document.querySelector('.chat-list').textContent.includes('다음 예약 질문')`,
      ),
      "명세 대화를 다시 불러오면 이력과 작성 초안 복원",
    );
    delete pool.chatRun;
    const specsBeforeNewChat = store.db.workspaces[0].document.specs.length;
    const originalThread = store.db.chats.at(-1).threadId;
    await click('[data-action="new-chat"]');
    await wait(
      `!document.querySelector('#chat-input').disabled&&document.querySelectorAll('.chat-list .bubble').length===0&&document.querySelector('.chat-thread-title').textContent==='새 대화'`,
    );
    const newThread = store.db.chatThreads.at(-1).id;
    assert(
      newThread !== originalThread,
      "새 대화는 기존 이력을 지우지 않고 독립 대화방 생성",
    );
    await ev(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['첨부 전체 내용: ATTACHMENT_BROWSER_SENTINEL'], 'verification.md', {type:'text/markdown'}));const input=document.querySelector('.compose-box input[type="file"]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(
      `document.querySelector('.chat-attachments')?.textContent.includes('verification.md')&&!document.querySelector('.chat-attachments [role="status"]')`,
    );
    assert(
      await ev(
        `document.querySelector('.chat-attachments').textContent.includes('verification.md')`,
      ),
      "채팅 파일 업로드와 첨부 표시",
    );
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'새 대화의 독립 질문');})()`,
    );
    await click('[data-action="send-chat"]');
    await wait(
      `!document.querySelector('[data-action="cancel-chat"]')&&document.querySelectorAll('.chat-list .bubble.assistant').length===1`,
    );
    assert(
      !pool.calls.at(-1).prompt.includes("STREAM_QUEUE_TEST") &&
        !pool.calls.at(-1).prompt.includes("다음 예약 질문"),
      "새 대화는 이전 대화의 모델 문맥과 분리",
    );
    assert(
      pool.calls.at(-1).prompt.includes("ATTACHMENT_BROWSER_SENTINEL"),
      "첨부 문서 본문을 실제 채팅 모델 입력에 전달",
    );
    await click('[data-action="regenerate-chat"]');
    await wait(
      `!document.querySelector('[data-action="cancel-chat"]')&&document.querySelectorAll('.chat-list .bubble.assistant').length===2`,
    );
    assert(
      store.db.chats.filter(
        (m) => m.threadId === newThread && m.role === "user",
      ).length === 1,
      "다시 생성해도 질문 중복 저장 없이 이전 답변 보존",
    );
    await ev(
      `window.clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.copiedChat=text}}})`,
    );
    await click('.bubble.assistant [data-action="copy-chat"]');
    await wait(`!!window.copiedChat`);
    assert(
      await ev(
        `window.copiedChat.includes('검토 결과')&&window.copiedChat.includes('boolean same = java.util.Objects.equals(a, b);')`,
      ),
      "메시지 전체 복사",
    );
    await ev(
      `if(window.clipboardDescriptor)Object.defineProperty(navigator,'clipboard',window.clipboardDescriptor);else delete navigator.clipboard;`,
    );
    await click('[data-action="chat-history"]');
    await wait(
      `!!document.querySelector('[data-action="rename-chat"][data-id="${newThread}"]')`,
    );
    await click('[data-action="rename-chat"][data-id="' + newThread + '"]');
    await fill("chatTitle", "내 새 대화");
    await submit();
    await closeSaved();
    assert(
      await ev(
        `document.querySelector('.chat-thread-title').textContent==='내 새 대화'`,
      ),
      "대화 이름 변경",
    );
    await click('[data-action="chat-history"]');
    await wait(`!!document.querySelector('#chat-history-search')`);
    await ev(
      `const input=document.querySelector('#chat-history-search');input.value='내 새 대화';input.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await wait(`document.querySelectorAll('.chat-history-entry').length===1`);
    assert(
      await ev(
        `document.querySelector('.chat-history-entry').textContent.includes('내 새 대화')`,
      ),
      "이전 대화 검색",
    );
    const threadShot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/chat-threads.png"),
      Buffer.from(threadShot.data, "base64"),
    );
    await click('[data-action="delete-chat"][data-id="' + newThread + '"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent==='대화를 삭제할까요?'`,
    );
    await submit();
    await closeSaved();
    assert(
      store.db.chatThreads.find((t) => t.id === newThread).deletedAt &&
        store.db.workspaces[0].document.specs.length === specsBeforeNewChat,
      "대화 삭제는 명세를 삭제하지 않음",
    );
    assert(
      await ev(
        `document.querySelector('#chat-input').value==='작성 중인 새 초안'`,
      ),
      "이전 대화로 돌아오면 보관한 초안 복구",
    );

    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'WAIT_CANCEL');})()`,
    );
    await click('[data-action="send-chat"]');
    await wait(
      `!!document.querySelector('[data-action="cancel-chat"]')&&document.querySelector('.rich-chat .ProseMirror').getAttribute('contenteditable')==='true'`,
    );
    assert(
      await ev(`!document.querySelector('#chat-input').disabled`),
      "AI 응답 대기 중에도 편집기 입력 가능",
    );
    await wait(`!!document.querySelector('.chat-list .note')`);
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'중지 후 보류할 질문');})()`,
    );
    await click('[data-action="send-chat"]');
    await click('[data-action="cancel-chat"]');
    await wait(
      `!document.querySelector('[data-action="cancel-chat"]')&&!!document.querySelector('[data-action="send-chat"]')&&document.querySelector('.rich-chat .ProseMirror').getAttribute('contenteditable')==='true'`,
    );
    assert(
      await ev(`!document.querySelector('#chat-input').disabled`),
      "AI 응답 중지 후 편집기 입력 복구",
    );
    await wait(
      `document.querySelector('.chat-queue')?.textContent.includes('전송 보류')`,
    );
    assert(
      await ev(
        `document.querySelector('.queued-message').textContent.includes('중지 후 보류할 질문')`,
      ),
      "응답 중지 시 예약 메시지 보존·자동 전송 보류",
    );
    await click('[aria-label="예약 전송 취소"]');
    await wait(`!document.querySelector('.chat-queue')`);
    fs.mkdirSync(path.join(root, "data/screenshots"), { recursive: true });
    const layouts = [];
    for (const width of [1440, 1920, 1024, 768, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1050,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 150));
      const dims = await ev(
        `({width:innerWidth,scroll:document.documentElement.scrollWidth})`,
      );
      assert(dims.scroll <= width, "가로 넘침 없음 " + width);
      layouts.push(dims);
      if ([1440, 390].includes(width)) {
        const shot = await call("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(
          path.join(root, "data/screenshots", width + ".png"),
          Buffer.from(shot.data, "base64"),
        );
      }
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert(
      await ev(
        `!document.querySelector('.assistant-head [data-action="toggle-ai"]')&&!document.querySelector('.rail-bottom [data-action="ai-settings"]')`,
      ),
      "채팅 X와 좌측 하단 AI 연결 제거",
    );
    assert(
      await ev(
        `document.querySelector('.assistant-head [data-action="ai-settings"]').textContent==='연결됨'&&!document.querySelector('.live-dot')`,
      ),
      "연결 상태는 연결됨 버튼 하나로 표시",
    );
    assert(
      await ev(`!!document.querySelector('.help-link svg circle')`),
      "도움말 원형 물음표 아이콘",
    );
    await click('[data-tab="design"]');
    assert(
      await ev(
        `[...document.querySelectorAll('.plan-version small')].every(x=>x.textContent.trim()&&x.getBoundingClientRect().height>0&&x.getBoundingClientRect().bottom<=x.closest('button').getBoundingClientRect().bottom)`,
      ),
      "계획 버전 제목이 화면에 표시",
    );
    const reviewUrl = await ev(
      `document.querySelector('[data-action="plan-edit"]').href`,
    );
    assert(
      await ev(
        `document.querySelector('[data-action="plan-edit"]').target==='_blank'&&!document.querySelector('.plan-actions [download]')`,
      ),
      "HTML 파일 다운로드 대신 새 탭 편집 링크 제공",
    );
    const editingPath = await ev("location.pathname");
    await call("Page.navigate", { url: reviewUrl });
    await wait(
      `!!document.querySelector('.review-document')?.contentDocument?.querySelector('.cw-review-actions')`,
    );
    await ev(
      `(()=>{const d=document.querySelector('.review-document').contentDocument;const node=d.createElement('script');node.textContent='window.planEditorExecuted=true';d.body.append(node);node.remove();})()`,
    );
    assert(
      await ev(
        `document.querySelector('.review-document').contentWindow.planEditorExecuted!==true`,
      ),
      "편집 iframe에서도 계획 스크립트 실행 차단",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const blockedScriptLog = errors.findIndex(
      (entry) =>
        entry.source === "security" &&
        entry.text?.includes("Blocked script execution in 'about:srcdoc'"),
    );
    assert(blockedScriptLog >= 0, "브라우저 sandbox 차단 로그 확인");
    errors.splice(blockedScriptLog, 1);

    await ev(
      `(()=>{const s=document.querySelector('#plan-font-size');s.value='20';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(
      `getComputedStyle(document.querySelector('.review-document').contentDocument.body).fontSize==='20px'`,
    );
    assert(
      await ev(
        `!document.querySelector('.review-toolbar').textContent.includes('미저장 변경')`,
      ),
      "글자 크기 변경은 계획 내용을 수정하지 않음",
    );
    assert(
      await ev(
        `(()=>{const d=document.querySelector('.review-document').contentDocument;const label=d.querySelector('.plan-check');const input=label.querySelector('input').getBoundingClientRect();const text=label.querySelector('span').getBoundingClientRect();return text.left-input.right>=11&&Math.abs(input.top+input.height/2-(text.top+18))<3})()`,
      ),
      "체크박스 12px 간격과 첫 줄 중앙 정렬",
    );
    await chooseTheme("light");
    await wait(
      `document.querySelector('.review-document').contentDocument?.documentElement?.textContent.includes('color-scheme:light')`,
    );
    await chooseTheme("dark");
    await wait(
      `document.querySelector('.review-document').contentDocument?.documentElement?.textContent.includes('color-scheme:dark')`,
    );
    await wait(
      `getComputedStyle(document.querySelector('.review-document').contentDocument.body).fontSize==='20px'`,
    );
    assert(
      await ev(
        `getComputedStyle(document.querySelector('.review-document').contentDocument.body).fontSize==='20px'`,
      ),
      "테마 전환 후 본문 글자 크기 유지",
    );
    await chooseTheme("system");
    await wait(
      `document.querySelector('.review-document').contentDocument?.documentElement?.textContent.includes('color-scheme:light')`,
    );
    await ev(
      `(()=>{const s=document.querySelector('#plan-font-size');s.value='14';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(
      `getComputedStyle(document.querySelector('.review-document').contentDocument.body).fontSize==='14px'`,
    );
    await wait(
      `(()=>{const d=document.querySelector('.review-document').contentDocument;return d.readyState==='complete'&&!d.querySelector('.plan-card input[type="checkbox"]').disabled})()`,
    );
    await ev(
      `document.querySelector('.review-document').contentDocument.querySelector('.plan-card input[type="checkbox"]').click()`,
    );
    assert(
      await ev(
        `document.querySelector('.review-document').contentDocument.querySelector('.plan-card input[type="checkbox"]').checked && !!document.querySelector('.review-document').contentDocument.querySelector('table th')`,
      ),
      "체크리스트 실제 선택과 표 렌더링",
    );
    await ev(
      `(()=>{const input=document.querySelector('[aria-label="계획 제목"]');input.value='RegistrationService 수정 계획';input.dispatchEvent(new Event('input',{bubbles:true}));const d=document.querySelector('.review-document').contentDocument;const p=[...d.querySelectorAll('.plan-card p')].find(n=>n.textContent.includes('RegistrationService'));p.textContent=p.textContent.replace('RegistrationService','RegistrationServiceV2');p.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    assert(
      await ev(
        `document.querySelector('.review-toolbar').textContent.includes('편집 중')`,
      ),
      "HTML 본문 직접 편집과 초안 추적",
    );
    assert(
      await ev(
        `!document.querySelector('.shell, .topbar, #assistant, .spec-header') && !!document.querySelector('.standalone-plan')`,
      ),
      "새 탭은 탐색·채팅·명세 헤더 없이 계획서만 표시",
    );
    await ev(
      `[...document.querySelectorAll('.review-toolbar button')].find(n=>n.textContent==='변경 저장').click()`,
    );
    await wait(
      `document.querySelector('.review-toolbar').textContent.includes('저장된 버전')`,
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions
        .at(-1)
        .html.match(/<input[^>]*type="checkbox"[^>]*>/g)
        ?.some((tag) => /\schecked(?:=|\s|>)/.test(tag)),
      "체크 상태를 계획 HTML에 저장",
    );
    await wait(
      `!!document.querySelector('.review-document').contentDocument.querySelector('.cw-review-actions button')`,
    );
    assert(
      await ev(
        `document.querySelector('.review-document').contentDocument.querySelector('.plan-card input[type="checkbox"]').checked`,
      ),
      "저장 후 체크 상태 복원",
    );
    await ev(
      `document.querySelector('.review-document').contentDocument.querySelector('.cw-review-actions button').click()`,
    );
    await wait(
      `document.querySelector('.review-toolbar').textContent.includes('1개 단계 검토함')`,
    );
    for (const reviewTheme of ["light", "dark"]) {
      await chooseTheme(reviewTheme);
      await wait(
        `document.querySelector('.review-document').contentDocument.querySelector('.cw-review-actions button')?.getAttribute('aria-pressed')==='true'`,
      );
      await ev(
        `document.querySelector('.review-document').contentDocument.querySelector('.cw-review-actions').scrollIntoView({block:'center'})`,
      );
      const reviewedShot = await call("Page.captureScreenshot", {
        format: "png",
      });
      fs.writeFileSync(
        path.join(root, `data/screenshots/plan-reviewed-${reviewTheme}.png`),
        Buffer.from(reviewedShot.data, "base64"),
      );
    }
    await chooseTheme("light");
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.at(-1)
        .stepApprovals["step-0"],
      "단계 승인 기록 저장",
    );
    await wait(
      `document.querySelector('.review-document').contentDocument.querySelector('.cw-review-actions button')?.textContent.includes('검토함')`,
    );
    assert(
      await ev(
        `document.querySelector('.review-document').contentDocument.querySelector('.cw-review-actions button').textContent.includes('검토함')`,
      ),
      "단계 승인 후 버튼 상태 즉시 갱신",
    );
    assert(
      await ev(
        `(() => { const doc = document.querySelector('.review-document').contentDocument; const b = doc.querySelector('.cw-review-actions button'); return b.getAttribute('aria-pressed') === 'true' && doc.defaultView.getComputedStyle(b).backgroundColor === 'rgb(22, 101, 52)'; })()`,
      ),
      "검토 완료 버튼은 선택 상태와 초록색으로 표시",
    );
    await ev(
      `(()=>{const e=document.querySelector('[aria-label="계획 제목"]');e.value+=' 편집 중';e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait(
      `document.querySelector('.review-toolbar').textContent.includes('0개 단계 검토함')`,
    );
    assert(
      await ev(
        `(() => { const b = document.querySelector('.review-document').contentDocument.querySelector('.cw-review-actions button'); return b.textContent==='검토함' && b.getAttribute('aria-pressed')==='false' && b.ownerDocument.defaultView.getComputedStyle(b).backgroundColor !== 'rgb(22, 101, 52)'; })()`,
      ),
      "편집 중인 내용에 이전 승인 표시를 적용하지 않음",
    );
    await ev(
      `(()=>{const e=document.querySelector('[aria-label="계획 제목"]');e.value=e.value.replace(' 편집 중','');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait(
      `document.querySelector('.review-toolbar').textContent.includes('1개 단계 검토함')`,
    );

    await ev(
      `document.querySelector('.review-document').contentDocument.querySelectorAll('.cw-review-actions button')[1].click()`,
    );
    await wait(`!!document.querySelector('[name="planRequest"]')`);
    assert(
      await ev(
        `document.querySelector('#modal .modal-head').textContent.includes('구현 방법')`,
      ),
      "단계 수정 요청 모달에 대상 표시",
    );
    await click('#modal .modal-foot [data-action="close"]');
    await closeSaved();
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await ev(
        `window.CodeWithTheme.set("dark");new Promise(r=>setTimeout(r,400))`,
      );
      await wait(
        `document.querySelector('.review-document').contentDocument?.documentElement?.textContent.includes('color-scheme:dark')`,
      );
      if (width === 390) await click(".review-menu-toggle");
      await ev(`window.scrollTo(0,650)`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const navigationPosition = await ev(
        `(()=>{const nav=document.querySelector('.review-specs'), r=nav.getBoundingClientRect(); return {scroll:window.scrollY,top:r.top,bottom:r.bottom,height:innerHeight,count:nav.querySelectorAll('button').length}})()`,
      );
      assert(
        navigationPosition.scroll > 0 &&
          navigationPosition.top >= 0 &&
          navigationPosition.bottom < navigationPosition.height &&
          navigationPosition.count === 2,
        `계획 본문 스크롤 중 스펙 탭 고정 ${width}: ${JSON.stringify(navigationPosition)}`,
      );
      await ev(`document.querySelectorAll('.review-specs button')[1].click()`);
      assert(
        await ev(
          `(()=>{const d=document.querySelector('.review-document').contentDocument;return d.querySelectorAll('.tab-state')[1].checked&&document.querySelectorAll('.review-specs button')[1].getAttribute('aria-pressed')==='true'})()`,
        ),
        `고정 스펙 탭으로 요구사항 전환 ${width}`,
      );
      if (width === 390) await click(".review-menu-toggle");
      await ev(`document.querySelector('.review-specs button').click()`);
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, `data/screenshots/plan-review-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
      assert(
        await ev(
          `document.querySelector('.plan-review-editor').scrollWidth<=document.querySelector('.plan-review-editor').clientWidth`,
        ),
        `HTML 검토 화면 ${width}px 가로 넘침 없음`,
      );
      assert(
        await ev(
          `(()=>{const r=document.querySelector('.review-document').getBoundingClientRect();return r.width>=document.documentElement.clientWidth*.65&&r.right<=document.documentElement.clientWidth+2&&r.height>=innerHeight*.6})()`,
        ),
        `계획서가 화면 너비와 높이를 충분히 사용 ${width}`,
      );
      await wait(
        `(()=>{const f=document.querySelector('.review-document');return f.contentDocument.scrollingElement.scrollHeight<=f.clientHeight+2})()`,
      );
      assert(
        await ev(
          `document.documentElement.scrollHeight>innerHeight && document.querySelector('.review-document').contentDocument.scrollingElement.scrollTop===0`,
        ),
        `HTML 내부 스크롤 없이 전체 페이지가 확장 ${width}`,
      );
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert(
      await ev(
        `[...document.querySelectorAll('.review-toolbar button')].find(n=>n.textContent==='전체 승인').disabled`,
      ),
      "편집본은 재평가 전 승인 불가",
    );
    const manualHtmlBeforeAssessment =
      store.db.workspaces[0].document.specs[0].plans.versions.at(-1).html;
    await ev(
      `[...document.querySelectorAll('.review-toolbar button')].find(n=>n.textContent==='수정본 평가하기').click()`,
    );
    await wait(
      `![...document.querySelectorAll('.review-toolbar button')].find(n=>n.textContent==='전체 승인').disabled`,
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.at(-1).html ===
        manualHtmlBeforeAssessment,
      "재평가는 편집한 HTML을 변경하지 않음",
    );
    await ev(
      `window.close=()=>{window.reviewCloseRequested=true};[...document.querySelectorAll('.review-toolbar button')].find(n=>n.textContent==='전체 승인').click()`,
    );
    await wait(`!!document.querySelector('dialog[open]')`);
    await ev(
      `[...document.querySelectorAll('#modal .modal-foot button')].find(n=>n.textContent==='승인하고 닫기').click()`,
    );
    await wait(`!!document.querySelector('.plan-version-head .accepted')`);
    assert(
      store.db.workspaces[0].document.specs[0].plans.finalVersionId ===
        store.db.workspaces[0].document.specs[0].plans.versions.at(-1).id,
      "새 탭 최종 승인 저장 후 닫기 제한 시 계획 화면으로 복귀",
    );
    await call("Page.navigate", { url: origin + editingPath });
    await wait(`!!document.querySelector('[data-action="plan-edit"]')`);
    const editedPlanId =
      store.db.workspaces[0].document.specs[0].plans.versions.at(-1).id;
    await click('[data-action="plan-view"][data-id="' + editedPlanId + '"]');
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.length === 3,
      "HTML 직접 수정과 재평가는 각각 새 버전으로 저장",
    );
    assert(
      await ev(
        `document.querySelector('.plan-evaluation h3').textContent.includes('최종 평가 결과')`,
      ),
      "HTML 직접 편집 후 독립 재평가한 버전에 평가 표시",
    );

    const oldPlanId =
      store.db.workspaces[0].document.specs[0].plans.versions[0].id;
    await click('[data-action="plan-view"][data-id="' + oldPlanId + '"]');
    await click('[data-action="plan-select"]');
    await wait(`document.querySelector('#modal').open`);
    await submit();
    await closeSaved();
    await wait(
      `document.querySelector('.plan-version-head .pill').textContent==='승인됨'`,
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.finalVersionId ===
        oldPlanId,
      "이전 버전으로 최종 계획을 다시 선택",
    );
    if (
      await ev(
        `document.querySelector('.shell').classList.contains('chat-hidden')`,
      )
    ) {
      await click('.topbar [data-action="toggle-ai"]');
    }
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'DB의 중복 처리와 검증 절차를 보강해 줘.');})()`,
    );
    await click('[data-action="send-chat"]');
    await wait(`!document.querySelector('[data-action="stop-plan"]')`);
    await wait(
      `document.querySelector('#plan-progress').textContent.includes('목표 달성')`,
    );
    assert(
      await ev(
        `!document.querySelector('.chat-mode-tabs')&&document.querySelector('.chat-context').textContent.includes('계획 대화')`,
      ),
      "계획 페이지에서 전환 버튼 없이 계획 대화 표시",
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.length === 4,
      "AI 수정 요청은 기준 버전을 연결한 새 HTML 버전",
    );
    assert(
      pool.calls.at(-1).prompt.includes("DB의 중복 처리와 검증 절차"),
      "수정 요청을 연결된 AI에 전달",
    );
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions.at(-1)
        .parentId === oldPlanId,
      "선택한 이전 버전을 기준으로 수정",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/html-plans.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    assert(
      await ev(`location.pathname.endsWith('/specs/SPEC-REG/plan')`),
      "계획 전용 URL",
    );
    const planTime = await ev("performance.timeOrigin");
    await call("Page.reload");
    await wait(
      `performance.timeOrigin!==${planTime}&&!!document.querySelector('[data-action="plan-edit"]')`,
    );
    assert(
      await ev(
        `document.querySelectorAll('.plan-version').length===4&&document.querySelector('.plan-version-head .pill').textContent==='승인됨'`,
      ),
      "새로고침하면 최종 버전과 전체 이력 복원",
    );
    const removableVersion =
      store.db.workspaces[0].document.specs[0].plans.versions[1];
    assert(
      await ev(
        `(()=>{const row=document.querySelector('.plan-version-row');const card=row.querySelector('.plan-version').getBoundingClientRect();const trash=row.querySelector('[data-action="plan-delete"]').getBoundingClientRect();return trash.top>=card.top&&trash.top-card.top<12&&trash.right<=card.right&&card.right-trash.right<12})()`,
      ),
      "삭제 아이콘은 버전 카드 안쪽 우상단에 배치",
    );
    await click(
      '[data-action="plan-delete"][data-id="' + removableVersion.id + '"]',
    );
    await wait(`document.querySelector('#modal').open`);
    await click('#modal .modal-foot [data-action="close"]');
    assert(
      !store.db.workspaces[0].document.specs[0].plans.versions[1].deletedAt,
      "삭제 취소는 계획을 유지",
    );
    await click(
      '[data-action="plan-delete"][data-id="' + removableVersion.id + '"]',
    );
    await wait(`document.querySelector('#modal').open`);
    await submit();
    await closeSaved();
    await wait(`document.querySelectorAll('.plan-version').length===3`);
    assert(
      store.db.workspaces[0].document.specs[0].plans.versions[1].deletedAt &&
        store.db.workspaces[0].document.specs[0].plans.finalVersionId ===
          oldPlanId,
      "일반 버전 삭제는 다른 승인본을 유지",
    );
    await call("Page.reload");
    await wait(`document.querySelectorAll('.plan-version').length===3`);
    assert(
      !(await ev(
        `!!document.querySelector('[data-action="plan-view"][data-id="${removableVersion.id}"]')`,
      )),
      "삭제한 버전은 새로고침 후에도 숨김",
    );
    await click('[data-tab="requirements"]');
    for (let i = 0; i < 2; i++) {
      await click('[data-action="complete-requirement"]');
      await wait(`document.querySelector('#modal').open`);
      await fill("completionSummary", "브라우저에서 검증하고 완료 기록");
      await submit();
      await closeSaved();
    }
    await call("Page.reload");
    await wait(`!!document.querySelector('.spec-link .state-icon.completed')`);
    await click('[data-tab="requirements"]');
    assert(
      await ev(
        `document.querySelectorAll('.requirement-nav .state-icon.completed').length===2&&!document.querySelector('.spec-link').textContent.includes('완료')`,
      ),
      "브라우저 완료 기록으로 요구사항·명세 아이콘 초록색 표시",
    );
    await click('[data-action="requirement-nav"]');
    assert(
      await ev(
        `!!document.querySelector('[data-requirement-card]')&&location.pathname.endsWith('/requirements')`,
      ),
      "좌측 요구사항 클릭으로 본문 이동",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/completed-requirements.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await click('[data-action="edit-requirement"]');
    await fill("body", "완료 후에도 자유롭게 변경한 요구사항");
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].requirements[0].status ===
        "pending" &&
        store.db.workspaces[0].document.specs[0].requirements[1].status ===
          "completed",
      "완료 요구사항 편집은 해당 항목만 구현 이전으로 전환",
    );
    await click('[data-tab="design"]');
    assert(
      await ev(
        `document.querySelector('[data-action="plan-edit"]').target==='_blank'`,
      ),
      "HTML 직접 편집은 별도 탭에서 진행",
    );
    await click('[data-tab="requirements"]');
    await click('[data-action="new-requirement"]');
    assert(
      await ev(
        `document.querySelector('#modal').open&&!!document.querySelector('#modal [name=body]')&&!document.querySelector('#inline-editor')`,
      ),
      "추가 요구사항은 중앙 모달에서 작성",
    );
    assert(
      await ev(
        `(()=>{const id=document.querySelector('[data-row-id]').getBoundingClientRect(),text=document.querySelector('[data-row-text]').getBoundingClientRect(),remove=document.querySelector('[data-action=repeat-remove]').getBoundingClientRect();return Math.abs(id.height-text.height)<1&&remove.left<id.left&&id.left<text.left;})()`,
      ),
      "완료 기준 ID와 입력 높이 일치 및 삭제 버튼 왼쪽 배치",
    );
    await click('[data-action="repeat-add"]');
    await ev(
      `window.retainedCriteriaInput=document.querySelectorAll('[data-row-text]')[1];window.retainedCriteriaInput.value='앞 항목 삭제 후 유지';window.retainedCriteriaInput.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await click('[data-action="repeat-remove"]');
    assert(
      await ev(
        `document.querySelector('[data-row-text]')===window.retainedCriteriaInput&&window.retainedCriteriaInput.value==='앞 항목 삭제 후 유지'`,
      ),
      "반복 입력의 앞 항목을 삭제해도 다음 입력 DOM과 값 유지",
    );
    await ev("delete window.retainedCriteriaInput");

    await click('#modal .modal-foot [data-action="close"]');
    await wait(`!!document.querySelector('#modal-unsaved')`);
    await click('[data-action="discard-modal"]');
    await click('[data-action="remove-requirement"]');
    await wait(
      `document.querySelector('dialog').open&&!!document.querySelector('.delete-target')`,
    );
    assert(
      await ev(
        `!document.querySelector('#inline-editor')&&document.querySelector('.delete-target code').textContent==='PROJECT-REG-100'&&document.querySelector('.delete-target b').textContent.length>0`,
      ),
      "요구사항 삭제는 대상 ID·제목이 있는 모달에서 확인",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/delete-requirement.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await click('.modal-foot [data-action="close"]');
    assert(
      store.db.workspaces[0].document.specs[0].requirements.length === 2,
      "삭제 모달 취소는 요구사항 유지",
    );
    await click('[data-action="remove-requirement"]');
    await wait(`document.querySelector('dialog').open`);
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces[0].document.specs[0].requirements.length === 1,
      "요구사항 삭제",
    );
    await click('[data-action="ai-settings"]');
    await wait(`!!document.querySelector('[data-action="disconnect-ai"]')`);
    assert(
      await ev(
        `document.querySelector('.modal-head h2')?.textContent==='현재 AI 연결을 해제할까요?'&&!document.querySelector('[data-action="ai-service"]')&&!document.querySelector('.wizard-progress')&&document.querySelector('.modal-foot [data-action="close"]').textContent==='연결 유지'`,
      ),
      "이미 연결된 AI는 새 연결 안내 대신 해제 확인만 표시",
    );
    await pointerClick('.modal-foot [data-action="close"]');
    await closeSaved();
    assert(
      !!store.db.users[0].aiConnections.codex,
      "연결 유지는 서버 AI 연결 보존",
    );
    await click('[data-action="ai-settings"]');
    await wait(`!!document.querySelector('[data-action="disconnect-ai"]')`);
    await shortcut('[data-action="disconnect-ai"]', "Escape", "Escape", 0);
    await closeSaved();
    assert(
      !!store.db.users[0].aiConnections.codex,
      "해제 확인의 Esc는 기존 AI 연결 보존",
    );
    await click('[data-action="ai-settings"]');
    await wait(`!!document.querySelector('[data-action="disconnect-ai"]')`);
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(
          root,
          "data/screenshots",
          `ai-disconnect-confirm-${width}.png`,
        ),
        Buffer.from(shot.data, "base64"),
      );
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await ev(
      `window.disconnectRequests=0;window.savedFetch=window.fetch;window.fetch=(url,options)=>String(url).endsWith('/api/ai/logout')?new Promise(resolve=>{window.disconnectRequests++;window.finishDisconnect=()=>resolve(new Response(JSON.stringify({error:'테스트 연결 해제 오류'}),{status:502,headers:{'Content-Type':'application/json'}}));}):window.savedFetch(url,options)`,
    );
    await click('[data-action="disconnect-ai"]');
    await wait(
      `document.querySelector('[data-action="disconnect-ai"]').getAttribute('aria-busy')==='true'`,
    );
    assert(
      await ev(
        `document.querySelector('#disconnect-status').textContent.includes('해제하고 있습니다')&&document.querySelector('[data-action="disconnect-ai"]').disabled`,
      ),
      "AI 연결 해제 진행 표시와 중복 클릭 차단",
    );
    await ev(`document.querySelector('[data-action="disconnect-ai"]').click()`);
    assert(
      await ev(`window.disconnectRequests===1`),
      "해제 버튼 중복 클릭은 요청 한 번",
    );
    await ev(`window.finishDisconnect()`);
    await wait(
      `document.querySelector('#dialog-error').textContent.includes('테스트 연결 해제 오류')`,
    );
    assert(
      await ev(
        `document.querySelector('[data-action="disconnect-ai"]').textContent.includes('다시 시도')&&!document.querySelector('[data-action="disconnect-ai"]').disabled&&document.querySelector('.connection-status').textContent.includes('연결됨')`,
      ),
      "연결 해제 실패는 오류와 재시도를 표시하고 완료로 표시하지 않음",
    );
    await ev(
      `window.fetch=(url,options)=>String(url).endsWith('/api/ai/logout')?new Promise((resolve,reject)=>{window.disconnectRequests++;window.finishDisconnect=()=>window.savedFetch(url,options).then(resolve,reject);}):window.savedFetch(url,options)`,
    );
    await click('[data-action="disconnect-ai"]');
    await wait(
      `document.querySelector('[data-action="disconnect-ai"]').disabled`,
    );
    await ev(`window.finishDisconnect()`);
    await wait(
      `document.querySelector('#toast:popover-open')?.textContent.includes('해제했습니다')`,
    );
    assert(
      await ev(
        `(()=>{const t=document.querySelector('#toast'),r=t.getBoundingClientRect();return t.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()`,
      ),
      "연결 해제 토스트가 모달 배경 위에 표시됨",
    );
    assert(
      await ev(
        `document.querySelector('dialog').open&&!document.querySelector('#disconnect-status')&&!document.querySelector('[data-action="disconnect-ai"]')&&!!document.querySelector('[data-action="ai-service"]')&&!document.querySelector('.connection-light')&&document.querySelector('#model-select').closest('.v-select').dataset.value===''`,
      ),
      "연결 해제 완료는 토스트에 표시하고 새 연결 모달·상태·모델 초기화",
    );
    assert(
      !store.db.users[0].aiConnections.codex,
      "연결 해제는 서버에 실제 반영",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/ai-disconnected.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await ev(`window.fetch=window.savedFetch`);
    await click('.modal-foot [data-action="close"]');
    await click('[data-action="ai-settings"]');
    await wait(
      `document.querySelector('dialog').open&&!!document.querySelector('[data-service="claude"]')`,
    );
    await click('[data-service="claude"]');
    await click('[data-method="api"]');
    await wait(`!!document.querySelector('#f-apiKey')`);
    assert(
      await ev(
        `document.querySelector('#f-provider').value==='claude'&&!!document.querySelector('#f-apiKey')`,
      ),
      "Claude API 인증 단계",
    );
    await click('[data-action="ai-back"]');
    await click('[data-method="subscription"]');
    await wait(`document.querySelector('#f-provider')?.value==='claude-code'`);
    assert(
      await ev(
        `document.querySelector('#f-provider').value==='claude-code'&&!!document.querySelector('[data-action="official-login"]')&&!document.querySelector('#f-apiKey')`,
      ),
      "Claude 구독 인증 단계",
    );
    await ev(
      `window.claudeNavigation=null;window.claudePopup=null;window.realOpen=window.open;window.open=(...args)=>{const tab=window.realOpen(...args);window.claudePopup=tab;return {get closed(){return tab.closed},set opener(v){tab.opener=v},location:{replace(url){window.claudeNavigation=url;tab.location.replace('/auth/wait?verification=claude')}},close(){tab.close()}};}`,
    );
    await pointerClick('[data-action="official-login"]');
    await wait(
      `window.claudeNavigation==='https://claude.com/cai/oauth/authorize?test=1'`,
    );
    assert(
      await ev(`window.claudePopup&&!window.claudePopup.closed`),
      "현재 Claude CLI의 claude.com 공식 로그인 주소로 새 탭 이동",
    );
    claudeAuthenticated = true;
    await closeSaved();
    await wait(
      `document.querySelector('.connection-status')?.textContent.includes('연결됨')`,
    );
    assert(
      store.db.users[0].aiSettings.provider === "claude-code",
      "Claude 공식 인증 후 계정 연결 완료",
    );
    await ev(`window.open=window.realOpen`);

    await click('a.brand[href="/"]');
    await wait(`!!document.querySelector('.workspace-home')`);
    assert(
      await ev(
        `document.querySelectorAll('.workspace-tile').length===1&&!document.querySelector('.home-steps')`,
      ),
      "홈은 워크스페이스 카드 목록",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/workspace.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    assert(
      await ev(
        `!document.querySelector('.rail')&&!document.querySelector('#assistant')`,
      ),
      "홈으로 돌아오면 프로젝트 메뉴와 대화 숨김",
    );
    await click(".workspace-open");
    await wait(`!!document.querySelector('.workspace-overview')`);
    await click('[data-action="exchange"]');
    await ev(
      `window.downloaded=null;window.oldCreate=URL.createObjectURL;URL.createObjectURL=blob=>{window.downloaded=blob;return window.oldCreate(blob)}`,
    );
    assert(
      await ev(
        `!document.querySelector('[name=json]').closest('.rich-editor')`,
      ),
      "JSON 입력은 서식 변환에서 제외",
    );
    await click('[data-action="template-json"]');
    await wait("!!window.downloaded");
    const exported = await ev("window.downloaded.text()");
    assert(
      JSON.parse(exported).document.specs[0].requirements[0].resources
        .length === 1,
      "다운로드 가능한 작성용 JSON 템플릿",
    );
    await fill("json", exported);
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces.length === 2,
      "템플릿 JSON을 새 프로젝트로 불러오기",
    );
    await click('[data-action="exchange"]');
    await fill("json", '{"broken":true}');
    await submit();
    await wait(`document.querySelector('#dialog-error').textContent.length>0`);
    assert(
      store.db.workspaces.length === 2,
      "잘못된 불러오기는 기존 프로젝트를 보존",
    );
    await click('[data-action="close"]');
    await click('[data-action="discard-modal"]');
    await closeSaved();
    await click('[data-action="view"][data-view="workspace"]');
    await wait(
      `!!document.querySelector('.workspace-overview .workspace-document [data-action="export-html"]')`,
    );
    assert(
      await ev(`!document.querySelector('dialog').open`),
      "HTML 다운로드는 워크스페이스 기본 설정에서 제공",
    );
    await ev("window.downloaded=null");
    await click('[data-action="export-html"]');
    await wait("!!window.downloaded");
    const html = await ev("window.downloaded.text()");
    assert(
      html.includes('rel="icon"') &&
        html.includes("data:image/svg+xml;base64,"),
      "워크스페이스 HTML에 자체 포함된 탭 아이콘",
    );
    assert(
      Buffer.from(
        html.match(/data:image\/svg\+xml;base64,([^" ]+)/)[1],
        "base64",
      ).toString() ===
        fs.readFileSync(path.join(root, "public/logo.svg"), "utf8"),
      "워크스페이스 HTML 아이콘은 현재 앱 로고와 동일",
    );
    assert(html.includes('id="codewith-data"'), "HTML에 표준 JSON 데이터 내장");
    await click('[data-action="exchange"]');
    assert(
      await ev(
        `!document.querySelector('dialog [data-action="export-html"]')&&!!document.querySelector('dialog [data-action="export-json"]')`,
      ),
      "공유 파일 메뉴에는 JSON 다운로드만 제공",
    );
    await fill("json", html);
    await submit();
    await closeSaved();
    assert(
      store.db.workspaces.length === 3,
      "HTML 문서를 새 프로젝트로 다시 불러오기",
    );
    assert(
      store.db.workspaces[2].document.specs[0].requirements[0].id ===
        store.db.workspaces[1].document.specs[0].requirements[0].id,
      "HTML 왕복 시 요구사항 식별번호 유지",
    );
    await click(".workspace-switch");
    await wait(
      `document.querySelectorAll('#workspace-menu .workspace-option').length===3`,
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/workspace-picker.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    assert(
      await ev(
        `['.workspace-switch','.workspace-option','.profile-settings'].every(selector=>[...document.querySelectorAll(selector)].filter(x=>x.getClientRects().length).every(button=>{const outer=button.getBoundingClientRect(),inner=button.querySelector('.v-btn__content').getBoundingClientRect();return inner.top>=outer.top&&inner.bottom<=outer.bottom;}))`,
      ),
      "워크스페이스 메뉴와 프로필의 여러 줄 텍스트가 버튼 영역 안에 표시",
    );
    const switchId = store.db.workspaces[0].id;
    await click('#workspace-menu [data-id="' + switchId + '"]');
    await wait(
      `location.pathname==='/workspaces/${switchId}'&&document.querySelector('.workspace-overview')?.dataset.workspace==='${switchId}'`,
    );
    assert(
      await ev(`document.querySelector('#workspace-menu').hidden`),
      "목록에서 다른 워크스페이스 선택 후 기본 설정으로 전환",
    );

    for (const width of [1920, 1440, 1024, 768, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1050,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await chooseTheme("dark");
      await click('a.brand[href="/"]');
      await wait(`!!document.querySelector('.workspace-home')`);
      await ev(
        `localStorage.setItem('codewith.navHidden','true');localStorage.setItem('codewith.chatHidden','true')`,
      );
      const previousTimeOrigin = await ev("performance.timeOrigin");
      await call("Page.reload");
      await wait(
        `performance.timeOrigin!==${previousTimeOrigin}&&!!document.querySelector('.workspace-home')`,
      );
      assert(
        await ev(
          `document.querySelectorAll('.workspace-tile').length===3&&!document.querySelector('.rail')`,
        ),
        "여러 워크스페이스를 홈에서 표시 " + width,
      );
      await pointerClick(".workspace-open");
      await wait(`!!document.querySelector('.workspace-overview')`);
      assert(
        await ev(
          `document.querySelector('.center').getBoundingClientRect().width>=innerWidth-1`,
        ),
        "두 패널을 접고 새로고침해도 본문 전체 표시 " + width,
      );
      for (const panel of ["nav", "ai", "nav", "ai"]) {
        await pointerClick('[data-action="toggle-' + panel + '"]');
        assert(
          await ev(
            `(()=>{const c=document.querySelector('.center').getBoundingClientRect();return c.width>250&&c.height>300&&document.documentElement.scrollWidth<=innerWidth;})()`,
          ),
          "패널 실제 클릭 후 본문과 화면 너비 유지 " + width + " " + panel,
        );
      }
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await click('a.brand[href="/"]');
    await wait(`!!document.querySelector('.workspace-home')`);
    await click('[data-action="edit-workspace"]');
    await click('[data-action="delete-workspace"]');
    await wait(
      `document.querySelector('dialog').open&&document.querySelector('.modal-head h2')?.textContent==='워크스페이스 삭제'`,
    );
    assert(
      await ev(
        `document.querySelector('#dialog-form').textContent.includes('모든 멤버')`,
      ),
      "워크스페이스 삭제 범위를 확인 창에 표시",
    );
    await click('.modal-foot [data-action="close"]');
    assert(
      store.list(store.db.users[0].id).length === 3,
      "삭제 취소 시 워크스페이스 유지",
    );
    await click('[data-action="edit-workspace"]');
    await click('[data-action="delete-workspace"]');
    await wait(
      `document.querySelector('dialog').open&&document.querySelector('.modal-head h2')?.textContent==='워크스페이스 삭제'`,
    );
    await submit();
    await closeSaved();
    await wait(`document.querySelectorAll('.workspace-tile').length===2`);
    assert(
      store.list(store.db.users[0].id).length === 2,
      "소유자가 카드에서 워크스페이스 삭제",
    );
    assert(
      await ev(`!document.querySelector('.rail')`),
      "삭제 후 메뉴 없는 홈 유지",
    );
    const live = store.list(store.db.users[0].id)[0],
      deepPath =
        "/workspaces/" +
        live.id +
        "/specs/" +
        store.workspace(live.id, store.db.users[0].id).document.specs[0].id +
        "/plan";
    await click('[data-action="logout"]');
    await wait(`!!document.querySelector('[data-action="access-key-login"]')`);
    await call("Page.navigate", { url: origin + deepPath });
    await wait(
      `location.pathname===${JSON.stringify(deepPath)}&&!!document.querySelector('[data-action="access-key-login"]')`,
    );
    await browserLogin();
    await wait(`!!document.querySelector('[data-action="plan-generate"]')`);
    assert(
      await ev(`location.pathname===${JSON.stringify(deepPath)}`),
      "공유된 계획 주소는 로그인 후에도 유지",
    );
    const deleted = store.db.workspaces.find((w) => w.deletedAt);
    await call("Page.navigate", { url: origin + "/workspaces/" + deleted.id });
    await wait(
      `location.pathname==='/'&&!!document.querySelector('.workspace-home')`,
    );
    assert(
      await ev(`!document.querySelector('.rail')`),
      "삭제된 워크스페이스 주소는 홈으로 복귀",
    );
    assert(!errors.length, "브라우저 JavaScript 오류 없음");
    assert(
      await ev(`!document.body.textContent.includes('수용 조건')`),
      "화면 용어를 완료 기준으로 통일",
    );
    fs.writeFileSync(
      path.join(root, "data/browser-verification.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          provider: "test fixture, no live inference",
          checks,
          layouts,
          errors,
        },
        null,
        2,
      ),
    );
    assert(
      await ev(`!document.querySelector('[data-action="export-identity"]')`),
      "개인 인증키 이전 UI 제거",
    );
    await click('[data-action="logout"]');
    await wait(`!!document.querySelector('[data-action="access-key-login"]')`);
    assert(
      await ev(
        `!document.querySelector('#auth-form')&&!document.querySelector('[name=password]')&&!document.body.textContent.includes('개인 PC')`,
      ),
      "첫 화면은 비밀번호 가입 없는 CodeWith 로그인",
    );
    await browserLogin();
    await wait(`!!document.querySelector('.workspace-home')`);
    assert(
      store.db.users.length === 1,
      "개인 로그인 키로 재로그인해도 사용자 중복 없음",
    );
    assert(
      errors.length === 0,
      "CodeWith 로그인과 AI 연결 분리 브라우저 오류 없음",
    );
    // Verify default personal entry, shared bootstrap and real WebAuthn round trip.
    async function extra(options) {
      const dataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "cw-mode-browser-"),
      );
      if (options.seedAccounts) {
        const { Store } = await import("./server/store.mjs");
        const storage = await Store.open(dataDir);
        storage.db.users = options.seedAccounts;
        await storage.persist();
        await storage.close();
      }
      const extraPool = new TestPool();
      const app = await createFrontendApplication({
        dataDir,
        codexPool: extraPool,
        ...options,
      });
      await new Promise((r) =>
        app.server.listen(options.port || 0, "127.0.0.1", r),
      );
      extraApps.push({ app, dataDir });
      return {
        app,
        pool: extraPool,
        url: options.origin || "http://127.0.0.1:" + app.server.address().port,
      };
    }
    const personal = await extra({});
    await call("Page.navigate", { url: personal.url });
    await wait(`!!document.querySelector('[data-action=access-personal]')`);
    assert(
      await ev(
        `!!document.querySelector('.auth-story')&&!document.querySelector('[data-action=access-create]')&&!document.querySelector('[data-action=access-key-login]')`,
      ),
      "PERSONAL 소개 첫 화면과 고정 계정 시작 버튼",
    );
    {
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots/personal-start.png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await click("[data-action=access-personal]");
    await wait(`!!document.querySelector('.workspace-home')`);
    assert(
      await ev(
        `!document.querySelector('[data-action="logout"]')&&!document.querySelector('[data-action="join-dialog"]')&&!document.querySelector('[data-action="access-account"]')&&document.querySelector('.topbar').textContent.includes('PERSONAL')`,
      ),
      "personal은 계정 설정 없이 PERSONAL로 진입",
    );
    await click('[data-action="new-workspace"]');
    await fill("workspaceName", "개인 작업");
    await submit();
    await closeSaved();
    assert(
      await ev(
        `!document.querySelector('[data-action="access-account"]')&&document.querySelector('.rail-bottom').textContent.includes('PERSONAL')`,
      ),
      "개인 워크스페이스에서도 계정 설정 제거",
    );
    await click('.topbar [data-action="toggle-ai"]');
    await click('[data-action="ai-settings"]');
    await wait(
      `document.querySelector('dialog').open&&!!document.querySelector('[data-action="ai-service"]')`,
    );
    assert(
      await ev(`!!document.querySelector('[data-action="ai-service"]')`),
      "개인 AI 연결은 대화창의 연결 설정에서 사용",
    );
    await click('.modal-foot [data-action="close"]');
    assert(
      await ev(
        `!document.querySelector('.project-source-card') && !document.querySelector('.rail-bottom [data-view="connection"]')`,
      ),
      "개인 프로젝트 연결 단독 메뉴 제거",
    );
    await click('[data-action="personal-settings"]');
    await fill("instructions", "탭 전환 중 보존할 지침");
    await click('[data-action="personal-tab-project"]');
    assert(
      await ev(
        `!document.querySelector('#personal-project').hidden && document.querySelector('#personal-skills').hidden && document.querySelector('#personal-project').textContent.includes('다른 팀원의 연결에는 영향을 주지 않습니다.')`,
      ),
      "개인 설정의 프로젝트 연결 탭",
    );
    await click('[data-action="project-source-open"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === '프로젝트 폴더 연결'`,
    );
    await click('.modal-foot [data-action="close"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === '개인 설정'`,
    );
    await click('[data-action="personal-tab-skills"]');
    assert(
      await ev(
        `document.querySelector('[name=instructions]').value.includes('탭 전환 중 보존할 지침')`,
      ),
      "폴더 편집 취소와 탭 전환 후 미저장 개인 지침 유지",
    );
    await submit();
    await closeSaved();
    await call("Page.navigate", {
      url:
        personal.url +
        "/workspaces/" +
        personal.app.store.db.workspaces[0].id +
        "/connection",
    });
    await wait(
      `!!document.querySelector('#personal-project') && !document.querySelector('#personal-project').hidden`,
    );
    // Native picker boundary with a real browser directory handle, initially empty.
    await ev(
      `(async()=>{const root=await navigator.storage.getDirectory();window.sourceTestHandle=await root.getDirectoryHandle('new-project',{create:true});window.showDirectoryPicker=async()=>sourceTestHandle;})()`,
    );
    await click('[data-action="project-source-open"]');
    await click('[data-action="project-source-upload"]');
    await wait(
      `document.querySelector('.project-source-card')?.textContent.includes('new-project')&&document.querySelector('.project-source-card')?.textContent.includes('0개 파일')&&document.querySelector('.project-source-card [role="status"]')?.textContent==='연결됨'`,
    );
    assert(
      await ev(
        `document.querySelector('.modal-head h2')?.textContent==='개인 설정'&&!document.querySelector('.project-folder-browser')&&document.querySelector('.project-source-card [role="status"]')?.textContent==='연결됨'`,
      ),
      "기본 폴더 선택 후 빈 프로젝트 자동 연결 및 상태 표시",
    );
    const sourceOwner = personal.app.store.db.users.find(
        (u) => u.personalProfile,
      ),
      sourceWorkspace = personal.app.store.db.workspaces[0];
    assert(
      Object.keys(sourceOwner.projectSources[sourceWorkspace.id].files)
        .length === 0,
      "빈 프로젝트 연결 저장",
    );
    await ev(
      `(async()=>{const f=await sourceTestHandle.getFileHandle('Example.java',{create:true}),w=await f.createWritable();await w.write('class Example { int version = 1; }');await w.close();})()`,
    );
    await click('[data-action="project-source-refresh"]');
    await wait(
      `document.querySelector('.project-source-card')?.textContent.includes('1개 파일')`,
    );
    assert(
      sourceOwner.projectSources[sourceWorkspace.id].files[
        "Example.java"
      ].includes("version = 1"),
      "빈 프로젝트에 추가한 코드 다시 읽기",
    );
    const priorRevision =
      sourceOwner.projectSources[sourceWorkspace.id].revision;
    await ev(
      `window.showDirectoryPicker=async()=>{throw new DOMException('Cancelled','AbortError')}`,
    );
    await click('[data-action="project-source-open"]');
    await click('[data-action="project-source-upload"]');
    assert(
      sourceOwner.projectSources[sourceWorkspace.id].revision === priorRevision,
      "폴더 선택 취소 시 기존 연결 보존",
    );
    await click('.modal-foot [data-action="close"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === "개인 설정"`,
    );
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1050,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      assert(
        await ev(
          `(()=>{const e=document.querySelector('.project-source-card');return e.scrollWidth<=e.clientWidth})()`,
        ),
        `폴더 연결 카드 넘침 없음 ${width}`,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, "data/screenshots", `folder-connection-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
    }
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await click('[data-action="project-source-disconnect"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === '프로젝트 연결 해제'`,
    );
    await wait(`document.querySelector('#modal').open`);
    await submit();
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === "개인 설정"`,
    );
    await wait(
      `document.querySelector('.project-source-card [role="status"]')?.textContent==='연결 안 됨'`,
    );
    assert(
      !sourceOwner.projectSources[sourceWorkspace.id] &&
        (await ev(
          `document.querySelector('.project-source-card [role="status"]')?.textContent==='연결 안 됨'`,
        )),
      "연결 해제 상태 표시",
    );
    assert(
      await ev(
        `sourceTestHandle.getFileHandle('Example.java').then(f=>f.getFile()).then(f=>f.text()).then(t=>t.includes('version = 1'))`,
      ),
      "연결 해제해도 원본 파일 유지",
    );
    await wait(
      `!!document.querySelector('[data-action="project-source-reconnect"]')&&!document.querySelector('[data-action="project-source-reconnect"]').disabled`,
    );
    await ev(
      `window.showDirectoryPicker=async()=>{throw Error('재연결은 폴더 선택을 다시 요구하면 안 됩니다');}`,
    );
    await click('[data-action="project-source-reconnect"]');
    await wait(
      `document.querySelector('.project-source-card [role="status"]')?.textContent==='연결됨'`,
    );
    assert(
      sourceOwner.projectSources[sourceWorkspace.id].label === "new-project",
      "연결 해제 후 이전 폴더 핸들로 폴더 선택 없이 재연결",
    );
    await click('[data-action="project-source-disconnect"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === '프로젝트 연결 해제'`,
    );
    await wait(`document.querySelector('#modal').open`);
    await submit();
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === "개인 설정"`,
    );
    await wait(
      `document.querySelector('.project-source-card [role="status"]')?.textContent==='연결 안 됨'`,
    );
    // Exercise directory-upload fallback using actual File objects and the browser picker input.
    await ev(
      `window.showDirectoryPicker=undefined;window.sourceInputClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'&&this.webkitdirectory){const f=new File(['class BrowserExample {}'],'BrowserExample.java',{type:'text/plain'});Object.defineProperty(f,'webkitRelativePath',{value:'browser-project/src/BrowserExample.java'});Object.defineProperty(this,'files',{value:[f]});this.dispatchEvent(new Event('change'));}else window.sourceInputClick.call(this);};`,
    );
    await click('[data-action="project-source-open"]');
    await click('[data-action="project-source-upload"]');
    await wait(
      `document.querySelector('.project-source-card')?.textContent.includes('browser-project')`,
    );
    assert(
      sourceOwner.projectSources[sourceWorkspace.id].kind === "upload" &&
        !!sourceOwner.projectSources[sourceWorkspace.id].files[
          "src/BrowserExample.java"
        ],
      "폴더 선택 대체 방식도 상대 경로로 코드 연결",
    );
    await ev("HTMLInputElement.prototype.click=window.sourceInputClick");
    await click('[data-action="project-source-disconnect"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === '프로젝트 연결 해제'`,
    );
    await wait(
      `document.querySelector('dialog').open&&document.querySelector('.modal-head h2')?.textContent==='프로젝트 연결 해제'`,
    );
    await submit();
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === "개인 설정"`,
    );
    // A real directory handle persists in IndexedDB and refreshes automatically before AI chat.
    await ev(
      `(async()=>{const root=await navigator.storage.getDirectory();window.sourceTestHandle=await root.getDirectoryHandle('browser-live',{create:true});const file=await sourceTestHandle.getFileHandle('Live.java',{create:true});const writer=await file.createWritable();await writer.write('class Live { int version = 1; }');await writer.close();window.showDirectoryPicker=async()=>sourceTestHandle;})()`,
    );
    await click('[data-action="project-source-open"]');
    await click('[data-action="project-source-upload"]');
    await wait(
      `document.querySelector('.project-source-card')?.textContent.includes('browser-live')`,
    );
    assert(
      sourceOwner.projectSources[sourceWorkspace.id].kind === "browser",
      "브라우저의 실제 폴더 핸들로 연결",
    );
    const beforeFolderReload = await ev("performance.timeOrigin");
    await call("Page.reload");
    await wait(
      `performance.timeOrigin!==${beforeFolderReload}&&!!document.querySelector('.project-source-card')`,
    );
    await ev(
      `window.sourcePermissionGranted=false;window.sourcePermissionRequests=0;window.sourceOriginalQuery=FileSystemHandle.prototype.queryPermission;window.sourceOriginalRequest=FileSystemHandle.prototype.requestPermission;FileSystemHandle.prototype.queryPermission=function(opts){return this.name==='browser-live'&&!sourcePermissionGranted?Promise.resolve('prompt'):sourceOriginalQuery.call(this,opts)};FileSystemHandle.prototype.requestPermission=function(opts){if(this.name==='browser-live'){sourcePermissionRequests++;sourcePermissionGranted=true;return Promise.resolve('granted')}return sourceOriginalRequest.call(this,opts)};window.showDirectoryPicker=async()=>{throw Error('권한 재허용은 폴더를 다시 선택하지 않아야 합니다')};window.dispatchEvent(new Event('focus'));`,
    );
    await wait(
      `document.querySelector('.project-source-card [role="status"]')?.textContent==='재연결 필요'`,
    );
    assert(
      await ev(
        `document.querySelector('.project-source-card')?.textContent.includes('browser-live')&&!document.querySelector('.project-source-card [role="status"]').classList.contains('completed')`,
      ),
      "저장된 연결이 있어도 브라우저 권한 만료를 재연결 필요로 표시",
    );
    const sourcePermissionShot = await call("Page.captureScreenshot", {
      format: "png",
    });
    fs.writeFileSync(
      path.join(root, "data/screenshots/folder-permission.png"),
      Buffer.from(sourcePermissionShot.data, "base64"),
    );
    await click('[data-action="project-source-reconnect"]');
    await wait(
      `document.querySelector('.project-source-card [role="status"]')?.textContent==='연결됨'`,
    );
    assert(
      await ev(`sourcePermissionRequests===1`),
      "사용자 클릭에서 이전 폴더 권한을 재요청하고 연결 상태 복구",
    );
    await ev(
      `FileSystemHandle.prototype.queryPermission=sourceOriginalQuery;FileSystemHandle.prototype.requestPermission=sourceOriginalRequest;`,
    );
    await ev(
      `(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('browser-live'),file=await dir.getFileHandle('Live.java'),writer=await file.createWritable();await writer.write('class Live { int version = 2; }');await writer.close();const request=async(p,b)=>{const r=await fetch('/api/ai'+p,{method:'POST',headers:{'Content-Type':'application/json','X-CodeWith':'1'},body:JSON.stringify(b)});if(!r.ok)throw Error(await r.text());};await request('/start',{provider:'codex'});await request('/login',{provider:'codex'});await request('/finish',{});})()`,
    );
    const beforeAIRefresh = await ev("performance.timeOrigin");
    await call("Page.reload");
    await wait(
      `performance.timeOrigin!==${beforeAIRefresh}&&!!document.querySelector('.project-source-card')`,
    );
    await click('.modal-foot [data-action="close"]');
    await closeSaved();
    await click('.topbar [data-action="toggle-ai"]');
    await wait(`!!document.querySelector('#chat-input')`);
    await ev(
      `(()=>{const area=document.querySelector('#chat-input');area.value='Live 코드를 설명해줘';area.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click('[data-action="send-chat"]');
    await wait(
      `document.querySelector('#chat-list')?.textContent.includes('검토 결과')`,
    );
    assert(
      sourceOwner.projectSources[sourceWorkspace.id].files[
        "Live.java"
      ].includes("version = 2"),
      "새로고침 후에도 폴더 재선택 없이 AI 요청 전에 변경 코드 갱신",
    );
    assert(
      personal.app.store.db.chats.some((m) => m.role === "assistant"),
      "브라우저 폴더를 연결한 실제 채팅 요청 완료",
    );
    await click('[data-action="personal-settings"]');
    await click('[data-action="personal-tab-project"]');
    await click('[data-action="project-source-disconnect"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === '프로젝트 연결 해제'`,
    );
    await wait(
      `document.querySelector('dialog').open&&document.querySelector('.modal-head h2')?.textContent==='프로젝트 연결 해제'`,
    );
    await submit();
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === "개인 설정"`,
    );
    await click('[data-action="project-source-open"]');
    await fill("path", nativeProjectDir);
    await click('[data-action="project-folder-browse"]');
    await wait(
      `document.querySelector('.folder-path')?.textContent === ${JSON.stringify(nativeProjectDir)}`,
    );
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await chooseTheme(width === 390 ? "dark" : "light");
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert(
        await ev(
          `document.querySelector('#modal').scrollWidth <= document.querySelector('#modal').clientWidth + 1`,
        ),
        `통합 프로젝트 폴더 선택 넘침 없음 ${width}`,
      );
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(
          root,
          "data/screenshots",
          `project-folder-picker-${width}.png`,
        ),
        Buffer.from(shot.data, "base64"),
      );
    }
    await chooseTheme("light");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1050,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await submit();
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === "개인 설정"`,
    );
    await wait(
      `document.querySelector('.project-source-card')?.textContent.includes('연결한 폴더에서 코드 읽기·파일 수정·명령 실행')`,
    );
    assert(
      sourceOwner.projectSources[sourceWorkspace.id].path === nativeProjectDir,
      "프로젝트 연결 경로를 CLI 작업에도 공통 사용",
    );
    await click('.modal-foot [data-action="close"]');
    await closeSaved();
    let toolAllowed;
    personal.pool.chatRun = async (opts) => {
      assert(
        opts.projectTools && opts.cwd === nativeProjectDir,
        "일반 채팅 CLI 도구와 실제 작업 경로 전달",
      );
      toolAllowed = await opts.approve({
        tool: "Bash",
        cwd: opts.cwd,
        input: { command: "npm test" },
      });
      return { text: toolAllowed ? "작업 승인 확인" : "작업 거절 확인" };
    };
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'STREAM_QUEUE_TEST 승인');})()`,
    );
    await click('[data-action="send-chat"]');
    await wait(`!!document.querySelector('.tool-approval-dialog[open]')`);
    for (const width of [1440, 390]) {
      await call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await ev(
        `document.documentElement.dataset.theme=${JSON.stringify(width === 390 ? "dark" : "light")}`,
      );
      await ev(`new Promise(resolve => setTimeout(resolve, 400))`);
      const shot = await call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(root, `data/screenshots/tool-approval-${width}.png`),
        Buffer.from(shot.data, "base64"),
      );
      assert(
        await ev(
          `(()=>{const e=document.querySelector('.tool-approval-dialog');return e.scrollWidth<=e.clientWidth&&e.getBoundingClientRect().right<=innerWidth})()`,
        ),
        `도구 승인 모달 ${width}px 가로 넘침 없음`,
      );
    }
    await ev(
      `[...document.querySelectorAll('.tool-approval-dialog button')].find(e=>e.textContent.includes('이번 작업 승인')).click()`,
    );
    await wait(
      `!document.querySelector('.tool-approval-dialog')&&document.querySelector('#chat-list').textContent.includes('작업 승인 확인')`,
    );
    assert(toolAllowed, "브라우저 승인 응답이 서버 도구 요청에 전달됨");
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'STREAM_QUEUE_TEST 거절');})()`,
    );
    await click('[data-action="send-chat"]');
    await wait(`!!document.querySelector('.tool-approval-dialog[open]')`);
    await shortcut(".tool-approval-dialog button", "Escape", "Escape", 0);
    await wait(
      `!document.querySelector('.tool-approval-dialog')&&document.querySelector('#chat-list').textContent.includes('작업 거절 확인')`,
    );
    assert(!toolAllowed, "Escape는 도구 실행 거절로 처리됨");
    personal.pool.chatRun = async (opts) => {
      const response = await opts.approve({
        tool: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "언어를 선택하세요",
              options: [{ label: "JavaScript", description: "JS 사용" }],
            },
            { question: "폴더를 입력하세요" },
          ],
        },
      });
      assert(
        response.answers["언어를 선택하세요"] === "JavaScript" &&
          response.answers["폴더를 입력하세요"] === "src",
        "CLI 질문의 원래 키로 답변 전달",
      );
      return { text: "CLI 질문 답변 확인" };
    };
    await ev(
      `(async()=>{const {setRichText}=await import('/text-editor.js');setRichText(document.querySelector('#chat-input'),'STREAM_QUEUE_TEST 질문');})()`,
    );
    await click('[data-action="send-chat"]');
    await wait(`!!document.querySelector('.tool-approval-dialog textarea')`);
    await ev(
      `[...document.querySelectorAll('.tool-approval-dialog button')].find(e=>e.textContent.includes('JavaScript')).click()`,
    );
    await ev(
      `[...document.querySelectorAll('.tool-approval-dialog button')].find(e=>e.textContent.includes('다음 질문')).click()`,
    );
    await wait(
      `document.querySelector('.tool-approval-dialog label').textContent.includes('폴더')`,
    );
    await ev(
      `(()=>{const e=document.querySelector('.tool-approval-dialog textarea');e.value='src';e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await ev(
      `[...document.querySelectorAll('.tool-approval-dialog button')].find(e=>e.textContent.includes('답변 보내기')).click()`,
    );
    await wait(
      `!document.querySelector('.tool-approval-dialog')&&document.querySelector('#chat-list').textContent.includes('CLI 질문 답변 확인')`,
    );
    delete personal.pool.chatRun;
    await call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await click('[data-action="personal-settings"]');
    await click('[data-action="personal-tab-project"]');
    await click('[data-action="project-source-disconnect"]');
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === '프로젝트 연결 해제'`,
    );
    await wait(`!!document.querySelector("#dialog-form")`);
    await submit();
    await wait(
      `document.querySelector('.modal-head h2')?.textContent === "개인 설정"`,
    );
    await click('.modal-foot [data-action="close"]');
    await closeSaved();
    // Spec deletion: consistent actions, protected draft, cancel, last item, stale deep link.
    await click('[data-action="new-spec"]');
    await fill("id", "SPEC-DELETE");
    await fill("title", "삭제할 명세");
    await submit();
    await closeSaved();
    const personalWorkspace = personal.app.store.db.workspaces[0],
      personalRoot = "/workspaces/" + personalWorkspace.id;
    for (const suffix of [
      "",
      "/requirements",
      "/project",
      "/history",
      "/specs/SPEC-DELETE/requirements",
      "/specs/SPEC-DELETE/plan",
    ]) {
      const target = personalRoot + suffix;
      await call("Page.navigate", { url: personal.url + target });
      await wait(
        `location.pathname===${JSON.stringify(target)}&&!!document.querySelector('.rail')`,
      );
      const beforeRefresh = await ev("performance.timeOrigin");
      await call("Page.reload");
      await wait(
        `performance.timeOrigin!==${beforeRefresh}&&!!document.querySelector('.rail')`,
      );
      assert(
        await ev(
          `location.pathname===${JSON.stringify(target)}&&!document.querySelector('[data-action=access-personal]')&&document.querySelector('#main-content').textContent.length>0`,
        ),
        "PERSONAL 새로고침 후 현재 화면 유지 " + (suffix || "워크스페이스"),
      );
    }
    await click('[data-tab="requirements"]');
    assert(
      await ev(
        `document.querySelector('.page-head .eyebrow').textContent==='SPEC-DELETE'`,
      ),
      "명세 제목에는 내부 버전 대신 식별번호만 표시",
    );
    assert(
      await ev(
        `(()=>{const a=document.querySelector('[data-action=edit-spec]').getBoundingClientRect(),b=document.querySelector('[data-action=delete-spec]').getBoundingClientRect();return a.height===b.height&&a.width===b.width;})()`,
      ),
      "명세 편집·삭제 버튼 크기 통일",
    );
    await click('[data-action="new-requirement"]');
    await fill("title", "작성 중 내용");
    assert(
      await ev(
        `document.querySelector('#modal').open&&!document.querySelector('#inline-editor')`,
      ),
      "요구사항 작성 모달이 배경의 명세 삭제 작업을 차단",
    );
    await click('#modal .modal-foot [data-action="close"]');
    await wait(`!!document.querySelector('#modal-unsaved')`);
    await click('[data-action="discard-modal"]');
    await click('[data-action="delete-spec"]');
    assert(
      await ev(
        `document.querySelector('dialog').open&&document.querySelector('.delete-target code').textContent==='SPEC-DELETE'&&document.querySelector('.delete-target b').textContent==='삭제할 명세'`,
      ),
      "명세 삭제 대상을 중앙 확인 모달에 표시",
    );
    await shortcut("#dialog-form button", "Escape", "Escape", 0);
    await closeSaved();
    assert(
      personal.app.store.db.workspaces[0].document.specs.length === 1,
      "Escape로 명세 삭제 취소",
    );
    await click('[data-action="delete-spec"]');
    await submit();
    await closeSaved();
    assert(
      personal.app.store.db.workspaces[0].document.specs.length === 0,
      "마지막 명세도 삭제 가능",
    );
    assert(
      await ev(
        `location.pathname.endsWith('/requirements')&&!document.querySelector('.spec-link')&&!!document.querySelector('#main-content')`,
      ),
      "명세 삭제 후 전체 요구사항으로 이동하고 좌측 목록 정리",
    );
    await ev("history.back()");
    await wait(
      `!location.pathname.includes('/specs/')&&!!document.querySelector('#main-content')`,
    );
    assert(
      await ev(`document.querySelector('#main-content').textContent.length>0`),
      "삭제 후 뒤로가기에도 본문 표시",
    );
    await call("Page.navigate", {
      url:
        personal.url +
        "/workspaces/" +
        personal.app.store.db.workspaces[0].id +
        "/specs/SPEC-DELETE/requirements",
    });
    await wait(`!!document.querySelector('.workspace-overview')`);
    assert(
      await ev(`!location.pathname.includes('/specs/')`),
      "삭제한 명세 주소를 새로 열면 워크스페이스로 이동",
    );
    await click('a.brand[href="/"]');
    await wait(`!!document.querySelector('.workspace-home')`);
    const homeBeforeRefresh = await ev("performance.timeOrigin");
    await call("Page.reload");
    await wait(
      `performance.timeOrigin!==${homeBeforeRefresh}&&!!document.querySelector('.workspace-home')`,
    );
    assert(
      await ev(
        `location.pathname==='/'&&!document.querySelector('[data-action=access-personal]')`,
      ),
      "PERSONAL 홈 새로고침도 로그인 상태 유지",
    );
    // A revoked session must show entry without losing the requested deep link.
    personal.app.store.db.sessions = [];
    await personal.app.store.persist();
    await call("Page.navigate", {
      url: personal.url + personalRoot + "/history",
    });
    await wait(`!!document.querySelector('[data-action=access-personal]')`);
    assert(
      await ev(
        `location.pathname===${JSON.stringify(personalRoot + "/history")}`,
      ),
      "PERSONAL 세션 만료 시 첫 화면에서도 요청 주소 유지",
    );
    await click("[data-action=access-personal]");
    await wait(`!!document.querySelector('.rail')`);
    assert(
      await ev(
        `location.pathname===${JSON.stringify(personalRoot + "/history")}&&!document.querySelector('[data-action=access-personal]')`,
      ),
      "PERSONAL 재진입 후 원래 화면 복원",
    );
    const selection = await extra({
      seedAccounts: [
        { id: "old-a", login: "old-a", name: "기존 계정 A" },
        { id: "old-b", login: "old-b", name: "기존 계정 B" },
      ],
    });
    await call("Page.navigate", { url: selection.url });
    await click("[data-action=access-personal]");
    await wait(`!!document.querySelector('.workspace-home')`);
    assert(
      await ev(
        `!document.querySelector('[data-action="access-select-personal"]')&&!document.querySelector('[data-action="access-account"]')&&document.querySelector('.topbar').textContent.includes('PERSONAL')`,
      ),
      "기존 계정이 여러 개여도 선택 화면 없이 PERSONAL로 진입",
    );
    assert(
      selection.app.store.db.users.length === 3,
      "다른 계정 데이터는 병합 없이 보존",
    );
    const shared = await extra({ mode: "shared" });
    await call("Page.navigate", { url: shared.url });
    await wait(`!!document.querySelector('[data-action="access-create"]')`);
    assert(
      await ev(`document.body.textContent.includes('처음 설정하기')`),
      "shared 첫 운영자 설정 화면",
    );
    await click('[data-action="access-create"]');
    await fill("accessName", "공유 관리자");
    await fill(
      "setupKey",
      fs
        .readFileSync(path.join(shared.app.store.dir, "setup-key"), "utf8")
        .trim(),
    );
    await submit();
    await wait(`!!document.querySelector('.access-secret')`);
    await submit();
    await closeSaved();
    assert(
      shared.app.store.db.users[0].name === "공유 관리자",
      "shared 초기 설정 후 별도 계정 진입",
    );
    const net = await import("node:net");
    const reserved = net.createServer();
    await new Promise((r) => reserved.listen(0, "127.0.0.1", r));
    const passPort = reserved.address().port;
    await new Promise((r) => reserved.close(r));
    const pass = await extra({
      mode: "server",
      authMethods: ["passkey"],
      origin: "http://localhost:" + passPort,
      port: passPort,
    });
    await call("Page.navigate", { url: pass.url });
    await wait(
      `!!document.querySelector('[data-action="access-passkey-register"]')`,
    );
    await call("WebAuthn.enable");
    await call("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await click('[data-action="access-passkey-register"]');
    await wait(`!!document.querySelector('#f-profileName')`);
    await fill("profileName", "패스키 사용자");
    await submit();
    await closeSaved();
    assert(
      pass.app.store.db.users.length === 1 &&
        pass.app.store.db.users[0].passkeys.length === 1,
      "실제 WebAuthn 등록 검증과 첫 이름 설정",
    );
    await click('[data-action="logout"]');
    await wait(
      `!!document.querySelector('[data-action="access-passkey-login"]')`,
    );
    await click('[data-action="access-passkey-login"]');
    await wait(`!!document.querySelector('.workspace-home')`);
    assert(
      pass.app.store.db.users.length === 1,
      "가상 인증기의 실제 서명으로 패스키 재로그인",
    );
    assert(!errors.length, "세 모드 브라우저 JavaScript 오류 없음");
    fs.writeFileSync(
      path.join(root, "data/browser-verification.json"),
      JSON.stringify(
        { at: new Date().toISOString(), checks, layouts, errors },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ checks: checks.length, layouts, errors }, null, 2),
    );
  }
} catch (e) {
  console.error(e);
  console.error("Browser errors", errors);
  console.error(
    "Editor",
    await ev(
      `({input: [document.querySelector('#chat-input')?.value,document.querySelector('#chat-input')?.disabled],chat:document.querySelector('#assistant')?.innerText.slice(-1800),dialog:document.querySelector('dialog')?.outerHTML,inline:document.querySelector('#inline-editor')?.outerHTML,toast:document.querySelector('#toast')?.textContent})`,
    ),
  );
  console.error("DOM", await ev("document.body?.innerHTML.slice(0,5000)"));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  proc.kill();
  await vite?.close();
  for (const { app, dataDir } of extraApps) {
    await app.vite?.close();
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(nativeProjectDir, { recursive: true, force: true });
}
