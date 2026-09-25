import assert from "node:assert/strict";
export async function keyLogin(origin, profile = {}, name = "테스트 사용자") {
  const route = profile.loginKey ? "login" : "create";
  const response = await fetch(origin + "/api/auth/key/" + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CodeWith": "1",
      Origin: origin,
    },
    body: JSON.stringify(
      profile.loginKey ? { key: profile.loginKey } : { name },
    ),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  if (data.key) profile.loginKey = data.key;
  return {
    data,
    cookie: response.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; "),
  };
}
