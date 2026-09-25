import { t as __t } from "../i18n/index.js";
import { h } from "vue";
import { api } from "../services/api.js";
import { date, short, clone } from "../services/format.js";
import { btn, field } from "../services/form-fields.js";

export function createTransferActions({
  openDialog,
  download,
  S,
  saveDoc,
  toast,
  exchangeDialog,
  template,
  exportHTML,
  editable,
  spec,
  modal,
  render,
}) {
  const onCopyCode = async (name, el) => {
    {
      const text = el.closest(".code-block").querySelector("code").textContent;
      try {
        await navigator.clipboard.writeText(text);
        el.textContent = __t("복사됨");
      } catch {
        openDialog(
          __t("코드 복사"),
          field(__t("복사할 코드"), "copy", text, "textarea", {
            class: "file-editor",
          }),
          null,
        );
      }
      return;
    }
  };
  const onDownloadFile = async (name, el) => {
    return download(
      el.dataset.path.split("/").pop(),
      S.w.document.files[el.dataset.path],
      "text/plain",
    );
  };
  const onImportCode = async (name, el) => {
    {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.onchange = async () => {
        try {
          const doc = clone(S.w.document);
          for (const file of input.files) {
            if (file.size > 200000)
              throw new Error(__t("각 파일은 200 KB 이하이어야 합니다."));
            if (Object.hasOwn(doc.files, file.name))
              throw new Error(
                __t(
                  "동일한 이름의 파일이 있습니다. 파일 편집에서 내용을 변경하세요.",
                ),
              );
            doc.files[file.name] = await file.text();
          }
          await saveDoc(doc, __t("코드 파일 가져오기"));
        } catch (e) {
          toast(e.message);
        }
      };
      input.click();
      return;
    }
  };
  const onExchange = async (name, el) => {
    return exchangeDialog();
  };
  const onTemplateJson = async (name, el) => {
    return download(
      "codewith-template.json",
      JSON.stringify(template(), null, 2),
    );
  };
  const onExportHtml = async (name, el) => {
    return exportHTML();
  };
  const onExportJson = async (name, el) => {
    {
      const p = await api("/workspaces/" + S.w.id + "/export");
      return download("codewith-workspace.json", JSON.stringify(p, null, 2));
    }
  };
  const onCommitDetail = async (name, el) => {
    const id = el.dataset.id;
    {
      const c = await api(`/workspaces/${S.w.id}/commits/${id}`);
      return openDialog(
        __t("프로젝트 커밋 ") + short(id),
        [
          h("h3", {}, [c.message]),
          h("p", {}, [[c.author.name, " · ", date(c.at)]]),
          c.changes.map((x) => [
            h("details", {}, [
              h("summary", { class: "file-path" }, [x.path]),
              h("label", {}, [__t("이전 커밋")]),
              h("pre", {}, [JSON.stringify(x.before, null, 2)]),
              h("label", {}, [__t("이 커밋")]),
              h("pre", {}, [JSON.stringify(x.after, null, 2)]),
            ]),
          ]),
          id !== S.w.head && editable()
            ? [
                h("div", { class: "note" }, [
                  __t(
                    "이 시점의 프로젝트 기준, 모든 명세와 코드 파일을 복원합니다. 복원 후 명세는 재검토 상태가 됩니다.",
                  ),
                ]),
                btn("restore-commit", __t("이 커밋으로 복원"), "primary", {
                  "data-id": id,
                }),
              ]
            : "",
        ],
        null,
        { wide: true },
      );
    }
  };
  const onRestoreCommit = async (name, el) => {
    const id = el.dataset.id;
    S.w = await api(`/workspaces/${S.w.id}/restore`, {
      method: "POST",
      body: { base: S.w.head, commitId: id },
    });
    if (!spec()) S.specId = S.w.document.specs[0]?.id || null;
    modal.close();
    render();
    return toast(__t("복원 커밋을 만들었습니다."));
  };
  return {
    "copy-code": (el) => onCopyCode("copy-code", el),
    "download-file": (el) => onDownloadFile("download-file", el),
    "import-code": (el) => onImportCode("import-code", el),
    exchange: (el) => onExchange("exchange", el),
    "template-json": (el) => onTemplateJson("template-json", el),
    "export-html": (el) => onExportHtml("export-html", el),
    "export-json": (el) => onExportJson("export-json", el),
    "commit-detail": (el) => onCommitDetail("commit-detail", el),
    "restore-commit": (el) => onRestoreCommit("restore-commit", el),
  };
}
