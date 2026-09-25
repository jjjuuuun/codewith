import { t as __t } from "../i18n/index.js";
export function readPlanNotes(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("[data-plan-review-notes] article")].map(
    (node) => ({
      issue: node.querySelector("[data-note-issue]")?.textContent || "",
      stance:
        node.querySelector("[data-note-stance]")?.textContent || __t("의견"),
      author: node.querySelector("[data-note-author]")?.textContent || "",
      text: node.querySelector("[data-note-text]")?.textContent || "",
    }),
  );
}
export function appendPlanNote(html, note) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let notes = doc.querySelector("[data-plan-review-notes]");
  if (!notes) {
    notes = doc.createElement("aside");
    notes.dataset.planReviewNotes = "";
    const heading = doc.createElement("h2");
    heading.textContent = __t("사람의 검토 의견");
    notes.append(heading);
    doc.body.append(notes);
  }
  const article = doc.createElement("article");
  for (const [key, value] of Object.entries(note)) {
    const node = doc.createElement(key === "issue" ? "h3" : "p");
    node.setAttribute("data-note-" + key, "");
    node.textContent = value;
    article.append(node);
  }
  notes.append(article);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
