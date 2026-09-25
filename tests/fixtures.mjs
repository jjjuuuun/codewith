import { blankSpec, SCHEMA } from "../shared/schema.mjs";
export function sample() {
  const s = blankSpec("SPEC-REG", "참가 등록");
  s.requirements = [
    {
      id: "REG-001",
      title: "중복 등록 방지",
      body: "동일한 이메일은 한 번만 등록한다.",
      status: "draft",
      criteria: [
        { id: "AC-001", text: "두 번째 요청은 중복 오류를 반환한다." },
      ],
      resources: [
        {
          id: "REF-001",
          type: "table",
          title: "기대 결과",
          headers: ["입력", "결과"],
          rows: [
            ["최초", "성공"],
            ["중복", "거절"],
          ],
        },
      ],
    },
  ];
  s.tasks = [
    { id: "TASK-001", text: "중복 검증 구현", req: "REG-001", done: false },
  ];
  return {
    schema: SCHEMA,
    project: "참가 등록 프로젝트",
    projectSpec: {
      purpose: "올바른 참가 등록",
      principles: ["원자적으로 등록한다."],
      constraints: ["Java 21"],
    },
    specs: [s],
    files: {},
  };
}
// Deterministic provider is only injected by tests. Production has no mock switch.
export class TestPool {
  constructor() {
    this.clients = new Map();
    this.calls = [];
  }
  get(uid) {
    if (!this.clients.has(uid)) {
      const pool = this;
      this.clients.set(uid, {
        connected: false,
        async account() {
          return {
            account: this.connected
              ? {
                  type: "chatgpt",
                  email: "verified-user@test.invalid",
                  planType: "plus",
                }
              : null,
          };
        },
        async login(type) {
          this.connected = true;
          if (type === "chatgpt")
            return {
              type: "chatgpt",
              loginId: "test-login",
              authUrl: "https://auth.openai.com/authorize?test=1",
            };
          return {
            type: "chatgptDeviceCode",
            loginId: "test-login",
            verificationUrl: "https://auth.openai.com/codex/device",
            userCode: "TEST-CODE",
          };
        },
        async logout() {
          this.connected = false;
        },
        async models() {
          return [
            {
              id: "test-codex",
              model: "test-codex",
              displayName: "Test Codex",
              isDefault: true,
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "low" },
                { reasoningEffort: "high", description: "high" },
              ],
              serviceTiers: [],
            },
          ];
        },
        async run(opts) {
          pool.calls.push({
            uid,
            ...opts,
            onEvent: undefined,
            signal: undefined,
          });
          if (
            pool.chatRun &&
            opts.prompt.includes("STREAM_QUEUE_TEST") &&
            opts.prompt
              .split("사용자 요청:\n")
              .at(-1)
              .startsWith("STREAM_QUEUE_TEST")
          )
            return pool.chatRun(opts);
          if (pool.planWait && opts.prompt.startsWith("CODEWITH_HTML_PLAN")) {
            const answer = await pool.planWait(opts);
            if (answer) return answer;
          }
          if (
            opts.prompt.split("사용자 요청:\n").at(-1).startsWith("WAIT_CANCEL")
          ) {
            await new Promise((resolve, reject) => {
              opts.signal.addEventListener(
                "abort",
                () => reject(new Error("응답 생성을 중지했습니다.")),
                { once: true },
              );
            });
          }
          if (opts.prompt.startsWith("CODEWITH_PLAN_REVISION"))
            return {
              text: JSON.stringify({
                message: "검토 반영 · 변경 없음",
                proposal: null,
                files: [],
              }),
            };
          if (opts.prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
            const candidates = JSON.parse(opts.prompt.split("\n후보: ")[1]);
            return {
              text: JSON.stringify({
                message: "평가 완료",
                proposal: null,
                files: [
                  {
                    path: "review.json",
                    content: ((value) =>
                      opts.responseSchema ? value : JSON.stringify(value))({
                      candidates: candidates.map((c) => ({
                        id: c.id,
                        scores: Object.fromEntries(
                          JSON.parse(
                            opts.prompt
                              .split("\n배점: ")[1]
                              .split("\n검증 지침:")[0],
                          ).criteria.map((k, i) => [
                            k.id,
                            Number(
                              (
                                k.max *
                                [2.8 / 3, 2.8 / 3, 1.7 / 2, 0.9, 0.9][i % 5]
                              ).toFixed(8),
                            ),
                          ]),
                        ),
                        reasons: Object.fromEntries(
                          JSON.parse(
                            opts.prompt
                              .split("\n배점: ")[1]
                              .split("\n검증 지침:")[0],
                          ).criteria.map((k) => [
                            k.id,
                            "항목별 설계와 검증 근거를 확인했습니다.",
                          ]),
                        ),
                        criteria: JSON.parse(
                          opts.prompt
                            .split("\n완료 기준: ")[1]
                            .split("\n평가 계약:")[0],
                        ).map((c) => ({
                          id: c.id,
                          status: "pass",
                          evidence:
                            "구현 방법과 검증 절에서 해당 기준을 확인했습니다.",
                        })),
                        blockingIssues: [],
                        suggestions: [],
                      })),
                    }),
                  },
                ],
              }),
            };
          }
          if (opts.prompt.startsWith("CODEWITH_HTML_PLAN")) {
            const spec = JSON.parse(
              opts.prompt.split("명세: ")[1].split("\n전달된 실제 코드")[0],
            );
            return {
              text: JSON.stringify({
                message: "요구사항별 구현 계획",
                proposal: null,
                files: spec.requirements.map((r) => ({
                  path: r.id + ".html",
                  content: ((value) =>
                    opts.responseSchema ? value : JSON.stringify(value))({
                    implementation:
                      "RegistrationService에서 중복 요청을 처리합니다.",
                    before: "기존 코드 미제공",
                    after: "제안 예시\n```java\nObjects.equals(a, b);\n```",
                    ui: "등록 폼의 제출 화면입니다.",
                    mockup:
                      "<html><body><h3>참가 등록</h3><button>요청 보내기</button></body></html>",
                    database: "```sql\nSELECT 1;\n```",
                    verification:
                      "| 완료 기준 | 기대 결과 |\n| --- | --- |\n| 중복 요청 | 오류 안내 |\n\n" +
                      (r.criteria
                        .map((c) => "- [ ] " + c.id + " 확인")
                        .join("\n") || "- [ ] 정상 요청과 경계값 확인"),
                  }),
                })),
              }),
            };
          }
          const developer = opts.prompt.includes("역할: 개발자:");
          opts.onEvent({ type: "delta", text: "테스트 응답" });
          return {
            text: JSON.stringify({
              message: developer
                ? "명세에 맞는 Java 파일입니다. 테스트는 실행하지 않았습니다."
                : "## 검토 결과\n- 중복 요청을 검증하세요.\n```java\nboolean same = java.util.Objects.equals(a, b);\n```",
              proposal: developer
                ? null
                : opts.prompt.includes("역할: 명세 협의자:")
                  ? {
                      title: "중복 요청 처리",
                      body: "같은 이메일로 요청하면 중복 오류를 반환한다.\n\n```java\nboolean same = java.util.Objects.equals(a, b);\n```",
                      criteria: ["두 번 요청해도 참가자는 한 명이다."],
                    }
                  : null,
              files: developer
                ? [
                    {
                      path: "src/main/java/example/RegistrationService.java",
                      content:
                        "package example;\npublic class RegistrationService {\n    public boolean sameEmail(String left, String right) { return java.util.Objects.equals(left, right); }\n}\n",
                    },
                  ]
                : [],
            }),
          };
        },
        stop() {},
      });
    }
    return this.clients.get(uid);
  }
  close() {}
}

// A fully assessed plan for tests whose subject is completion/deletion, not AI execution.
export async function saveAssessedPlan(
  app,
  w,
  { html, title = "평가된 계획" },
) {
  const { PLAN_RUBRIC, planCriteria } =
    await import("../shared/plan-workflow.mjs");
  const spec = w.document.specs[0];
  const criteria = planCriteria(spec);
  const review = {
    id: "draft-1",
    provider: "codex",
    model: "test",
    scores: Object.fromEntries(PLAN_RUBRIC.criteria.map((c) => [c.id, c.max])),
    reasons: Object.fromEntries(
      PLAN_RUBRIC.criteria.map((c) => [c.id, "테스트 검토 근거"]),
    ),
    blockingIssues: [],
    suggestions: [],
    criteria: criteria.map((c) => ({
      id: c.id,
      status: "pass",
      evidence: "테스트 계획의 설계 및 검증 방법",
    })),
  };
  await app.store.savePlan(w.id, w.ownerId, spec.id, {
    base: w.head,
    html,
    title,
    source: "ai",
    evaluation: {
      rubricId: PLAN_RUBRIC.id,
      rubricHash: "a".repeat(64),
      evaluatedAt: new Date().toISOString(),
      selectedId: "draft-1",
      criteria,
      candidates: [
        { id: "draft-1", provider: "codex", model: "test", reviews: [review] },
      ],
    },
  });
  return app.store.view(app.store.workspace(w.id, w.ownerId), w.ownerId);
}
