import fs from "node:fs";
import path from "node:path";
export async function verifyI18n({
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
}) {
  assert(
    await ev(
      `document.documentElement.lang==='en'&&document.body.innerText.includes('Get started with CodeWith')`,
    ),
    "default language is English",
  );
  async function chooseLanguage(label) {
    await pointerClick("[data-language-select] .v-field");
    await wait(
      `!!document.querySelector('.v-overlay--active [role="listbox"]')`,
    );
    await ev(
      `window.reloadMarker=true;[...document.querySelectorAll('.v-overlay--active [role="option"]')].find(x=>x.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
    await wait(
      `!window.reloadMarker&&!!document.querySelector('[data-language-select]')`,
    );
  }
  await chooseLanguage("한국어");
  assert(
    await ev(
      `document.documentElement.lang==='ko'&&document.body.innerText.includes('CodeWith 시작하기')`,
    ),
    "Korean selection persists through reload",
  );
  await chooseLanguage("English");
  await click('[data-action="access-create"]');
  await fill("accessName", "언어 검증 사용자");
  await submit();
  await wait(`!!document.querySelector('.access-secret code')`);
  await submit();
  await closeSaved();
  await click('[data-action="new-workspace"]');
  await fill("workspaceName", "한국어 원본 보존");
  await submit();
  await closeSaved();
  assert(
    await ev(
      `document.body.innerText.includes('한국어 원본 보존')&&document.body.innerText.includes('Basic settings')`,
    ),
    "user content stays Korean inside English UI",
  );
  for (const [width, theme] of [
    [1440, "light"],
    [390, "dark"],
  ]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width === 390,
    });
    await ev(`window.CodeWithTheme.set(${JSON.stringify(theme)})`);
    await new Promise((r) => setTimeout(r, 400));
    assert(
      await ev(
        `document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.topbar .v-field,.topbar .help-link')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})`,
      ),
      "English layout has no horizontal overflow " + width,
    );
    const shot = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(root, "data/screenshots/i18n-" + width + ".png"),
      Buffer.from(shot.data, "base64"),
    );
  }
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await chooseLanguage("한국어");
  assert(
    await ev(
      `document.body.innerText.includes('기본 설정')&&document.body.innerText.includes('한국어 원본 보존')`,
    ),
    "workspace returns to Korean without changing data",
  );
  await chooseLanguage("English");
  await call("Page.navigate", { url: origin + "/guide/deployment" });
  await wait(`!!document.querySelector('#server')`);
  assert(
    await ev(
      `document.documentElement.lang==='en'&&document.body.innerText.includes('Choose authentication for deployment')`,
    ),
    "English deployment guide and anchors",
  );

  await call("Page.navigate", { url: origin + "/auth/wait" });
  await wait(
    `document.querySelector('#login-title')?.textContent === 'Preparing your sign-in'`,
  );
  assert(
    await ev(
      `document.documentElement.lang==='en'&&!/[가-힣]/.test(document.body.innerText)`,
    ),
    "Authentication hand-off follows the saved language",
  );
}
