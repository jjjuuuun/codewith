import { t as __t } from "../i18n/index.js";
import { UI_CONFIG } from "../config/ui.js";
import { AUTH_POLICY } from "../../shared/config.mjs";
import { btn, field } from "../services/form-fields.js";
import { h, reactive, watch, onBeforeUnmount } from "vue";
import { aiAPI } from "../services/api.js";
import { officialLoginURL } from "../services/auth-urls.js";

export function useAIConnection({
  editors,
  getField,
  setField,
  setError,
  setContent,
  control,
  S,
  modal,
  timers,
  renderChat,
  refreshModels,
  serverSettings,
  persistSettings,
  initialize,
  toast,
  openDialog,
}) {
  async function beginAIAuth(service) {
    AIFlow.service = service;
    AIFlow.method = "";
    aiWizard(2);
  }
  async function finishAIAuth() {
    await aiAPI("/finish", { method: "POST", body: {} });
    AIFlow.pending = false;
    modal.close();
    await initialize();
    toast(__t("AI 연결을 계정에 저장했습니다."));
  }
  const AIFlow = reactive({ service: "", method: "", step: 1, pending: false });
  const providerLabel = (provider) =>
    ({
      codex: "Codex",
      "claude-code": "Claude Code",
      openai: "OpenAI API",
      claude: "Claude API",
    })[provider] || provider;
  function confirmDisconnect() {
    openDialog(
      __t("현재 AI 연결을 해제할까요?"),
      [
        h(
          "p",
          {},
          __t("현재 {0}에 연결되어 있습니다.", [
            providerLabel(S.settings.provider),
          ]),
        ),
        h(
          "p",
          { class: "muted" },
          __t(
            "새로운 AI에 연결하려면 먼저 현재 연결을 해제해야 합니다. 해제 후 새 연결을 선택할 수 있습니다.",
          ),
        ),
      ],
      null,
      {
        closeLabel: __t("연결 유지"),
        footerStart: btn(
          "disconnect-ai",
          __t("연결 해제 후 새로 연결"),
          "danger",
        ),
      },
    );
  }
  async function disconnectAI() {
    const editor = editors.state.dialog;
    if (!editor || editor.busy || !S.connected) return;
    const provider = S.settings.provider,
      label = providerLabel(provider);
    const status = (text) =>
      setContent(
        "dialog-prefix",
        h(
          "p",
          {
            id: "disconnect-status",
            class: "note",
            role: "status",
            "aria-live": "polite",
          },
          text,
        ),
      );
    editor.busy = true;
    editor.error = "";
    control("disconnect-ai", { "aria-busy": "true" });
    setContent("disconnect-ai", __t("연결 해제 중…"));
    status(label + __t(" 연결을 해제하고 있습니다. 잠시 기다려 주세요."));
    try {
      const result = await aiAPI("/logout", {
        method: "POST",
        body: { provider },
      });
      S.settings = result.settings || (await serverSettings());
      S.connected = false;
      S.models = [];
      AIFlow.pending = false;
      renderChat();
      await aiWizard(1);
      toast(label + __t(" 연결을 해제했습니다."));
    } catch (error) {
      status(
        __t(
          "연결 해제를 완료하지 못했습니다. 아래 오류를 확인한 뒤 다시 시도해 주세요.",
        ),
      );
      setError(error.message);
      setContent("disconnect-ai", __t("연결 해제 다시 시도"));
    } finally {
      editor.busy = false;
      control("disconnect-ai", { "aria-busy": null });
    }
  }
  async function aiDialog() {
    if (S.connected) return confirmDisconnect();
    await aiAPI("/login/cancel", { method: "POST" }).catch(() => {});
    AIFlow.service = "";
    AIFlow.method = "";
    aiWizard(1);
  }
  async function aiWizard(step) {
    if (S.connected) return confirmDisconnect();
    if (step < 3 && AIFlow.pending) {
      AIFlow.pending = false;
      await aiAPI("/login/cancel", { method: "POST" }).catch(() => {});
    }
    authPollGeneration++;
    clearInterval(timers.login);
    AIFlow.step = step;
    const provider =
      AIFlow.service === "claude"
        ? AIFlow.method === "subscription"
          ? "claude-code"
          : "claude"
        : AIFlow.method === "subscription"
          ? "codex"
          : "openai";
    if (step === 3) {
      const started = await aiAPI("/start", {
        method: "POST",
        body: { provider },
      });
      S.settings = started.settings;
      S.connected = false;
      AIFlow.pending = true;
    }
    let body = [
      h("div", { class: "wizard-progress" }, [
        [__t("서비스"), __t("연결 방식"), __t("인증"), __t("완료")].map(
          (x, i) => [
            h("span", { class: i + 1 === step ? "active" : "" }, [
              i + 1,
              " ",
              x,
            ]),
          ],
        ),
      ]),
    ];
    if (step === 1)
      body = [
        body,
        [
          h("h3", {}, [__t("어떤 AI를 사용할까요?")]),
          h("p", { class: "muted" }, [
            __t(
              "연결·모델 설정·대화는 사용자별로 저장되며 팀원에게 공유되지 않습니다.",
            ),
          ]),
          h("div", { class: "connection-choices" }, [
            btn(
              "ai-service",
              [
                h("b", {}, ["OpenAI"]),
                h("small", {}, ["Codex · ChatGPT · OpenAI API"]),
              ],
              "choice-card",
              { "data-service": "openai" },
            ),
            btn(
              "ai-service",
              [
                h("b", {}, ["Claude"]),
                h("small", {}, ["Claude Code · Anthropic API"]),
              ],
              "choice-card",
              { "data-service": "claude" },
            ),
          ]),
        ],
      ];
    if (step === 2)
      body = [
        body,
        [
          h("h3", {}, [
            AIFlow.service === "claude" ? "Claude" : "OpenAI",
            __t(" 연결 방식을 선택하세요"),
          ]),
          h("div", { class: "connection-choices" }, [
            btn(
              "ai-method",
              [
                h("b", {}, [__t("구독 계정")]),
                h("small", {}, [
                  AIFlow.service === "claude"
                    ? __t("공식 Claude Code 브라우저 로그인")
                    : __t("ChatGPT 계정으로 Codex 로그인"),
                ]),
              ],
              "choice-card",
              { "data-method": "subscription" },
            ),
            btn(
              "ai-method",
              [
                h("b", {}, [__t("API 키")]),
                h("small", {}, [__t("개인 API 키로 연결 · 구독과 별도 과금")]),
              ],
              "choice-card",
              { "data-method": "api" },
            ),
          ]),
        ],
      ];
    if (step === 3)
      body = [
        body,
        [
          h("input", { type: "hidden", id: "f-provider", value: provider }, []),
          h("div", { id: "provider-panel" }, []),
          h("div", { id: "ai-account-status", role: "status" }, []),
        ],
      ];
    const footerStart =
      step > 1
        ? btn("ai-back", __t("이전"), "", { "data-step": step - 1 })
        : "";
    openDialog(__t("AI 연결"), body, null, { footerStart });
    if (step === 3) setContent("provider-panel", connectionPanel(provider));
  }
  function connectionPanel(provider) {
    if (AIFlow.method === "subscription")
      return [
        h("h3", {}, [
          provider === "codex" ? "Codex" : "Claude Code",
          __t(" 공식 로그인"),
        ]),
        h("p", {}, [
          __t(
            "공식 로그인 페이지에서 승인하면 자동으로 연결을 확인합니다. 인증은 서버의 사용자별 공식 CLI 저장소에 보관됩니다.",
          ),
        ]),
        btn("official-login", __t("로그인"), "primary"),
        h("div", { id: "official-login-info" }, []),
        h("div", { id: "claude-code-step" }, []),
      ];
    return [
      h("h3", {}, [__t("개인 API 키 연결")]),
      h("p", {}, [
        __t(
          "API 키는 서버에 암호화해 보관하며 다른 사용자에게 공개하지 않습니다.",
        ),
      ]),
      field(__t("개인 API 키"), "apiKey", "", "input", {
        type: "password",
        autocomplete: "off",
      }),
      h("div", { class: "connection-actions" }, [
        btn("save-api-key", __t("키 확인 · 연결"), "primary"),
      ]),
    ];
  }
  async function setProvider(provider) {
    S.connected = false;
    S.settings = { ...S.settings, provider, model: "", effort: "auto" };
    await persistSettings();
    renderChat();
  }
  async function connectAPIKey() {
    const provider = getField("f-provider");
    await aiAPI("/key", {
      method: "POST",
      body: { provider, key: getField("apiKey") },
    });
    setField("apiKey", "");
    await setProvider(provider);
    await refreshModels();
    await finishAIAuth();
  }
  let authPollGeneration = 0,
    stopWaiting;
  watch(
    () => editors.state.dialog?.id,
    (id, previous) => {
      if (previous && previous !== id) {
        authPollGeneration++;
        stopWaiting?.();
      }
    },
    { flush: "sync" },
  );
  onBeforeUnmount(() => {
    authPollGeneration++;
    stopWaiting?.();
    clearInterval(timers.login);
  });
  async function startOfficialLogin() {
    const provider = getField("f-provider"),
      editorId = editors.state.dialog.id;
    if (editors.state.dialog.controls["official-login"]?.disabled) return;
    control("official-login", { disabled: true });
    const generation = ++authPollGeneration;
    clearInterval(timers.login);
    // Open within the click gesture; the provider URL may arrive after an async request.
    // Open within the click gesture; the provider URL may arrive after an async request.
    let loginTab = null,
      navigated = false;
    try {
      loginTab = window.open("/auth/wait", "_blank");
      if (loginTab) loginTab.opener = null;
    } catch {
      loginTab?.close();
      loginTab = null;
    }
    const active = () =>
      generation === authPollGeneration &&
      modal.open &&
      editors.state.dialog?.id === editorId;
    const closeWaitingTab = () => {
      if (loginTab && !navigated && !loginTab.closed) loginTab.close();
    };
    const stop = () => {
      clearInterval(timers.login);
      closeWaitingTab();
    };
    stopWaiting = stop;
    function showURL(url, code) {
      if (!url || !active()) return;
      const u = officialLoginURL(url);
      if (!u) throw new Error(__t("공식 로그인 주소를 확인할 수 없습니다."));
      if (loginTab && !loginTab.closed && !navigated) {
        loginTab.location.replace(u.href);
        navigated = true;
      }
      const needsLink = !loginTab || loginTab.closed;
      setContent("official-login-info", [
        h("div", { class: "note" }, [
          needsLink
            ? [
                h("p", {}, [
                  __t("새 탭이 차단되었거나 닫혔습니다. "),
                  h(
                    "a",
                    {
                      href: u.href,
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                    [__t("로그인 페이지 열기")],
                  ),
                ]),
              ]
            : [h("p", {}, [__t("새 탭에서 로그인을 완료해 주세요.")])],
          code ? [h("p", {}, [__t("장치 코드: "), h("code", {}, [code])])] : "",
          h("p", {}, [__t("로그인 완료를 기다리는 중입니다…")]),
        ]),
      ]);
    }
    setContent(
      "official-login-info",
      __t("로그인 페이지에 연결하고 있습니다…"),
    );
    try {
      await setProvider(provider);
      if (!active()) {
        stop();
        return;
      }
      const result = await aiAPI("/login", {
        method: "POST",
        body: { provider },
      });
      if (!active()) {
        stop();
        return;
      }
      showURL(result.authUrl || result.verificationUrl, result.userCode);
      const expires = Date.now() + AUTH_POLICY.flowMs;
      let checking = false;
      timers.login = setInterval(async () => {
        if (checking) return;
        if (!active()) {
          stop();
          return;
        }
        if (Date.now() > expires) {
          stop();
          setContent(
            "official-login-info",
            __t("로그인 시간이 만료되었습니다. 다시 시작해 주세요."),
          );
          control("official-login", { disabled: false });
          return;
        }
        checking = true;
        try {
          const status = await aiAPI(
            "/login/status?provider=" + encodeURIComponent(provider),
          );
          if (!active()) {
            stop();
            return;
          }
          if (status.account) {
            stop();
            await refreshModels();
            if (active()) {
              await finishAIAuth();
              try {
                if (loginTab && !loginTab.closed) loginTab.close();
                window.focus();
              } catch {}
            }
            return;
          }
          if (status.login?.authUrl) showURL(status.login.authUrl);
          if (status.login?.codeInputReady && !getField("codeInputReady")) {
            setField("codeInputReady", true);
            setContent("claude-code-step", [
              h("section", { class: "note claude-auth-code" }, [
                h("h3", {}, [__t("Claude 인증 코드 입력")]),
                h("p", {}, [
                  __t("인증 페이지에서 발급된 코드 전체를 붙여넣으세요."),
                ]),
                field(__t("인증 코드"), "authCode", "", "input", {
                  autocomplete: "off",
                  spellcheck: "false",
                }),
                btn("official-code", __t("인증 완료"), "primary"),
              ]),
            ]);
          }
          if (status.login?.status === "error") {
            stop();
            setContent("official-login-info", status.login.error);
            control("official-login", { disabled: false });
          }
        } catch (e) {
          if (active()) {
            stop();
            control("official-login", { disabled: false });
            setContent("official-login-info", e.message);
          }
        } finally {
          checking = false;
        }
      }, UI_CONFIG.loginPollMs);
    } catch (e) {
      stop();
      if (active()) {
        control("official-login", { disabled: false });
        setContent(
          "official-login-info",
          __t("로그인 페이지를 열지 못했습니다."),
        );
      }
      throw e;
    }
  }

  return {
    AIFlow,
    beginAIAuth,
    finishAIAuth,
    disconnectAI,
    aiDialog,
    aiWizard,
    setProvider,
    connectAPIKey,
    startOfficialLogin,
  };
}
