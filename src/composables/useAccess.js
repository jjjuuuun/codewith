import { t as __t, dateLocale } from "../i18n/index.js";
import { UI_CONFIG } from "../config/ui.js";
import { AUTH_POLICY } from "../../shared/config.mjs";
import { btn, field } from "../services/form-fields.js";
import { api } from "../services/api.js";
import { h, ref } from "vue";
export function useAccess({
  setField,
  setError,
  onField,
  openDialog,
  modal,
  initialize,
  render,
  getState,
  toast,
}) {
  const config = ref({ mode: "personal", methods: [] });
  let credentialLibrary;
  const labels = {
    personal: __t("개인용"),
    shared: __t("공유용"),
    server: __t("서버 운영"),
  };
  async function passkey(register = false) {
    if (!window.isSecureContext)
      throw Error(__t("패스키는 HTTPS 접속에서 사용할 수 있습니다."));
    credentialLibrary ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/webauthn.js";
      script.onload = () => resolve(window.SimpleWebAuthnBrowser);
      script.onerror = () => {
        credentialLibrary = null;
        reject(Error(__t("패스키 기능을 불러오지 못했습니다.")));
      };
      document.head.append(script);
    });
    const library = await credentialLibrary,
      kind = register ? "register" : "login",
      optionsJSON = await api("/auth/passkey/" + kind + "/options", {
        method: "POST",
        body: {},
      });
    try {
      const response = await library[
        register ? "startRegistration" : "startAuthentication"
      ]({ optionsJSON });
      await api("/auth/passkey/" + kind + "/verify", {
        method: "POST",
        body: response,
      });
      await initialize();
      toast(register ? __t("패스키를 등록했습니다.") : __t("로그인했습니다."));
    } catch (e) {
      if (e.name === "NotAllowedError")
        throw Error(__t("패스키 인증이 취소되었거나 시간이 지났습니다."));
      throw e;
    }
  }
  function downloadKey(result) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "codewith-login-key-v1",
            instanceId: result.instanceId,
            accountId: result.user.id,
            key: result.key,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "codewith-login-key.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), UI_CONFIG.downloadRevokeMs);
  }
  function showKey(result) {
    openDialog(
      __t("개인 로그인 키 보관"),
      [
        h("p", {}, [
          __t(
            "다른 브라우저나 PC에서 같은 계정으로 로그인할 때 사용합니다. 키는 지금 한 번만 표시됩니다.",
          ),
        ]),
        h("div", { class: "access-secret" }, [h("code", {}, [result.key])]),
        h("div", { class: "connection-actions" }, [
          btn("access-download-key", __t("키 파일 다운로드")),
        ]),
        result.pending
          ? [
              h("p", { class: "note" }, [
                __t(
                  "워크스페이스 참여를 요청했습니다. 관리자 승인 후 목록에 표시됩니다.",
                ),
              ]),
            ]
          : "",
      ],
      async () => {
        modal.close();
        await initialize();
        return false;
      },
      { save: __t("보관했어요") },
    );
    onField("access-download-key", (e) => {
      e.stopPropagation();
      downloadKey(result);
    });
  }
  function createAccount() {
    const setup = config.value.setupRequired;
    openDialog(
      setup ? __t("공유용 초기 설정") : __t("CodeWith 시작하기"),
      [
        h("p", {}, [
          setup
            ? __t("실행 PC에 생성된 초기 설정 키로 첫 계정을 준비하세요.")
            : __t("표시 이름을 정하면 개인 로그인 키가 발급됩니다."),
        ]),
        field(__t("표시 이름"), "accessName", "", "input", {
          required: true,
          maxlength: "80",
          autocomplete: "name",
        }),
        setup
          ? field(__t("초기 설정 키"), "setupKey", "", "input", {
              required: true,
              type: "password",
              autocomplete: "off",
            })
          : config.value.mode === "shared"
            ? field(
                __t("워크스페이스 초대 코드"),
                "accessInvite",
                new URLSearchParams(location.search).get("join") || "",
                "input",
                { required: true, autocomplete: "off" },
              )
            : "",
        setup
          ? [
              h("p", { class: "muted" }, [
                __t("키 파일 위치는 CodeWith 실행 화면에 안내됩니다."),
              ]),
            ]
          : "",
      ],
      async (f) => {
        const result = await api("/auth/key/create", {
          method: "POST",
          body: {
            name: f.get("accessName"),
            setupKey: f.get("setupKey"),
            inviteCode: f.get("accessInvite"),
          },
        });
        await initialize();
        showKey(result);
        return false;
      },
      { save: setup ? __t("초기 설정 완료") : __t("시작하기") },
    );
  }
  function keyLogin() {
    openDialog(
      __t("로그인 키로 로그인"),
      [
        h("p", {}, [
          __t("보관한 개인 로그인 키를 입력하거나 키 파일을 선택하세요."),
        ]),
        field(__t("로그인 키"), "accessKey", "", "input", {
          type: "password",
          autocomplete: "off",
          required: true,
        }),
        h("label", { for: "access-key-file" }, [__t("키 파일 불러오기")]),
        h(
          "input",
          {
            type: "file",
            id: "access-key-file",
            accept: ".json,application/json",
          },
          [],
        ),
      ],
      async (f) => {
        await api("/auth/key/login", {
          method: "POST",
          body: { key: f.get("accessKey") },
        });
        modal.close();
        await initialize();
        return false;
      },
      { save: __t("로그인") },
    );
    onField("access-key-file", async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > AUTH_POLICY.keyFileBytes)
          throw Error(__t("CodeWith 키 파일을 선택하세요."));
        const data = JSON.parse(await file.text());
        if (
          data.format !== "codewith-login-key-v1" ||
          typeof data.key !== "string"
        )
          throw Error(__t("올바른 키 파일이 아닙니다."));
        if (data.instanceId !== config.value.instanceId)
          throw Error(__t("다른 CodeWith 설치에서 발급한 키입니다."));
        setField("accessKey", data.key);
      } catch (err) {
        setError(err.message);
      }
    });
  }
  function email() {
    openDialog(
      __t("이메일로 계속하기"),
      [
        h("p", {}, [
          __t(
            "받은 인증 코드를 입력하면 로그인됩니다. 처음 사용하는 이메일은 계정이 자동 생성됩니다.",
          ),
        ]),
        field(__t("이메일"), "accessEmail", "", "input", {
          required: true,
          type: "email",
          autocomplete: "email",
        }),
      ],
      async (f) => {
        await api("/auth/email/start", {
          method: "POST",
          body: { email: f.get("accessEmail") },
        });
        openDialog(
          __t("인증 코드 입력"),
          [
            h("p", {}, [
              __t("이메일로 보낸 8자리 코드를 {0}분 안에 입력하세요.", [
                AUTH_POLICY.flowMs / 60000,
              ]),
            ]),
            field(__t("인증 코드"), "emailCode", "", "input", {
              required: true,
              inputmode: "numeric",
              autocomplete: "one-time-code",
              pattern: "[0-9]{8}",
              maxlength: "8",
            }),
          ],
          async (data) => {
            await api("/auth/email/verify", {
              method: "POST",
              body: { code: data.get("emailCode") },
            });
            modal.close();
            await initialize();
            return false;
          },
          { save: __t("인증 완료") },
        );
        return false;
      },
      { save: __t("인증 코드 받기") },
    );
  }
  async function account() {
    const s = getState(),
      details = await api("/auth/account");
    openDialog(
      __t("계정 설정"),
      [
        h("div", { class: "row between" }, [h("b", {}, [s.user.name])]),
        h("p", { class: "muted" }, [
          __t("AI 연결을 변경해도 이 계정과 작성 이력은 유지됩니다."),
        ]),
        field(__t("표시 이름"), "accountName", s.user.name, "input", {
          required: true,
          maxlength: "80",
        }),
        h("section", { class: "access-section" }, [
          h("h3", {}, [__t("로그인 수단")]),
          details.keys.map((k) => [
            h("div", { class: "list-row" }, [
              h("span", { class: "grow" }, [
                __t("로그인 키 · "),
                new Date(k.createdAt).toLocaleDateString(dateLocale),
              ]),
              btn("access-revoke-key", __t("폐기"), "small danger", {
                "data-key-id": k.id,
              }),
            ]),
          ]),
          h("p", { class: "muted" }, [
            __t("패스키 "),
            details.passkeys.length,
            __t("개"),
            details.email ? " · " + details.email : "",
            details.oidc ? __t(" · 조직 계정 연결됨") : "",
          ]),
        ]),
        h(
          "a",
          { href: "/guide/deployment", target: "_blank", rel: "noopener" },
          [__t("운영 모드와 전환 안내")],
        ),
      ],
      async (f) => {
        const result = await api("/profile", {
          method: "POST",
          body: { name: f.get("accountName") },
        });
        s.user = result.user;
        render();
      },
      {
        save: __t("저장"),
        headerActions: [
          btn("access-issue-key", __t("로그인 키 발급")),
          config.value.methods.includes("passkey")
            ? btn("access-passkey-register", __t("패스키 추가"))
            : "",
          config.value.methods.includes("email")
            ? btn(
                "access-email",
                details.email ? __t("이메일 변경") : __t("이메일 연결"),
              )
            : "",
          config.value.methods.includes("oidc")
            ? btn("access-oidc", __t("조직 계정 연결"))
            : "",
        ],
      },
    );
  }
  return {
    async load() {
      config.value = await api("/auth/config");
      return config.value;
    },
    get config() {
      return config.value;
    },
    label() {
      return labels[config.value.mode];
    },
    async action(name, el) {
      if (config.value.mode === "personal" && name !== "access-personal")
        return;
      switch (name) {
        case "access-create":
          return createAccount();
        case "access-key-login":
          return keyLogin();
        case "access-personal":
          await api("/auth/personal", { method: "POST" });
          return initialize();
        case "access-passkey-login":
          return passkey();
        case "access-passkey-register":
          return passkey(true);
        case "access-email":
          return email();
        case "access-oidc": {
          const r = await api("/auth/oidc/start", {
            method: "POST",
            body: { returnTo: location.pathname + location.search },
          });
          location.assign(r.url);
          return;
        }
        case "access-account":
          return account();
        case "access-issue-key":
          return showKey(await api("/auth/keys", { method: "POST" }));
        case "access-revoke-key":
          openDialog(
            __t("로그인 키 폐기"),
            [
              h("p", {}, [
                __t(
                  "이 키와 기존 로그인 세션을 무효화합니다. 현재 브라우저는 새 세션으로 유지됩니다.",
                ),
              ]),
            ],
            async () => {
              await api("/auth/keys/revoke", {
                method: "POST",
                body: { id: el.dataset.keyId },
              });
              await account();
              return false;
            },
            { save: __t("폐기") },
          );
          return;
      }
    },
  };
}
