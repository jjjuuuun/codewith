import { t as __t } from "../i18n/index.js";
import { api } from "../services/api.js";

import { parseRoute, routePath } from "../services/routes.js";
export function useNavigation({
  S,
  listen,
  editors,
  modal,
  renderAuth,
  render,
  toast,
  serverChats,
}) {
  let routeGeneration = 0,
    historyIndex = Number.isInteger(history.state?.codewithIndex)
      ? history.state.codewithIndex
      : 0,
    restoringHistory = false;
  history.replaceState(
    { ...history.state, codewithIndex: historyIndex },
    "",
    location.href,
  );
  function syncRoute({
    replace = false,
    path = routePath({
      view: S.view,
      workspaceId: S.w?.id,
      specId: S.specId,
      tab: S.tab,
    }),
  } = {}) {
    if (location.pathname === path && !location.search) return;
    routeGeneration++;
    if (!replace) historyIndex++;
    history[replace ? "replaceState" : "pushState"](
      { codewithIndex: historyIndex },
      "",
      path,
    );
  }
  async function applyRoute(path) {
    const generation = ++routeGeneration,
      route = parseRoute(path);
    if (!S.user) return renderAuth();
    try {
      if (!route) throw new Error(__t("찾을 수 없는 화면입니다."));
      const workspaces = await api("/workspaces");
      let w = null,
        messages = [],
        chatThread = null,
        specId = null;
      if (route.workspaceId) {
        w = await api("/workspaces/" + route.workspaceId);
        specId = route.specId || w.document.specs[0]?.id || null;
        if (
          route.view === "spec" &&
          !w.document.specs.some((s) => s.id === route.specId)
        ) {
          if (generation !== routeGeneration) return;
          syncRoute({
            replace: true,
            path: routePath({
              workspaceId: route.workspaceId,
              view: "workspace",
            }),
          });
          toast(__t("이 명세를 찾을 수 없어 워크스페이스를 열었습니다."));
          return applyRoute(location.pathname);
        }
        const conversation = await serverChats(
          w.id,
          route.view === "spec" ? specId : null,
        );
        messages = conversation.messages;
        chatThread = conversation.thread;
      }
      if (generation !== routeGeneration) return;
      const changed = S.w?.id !== w?.id;
      Object.assign(S, {
        w,
        workspaces: workspaces.workspaces,
        view: route.view,
        specId,
        tab: route.tab || "requirements",
        messages,
        chatThread,
        showNav: false,
        showAI: false,
        draft: "",
      });
      if (changed) S.selectedFiles = [];
      render();
    } catch (e) {
      if (generation !== routeGeneration) return;
      if (e.status === 401) {
        S.user = null;
        return renderAuth();
      }
      Object.assign(S, {
        w: null,
        view: "home",
        specId: null,
        messages: [],
        selectedFiles: [],
      });
      syncRoute({ replace: true, path: "/" });
      render();
      toast(e.message);
    }
  }
  async function loadWorkspace(id) {
    syncRoute({ path: routePath({ workspaceId: id, view: "workspace" }) });
    return applyRoute(location.pathname);
  }
  listen(window, "popstate", async (e) => {
    const target = Number.isInteger(e.state?.codewithIndex)
      ? e.state.codewithIndex
      : 0;
    if (restoringHistory) {
      restoringHistory = false;
      historyIndex = target;
      return;
    }
    if (
      editors.state.inline?.onSave ||
      editors.modalDirty() ||
      editors.state.dialog?.busy ||
      S.busy
    ) {
      const delta = historyIndex - target;
      if (delta) {
        restoringHistory = true;
        history.go(delta);
      }
      toast(
        S.busy
          ? __t("AI 응답을 완료하거나 중지한 뒤 이동해 주세요.")
          : __t("작성 중인 내용을 저장하거나 취소한 뒤 이동해 주세요."),
      );
      return;
    }
    historyIndex = target;
    modal.close();
    editors.closeInline();
    await applyRoute(location.pathname);
  });
  async function goHome({ replace = false } = {}) {
    syncRoute({ path: "/", replace });
    return applyRoute("/");
  }
  return { syncRoute, applyRoute, loadWorkspace, goHome };
}
