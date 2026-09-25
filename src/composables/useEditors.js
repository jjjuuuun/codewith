import { t as __t } from "../i18n/index.js";
import { reactive, markRaw, onBeforeUnmount } from "vue";

// Each editor owns its draft. Saving an older editor must never close a newer one.
export function useEditors({ canEdit, onClose = () => {} }) {
  const state = reactive({ dialog: null, inline: null });
  let serial = 0;
  const active = () => state.dialog || state.inline;
  function collect(nodes, values, rows) {
    for (const node of [nodes].flat(Infinity)) {
      if (!node || typeof node !== "object") continue;
      const p = node.props || {};
      if (p.formRows) rows[p.name] = JSON.parse(JSON.stringify(p.items));
      if (["input", "textarea", "select"].includes(node.type)) {
        const name = p.name || p.id;
        if (name && p.type !== "file") {
          if (p.type === "checkbox") {
            if (name === "context") {
              values[name] ||= [];
              if (p.checked) values[name].push(p.value);
            } else values[name] = !!p.checked;
          } else if (node.type === "select") {
            const options = (node.children || []).flat(Infinity);
            values[name] =
              options.find((x) => x.props?.selected)?.props?.value ??
              options[0]?.props?.value ??
              "";
          } else
            values[name] =
              p.value ??
              (node.type === "textarea"
                ? (node.children || []).flat(Infinity).join("")
                : "");
        }
      }
      if (Array.isArray(node.children)) collect(node.children, values, rows);
    }
  }
  function create(title, nodes, onSave, options = {}) {
    const values = {},
      rows = {};
    collect([nodes, options.titleActions], values, rows);
    return {
      id: ++serial,
      title,
      nodes: markRaw(Array.isArray(nodes) ? nodes : [nodes]),
      onSave: onSave ? markRaw(onSave) : null,
      options,
      values,
      rows,
      overrides: {},
      handlers: {},
      controls: {},
      error: "",
      busy: false,
      unsaved: false,
      baseline: JSON.stringify({ values, rows }),
    };
  }
  function openDialog(...args) {
    state.dialog = create(...args);
    return state.dialog;
  }
  function openInline(...args) {
    if (canEdit()) {
      state.inline = create(...args);
      return state.inline;
    }
  }
  function closeDialog() {
    if (!state.dialog) return;
    state.dialog = state.dialog.options.parentEditor || null;
    if (!state.dialog) onClose();
  }
  const closeInline = () => {
    state.inline = null;
  };
  const dialogDirty = (editor) =>
    !!editor?.onSave &&
    JSON.stringify({ values: editor.values, rows: editor.rows }) !==
      editor.baseline;
  const modalDirty = () => {
    for (
      let editor = state.dialog;
      editor;
      editor = editor.options.parentEditor
    )
      if (dialogDirty(editor)) return true;
    return false;
  };
  function requestModalClose() {
    if (state.dialog?.busy) return;
    if (dialogDirty(state.dialog)) state.dialog.unsaved = true;
    else closeDialog();
  }
  async function submit(editor, data, form) {
    if (!editor.onSave || editor.busy) return;
    editor.busy = true;
    editor.error = "";
    try {
      const result = await editor.onSave(data, form);
      if (result !== false) {
        if (state.dialog?.id === editor.id) closeDialog();
        if (state.inline?.id === editor.id) closeInline();
      }
    } catch (error) {
      editor.error =
        error.status === 409 && state.inline?.id === editor.id
          ? __t(
              "팀의 변경과 충돌했습니다. 입력 내용은 유지됩니다. 다른 탭에서 최신 명세를 확인한 뒤 취소하고 다시 편집해 주세요.",
            )
          : __t(error.message);
    } finally {
      editor.busy = false;
    }
  }
  const getField = (name) => active()?.values[name] ?? "";
  const setField = (name, value) => {
    if (active()) active().values[name] = value;
  };
  const setError = (text) => {
    if (active()) active().error = text;
  };
  function setContent(id, nodes) {
    if (active()) {
      collect(nodes, active().values, active().rows);
      active().overrides[id] = markRaw(Array.isArray(nodes) ? nodes : [nodes]);
    }
  }
  const onField = (id, handler) => {
    active().handlers[id] = handler;
  };
  const control = (id, props) => {
    if (active())
      active().controls[id] = { ...active().controls[id], ...props };
  };
  const readRows = (name) =>
    (active()?.rows[name] || []).map((x) =>
      typeof x === "string"
        ? x.trim()
        : { id: x.id.trim(), text: x.text.trim() },
    );
  function beforeUnload(e) {
    if (state.inline?.onSave || modalDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  window.addEventListener("beforeunload", beforeUnload);
  onBeforeUnmount(() =>
    window.removeEventListener("beforeunload", beforeUnload),
  );
  return {
    state,
    active,
    openDialog,
    openInline,
    closeDialog,
    closeInline,
    modalDirty,
    requestModalClose,
    submit,
    getField,
    setField,
    setError,
    setContent,
    onField,
    control,
    readRows,
  };
}
