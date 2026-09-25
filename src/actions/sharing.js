import { t as __t } from "../i18n/index.js";
import { api } from "../services/api.js";

import { field } from "../services/form-fields.js";

export function createSharingActions({ S, renderMain, toast, openDialog }) {
  const onSharing = async (name, el) => {
    S.w = await api(`/workspaces/${S.w.id}/sharing`, {
      method: "POST",
      body: {
        visibility:
          name === "sharing"
            ? S.w.visibility === "team"
              ? "private"
              : "team"
            : S.w.visibility,
        rotate: name === "rotate-invite",
      },
    });
    return renderMain();
  };
  const onCopyInvite = async () => {
    const code = S.w.inviteCode;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(code);
      toast(__t("초대 코드를 복사했습니다."));
    } catch {
      const previousFocus = document.activeElement;
      const input = document.createElement("textarea");
      input.value = code;
      input.readOnly = true;
      input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      let copied = false;
      try {
        document.body.append(input);
        input.select();
        copied = document.execCommand("copy");
      } catch {
        // A browser may block both clipboard methods; keep the code selectable.
      } finally {
        input.remove();
        previousFocus?.focus({ preventScroll: true });
      }
      if (copied) toast(__t("초대 코드를 복사했습니다."));
      else
        openDialog(
          __t("초대 코드"),
          field(__t("팀에 공유할 초대 코드"), "inviteCode", code, "input", {
            readonly: true,
          }),
          null,
        );
    }
  };
  const onApprove = async (name, el) => {
    const id = el.dataset.id;
    S.w = await api(`/workspaces/${S.w.id}/members`, {
      method: "POST",
      body: {
        requestId: id,
        approve: name === "approve",
        role: el.dataset.role || "editor",
      },
    });
    return renderMain();
  };
  const onMemberRole = async (name, el) => {
    const id = el.dataset.id;
    S.w = await api(`/workspaces/${S.w.id}/members`, {
      method: "POST",
      body: {
        userId: id,
        role: el.dataset.role,
        remove: name === "member-remove",
      },
    });
    return renderMain();
  };
  return {
    sharing: (el) => onSharing("sharing", el),
    "rotate-invite": (el) => onSharing("rotate-invite", el),
    "copy-invite": (el) => onCopyInvite("copy-invite", el),
    approve: (el) => onApprove("approve", el),
    reject: (el) => onApprove("reject", el),
    "member-role": (el) => onMemberRole("member-role", el),
    "member-remove": (el) => onMemberRole("member-remove", el),
  };
}
