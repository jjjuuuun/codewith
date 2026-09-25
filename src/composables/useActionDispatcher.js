import { t as __t } from "../i18n/index.js";
export function useActionDispatcher({
  S,
  editors,
  plans,
  access,
  source,
  handlers,
  toast,
}) {
  async function dispatch(name, el) {
    if (name.startsWith("plan-")) return plans.handle(name, el);
    if (name.startsWith("access-")) {
      if (editors.state.inline?.onSave)
        return toast(__t("작성 중인 내용을 저장하거나 취소해 주세요."));
      return access.action(name, el);
    }
    const id = el.dataset.id,
      sid = el.dataset.spec;
    const editor = editors.state.inline;
    if (
      S.busy &&
      !(
        plans.execution?.value?.active &&
        ["view", "tab", "spec", "requirement-nav"].includes(name) &&
        el.dataset.view !== "home"
      ) &&
      [
        "view",
        "tab",
        "spec",
        "requirement-nav",
        "workspaces",
        "switch-workspace",
        "new-spec",
        "edit-spec",
        "delete-spec",
        "new-workspace",
        "delete-workspace",
        "exchange",
        "restore-commit",
        "load-chat-history",
        "new-chat",
        "rename-chat",
        "delete-chat",
      ].includes(name)
    )
      return toast(__t("AI 응답을 완료하거나 중지한 뒤 이동해 주세요."));
    if (editor?.busy && name !== "cancel-chat") return;
    if (
      editor?.onSave &&
      [
        "view",
        "tab",
        "spec",
        "requirement-nav",
        "workspaces",
        "new-workspace",
        "join-dialog",
        "delete-workspace",
        "edit-workspace",
        "personal-settings",
        "switch-workspace",
        "new-spec",
        "edit-spec",
        "delete-spec",
        "new-requirement",
        "edit-requirement",
        "complete-requirement",
        "new-task",
        "edit-task",
        "new-question",
        "edit-question",
        "edit-design",
        "resources",
        "exchange",
        "logout",
        "remove-requirement",
        "remove-task",
        "remove-question",
        "remove-plan",
        "review-proposal",
        "add-spec-proposal",
        "chat-history",
        "load-chat-history",
        "new-chat",
        "rename-chat",
        "delete-chat",
        "preview-chat",
      ].includes(name)
    )
      return toast(__t("작성 중인 내용을 저장하거나 취소해 주세요."));
    if (name.startsWith("project-source-")) return source.handle(name, el);

    return handlers[name]?.(el);
  }

  return { dispatch };
}
