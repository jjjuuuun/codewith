<script setup>
import { t as __t } from "../i18n/index.js";

import { computed, nextTick, ref } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
import ThemeControl from "../components/ThemeControl.vue";
const { accessConfig: config } = useWorkspace();
const selectedMethod = ref("");
const stepHeading = ref();
const methods = computed(() => config.value.methods || []);
const activeMethod = computed(
  () =>
    selectedMethod.value ||
    (methods.value.length === 1 ? methods.value[0] : ""),
);
async function selectMethod(method) {
  selectedMethod.value = method;
  await nextTick();
  stepHeading.value?.focus();
}
const methodLabels = {
  key: __t("로그인 키"),
  passkey: __t("패스키"),
  email: __t("이메일"),
  oidc: __t("조직 계정"),
};
const methodDescriptions = {
  key: __t("보관한 키로 로그인하거나 새 키를 발급받으세요."),
  passkey: __t("휴대폰 또는 이 기기의 지문·얼굴·PIN을 사용하세요."),
  email: __t("이메일로 받은 인증 코드를 사용하세요."),
  oidc: __t("조직에서 사용하는 계정으로 로그인하세요."),
};
const labels = {
  personal: __t("개인용"),
  shared: __t("공유용"),
  server: __t("서버 운영"),
};
</script>
<template>
  <div class="auth-shell">
    <div class="auth-theme"><ThemeControl /></div>
    <section class="auth-story">
      <a
        class="brand"
        href="/"
        ><img
          src="/logo.svg"
          alt="CodeWith"
        />codewith</a
      >
      <div class="auth-intro">
        <p class="eyebrow">{{ __t("함께 생각하고, 직접 만들다") }}</p>
        <h1>{{ __t("명세는 함께,") }}<br />{{ __t("개발은 나답게.") }}</h1>
        <p>
          {{ __t("아이디어를 요구사항으로, 요구사항을 실행할 계획으로.")
          }}<br />{{
            __t("팀과 기준을 나누고, 나의 AI와 한 단계씩 구체화하세요.")
          }}
        </p>
        <div class="intro-points">
          <span
            ><CwIcon name="requirements" /> {{ __t("명확한 요구사항") }}</span
          ><span><CwIcon name="project" /> {{ __t("함께 세우는 계획") }}</span
          ><span><CwIcon name="chat" /> {{ __t("개인별 AI 연결") }}</span>
        </div>
      </div>
      <small>{{ __t("CodeWith · 생각을 코드로 잇는 공간") }}</small>
    </section>
    <section class="auth-form">
      <div class="auth-box">
        <p class="eyebrow">
          {{
            config.mode === "personal"
              ? __t("개인용 워크스페이스")
              : labels[config.mode]
          }}
        </p>
        <h2>{{ __t("CodeWith 시작하기") }}</h2>
        <template v-if="config.mode === 'personal'">
          <p class="muted">
            {{ __t("생각을 명세로 정리하고, 차근차근 구현하세요.") }}<br />{{
              __t("고정된 PERSONAL 계정으로 사용합니다.")
            }}
          </p>
          <CwButton
            action="access-personal"
            class="personal-entry"
            :aria-label="__t('PERSONAL 계정으로 들어가기')"
            ><span
              class="avatar"
              aria-hidden="true"
              >P</span
            ><span class="personal-entry-label"
              ><b>PERSONAL</b><small>{{ __t("나의 작업 공간") }}</small></span
            ><span
              class="personal-entry-arrow"
              aria-hidden="true"
              >→</span
            ></CwButton
          >
          <p class="muted access-guide">
            {{ __t("AI 서비스는 들어간 뒤 연결할 수 있습니다.") }}
          </p>
        </template>
        <template v-else>
          <h3
            ref="stepHeading"
            class="auth-step-heading"
            tabindex="-1"
          >
            {{
              activeMethod
                ? __t("{0}로 시작하기", [methodLabels[activeMethod]])
                : __t("로그인 방식을 선택하세요")
            }}
          </h3>
          <p class="muted">
            {{
              activeMethod
                ? methodDescriptions[activeMethod]
                : __t(
                    "사용할 방식을 고르면 로그인과 가입을 이어갈 수 있습니다.",
                  )
            }}
          </p>
          <div
            v-if="!activeMethod"
            class="connection-choices"
          >
            <CwButton
              v-for="method in methods"
              :key="method"
              class="choice-card auth-method-choice"
              :data-auth-method="method"
              @click="selectMethod(method)"
            >
              <b>{{ methodLabels[method] }}</b
              ><small>{{ methodDescriptions[method] }}</small>
            </CwButton>
          </div>
          <template v-else>
            <p
              v-if="activeMethod === 'passkey'"
              class="note passkey-guide"
            >
              {{
                __t(
                  "휴대폰에 패스키를 만들려면 아래 ‘패스키로 처음 시작하기’를 누른 뒤 인증창에서 ‘휴대전화 또는 태블릿 사용’을 선택하고 QR을 스캔하세요. 기기와 브라우저에 따라 선택 항목이 다를 수 있습니다.",
                )
              }}
            </p>
            <div class="connection-choices">
              <CwButton
                v-if="activeMethod === 'key' && config.methods.includes('key')"
                action="access-create"
                class="choice-card"
                ><b>{{
                  config.setupRequired
                    ? __t("처음 설정하기")
                    : config.mode === "shared"
                      ? __t("초대로 참여하기")
                      : __t("처음 시작하기")
                }}</b
                ><small>{{
                  config.setupRequired
                    ? __t("실행 PC의 초기 설정 키 사용")
                    : __t("표시 이름과 개인 로그인 키로 시작")
                }}</small></CwButton
              >
              <template v-if="activeMethod === 'passkey'"
                ><CwButton
                  action="access-passkey-login"
                  class="choice-card"
                  ><b>{{ __t("패스키로 로그인") }}</b
                  ><small>{{
                    __t("지문·얼굴·기기 PIN으로 인증")
                  }}</small></CwButton
                ><CwButton action="access-passkey-register">{{
                  __t("패스키로 처음 시작하기")
                }}</CwButton></template
              >
              <CwButton
                v-if="activeMethod === 'email'"
                action="access-email"
                class="choice-card"
                ><b>{{ __t("이메일로 계속하기") }}</b
                ><small>{{
                  __t("인증 코드로 간편하게 로그인")
                }}</small></CwButton
              >
              <CwButton
                v-if="activeMethod === 'oidc'"
                action="access-oidc"
                class="choice-card"
                ><b>{{ config.oidcLabel }}{{ __t("으로 로그인") }}</b
                ><small>{{
                  __t("조직에서 사용하는 계정으로 인증")
                }}</small></CwButton
              >
              <CwButton
                v-if="activeMethod === 'key'"
                action="access-key-login"
                >{{
                  config.methods.includes("key")
                    ? __t("로그인 키로 로그인")
                    : __t("복구 키로 로그인")
                }}</CwButton
              >
            </div>
          </template>
          <CwButton
            v-if="
              activeMethod &&
              (methods.length > 1 || !methods.includes(activeMethod))
            "
            class="ghost auth-method-back"
            data-auth-back
            @click="selectMethod('')"
            >{{ __t("다른 로그인 방식 선택") }}</CwButton
          >
          <CwButton
            v-if="!methods.includes('key') && activeMethod !== 'key'"
            class="ghost auth-method-back"
            @click="selectMethod('key')"
            >{{ __t("복구 키 사용") }}</CwButton
          >
        </template>
        <p class="muted access-guide">
          <a
            href="/guide"
            target="_blank"
            rel="noopener"
            >{{ __t("사용 안내") }}</a
          >
          ·
          <a
            href="/guide/deployment"
            target="_blank"
            rel="noopener"
            >{{ __t("운영 모드 안내") }}</a
          >
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.auth-step-heading {
  margin: 24px 0 12px;
  font-size: 18px;
}
.auth-step-heading:focus {
  outline: none;
}
.auth-method-back {
  margin-top: 16px;
}
.passkey-guide {
  line-height: 1.8;
}
.auth-method-choice :deep(.v-btn__content) {
  gap: 8px;
}
</style>
