export function aiError(code, message, diagnostics = {}, status = 502) {
  return Object.assign(new Error(message), { code, status, diagnostics });
}

export function providerError(message, reason) {
  const explicit = typeof reason === "string" ? reason : null;
  return aiError(
    ["max_output_tokens", "max_tokens"].includes(explicit)
      ? "output_limit"
      : "provider",
    message || "공급자가 응답을 완료하지 못했습니다.",
    { providerReason: explicit },
  );
}
