const labels = {
  request_timeout: "요청당 시간 초과",
  rpc_timeout: "연결 명령 응답 시간 초과",
  timeout: "전체 계획 실행 시간 초과",
  output_limit: "모델 출력 토큰 한도",
  response_size_limit: "앱 출력 수신 한도",
  validation: "응답 형식 오류",
  plan_document_size: "계획 HTML 저장 한도",
  cancelled: "사용자가 전체 실행 중지",
  session_cancelled: "사용자가 세션 정지",
  provider_interrupted: "공급자가 응답 중단 · 원인 미확인",
  interrupted: "실행 중단 · 원인 미확인",
  connection_lost: "연결 종료",
  provider: "공급자 오류",
  call_budget: "호출 예산 소진",
  plan_retry_limit: "추가 요청 한도",
};
function tokens(usage) {
  const u = usage?.last || usage;
  const number = (...values) =>
    values.find((v) => typeof v === "number" && Number.isFinite(v)) ?? null;
  return {
    input: number(u?.input_tokens, u?.inputTokens),
    output: number(u?.output_tokens, u?.outputTokens),
    reasoning: number(
      u?.output_tokens_details?.reasoning_tokens,
      u?.reasoningOutputTokens,
    ),
  };
}
export function planFailure(error, signal) {
  const cause =
    signal?.aborted && signal.reason instanceof Error ? signal.reason : error;
  const detail = String(cause?.message || "알 수 없는 오류")
    .replace(/\b(?:sk|sess)-[a-zA-Z0-9_-]+/g, "[비공개]")
    .replace(/(Bearer\s+)\S+/gi, "$1[비공개]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[비공개]",
    )
    .slice(0, 1200);
  const kind =
    cause?.code || (cause?.status === 422 ? "validation" : "provider");
  const diagnostic = cause?.diagnostics || {};
  return {
    ...error?.planStep,
    usage: tokens(error?.planStep?.usage),
    kind,
    label: labels[kind] || "원인 미분류 · 공급자 오류",
    detectedAt: Date.now(),
    timeoutSeconds:
      typeof diagnostic.timeoutSeconds === "number"
        ? diagnostic.timeoutSeconds
        : null,
    limit: typeof diagnostic.limit === "number" ? diagnostic.limit : null,
    providerReason:
      typeof diagnostic.providerReason === "string"
        ? diagnostic.providerReason
            .slice(0, 100)
            .replace(/[^a-zA-Z0-9_.:-]/g, "")
        : null,
    operation:
      typeof diagnostic.operation === "string"
        ? diagnostic.operation.slice(0, 100)
        : null,
    status: cause?.status || null,
    detail,
    message:
      (error?.planStep
        ? `${error.planStep.stage} · ${error.planStep.provider} / ${error.planStep.model}\n`
        : "") + detail,
  };
}
