import { t as __t } from "../i18n/index.js";
import { LIMITS } from "../../shared/config.mjs";
import { download, template, exportHTML } from "../services/exchange.js";
import { h } from "vue";
import { api } from "../services/api.js";

import { btn, field, selectField } from "../services/form-fields.js";

export function useExchange({
  S,
  openDialog,
  refreshList,
  loadWorkspace,
  editable,
  saveDoc,
  spec,
  loadChats,
  render,
  onField,
  setError,
  setField,
}) {
  function exchangeDialog() {
    openDialog(
      __t("공유 파일 · JSON 불러오기"),
      [
        h("p", {}, [
          __t(
            "JSON v2 한 형식에 프로젝트 기준, 모든 개발 단위, 참고 자료와 코드 파일을 담습니다. 계정·AI 연결·대화·멤버·커밋 이력은 공유 파일에 포함하지 않습니다.",
          ),
        ]),
        h("label", {}, [__t("JSON 또는 CodeWith HTML 파일 선택")]),
        h(
          "input",
          {
            type: "file",
            id: "import-json-file",
            accept: ".json,.html,application/json,text/html",
          },
          [],
        ),
        field(__t("JSON 직접 작성 · 붙여넣기"), "json", "", "textarea", {
          class: "file-editor",
          placeholder: __t("템플릿 JSON을 붙여넣으세요."),
        }),
        selectField(
          __t("불러올 위치"),
          "destination",
          [
            ["new", __t("새 워크스페이스로 만들기")],
            ["current", __t("현재 프로젝트 전체 교체 · 새 커밋")],
          ],
          "new",
        ),
        h("div", { class: "note" }, [
          __t(
            "불러오기 전에 형식과 식별번호 중복을 검사합니다. 현재 프로젝트 교체도 이전 커밋으로 복원할 수 있습니다. 기본 설정에서 내려받은 HTML 문서도 다시 불러올 수 있습니다. YAML 입력은 아직 지원하지 않습니다.",
          ),
        ]),
        h("a", { href: "/guide#format", target: "_blank" }, [
          __t("필드 설명과 직접 작성 예제"),
        ]),
      ],
      async (f) => {
        let payload;
        try {
          const raw = f.get("json").trim();
          if (raw.startsWith("<")) {
            const m = raw.match(
              /<script\s+type="application\/json"\s+id="codewith-data">([\s\S]*?)<\/script>/i,
            );
            if (!m) throw new Error();
            payload = JSON.parse(m[1]);
          } else payload = JSON.parse(raw);
        } catch {
          throw new Error(
            __t("올바른 JSON 또는 CodeWith에서 저장한 HTML을 입력하세요."),
          );
        }
        if (f.get("destination") === "new") {
          const w = await api("/workspaces", {
            method: "POST",
            body: { exchange: payload },
          });
          await refreshList();
          await loadWorkspace(w.id);
        } else {
          if (!editable()) throw new Error(__t("편집 권한이 필요합니다."));
          const doc =
            payload.format === "codewith.exchange" ? payload.document : payload;
          await saveDoc(doc, __t("공유 JSON 불러오기"));
          if (!spec()) S.specId = S.w.document.specs[0]?.id || null;
          await loadChats();
          render();
        }
      },
      {
        save: __t("검사 후 불러오기"),
        wide: true,
        headerActions: [
          btn("export-json", __t("현재 프로젝트 내려받기"), "primary"),
          btn("template-json", __t("작성용 템플릿 내려받기")),
        ],
      },
    );
    onField("import-json-file", async (e) => {
      const f = e.target.files[0];
      if (f) {
        if (f.size > LIMITS.exchangeBytes) {
          setError(__t("35 MB 이하의 파일을 선택하세요."));
          return;
        }
        setField("json", await f.text());
      }
    });
  }

  return {
    download,
    template,
    exchangeDialog,
    exportHTML: () => exportHTML(S.w.id),
  };
}
