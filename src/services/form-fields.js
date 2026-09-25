import { h } from "vue";
import RepeatFields from "../components/forms/RepeatFields.vue";
export const btn = (action, label, cls = "", attrs = {}) =>
  h(
    "button",
    { type: "button", "data-action": action, class: cls, ...attrs },
    Array.isArray(label) ? label : [label],
  );
export const field = (label, name, value = "", type = "input", attrs = {}) => [
  h("label", { for: "f-" + name, class: "field-label-help" }, label),
  h(
    type,
    { id: "f-" + name, name, ...attrs, ...(type === "input" ? { value } : {}) },
    type === "input" ? undefined : [String(value)],
  ),
];
export const selectField = (label, name, values, selected) => [
  h("label", { for: "f-" + name, class: "field-label-help" }, label),
  h(
    "select",
    { id: "f-" + name, name },
    values.map((v) => {
      const [value, title] = Array.isArray(v) ? v : [v, v];
      return h("option", { value, selected: value === selected }, title);
    }),
  ),
];
export const repeatRows = (name, items, ids = false) =>
  h(RepeatFields, { name, items, ids, formRows: true });
