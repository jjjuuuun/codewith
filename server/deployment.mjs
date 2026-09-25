import { isIP } from "node:net";
export const isLoopback = (host) =>
  ["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"].includes(host);
export function deploymentConfig(options = {}, env = process.env) {
  const mode = options.mode || env.CODEWITH_MODE || "personal";
  if (!["personal", "shared", "server"].includes(mode))
    throw Error("CODEWITH_MODE는 personal, shared, server 중 하나여야 합니다.");
  const origin = options.origin ?? env.CODEWITH_ORIGIN ?? "";
  if (origin) {
    const u = new URL(origin);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.origin !== origin ||
      u.username ||
      u.password
    )
      throw Error("CODEWITH_ORIGIN은 경로 없는 접속 주소여야 합니다.");
    if (mode === "personal" && !isLoopback(u.hostname))
      throw Error("personal 모드는 루프백 주소만 사용할 수 있습니다.");
  }
  const methods =
    mode === "personal"
      ? []
      : mode === "shared"
        ? ["key"]
        : [
            ...new Set(
              (options.authMethods || env.CODEWITH_AUTH_METHODS || "key")
                .toString()
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ];
  if (
    mode === "server" &&
    (!methods.length ||
      methods.some((x) => !["key", "passkey", "email", "oidc"].includes(x)))
  )
    throw Error(
      "CODEWITH_AUTH_METHODS에는 key, passkey, email, oidc를 지정하세요.",
    );
  const smtpURL = options.smtpURL ?? env.CODEWITH_SMTP_URL,
    mailFrom = options.mailFrom ?? env.CODEWITH_MAIL_FROM;
  const oidcIssuer = options.oidcIssuer ?? env.CODEWITH_OIDC_ISSUER,
    oidcClientId = options.oidcClientId ?? env.CODEWITH_OIDC_CLIENT_ID,
    oidcClientSecret =
      options.oidcClientSecret ?? env.CODEWITH_OIDC_CLIENT_SECRET;
  if (
    methods.some((x) => x !== "key") &&
    (!origin ||
      !(
        origin.startsWith("https://") ||
        new URL(origin).hostname === "localhost"
      ))
  )
    throw Error(
      "패스키·이메일·SSO에는 HTTPS CODEWITH_ORIGIN이 필요합니다. 개발 시 http://localhost를 사용할 수 있습니다.",
    );
  if (methods.includes("passkey") && isIP(new URL(origin).hostname))
    throw Error("패스키에는 IP 대신 도메인 CODEWITH_ORIGIN을 사용하세요.");
  if (methods.includes("email") && (!smtpURL || !mailFrom))
    throw Error(
      "이메일 인증에는 CODEWITH_SMTP_URL과 CODEWITH_MAIL_FROM이 필요합니다.",
    );
  if (
    methods.includes("oidc") &&
    (!oidcIssuer?.startsWith("https://") || !oidcClientId)
  )
    throw Error(
      "SSO에는 HTTPS CODEWITH_OIDC_ISSUER와 CODEWITH_OIDC_CLIENT_ID가 필요합니다.",
    );
  return {
    mode,
    origin,
    methods,
    smtpURL,
    mailFrom,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret,
    oidcLabel: options.oidcLabel || env.CODEWITH_OIDC_LABEL || "조직 계정",
  };
}
export function listenConfig(config, args = [], env = process.env) {
  const value = (flag, def) =>
    args.includes(flag) ? args[args.indexOf(flag) + 1] : def;
  const host = value(
    "--host",
    env.HOST || (config.mode === "personal" ? "127.0.0.1" : "0.0.0.0"),
  );
  if (config.mode === "personal" && !isLoopback(host))
    throw Error(
      "personal 모드는 외부에 공개할 수 없습니다. 공유하려면 CODEWITH_MODE=shared를 설정하세요.",
    );
  return { host, port: Number(value("--port", env.PORT || 4310)) };
}
