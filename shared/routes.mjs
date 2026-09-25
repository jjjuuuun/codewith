import { guideForPath, guides } from "./guides.mjs";
const views = new Set([
  "project",
  "requirements",
  "history",
  "members",
  "connection",
]);
export function parseRoute(path) {
  const guide = guideForPath(path);
  if (guide) return { view: "guide", guideId: guide.id };
  if (path === "/" || path === "/index.html") return { view: "home" };
  const m = path.match(/^\/workspaces\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/);
  if (!m) return null;
  const [, workspaceId, rest = ""] = m;
  if (!rest) return { workspaceId, view: "workspace" };
  if (views.has(rest)) return { workspaceId, view: rest };
  const spec = rest.match(
    /^specs\/([a-zA-Z0-9_-]+)(?:\/(requirements|plan))?$/,
  );
  return spec
    ? {
        workspaceId,
        view: "spec",
        specId: spec[1],
        tab: spec[2] === "plan" ? "design" : "requirements",
      }
    : null;
}
export function routePath({ view, workspaceId, specId, tab, guideId }) {
  if (view === "guide")
    return guides.find((guide) => guide.id === guideId)?.path || "/guide";
  if (view === "home" || !workspaceId) return "/";
  const base = "/workspaces/" + encodeURIComponent(workspaceId);
  if (view === "spec")
    return (
      base +
      "/specs/" +
      encodeURIComponent(specId) +
      "/" +
      (tab === "design" ? "plan" : "requirements")
    );
  return base + (views.has(view) ? "/" + view : "");
}
