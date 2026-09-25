/* Progressive controls: native fields retain values, validation and FormData. */
(() => {
  const fields = new WeakMap();
  const label = (en, ko) => (document.documentElement.lang === "ko" ? ko : en);
  let serial = 0,
    active = null,
    typeBuffer = "",
    typeTimer;
  const chevron =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function name(select) {
    return (
      select.getAttribute("aria-label") ||
      [...(select.labels || [])].map((l) => l.textContent.trim()).join(" ") ||
      label("Select", "선택")
    );
  }
  function sync(select) {
    const item = fields.get(select);
    if (!item) return;
    const text =
      [...select.selectedOptions].map((o) => o.label).join(", ") ||
      label("Choose an option", "선택하세요");
    if (item.text.textContent !== text) item.text.textContent = text;
    item.button.disabled = select.matches(":disabled");
    item.button.setAttribute("aria-label", name(select) + ": " + text);
    if (select.required) item.button.setAttribute("aria-required", "true");
    else item.button.removeAttribute("aria-required");
    if (select.title) item.button.title = select.title;
    if (
      active?.select === select &&
      (item.button.disabled || !select.isConnected)
    )
      close(false);
  }
  function close(focus = true) {
    typeBuffer = "";
    clearTimeout(typeTimer);
    if (!active) return;
    const old = active;
    active = null;
    old.button.setAttribute("aria-expanded", "false");
    old.button.removeAttribute("aria-activedescendant");
    old.popup.remove();
    if (focus && old.button.isConnected)
      old.button.focus({ preventScroll: true });
  }
  function position() {
    if (!active) return;
    const { button, popup } = active,
      r = button.getBoundingClientRect(),
      margin = 10,
      width = Math.min(Math.max(r.width, 220), innerWidth - margin * 2);
    popup.style.width = width + "px";
    popup.style.maxHeight =
      Math.max(140, Math.min(330, innerHeight - margin * 2)) + "px";
    const height = Math.min(popup.scrollHeight, 330),
      below = innerHeight - r.bottom - margin;
    popup.style.left =
      Math.max(margin, Math.min(r.left, innerWidth - width - margin)) + "px";
    popup.style.top =
      (below >= Math.min(height, 180) || r.top < below
        ? Math.max(margin, r.bottom + 6)
        : Math.max(margin, r.top - height - 6)) + "px";
    popup.style.maxHeight =
      Math.max(
        100,
        Math.min(
          330,
          below >= Math.min(height, 180) || r.top < below
            ? below
            : r.top - margin - 6,
        ),
      ) + "px";
  }
  function options(select) {
    return [...select.options]
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.hidden);
  }
  function move(index) {
    if (!active) return;
    active.index = index;
    for (const item of active.items) {
      const on = item.index === index;
      item.node.classList.toggle("is-highlighted", on);
      if (on) {
        active.button.setAttribute("aria-activedescendant", item.node.id);
        item.node.scrollIntoView({ block: "nearest" });
      }
    }
  }
  function choose(index) {
    if (!active) return;
    const { select } = active,
      option = select.options[index];
    if (!option || option.disabled || option.parentElement?.disabled) return;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    sync(select);
    close();
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function open(select) {
    const item = fields.get(select);
    if (!item || item.button.disabled) return;
    if (active?.select === select) return close();
    close(false);
    sync(select);
    const popup = document.createElement("div");
    popup.className = "cw-select-popup";
    popup.id = item.button.getAttribute("aria-controls");
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", name(select));
    popup.setAttribute("popover", "manual");
    const items = [];
    for (const { option, index } of options(select)) {
      const node = document.createElement("div");
      node.className = "cw-select-option";
      node.id = popup.id + "-" + index;
      node.setAttribute("role", "option");
      node.setAttribute(
        "aria-selected",
        String(index === select.selectedIndex),
      );
      const disabled = option.disabled || option.parentElement?.disabled;
      node.setAttribute("aria-disabled", String(!!disabled));
      node.textContent = option.label;
      node.dataset.index = index;
      node.addEventListener("pointermove", () => {
        if (!disabled) move(index);
      });
      node.addEventListener("pointerdown", (e) => e.preventDefault());
      node.addEventListener("click", () => choose(index));
      popup.append(node);
      items.push({ node, index, disabled });
    }
    if (!items.length) {
      const empty = document.createElement("p");
      empty.textContent = label(
        "No options available.",
        "선택할 항목이 없습니다.",
      );
      popup.append(empty);
    }
    (select.closest("dialog") || document.body).append(popup);
    active = { ...item, select, popup, items, index: select.selectedIndex };
    item.button.setAttribute("aria-expanded", "true");
    if (popup.showPopover) popup.showPopover();
    position();
    move(select.selectedIndex);
    item.button.focus({ preventScroll: true });
  }
  function enhance(select) {
    if (fields.has(select) || select.multiple || select.size > 1) return;
    const wrapper = document.createElement("span");
    wrapper.className = "cw-select";
    wrapper.dataset.selectId = select.id || "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cw-select-trigger";
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "cw-options-" + ++serial);
    const text = document.createElement("span");
    text.className = "cw-select-value";
    button.append(text);
    button.insertAdjacentHTML("beforeend", chevron);
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add("cw-native-select");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    fields.set(select, { wrapper, button, text });
    sync(select);
    button.addEventListener("click", () => open(select));
    button.addEventListener("keydown", (e) => {
      if (
        e.key === "Enter" ||
        e.key === " " ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp"
      ) {
        if (active) return;
        e.preventDefault();
        open(select);
        if (e.key === "ArrowUp" && select.selectedIndex < 0) {
          const allowed = active.items.filter((i) => !i.disabled);
          move(allowed.at(-1)?.index ?? -1);
        }
      }
    });
    select.addEventListener("focus", () => button.focus());
    select.addEventListener("invalid", () => {
      button.setAttribute("aria-invalid", "true");
      button.focus();
    });
    select.addEventListener("change", () => {
      button.removeAttribute("aria-invalid");
      sync(select);
    });
  }
  function scan(root) {
    if (root.matches?.("select")) enhance(root);
    root.querySelectorAll?.("select").forEach(enhance);
  }
  document.addEventListener(
    "keydown",
    (e) => {
      if (!active) return;
      if (e.isComposing) return;
      const allowed = active.items.filter((i) => !i.disabled),
        at = allowed.findIndex((i) => i.index === active.index);
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        return;
      }
      if (e.key === "Tab") {
        close(false);
        return;
      }
      if (
        ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === "Enter" || e.key === " ") return choose(active.index);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? allowed.length - 1
              : e.key === "ArrowDown"
                ? Math.min(at + 1, allowed.length - 1)
                : Math.max(at - 1, 0);
        if (allowed[next]) move(allowed[next].index);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typeBuffer += e.key.toLocaleLowerCase();
        clearTimeout(typeTimer);
        typeTimer = setTimeout(() => (typeBuffer = ""), 650);
        const found = allowed.find((i) =>
          active.select.options[i.index].label
            .toLocaleLowerCase()
            .startsWith(typeBuffer),
        );
        if (found) move(found.index);
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        active &&
        !active.popup.contains(e.target) &&
        !active.button.contains(e.target)
      )
        close(false);
    },
    true,
  );
  document.addEventListener(
    "change",
    (e) => {
      if (e.target instanceof HTMLSelectElement) sync(e.target);
    },
    true,
  );
  document.addEventListener("codewith:controls-sync", () =>
    document.querySelectorAll("select").forEach(sync),
  );
  document.addEventListener("reset", (e) =>
    queueMicrotask(() => e.target.querySelectorAll("select").forEach(sync)),
  );
  window.addEventListener("resize", position);
  document.addEventListener(
    "scroll",
    (e) => {
      if (active && !active.popup.contains(e.target)) position();
    },
    true,
  );
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        record.addedNodes.forEach((n) => {
          if (n.nodeType === 1) scan(n);
        });
        const select = record.target.closest?.("select");
        if (select) sync(select);
      } else {
        if (record.target instanceof HTMLSelectElement) sync(record.target);
        else if (record.target instanceof HTMLOptionElement)
          sync(record.target.closest("select"));
        else if (record.target.tagName === "FIELDSET")
          record.target.querySelectorAll("select").forEach(sync);
      }
    }
    if (active && (!active.select.isConnected || !active.button.isConnected))
      close(false);
  });
  function start() {
    scan(document);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "selected", "label", "required", "hidden"],
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
