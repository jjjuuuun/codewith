/* Apply before styles load so a saved dark preference never flashes light. */
(() => {
  const key = "codewith.theme",
    valid = (value) =>
      ["system", "light", "dark"].includes(value) ? value : "system";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let mode = "system";
  try {
    mode = valid(localStorage.getItem(key));
  } catch {}
  const glyphs = {
    system:
      '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    light:
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    dark: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  };
  const label = (en, ko) => (document.documentElement.lang === "ko" ? ko : en);
  function control() {
    return `<span class="theme-control" title="${label("Display theme", "화면 테마")}">${Object.entries(
      glyphs,
    )
      .map(
        ([name, path]) =>
          `<svg class="theme-icon theme-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`,
      )
      .join(
        "",
      )}<select data-theme-select aria-label="${label("Display theme", "화면 테마")}">${[
      ["system", label("System", "시스템 설정")],
      ["light", label("Light", "라이트")],
      ["dark", label("Dark", "다크")],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${mode === value ? "selected" : ""}>${label}</option>`,
      )
      .join("")}</select></span>`;
  }
  function apply() {
    const theme = mode === "system" ? (media.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelectorAll("[data-theme-select]")
      .forEach((s) => (s.value = mode));
    document.dispatchEvent(new Event("codewith:controls-sync"));
    document.querySelectorAll("iframe.plan-preview").forEach((frame) => {
      const url = new URL(frame.src, location.href);
      if (
        url.origin !== location.origin ||
        url.searchParams.get("theme") === theme
      )
        return;
      url.searchParams.set("theme", theme);
      frame.src = url.href;
    });
  }
  function set(value) {
    mode = valid(value);
    try {
      if (mode === "system") localStorage.removeItem(key);
      else localStorage.setItem(key, mode);
    } catch {}
    apply();
  }
  window.CodeWithTheme = {
    control,
    set,
    get mode() {
      return mode;
    },
    get resolved() {
      return document.documentElement.dataset.theme;
    },
  };
  apply();
  media.addEventListener("change", () => {
    if (mode === "system") apply();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === key || e.key === null) {
      mode = valid(e.newValue);
      apply();
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-theme-select]")) set(e.target.value);
  });
  document.addEventListener("DOMContentLoaded", () => {
    if (!document.querySelector("#app")) {
      const box = document.createElement("div");
      box.className = "theme-document-control";
      box.innerHTML = control();
      document.body.prepend(box);
    }
    apply();
  });
})();
