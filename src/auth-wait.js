import { t } from "./i18n/index.js";
// Only the authentication hand-off shell is translated here.
for (const element of document.querySelectorAll("[data-auth-message]")) {
  element.textContent = t(element.textContent);
}
document.title = t("로그인 준비 중 · CodeWith");
