import { t as __t } from "../i18n/index.js";
import { planRequirementLabel } from "../../shared/plans.mjs";
import { PLAN_DOCUMENT_STYLE } from "../../shared/plan-document-style.mjs";
import { createPlanMarkdown } from "../../shared/plan-markdown.mjs";
const renderPlanMarkdown = createPlanMarkdown();
export function planTabLabel(tab) {
  const label = tab.nextElementSibling;
  const section = label?.nextElementSibling;
  const id = section?.querySelector(".requirement-id")?.textContent.trim();
  const title = section?.querySelector(".plan-title h1")?.textContent.trim();
  return id && title
    ? planRequirementLabel(id, title)
    : label?.textContent || "";
}
export function serializePlanEditor(document) {
  const root = document.documentElement.cloneNode(true);
  root
    .querySelectorAll(
      "[data-codewith-editor-ui], [data-codewith-preview-theme]",
    )
    .forEach((node) => node.remove());
  const liveChecks = document.querySelectorAll(
    '.plan-card input[type="checkbox"]',
  );
  root
    .querySelectorAll('.plan-card input[type="checkbox"]')
    .forEach((input, index) => {
      input.toggleAttribute("checked", liveChecks[index].checked);
      input.disabled = input.dataset.planWasDisabled === "true";
      input.removeAttribute("data-plan-was-disabled");
    });
  root.querySelectorAll("[data-codewith-editable]").forEach((node) => {
    node.removeAttribute("contenteditable");
    node.removeAttribute("data-codewith-editable");
  });
  return "<!doctype html>" + root.outerHTML;
}

export function attachPlanEditor(
  document,
  { editable, approvals, onChange, onApprove, onRevise, externalTabs = false },
) {
  const cards = [...document.querySelectorAll(".plan-card")];
  if (!cards.length) cards.push(document.body);
  const style = document.createElement("style");
  style.dataset.codewithEditorUi = "";
  style.textContent = `main[data-codewith-plan-ui]{max-width:none;width:100%;padding-top:0}main[data-codewith-plan-ui]>.tab-state+label{display:none}.cw-review-specs{position:sticky;top:0;z-index:5;order:-1;display:flex;gap:10px;width:100%;overflow-x:auto;padding:14px 0;border-bottom:1px solid #8885}.cw-review-specs button{flex-shrink:0;font:inherit;padding:9px 14px;border:1px solid #8886;border-radius:9px;background:transparent;color:inherit;cursor:pointer}.cw-review-specs button[aria-pressed=true]{background:#6260b4;color:#fff;border-color:#6260b4}.cw-review-specs button:focus-visible{outline:3px solid #b7b5f1;outline-offset:-3px}.cw-review-actions{display:flex!important;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 0;margin-bottom:16px;border-bottom:1px solid #8885}.cw-review-actions button{display:inline-block!important;font:inherit;font-size:14px;padding:7px 12px;border:1px solid #8888;border-radius:8px;background:transparent;color:inherit;cursor:pointer}[contenteditable=true]:focus{outline:2px solid #8581cd;outline-offset:4px}`;
  style.textContent += `
    .cw-review-actions button[aria-pressed="true"] {
      background: #166534;
      color: #fff;
      border-color: #22c55e;
      font-weight: 700;
    }
    .cw-review-actions button:focus-visible {
      outline: 3px solid #8581cd;
      outline-offset: 3px;
    }
  `;
  style.textContent += PLAN_DOCUMENT_STYLE;
  document.head.append(style);
  // Upgrade legacy rendered Markdown without touching code examples or stored versions.
  cards.forEach((card) => {
    card.querySelectorAll("li").forEach((li) => {
      const text = li.querySelector(":scope > p")?.firstChild || li.firstChild;
      if (text?.nodeType !== 3) return;
      const match = text.textContent.match(/^\[([ xX])\]\s+/);
      if (!match) return;
      text.textContent = text.textContent.slice(match[0].length);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.planCheck = "";
      input.disabled = true;
      input.checked = match[1].toLowerCase() === "x";
      input.toggleAttribute("checked", input.checked);
      input.setAttribute("aria-label", li.textContent.trim());
      text.parentNode.insertBefore(input, text);
      li.classList.add("plan-task");
    });
    card.querySelectorAll("p").forEach((p) => {
      if (p.closest("pre, code") || !p.textContent.trim().startsWith("|"))
        return;
      const text = [...p.childNodes]
        .map((n) => (n.nodeName === "BR" ? "\n" : n.textContent))
        .join("");
      const rendered = renderPlanMarkdown(text);
      if (!rendered.includes('<div class="plan-table">')) return;
      const holder = document.createElement("div");
      holder.innerHTML = rendered;
      p.replaceWith(...holder.childNodes);
    });
    card.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      if (!input.closest("label.plan-check")) {
        let label = input.closest("label");
        if (!label) {
          label = document.createElement("label");
          input.before(label);
          label.append(input);
          while (
            label.nextSibling &&
            !["UL", "OL"].includes(label.nextSibling.nodeName)
          )
            label.append(label.nextSibling);
        }
        label.classList.add("plan-check");
        const text = document.createElement("span");
        [...label.childNodes]
          .filter((node) => node !== input)
          .forEach((node) => text.append(node));
        label.append(text);
      }
      input.dataset.planWasDisabled = String(input.disabled);
      input.disabled = !editable;
      if (!input.labels?.length && !input.getAttribute("aria-label"))
        input.setAttribute(
          "aria-label",
          input.closest("li")?.textContent.trim() || __t("검토 항목 확인"),
        );
      input.addEventListener("change", () => {
        input.toggleAttribute("checked", input.checked);
        onChange(serializePlanEditor(document));
      });
    });
  });
  const main = document.querySelector("main[data-codewith-plan-ui]");
  const tabs = main ? [...main.querySelectorAll(":scope > .tab-state")] : [];
  if (tabs.length && !externalTabs) {
    const nav = document.createElement("nav");
    nav.dataset.codewithEditorUi = "";
    nav.className = "cw-review-specs";
    nav.setAttribute("aria-label", __t("계획 요구사항 선택"));
    nav.style.background = document.defaultView.getComputedStyle(
      document.body,
    ).backgroundColor;
    const syncTabs = () => {
      [...nav.children].forEach((button, index) =>
        button.setAttribute("aria-pressed", String(tabs[index].checked)),
      );
    };
    tabs.forEach((tab) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = planTabLabel(tab);
      button.addEventListener("click", () => {
        tab.checked = true;
        tab.dispatchEvent(
          new document.defaultView.Event("change", { bubbles: true }),
        );
        document.scrollingElement.scrollTop = 0;
      });
      tab.addEventListener("change", syncTabs);
      nav.append(button);
    });
    main.prepend(nav);
    syncTabs();
  }
  cards.forEach((card, index) => {
    const step = "step-" + index;
    const title = card.querySelector("h2")?.textContent || __t("전체 계획");
    const controls = document.createElement("div");
    controls.dataset.codewithEditorUi = "";
    controls.className = "cw-review-actions";
    controls.dataset.step = step;
    controls.contentEditable = "false";
    for (const [label, action] of [
      [__t("검토함"), () => onApprove(step)],
      [__t("이 단계 수정 요청"), () => onRevise(step, title)],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = !editable;
      button.addEventListener("click", action);
      controls.append(button);
    }
    if (editable) {
      card.contentEditable = "true";
      card.dataset.codewithEditable = "";
    }
    card.prepend(controls);
  });
  document.addEventListener("input", () =>
    onChange(serializePlanEditor(document)),
  );
  document.addEventListener("click", (event) => {
    if (event.target.closest("a")) event.preventDefault();
  });
  updatePlanApprovals(document, approvals);
  return tabs;
}

export function updatePlanApprovals(document, approvals) {
  document?.querySelectorAll(".cw-review-actions").forEach((controls) => {
    const button = controls.querySelector("button");
    const reviewed = !!approvals?.[controls.dataset.step];
    button.textContent = reviewed ? __t("검토함 · 해제") : __t("검토함");
    button.setAttribute("aria-pressed", String(reviewed));
    button.title = reviewed
      ? __t("검토 표시 해제")
      : __t("이 단계를 검토함으로 표시");
  });
}
