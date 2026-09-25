import { t as __t } from "../i18n/index.js";
import { api } from "../services/api.js";
import { clone } from "../services/format.js";

export function useWorkspaceData({ S, spec, render, toast }) {
  async function saveDoc(doc, message) {
    S.w = await api("/workspaces/" + S.w.id, {
      method: "PATCH",
      body: { base: S.w.head, document: doc, message },
    });
    await refreshList();
    if (!spec()) S.specId = S.w.document.specs[0]?.id || null;
    render();
    toast(__t("프로젝트 이력에 저장했습니다."));
  }
  async function mutate(fn, message) {
    const doc = clone(S.w.document);
    fn(
      doc,
      doc.specs.find((s) => s.id === S.specId),
    );
    await saveDoc(doc, message);
  }
  async function refreshList() {
    S.workspaces = (await api("/workspaces")).workspaces;
  }
  return { saveDoc, mutate, refreshList };
}
