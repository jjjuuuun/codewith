import { t as __t } from "../i18n/index.js";
async function fetchResponse(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw Object.assign(
      new Error(
        __t(
          "CodeWith 서버에 연결할 수 없습니다. 서버가 실행 중인지와 네트워크 연결을 확인하세요.",
        ),
      ),
      { network: true, cause: error },
    );
  }
}

export async function api(p, { method = "GET", body } = {}) {
  const r = await fetchResponse("/api" + p, {
    method,
    headers: { "Content-Type": "application/json", "X-CodeWith": "1" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const j = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(__t(j.error || "요청 실패")), {
      status: r.status,
    });
  return j;
}

export async function aiFetch(route, { method = "GET", body, signal } = {}) {
  const r = await fetchResponse("/api/ai" + route, {
    method,
    headers: { "Content-Type": "application/json", "X-CodeWith": "1" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(__t(j.error || "AI 요청 실패")), {
      status: r.status,
    });
  }
  return r;
}
export async function aiAPI(route, opts) {
  return (await aiFetch(route, opts)).json();
}
