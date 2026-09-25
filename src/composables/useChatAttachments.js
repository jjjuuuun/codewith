import { t as __t } from "../i18n/index.js";
import { LIMITS } from "../../shared/config.mjs";
import { aiAPI } from "../services/api.js";
export function useChatAttachments(S, toast) {
  async function add(files) {
    if (!S.w || S.chatUploading || !files?.length) return;
    const wid = S.w.id,
      sid = S.specId,
      thread = S.chatThread?.id;
    if (
      (S.chatAttachments?.length || 0) + files.length >
      LIMITS.attachmentCount
    )
      return toast(
        __t("첨부 파일은 {0}개까지 선택할 수 있습니다.", [
          LIMITS.attachmentCount,
        ]),
      );
    S.chatUploading = true;
    try {
      for (const file of files) {
        if (file.size > LIMITS.attachmentBytes)
          throw Error(
            __t("파일 하나는 {0} MB 이하이어야 합니다.", [
              LIMITS.attachmentBytes / (1024 * 1024),
            ]),
          );
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(Error(__t("파일을 읽지 못했습니다.")));
          reader.readAsDataURL(file);
        });
        const { attachment } = await aiAPI("/attachments", {
          method: "POST",
          body: { workspaceId: wid, name: file.name, data },
        });
        if (S.w?.id !== wid || S.specId !== sid || S.chatThread?.id !== thread)
          return;
        S.chatAttachments = [...(S.chatAttachments || []), attachment];
      }
    } catch (error) {
      toast(error.message);
    } finally {
      S.chatUploading = false;
    }
  }
  function fromEvent(event) {
    const files = event.clipboardData?.files || event.dataTransfer?.files;
    if (files?.length) {
      event.preventDefault();
      event.stopPropagation();
      void add([...files]);
    }
  }
  return {
    add,
    fromEvent,
    remove: (id) => {
      S.chatAttachments = S.chatAttachments.filter((a) => a.id !== id);
    },
  };
}
