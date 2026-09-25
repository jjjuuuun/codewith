export const SOURCE_LIMITS = {
  files: 500,
  fileBytes: 200000,
  totalBytes: 2000000,
  entries: 20000,
};
const folders = new Set([
  "node_modules",
  "target",
  "build",
  "dist",
  "out",
  "vendor",
  "coverage",
  "venv",
  "__pycache__",
]);
const extensions = new Set(
  "java kt kts scala groovy js jsx ts tsx mjs cjs vue svelte html css scss less sql xml json yaml yml toml properties gradle md txt py go rs c h cpp hpp cs fs rb php swift sh bash bat ps1 proto graphql gql dockerfile".split(
    " ",
  ),
);
export function validSourcePath(p) {
  return (
    typeof p === "string" &&
    p.length <= 500 &&
    !p.includes("\\") &&
    !p.includes(":") &&
    !/[\x00-\x1f]/.test(p) &&
    !p.startsWith("/") &&
    p.split("/").every((x) => x && x !== "." && x !== "..")
  );
}
export function exclusions(input = []) {
  if (
    !Array.isArray(input) ||
    input.length > 100 ||
    input.some((p) => !validSourcePath(p))
  )
    throw Error("제외 경로는 프로젝트 기준 상대 경로로 최대 100개 입력하세요.");
  return [...new Set(input)];
}
export function sourceAllowed(p, excluded = [], directory = false) {
  if (!validSourcePath(p)) return false;
  const parts = p.split("/"),
    name = parts.at(-1).toLowerCase();
  if (
    parts.some(
      (x) =>
        x.startsWith(".") ||
        folders.has(x.toLowerCase()) ||
        /^(secrets?|credentials?)$/i.test(x),
    )
  )
    return false;
  if (excluded.some((x) => p === x || p.startsWith(x + "/"))) return false;
  if (directory) return true;
  if (
    /(?:^|[._-])(secret|credentials?|private[-_]?key)(?:[._-]|$)/i.test(name) ||
    /^(id_rsa|id_ed25519|database\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(
      name,
    )
  )
    return false;
  return (
    extensions.has(name.split(".").at(-1)) ||
    ["dockerfile", "makefile", "pom.xml", "gradlew"].includes(name)
  );
}
export function validateSourceFiles(input, excluded = []) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== "object" ||
    Object.keys(input).length > SOURCE_LIMITS.files
  )
    throw Error(
      "분석 파일은 최대 500개입니다. 하위 폴더를 선택하거나 제외 경로를 추가하세요.",
    );
  const files = {};
  let bytes = 0;
  for (const [p, text] of Object.entries(input)) {
    if (!sourceAllowed(p, excluded))
      throw Error("분석할 수 없는 파일 경로가 포함되어 있습니다.");
    if (typeof text !== "string" || text.includes("\0"))
      throw Error("텍스트 코드 파일만 연결할 수 있습니다.");
    const size = new TextEncoder().encode(text).length;
    if (size > SOURCE_LIMITS.fileBytes)
      throw Error("분석 파일 하나는 200 KB 이하여야 합니다.");
    bytes += size;
    if (bytes > SOURCE_LIMITS.totalBytes)
      throw Error(
        "분석 코드는 총 2 MB 이하여야 합니다. 제외 경로를 추가하세요.",
      );
    Object.defineProperty(files, p, {
      value: text,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return files;
}
