import messages from "./en.json" with { type: "json" };
import koreanCode from "./ko-code.json" with { type: "json" };
export const supportedLocales = ["en", "ko"];
export function resolveLocale(saved, fallback = "en") {
  return supportedLocales.includes(saved)
    ? saved
    : supportedLocales.includes(fallback)
      ? fallback
      : "en";
}
function savedLocale() {
  try {
    return globalThis.localStorage?.getItem("codewith.locale");
  } catch {
    return null;
  }
}
export const locale = resolveLocale(
  savedLocale(),
  import.meta.env?.VITE_DEFAULT_LOCALE,
);
export function translate(message, values = [], language = locale) {
  const source = String(message ?? "");
  const key = source.replace(/\s+/g, " ").trim();
  const text =
    language === "en" ? (messages[key] ?? source) : (koreanCode[key] ?? source);
  return text.replace(/\{(\d+)\}/g, (match, index) =>
    index < values.length ? String(values[index]) : match,
  );
}
export const t = translate;
export function changeLocale(value) {
  if (!supportedLocales.includes(value) || value === locale) return;
  localStorage.setItem("codewith.locale", value);
  // Reload through the existing unsaved-change guard. Existing drafts are never rewritten.
  location.reload();
}
export const dateLocale = locale === "ko" ? "ko-KR" : "en-US";
if (typeof document !== "undefined") document.documentElement.lang = locale;
