import { t as __t } from "../i18n/index.js";
import { LIMITS } from "../../shared/config.mjs";
import { uid } from "../services/format.js";
import { btn, field, repeatRows } from "../services/form-fields.js";
import { h } from "vue";
import ResourceContent from "../components/ResourceContent.vue";
const resourceNodes = (resource) => h(ResourceContent, { resource });

export function useResources({ S, openInline, readRows, mutate }) {
  function resourceDialog(rid, sid) {
    const r = S.w.document.specs
      .find((s) => s.id === sid)
      .requirements.find((r) => r.id === rid);
    openInline(
      __t("{0} · 참고 자료", [rid]),
      [
        h("p", { class: "muted" }, [
          __t(
            "목업·도표 이미지 또는 직접 작성한 표·그래프·흐름도를 요구사항과 함께 버전 관리합니다.",
          ),
        ]),
        (r.resources || []).map((a) => [
          h("div", { class: "card" }, [
            h("div", { class: "row between" }, [
              h("b", {}, [a.title]),
              h("div", {}, [
                btn("resource-edit", __t("편집"), "small", {
                  "data-resource": a.id,
                  "data-id": rid,
                  "data-spec": sid,
                }),
                " ",
                btn("resource-delete", __t("삭제"), "danger small", {
                  "data-resource": a.id,
                  "data-id": rid,
                  "data-spec": sid,
                }),
              ]),
            ]),
            resourceNodes(a),
          ]),
        ]),
        h("div", { class: "row" }, [
          ["image", "table", "chart", "flow", "note"].map((type) =>
            btn(
              "resource-new",
              {
                image: __t("이미지 · 목업"),
                table: __t("표"),
                chart: __t("막대그래프"),
                flow: __t("흐름도"),
                note: __t("설명 · 링크"),
              }[type],
              "small",
              { "data-type": type, "data-id": rid, "data-spec": sid },
            ),
          ),
        ]),
      ],
      null,
      { resourceRequirement: rid, resourceSpec: sid },
    );
  }
  function editResource(rid, sid, type, aid) {
    const r = S.w.document.specs
        .find((s) => s.id === sid)
        .requirements.find((r) => r.id === rid),
      a = r.resources?.find((a) => a.id === aid) || {
        id: uid("REF"),
        type,
        title: "",
      };
    type = a.type;
    let html = [
      field(__t("자료 식별번호"), "id", a.id, "input", {
        required: true,
        pattern: "(?:[a-zA-Z0-9_]|-)+",
      }),
      field(__t("자료 이름"), "title", a.title, "input", {
        required: true,
        maxlength: "200",
      }),
    ];
    if (type === "image")
      html = [
        html,
        [
          [
            [
              h("label", {}, [
                __t("이미지 파일 · PNG/JPEG/WebP/GIF, 1 MB 이하"),
              ]),
              h(
                "input",
                {
                  type: "file",
                  name: "image",
                  accept: "image/png,image/jpeg,image/webp,image/gif",
                },
                [],
              ),
            ],
            a.data ? resourceNodes(a) : "",
          ],
          [
            h("p", { class: "muted" }, [
              __t(
                "목업, 아키텍처 다이어그램, 그래프 등을 이미지로 첨부할 수 있습니다.",
              ),
            ]),
          ],
        ],
      ];
    if (type === "table")
      html = [
        html,
        [
          field(
            __t("표 데이터 · 첫 줄은 열 이름, 열 사이는 탭"),
            "table",
            a.headers
              ? [a.headers, ...a.rows].map((row) => row.join("\t")).join("\n")
              : __t("입력\t기대 결과\n신규 요청\t성공\n중복 요청\t거절"),
            "textarea",
            { required: true, class: "file-editor" },
          ),
          [
            h("small", {}, [
              __t("스프레드시트에서 셀을 복사해 붙여넣어도 됩니다."),
            ]),
          ],
        ],
      ];
    if (type === "chart")
      html = [
        html,
        [
          field(
            __t("막대그래프 데이터 · 한 줄에 이름, 숫자"),
            "values",
            (
              a.values || [
                { label: __t("응답 시간 목표(ms)"), value: 200 },
                { label: __t("현재 측정(ms)"), value: 160 },
              ]
            )
              .map((x) => x.label + ", " + x.value)
              .join("\n"),
            "textarea",
            { required: true },
          ),
          [
            h("small", {}, [
              __t("0 이상의 수치만 사용합니다. 측정 단위는 이름에 표시하세요."),
            ]),
          ],
        ],
      ];
    if (type === "flow")
      html = [
        html,
        [
          [h("label", {}, [__t("위에서 아래로 진행할 단계")])],
          repeatRows(
            "steps",
            a.steps || [__t("요청 입력"), __t("조건 확인"), __t("결과 반환")],
          ),
        ],
      ];
    if (type === "note")
      html = [
        html,
        field(__t("설명 · 출처 URL"), "text", a.text || "", "textarea", {
          required: true,
        }),
      ];
    openInline(
      __t("참고 자료 ") + (aid ? __t("편집") : __t("추가")),
      html,
      async (f) => {
        const next = { id: f.get("id"), title: f.get("title"), type };
        if (type === "image") {
          const file = f.get("image");
          if (file?.size) {
            if (
              file.size > LIMITS.imageBytes ||
              !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
                file.type,
              )
            )
              throw new Error(
                __t("1 MB 이하의 PNG/JPEG/WebP/GIF 이미지를 선택하세요."),
              );
            next.data = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
          } else if (a.data) next.data = a.data;
          else throw new Error(__t("이미지를 선택하세요."));
        }
        if (type === "table") {
          const rows = f
            .get("table")
            .trim()
            .split("\n")
            .map((line) => line.split("\t"));
          next.headers = rows.shift();
          next.rows = rows;
        }
        if (type === "chart") {
          next.values = f
            .get("values")
            .trim()
            .split("\n")
            .map((line) => {
              const at = line.lastIndexOf(",");
              return {
                label: line.slice(0, at).trim(),
                value: at < 0 ? NaN : Number(line.slice(at + 1).trim()),
              };
            });
        }
        if (type === "flow") next.steps = readRows("steps");
        if (type === "note") next.text = f.get("text");
        await mutate(
          (d) => {
            const target = d.specs
              .find((s) => s.id === sid)
              .requirements.find((r) => r.id === rid);
            target.resources ??= [];
            if (aid)
              target.resources[
                target.resources.findIndex((a) => a.id === aid)
              ] = next;
            else target.resources.push(next);
          },
          __t("요구사항 참고 자료 ") + (aid ? __t("수정") : __t("추가")),
        );
      },
      { resourceRequirement: rid, resourceSpec: sid },
    );
  }

  return { resourceDialog, editResource };
}
