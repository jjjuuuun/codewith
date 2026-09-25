import { dateLocale } from "../i18n/index.js";
export const date = (value) =>
  new Date(value).toLocaleString(dateLocale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const short = (value) => value?.slice(0, 8) || "—";

export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const uid = (prefix) =>
  prefix +
  "-" +
  Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
