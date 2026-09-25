import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer, h } from "vue";
import { useEditors } from "../src/composables/useEditors.js";
import { useActionDispatcher } from "../src/composables/useActionDispatcher.js";

function fixture() {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  const events = globalThis.window;
  let editors,
    closes = 0;
  const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode() {},
    nextSibling() {},
  });
  const app = renderer.createApp({
    setup() {
      editors = useEditors({ canEdit: () => true, onClose: () => closes++ });
      return () => null;
    },
  });
  app.mount({});
  return {
    editors,
    events,
    get closes() {
      return closes;
    },
    dispose() {
      app.unmount();
      globalThis.window = previous;
    },
  };
}
const input = (value) => h("input", { name: "title", value });

test("editor drafts drive unsaved protection and release unload listeners", () => {
  const f = fixture();
  try {
    const e = f.editors.openDialog("편집", input("initial"), async () => {});
    assert.equal(f.editors.modalDirty(), false);
    e.values.title = "changed";
    f.editors.requestModalClose();
    assert.equal(e.unsaved, true);
    assert.equal(f.editors.state.dialog, e);
    const event = new Event("beforeunload", { cancelable: true });
    f.events.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    f.editors.closeDialog();
    assert.equal(f.closes, 1);
    f.editors.openInline("작성", input("draft"), async () => {});
    f.dispose();
    const after = new Event("beforeunload", { cancelable: true });
    f.events.dispatchEvent(after);
    assert.equal(after.defaultPrevented, false);
  } finally {
    if (globalThis.window === f.events) f.dispose();
  }
});

test("saving is single flight and cannot close a replacement dialog", async () => {
  const f = fixture();
  try {
    let resolve,
      calls = 0;
    const original = f.editors.openDialog("첫 단계", input("old"), async () => {
      calls++;
      await new Promise((r) => (resolve = r));
    });
    const save = f.editors.submit(original, new FormData());
    await f.editors.submit(original, new FormData());
    assert.equal(calls, 1);
    f.editors.requestModalClose();
    assert.equal(f.editors.state.dialog, original);
    const replacement = f.editors.openDialog(
      "다음 단계",
      input("new"),
      async () => {},
    );
    resolve();
    await save;
    assert.equal(f.editors.state.dialog, replacement);
    assert.equal(replacement.values.title, "new");
    assert.equal(f.closes, 0);
  } finally {
    f.dispose();
  }
});

test("conflicts retain the inline draft and allow retry", async () => {
  const f = fixture();
  try {
    let conflict = true;
    const editor = f.editors.openInline("요구사항", input("text"), async () => {
      if (conflict) throw Object.assign(new Error("conflict"), { status: 409 });
    });
    editor.values.title = "unsaved";
    await f.editors.submit(editor, new FormData());
    assert.equal(f.editors.state.inline, editor);
    assert.equal(editor.values.title, "unsaved");
    assert.equal(editor.busy, false);
    assert.match(editor.error, /Your input is preserved/);
    conflict = false;
    await f.editors.submit(editor, new FormData());
    assert.equal(f.editors.state.inline, null);
  } finally {
    f.dispose();
  }
});

test("dynamic fields do not replace existing input and files count as changes", () => {
  const f = fixture();
  try {
    const editor = f.editors.openDialog(
      "계정",
      [input("name"), h("div", { id: "step" })],
      () => {},
    );
    editor.values.title = "my name";
    f.editors.setContent("step", h("input", { name: "code", value: "" }));
    f.editors.setField("code", "123");
    assert.equal(f.editors.getField("code"), "123");
    assert.equal(editor.values.title, "my name");
    editor.values.file = [["data.json", 100, 1]];
    assert.equal(f.editors.modalDirty(), true);
  } finally {
    f.dispose();
  }
});

test("navigation guards preserve inline drafts and block switching during AI responses", async () => {
  const S = { busy: false },
    editors = { state: { inline: { onSave() {}, busy: false } } },
    messages = [];
  let called = 0;
  const { dispatch } = useActionDispatcher({
    S,
    editors,
    plans: {},
    access: {},
    source: {},
    handlers: { view: () => called++, "cancel-chat": () => called++ },
    toast: (text) => messages.push(text),
  });
  await dispatch("view", { dataset: { view: "home" } });
  assert.equal(called, 0);
  assert.match(messages.at(-1), /Save or cancel/);
  editors.state.inline = null;
  S.busy = true;
  await dispatch("view", { dataset: { view: "home" } });
  assert.equal(called, 0);
  await dispatch("cancel-chat", { dataset: {} });
  assert.equal(called, 1);
  S.busy = false;
  await dispatch("view", { dataset: { view: "home" } });
  assert.equal(called, 2);
});

test("plan execution permits in-workspace navigation while guarding workspace switches", async () => {
  const calls = [],
    notices = [];
  const { dispatch } = useActionDispatcher({
    S: { busy: true },
    editors: { state: {} },
    plans: { execution: { value: { active: true } } },
    access: {},
    source: {},
    handlers: {
      tab: () => calls.push("tab"),
      view: () => calls.push("view"),
      "switch-workspace": () => calls.push("switch"),
    },
    toast: (text) => notices.push(text),
  });
  await dispatch("tab", { dataset: { tab: "requirements" } });
  await dispatch("view", { dataset: { view: "project" } });
  await dispatch("view", { dataset: { view: "home" } });
  await dispatch("switch-workspace", { dataset: {} });
  assert.deepEqual(calls, ["tab", "view"]);
  assert.equal(notices.length, 2);
});

test("title switches preserve disabled defaults and participate in unsaved-change protection", () => {
  const f = fixture();
  try {
    const e = f.editors.openDialog("스킬", input("existing"), async () => {}, {
      titleActions: [
        h("input", {
          type: "checkbox",
          role: "switch",
          name: "enabled",
          checked: false,
        }),
      ],
    });
    assert.equal(e.values.enabled, false);
    assert.equal(f.editors.modalDirty(), false);
    e.values.enabled = true;
    f.editors.requestModalClose();
    assert.equal(e.unsaved, true);
    e.values.enabled = false;
    assert.equal(f.editors.modalDirty(), false);
  } finally {
    f.dispose();
  }
});

test("child project dialogs restore unsaved personal settings and preserve unload protection", async () => {
  const f = fixture();
  try {
    const parent = f.editors.openDialog(
      "개인 설정",
      input("original"),
      async () => {},
      { personalSettings: true },
    );
    parent.values.title = "unsaved";
    f.editors.openDialog("폴더 연결", input("path"), async () => {}, {
      parentEditor: parent,
    });
    const event = new Event("beforeunload", { cancelable: true });
    f.events.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    f.editors.requestModalClose();
    assert.equal(f.editors.state.dialog, parent);
    assert.equal(parent.values.title, "unsaved");
    assert.equal(parent.unsaved, false);
    const child = f.editors.openDialog(
      "폴더 연결",
      input("path"),
      async () => {},
      { parentEditor: parent },
    );
    await f.editors.submit(child, new FormData());
    assert.equal(f.editors.state.dialog, parent);
    assert.equal(f.closes, 0);
    f.editors.requestModalClose();
    assert.equal(parent.unsaved, true);
  } finally {
    f.dispose();
  }
});
