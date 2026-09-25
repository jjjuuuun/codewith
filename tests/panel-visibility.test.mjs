import test from "node:test";
import assert from "node:assert/strict";
import { createNavigationActions } from "../src/actions/navigation.js";
import { isChatVisible } from "../src/services/panel-visibility.js";

test("one click opens or closes chat from every view, viewport and saved state", (t) => {
  for (const [key, value] of Object.entries({
    localStorage: { setItem() {} },
    innerWidth: 1280,
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
    t.after(() =>
      original
        ? Object.defineProperty(globalThis, key, original)
        : delete globalThis[key],
    );
  }
  for (const width of [390, 950, 951, 1280]) {
    globalThis.innerWidth = width;
    for (const view of ["workspace", "spec"])
      for (const chatHidden of [false, true])
        for (const showAI of [false, true]) {
          const S = { view, chatHidden, showAI };
          const actions = createNavigationActions({ S, render() {} });
          const before = isChatVisible(S, width);
          actions["toggle-ai"]();
          assert.equal(isChatVisible(S, width), !before);
          actions["toggle-ai"]();
          assert.equal(isChatVisible(S, width), before);
        }
  }
});
