import { t as __t } from "../i18n/index.js";
import { LIMITS, PLAN_POLICY } from "../../shared/config.mjs";
import PlanAgentResponse from "../components/PlanAgentResponse.vue";
import { consumeAI } from "../services/ai-events.js";
import HelpTip from "../components/HelpTip.vue";
import { usePlanProgress } from "./usePlanProgress.js";
import {
  defaultPlanSettings,
  validatePlanSettings,
} from "../../shared/plan-workflow.mjs";
import { field, selectField } from "../services/form-fields.js";
import { api, aiFetch, aiAPI } from "../services/api.js";
import { h, reactive, shallowRef, watch } from "vue";
import { defaultPlanSkill } from "../../shared/plans.mjs";
export function usePlans({
  editors,
  setField,
  onField,
  prepareSource = async () => {},
  S,
  render,
  renderChat,
  syncRoute,
  openDialog,
  editable,
  toast,
  mutate,
}) {
  const viewed = reactive(new Map());
  const reviewContext = shallowRef(null);
  function reviewDraftFor(s) {
    const draft = reviewContext.value?.();
    return draft?.workspaceId === S.w?.id &&
      draft.specId === s?.id &&
      s.plans?.versions.some(
        (version) => version.id === draft.versionId && !version.deletedAt,
      )
      ? draft
      : null;
  }
  const execution = usePlanProgress();
  let pendingQuestions = null;
  watch(
    () => S.user?.id,
    () => {
      execution.task.value = null;
      execution.visible.value = false;
      pendingQuestions = null;
    },
  );
  const readPlanDraft = (job) => {
    try {
      return JSON.parse(
        localStorage.getItem(`codewith.plan:${S.user?.id}:${job}`),
      );
    } catch {
      return null;
    }
  };
  watch(
    () => execution.task.value,
    (task) => {
      if (task?.job && ["questions", "cancelled"].includes(task.phase))
        try {
          localStorage.setItem(
            `codewith.plan:${S.user?.id}:${task.job}`,
            JSON.stringify({
              phase: task.phase,
              answers: task.answers,
              questionDrafts: Object.fromEntries(
                (task.questionQueue || []).map((q) => [
                  q.id,
                  q.id === task.currentQuestion?.id
                    ? task.answers?.[0] || ""
                    : q.answer || "",
                ]),
              ),
              questionIndex: task.questionIndex,
            }),
          );
        } catch {}
    },
    { deep: true },
  );
  const recovered = new Set();
  async function recover() {
    if (S.busy || S.chatMode !== "plan" || !S.w || !S.specId) return;
    const wid = S.w.id,
      sid = S.specId;
    try {
      const { job } = await aiAPI(
        `/jobs?workspace=${wid}&spec=${sid}&kind=plan`,
      );
      if (
        !job ||
        !["running", "questions", "failed", "interrupted"].includes(
          job.state,
        ) ||
        recovered.has(job.id) ||
        readPlanDraft(job.id)?.phase === "cancelled" ||
        S.busy ||
        S.w?.id !== wid ||
        S.specId !== sid
      )
        return;
      recovered.add(job.id);
      const spec = S.w.document.specs.find((s) => s.id === sid);
      if (spec) await generate(spec, { ...job.input, resumeJob: job.id });
    } catch (error) {
      toast(error.message);
    }
  }
  const key = (s) => S.w.id + ":" + s.id;
  function current(s) {
    const stored = s.plans || { versions: [] };
    const p = {
      ...stored,
      versions: stored.versions.filter((v) => !v.deletedAt),
    };
    return (
      p.versions.find((v) => v.id === reviewDraftFor(s)?.versionId) ||
      p.versions.find((v) => v.id === viewed.get(key(s))) ||
      p.versions.find((v) => v.id === p.finalVersionId) ||
      p.versions.at(-1)
    );
  }
  async function generate(
    s,
    {
      message = "",
      parentVersionId = null,
      draftHtml,
      evaluateOnly = false,
      continueLoop = false,
      base = S.w.head,
      attachments = [],
      resumeJob = null,
    } = {},
  ) {
    if (S.busy) return;
    if (!resumeJob && (!S.connected || !S.settings.model)) {
      toast(__t("대화창의 연결 설정에서 AI를 먼저 연결하세요."));
      return false;
    }
    const wid = S.w.id;
    S.busy = true;
    execution.start(wid, s);
    execution.task.value.request =
      message || __t("요구사항을 바탕으로 계획 작성");
    execution.task.value.input = {
      message,
      parentVersionId,
      draftHtml,
      evaluateOnly,
      continueLoop,
      attachments,
    };
    showProgress();
    try {
      if (!resumeJob) await prepareSource();
    } catch (e) {
      S.busy = false;
      execution.finish(e.message);
      throw e;
    }
    renderChat();
    let restoredDrafts = resumeJob
      ? readPlanDraft(resumeJob)?.questionDrafts || {}
      : {};
    let done = false,
      waiting = false;
    try {
      const r = resumeJob
        ? await aiFetch(`/jobs/${resumeJob}/events`)
        : await aiFetch("/plan", {
            method: "POST",
            body: {
              workspaceId: wid,
              specId: s.id,
              base,
              parentVersionId,
              draftHtml,
              evaluateOnly,
              continueLoop,
              message,
              attachments,
            },
          });
      await consumeAI(
        r,
        async (e) => {
          if (e.type === "run") execution.task.value.job = e.job;
          execution.receive(e);
          if (e.type === "plan-question") {
            const task = execution.task.value;
            if (restoredDrafts[e.id]) {
              const question = task.questionQueue.find((q) => q.id === e.id);
              if (question) question.answer = restoredDrafts[e.id];
              if (task.currentQuestion?.id === e.id)
                task.answers[0] = restoredDrafts[e.id];
            }
          }
          if (e.type === "error") throw Error(e.message);
          if (e.type === "plan-questions") {
            waiting = true;
            pendingQuestions = {
              workspaceId: wid,
              specId: s.id,
              message,
              parentVersionId,
              attachments,
              questions: e.questions,
            };
            const saved = readPlanDraft(execution.task.value.job);
            execution.questions(e.questions);
            if (saved?.answers?.length === e.questions.length) {
              execution.task.value.answers = saved.answers;
              execution.task.value.questionIndex = saved.questionIndex || 0;
            }
          }
          if (e.type === "answer") {
            execution.task.value.savedVersionId = e.versionId;
            if (S.w?.id === wid) {
              S.w = e.workspace || (await api("/workspaces/" + wid));
              viewed.set(key(s), e.versionId);
            }
            done = true;
          }
        },
        {
          replay: () => {
            restoredDrafts =
              readPlanDraft(execution.task.value.job)?.questionDrafts || {};
            execution.start(wid, s);
            execution.task.value.input = {
              message,
              parentVersionId,
              draftHtml,
              evaluateOnly,
              continueLoop,
              attachments,
            };
          },
        },
      );
      if (waiting) return true;
      if (!done)
        throw new Error(
          __t(
            "계획 생성이 완료 전에 종료되었습니다. 저장된 버전은 변경되지 않았습니다.",
          ),
        );
      execution.finish();
      toast(__t("계획과 평가 결과를 새 버전으로 저장했습니다."));
      return true;
    } catch (error) {
      S.chatQueuePaused = true;
      execution.finish(error.message, !!error.network);
      throw error;
    } finally {
      S.busy = false;
      renderChat();
      if (done) render();
    }
  }
  function showProgress() {
    S.view = "spec";
    S.tab = "design";
    syncRoute();
    S.chatHidden = false;
    S.showAI = true;
    execution.show();
    S.chatSendVersion++;
  }
  async function restart() {
    const task = execution.task.value;
    if (
      !task ||
      S.busy ||
      task.active ||
      task.phase === "questions" ||
      !editable()
    )
      return;
    if (task.workspaceId !== S.w?.id || task.specId !== S.specId) return;
    const spec = S.w.document.specs.find((s) => s.id === task.specId);
    if (!spec) return;
    pendingQuestions = null;
    try {
      await generate(spec, {
        ...(task.input || {}),
        ...(task.savedVersionId
          ? {
              parentVersionId: task.savedVersionId,
              continueLoop: true,
              draftHtml: undefined,
              evaluateOnly: false,
              message: __t(
                "저장한 마지막 평가본에서 미충족 기준과 지적을 이어서 개선하세요.",
              ),
            }
          : {}),
        ...(task.phase === "disconnected" && task.job
          ? { resumeJob: task.job }
          : {}),
      });
    } catch (error) {
      toast(error.message);
    }
  }
  async function stop() {
    const task = execution.task.value;
    if (!task || (!task.active && task.phase !== "questions")) return;
    S.chatQueue = S.chatQueue.filter(
      (item) =>
        !(
          item.kind === "plan" &&
          item.workspaceId === task.workspaceId &&
          item.specId === task.specId
        ),
    );
    S.chatQueuePaused = true;
    if (task.active) {
      try {
        await aiAPI("/cancel", { method: "POST" });
      } catch (error) {
        toast(error.message);
        return;
      }
      task.message = __t("계획 생성 중지 요청을 보냈습니다…");
    } else {
      pendingQuestions = null;
      execution.finish(
        __t("계획 생성을 중지했습니다. 저장된 계획은 유지됩니다."),
      );
      execution.task.value.phase = "cancelled";
    }
  }
  function acceptingAnswer() {
    return (
      S.chatMode === "plan" &&
      execution.task.value?.workspaceId === S.w?.id &&
      execution.task.value?.specId === S.specId &&
      execution.task.value?.phase === "questions"
    );
  }
  async function answerCurrentQuestion() {
    const task = execution.task.value;
    if (
      !acceptingAnswer() ||
      task.answerSubmitting ||
      (S.busy && !task.currentQuestion)
    )
      return;
    if (task.currentQuestion) {
      const answer = task.answers[0]?.trim();
      if (!answer) {
        task.answerError = __t("답변을 입력해 주세요.");
        return;
      }
      task.answerSubmitting = true;
      try {
        await aiAPI("/plan/answers", {
          method: "POST",
          body: {
            jobId: task.job,
            questionId: task.currentQuestion.id,
            answer,
          },
        });
      } catch (error) {
        task.answerError = error.message;
      } finally {
        task.answerSubmitting = false;
      }
      return;
    }
    if (!task.answers[task.questionIndex].trim()) {
      task.answerError = __t("답변을 입력해 주세요.");
      return;
    }
    task.answerError = "";
    S.chatSendVersion++;
    if (task.questionIndex < task.questions.length - 1) task.questionIndex++;
    else await answerQuestions();
  }
  async function requestFromChat(message, specId, attachments = []) {
    const spec = S.w?.document.specs.find((s) => s.id === specId);
    if (!spec) throw new Error(__t("계획을 작성할 명세를 선택해 주세요."));
    const version = current(spec);
    const draft = reviewDraftFor(spec);
    return generate(spec, {
      ...(draft ? { draftHtml: draft.html, base: draft.base } : {}),
      message,
      parentVersionId: version?.id || null,
      attachments,
    });
  }
  async function answerQuestions() {
    const task = execution.task.value,
      pending = pendingQuestions;
    if (!task || !pending || S.busy) return;
    const answers = task.answers.map((text) => text.trim());
    if (answers.some((text) => !text)) {
      task.answerError = __t("모든 질문에 답변해 주세요.");
      return;
    }
    if (S.w?.id !== pending.workspaceId) {
      task.answerError = __t(
        "질문이 발생한 워크스페이스에서 다시 시도해 주세요.",
      );
      return;
    }
    const spec = S.w.document.specs.find((spec) => spec.id === pending.specId);
    if (!spec) {
      task.answerError = __t("대상 명세를 찾을 수 없습니다.");
      return;
    }
    const message =
      pending.message +
      __t("\n계획 확인 질문에 대한 사용자 답변:\n") +
      JSON.stringify(
        pending.questions.map((question, i) => ({
          question,
          answer: answers[i],
        })),
      );
    if (message.length > LIMITS.messageChars) {
      task.answerError = __t(
        "답변을 포함한 요청은 16,000자 이하로 작성해 주세요.",
      );
      return;
    }
    pendingQuestions = null;
    try {
      await generate(spec, {
        message,
        parentVersionId: pending.parentVersionId,
        attachments: pending.attachments,
      });
    } catch (error) {
      toast(error.message);
    }
  }
  async function configure() {
    const [{ settings }, available] = await Promise.all([
      aiAPI("/plan-settings"),
      aiAPI("/plan-models"),
    ]);
    const config = { ...defaultPlanSettings, ...settings, loop: true };
    const fallback = JSON.stringify({
      provider: S.settings.provider,
      model: S.settings.model,
    });
    const choices = available.models.map((m) => [
      JSON.stringify({ provider: m.provider, model: m.model }),
      `${m.provider} · ${m.name}`,
    ]);
    const choice = (list, i) =>
      JSON.stringify(
        list[i] || { provider: S.settings.provider, model: S.settings.model },
      );
    const withHelp = (nodes, name, text) => [
      h("label", { for: "f-" + name, class: "field-label-help" }, [
        nodes[0].children,
        h(
          "span",
          { id: `plan-${name}-help` },
          text
            ? [h(HelpTip, { text, label: nodes[0].children + __t(" 설명") })]
            : [],
        ),
      ]),
      ...nodes.slice(1),
    ];
    const nodes = [
      h(
        "p",
        { class: "note" },
        __t(
          "목표 점수와 필수 기준을 충족하고 차단 문제가 없으면 개선을 멈춥니다. 변경한 목표는 다음 작성·수정·평가부터 적용되며, 기존 버전의 승인 기준은 유지됩니다.",
        ),
      ),
      h(
        "p",
        { class: "note" },
        __t(
          "목표 점수와 배점은 명세의 평가 기준 → 워크스페이스 공통 설정 → 시스템 기본값 순으로 적용됩니다. 계획 탭의 평가 기준 또는 공통 설정과 스킬 사이의 평가 기준에서 변경하세요.",
        ),
      ),
      ...selectField(
        __t("에이전트 토론"),
        "discussion",
        [
          ["false", __t("사용 안 함")],
          ["true", __t("사용")],
        ],
        String(config.discussion),
      ),
      h(
        "p",
        { class: "muted" },
        __t(
          "작성자와 토론 검토자가 쟁점을 자유롭게 논의합니다. 합의·새 근거 없음·호출 예산에 따라 수정을 시작하며, 수정과 독립 재평가에 필요한 호출은 남겨둡니다.",
        ),
      ),
      ...field(__t("AI 호출 예산"), "maxCalls", config.maxCalls, "input", {
        type: "number",
        min: 2,
        max: PLAN_POLICY.callsMax,
        step: 1,
        required: true,
      }),
      ...field(
        __t("실행 시간 예산 (분)"),
        "runMinutes",
        Math.ceil(config.timeoutSeconds / 60),
        "input",
        { type: "number", min: 1, max: 1440, step: 1, required: true },
      ),
      h(
        "p",
        { class: "muted" },
        __t(
          "예산 안에서 개선을 계속합니다. 2회 연속 진전이 없으면 접근을 바꾸고, 이후에도 진전이 없으면 중단합니다. 사용자 답변·수동 세션 대기 시간은 실행 시간에서 제외합니다.",
        ),
      ),
      h("section", { class: "form-settings-section" }, [
        h("h3", {}, __t("후보 비교와 모델")),
        withHelp(
          selectField(
            __t("후보 비교"),
            "mode",
            [
              ["review", __t("한 계획을 기준에 맞춰 개선")],
              ["compare", __t("여러 설계 후보 비교")],
            ],
            config.mode,
          ),
          "mode",
        ),
        h(
          "div",
          { id: "plan-writer-count" },
          selectField(
            __t("작성 에이전트 수"),
            "writers",
            Array.from(
              { length: PLAN_POLICY.writersMax - PLAN_POLICY.writersMin + 1 },
              (_, i) => String(i + PLAN_POLICY.writersMin),
            ).map((n) => [n, n]),
            String(config.writers),
          ),
        ),
        h("div", { id: "plan-review-options" }, [
          selectField(
            __t("최종 평가자 수"),
            "reviewers",
            Array.from({ length: PLAN_POLICY.reviewersMax }, (_, i) =>
              String(i + 1),
            ).map((n) => [n, n]),
            String(config.reviewers),
          ),
        ]),
        ...Array.from({ length: PLAN_POLICY.writersMax }, (_, i) =>
          h(
            "div",
            { id: `plan-writer-${i}` },
            withHelp(
              selectField(
                __t("작성자 {0} 모델", [i + 1]),
                `writer${i}`,
                choices,
                choice(config.agents, i) || fallback,
              ),
              `writer${i}`,
              __t(
                "이 작성자는 초안 작성과 평가 지적에 따른 수정에 같은 모델과 세션을 사용합니다. 다른 작성자와 같은 모델을 골라도 세션은 분리됩니다.",
              ),
            ),
          ),
        ),
        h("section", { id: "plan-discussion-options" }, [
          h("h3", {}, __t("토론 검토자")),
          ...selectField(
            __t("토론 검토자 수"),
            "discussionReviewers",
            Array.from(
              { length: PLAN_POLICY.discussionReviewersMax },
              (_, i) => [String(i + 1), String(i + 1)],
            ),
            String(config.discussionReviewers),
          ),
          h(
            "p",
            { class: "muted" },
            __t(
              "작성자와 토론할 검토자입니다. 최종 평가자는 토론에 참여하지 않고 별도 세션에서 독립 채점합니다.",
            ),
          ),
          ...Array.from(
            { length: PLAN_POLICY.discussionReviewersMax },
            (_, i) =>
              h(
                "div",
                { id: `plan-discussion-reviewer-${i}` },
                selectField(
                  __t("토론 검토자 {0} 모델", [i + 1]),
                  `discussionReviewer${i}`,
                  choices,
                  choice(config.discussionAgents, i) || fallback,
                ),
              ),
          ),
        ]),
        ...Array.from({ length: PLAN_POLICY.reviewersMax }, (_, i) =>
          h(
            "div",
            { id: `plan-judge-${i}` },
            withHelp(
              selectField(
                __t("최종 평가자 {0} 모델", [i + 1]),
                `judge${i}`,
                choices,
                choice(config.judges, i) || fallback,
              ),
              `judge${i}`,
              __t(
                "매 평가마다 새 세션에서 명세와 현재 후보를 검토합니다. 이전 점수와 작성 대화는 전달하지 않습니다.",
              ),
            ),
          ),
        ),
      ]),
      available.unavailable.length
        ? h(
            "p",
            { class: "note" },
            __t("연결을 확인할 수 없음: {0}", [
              available.unavailable.join(", "),
            ]),
          )
        : "",
    ];
    const editor = openDialog(__t("계획 실행 설정"), nodes, async (f) => {
      const mode = f.get("mode"),
        writers = Number(f.get("writers")),
        reviewers = Number(f.get("reviewers"));
      const next = validatePlanSettings({
        mode,
        loop: true,
        adaptive: true,
        discussion: f.get("discussion") === "true",
        writers,
        reviewers,
        discussionReviewers: Number(f.get("discussionReviewers")),
        discussionAgents: Array.from(
          { length: Number(f.get("discussionReviewers")) },
          (_, i) => JSON.parse(f.get(`discussionReviewer${i}`)),
        ),
        maxCalls: Number(f.get("maxCalls")),
        timeoutSeconds: Number(f.get("runMinutes")) * 60,
        targetScore: config.targetScore,
        agents: Array.from(
          { length: mode === "compare" ? writers : 1 },
          (_, i) => JSON.parse(f.get(`writer${i}`)),
        ),
        judges:
          mode === "single"
            ? []
            : Array.from({ length: reviewers }, (_, i) =>
                JSON.parse(f.get(`judge${i}`)),
              ),
      });
      await aiAPI("/plan-settings", { method: "POST", body: next });
      toast(__t("계획 실행 설정을 저장했습니다."));
    });
    const update = () => {
      const mode = editor.values.mode,
        writers = Number(editor.values.writers),
        reviewers = Number(editor.values.reviewers);
      editor.controls["plan-writer-count"] = { hidden: mode !== "compare" };
      editor.controls["plan-review-options"] = { hidden: mode === "single" };
      for (let i = 0; i < PLAN_POLICY.writersMax; i++)
        editor.controls[`plan-writer-${i}`] = {
          hidden: i >= (mode === "compare" ? writers : 1),
        };
      for (let i = 0; i < PLAN_POLICY.reviewersMax; i++)
        editor.controls[`plan-judge-${i}`] = {
          hidden: mode === "single" || i >= reviewers,
        };
      editor.controls["plan-discussion-options"] = {
        hidden: editor.values.discussion !== "true",
      };
      for (let i = 0; i < PLAN_POLICY.discussionReviewersMax; i++)
        editor.controls[`plan-discussion-reviewer-${i}`] = {
          hidden: i >= Number(editor.values.discussionReviewers),
        };
      const flow =
        (editor.values.discussion === "true"
          ? __t("토론 후 계획을 수정하고 새 세션에서 독립 재평가합니다.") + " "
          : "") +
        __t(
          "계획 작성 → 독립 평가 → 지적 보완을 반복합니다. 필수 기준 충족·차단 문제 없음·명세 목표 점수 이상이면 승인 대기합니다. 호출 {0}회·실행 {1}분 예산 또는 개선 정체 시 최선의 계획과 마지막 시도를 보존하고 중단합니다.",
          [editor.values.maxCalls, editor.values.runMinutes],
        );
      editors.setContent(
        "plan-mode-help",
        h(HelpTip, { text: flow, label: __t("진행 방식 설명") }),
      );
    };
    for (const name of [
      "mode",
      "discussion",
      "discussionReviewers",
      "writers",
      "reviewers",
      "maxCalls",
      "runMinutes",
      "targetScore",
    ])
      onField("f-" + name, update);
    update();
  }
  async function handle(name, el) {
    const s = S.w?.document.specs.find((s) => s.id === S.specId);
    if (!s) return;
    if (S.busy) return toast(__t("AI 응답을 완료하거나 중지해 주세요."));
    if (editors.state.inline)
      return toast(__t("작성 중인 내용을 저장하거나 취소해 주세요."));
    const v = current(s);
    if (name === "plan-view") {
      viewed.set(key(s), el.dataset.id);
      return render();
    }
    if (!editable()) return;
    if (name === "plan-delete") {
      const target = s.plans.versions.find(
        (v) => v.id === el.dataset.id && !v.deletedAt,
      );
      if (!target) return;
      const wid = S.w.id,
        base = S.w.head;
      return openDialog(
        __t("v{0} 계획을 삭제할까요?", [s.plans.versions.indexOf(target) + 1]),
        [
          h(
            "p",
            {},
            __t(
              "{0} 버전을 목록에서 삭제합니다. 삭제 기록과 내용은 변경 이력에 보존됩니다.",
              [target.title],
            ),
          ),
          ...(s.plans.finalVersionId === target.id
            ? [
                h(
                  "p",
                  { class: "note" },
                  __t(
                    "현재 승인된 버전입니다. 삭제하면 최종 승인도 해제됩니다. 다른 버전은 자동 승인되지 않습니다.",
                  ),
                ),
              ]
            : []),
        ],
        async () => {
          const workspace = await api(
            `/workspaces/${wid}/plans/${s.id}/${target.id}`,
            { method: "DELETE", body: { base } },
          );
          if (S.w?.id === wid) S.w = workspace;
          if (viewed.get(key(s)) === target.id) viewed.delete(key(s));
          toast(__t("계획 버전을 삭제했습니다."));
          render();
        },
        { save: __t("삭제") },
      );
    }
    if (name === "plan-install-skill") {
      const { skills } = await aiAPI("/skill-defaults");
      return mutate((d) => {
        if (!d.projectSpec.skills.some((x) => x.id === defaultPlanSkill.id))
          d.projectSpec.skills.push(
            structuredClone(skills.find((x) => x.id === defaultPlanSkill.id)),
          );
      }, __t("기본 HTML 계획 스킬 추가"));
    }
    if (name === "plan-generate") return generate(s);
    if (name === "plan-settings") return configure();
    if (name === "plan-evaluate")
      return generate(s, {
        parentVersionId: v.id,
        evaluateOnly: true,
        message: __t(
          "현재 계획 내용을 변경하지 말고 명세 기준으로 독립 평가하세요.",
        ),
      });
    if (name === "plan-continue")
      return generate(s, {
        parentVersionId: v.id,
        continueLoop: true,
        message: __t(
          "이 계획에서 이어서 개선하세요. 이미 충족한 내용을 보존하고 미충족 기준과 평가 지적만 보완하세요. 명세가 변경되었다면 최신 명세를 우선하세요.",
        ),
      });
    if (name === "plan-reset-skills")
      return openDialog(
        __t("기본 계획 스킬로 복원할까요?"),
        [
          h(
            "p",
            {},
            __t(
              "계획 작성·UI·검증·진행 스킬의 수정 내용을 기본값으로 복원합니다. 기존 계획 버전과 평가 기록은 유지됩니다.",
            ),
          ),
        ],
        async () => {
          const { skills } = await aiAPI("/skill-defaults");
          return mutate((d) => {
            for (const skill of skills) {
              const i = d.projectSpec.skills.findIndex(
                (x) => x.id === skill.id,
              );
              if (i < 0) d.projectSpec.skills.push(structuredClone(skill));
              else d.projectSpec.skills[i] = structuredClone(skill);
            }
          }, __t("기본 계획 스킬 복원"));
        },
        { save: __t("복원") },
      );
    if (name === "plan-select") {
      const wid = S.w.id,
        base = S.w.head,
        versionId = s.plans.finalVersionId === v.id ? null : v.id;
      return openDialog(
        versionId
          ? __t("이 버전을 최종 계획으로 승인할까요?")
          : __t("최종 계획 승인을 해제할까요?"),
        [
          h(
            "p",
            {},
            versionId
              ? __t(
                  "v{0}을 검토하고 개발 기준으로 승인합니다. 기존 승인본이 있으면 이 버전으로 대체합니다.",
                  [s.plans.versions.indexOf(v) + 1],
                )
              : __t("승인을 해제하면 이 버전은 최종 구현 기준에서 제외됩니다."),
          ),
          !v.evaluation && versionId
            ? h(
                "p",
                { class: "note" },
                __t(
                  "이 버전은 AI 미평가 상태입니다. 코드와 검증 항목을 직접 확인한 뒤 승인하세요.",
                ),
              )
            : "",
        ],
        async () => {
          S.w = await api(`/workspaces/${wid}/plans/${s.id}/final`, {
            method: "POST",
            body: { base, versionId },
          });
          render();
        },
        { save: versionId ? __t("검토 완료 · 승인") : __t("승인 해제") },
      );
    }
    const base = S.w.head,
      wid = S.w.id;
    if (name === "plan-revise") {
      openDialog(
        __t("AI에 계획 수정 요청"),
        [
          h("p", {}, [
            [
              "v",
              s.plans.versions.indexOf(v) + 1,
              __t("을 기준으로 수정하여 새 버전으로 저장합니다."),
            ],
          ]),
          field(__t("수정할 내용"), "planRequest", "", "textarea", {
            required: true,
            maxlength: LIMITS.messageChars,
            placeholder: __t(
              "예: 두 번째 요구사항의 중복 처리 쿼리를 원자적으로 바꾸고 검증 항목을 보강해 줘.",
            ),
          }),
        ],
        async (f) => {
          if (!S.connected || !S.settings.model)
            throw new Error(__t("AI 연결 후 다시 요청하세요."));
          void generate(s, {
            message: f.get("planRequest"),
            parentVersionId: v.id,
            base,
          }).catch((error) => toast(error.message));
        },
        { save: __t("AI로 수정 · 새 버전 저장") },
      );
      return;
    }
  }

  return {
    current,
    generate,
    reviewDraftFor,
    setReviewContext: (context) => {
      reviewContext.value = context;
    },
    inspectStep: (step) => {
      const task = execution.task.value;
      return openDialog(
        __t("에이전트 세션 응답"),
        [
          h(PlanAgentResponse, {
            task,
            call: step.call,
            control: (session, action) =>
              aiAPI("/plan/agents", {
                method: "POST",
                body: {
                  jobId: task.job,
                  session,
                  action,
                },
              }),
          }),
        ],
        null,
        { wide: true },
      );
    },
    handle,
    execution: execution.task,
    progressVisible: execution.visible,
    recover,
    showProgress,
    restart,
    acceptingAnswer,
    answerCurrentQuestion,
    requestFromChat,
    stop,
    answerQuestions,
    dismissProgress: execution.dismiss,
  };
}
