import { t as __t } from "../i18n/index.js";
import { UI_CONFIG } from "../config/ui.js";
import { h, onBeforeUnmount } from "vue";
import { api } from "../services/api.js";

export function useSession({
  S,
  getAccess,
  serverSettings,
  applyRoute,
  profileDialog,
  joinWorkspaceDialog,
  refreshModels,
  renderAuth,
  renderChat,
  renderMain,
  render,
  syncRoute,
  spec,
  goHome,
  modal,
  editors,
  toast,
}) {
  let pollTimer,
    disposed = false,
    polling = false,
    generation = 0;
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    clearInterval(pollTimer);
  });
  async function initialize() {
    const current = ++generation;
    clearInterval(pollTimer);
    try {
      await getAccess().load();
      const me = await api("/me");
      if (disposed || current !== generation) return;
      Object.assign(S, { user: me.user, workspaces: me.workspaces });
      S.settings = await serverSettings().catch(() => ({
        provider: "codex",
        model: "",
        effort: "auto",
      }));
      await applyRoute(location.pathname);
      if (S.user.needsProfile) profileDialog();
      else if (
        getAccess().config.mode !== "personal" &&
        new URLSearchParams(location.search).has("join")
      )
        joinWorkspaceDialog();
      if (S.settings.model)
        refreshModels().catch(() => {
          S.connected = false;
          renderChat();
        });
    } catch (e) {
      if (disposed || current !== generation) return;
      S.user = null;
      renderAuth();
      if (e.status !== 401) toast(e.message);
    }
    if (disposed || current !== generation) return;
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (polling || !S.w || modal.open || S.busy || editors.state.inline)
        return;
      const wid = S.w.id,
        head = S.w.head;
      const active = () =>
        !disposed &&
        current === generation &&
        S.w?.id === wid &&
        S.w.head === head &&
        !modal.open &&
        !S.busy &&
        !editors.state.inline;
      polling = true;
      try {
        const h = await api(`/workspaces/${wid}/head`);
        if (!active()) return;
        if (h.head !== S.w.head) {
          const next = await api("/workspaces/" + wid);
          if (!active()) return;
          S.w = next;
          if (!spec()) {
            S.specId = S.w.document.specs[0]?.id || null;
            if (S.view === "spec") S.view = "workspace";
            syncRoute({ replace: true });
          }
          render();
          toast(__t("팀의 최신 변경을 불러왔습니다."));
        } else if (S.view === "members") {
          const next = await api("/workspaces/" + wid);
          if (!active()) return;
          S.w = next;
          renderMain();
        }
      } catch (e) {
        if (active() && (e.status === 403 || e.status === 404)) {
          await goHome();
          toast(
            __t("이 워크스페이스에 접근할 수 없습니다. 목록으로 돌아왔습니다."),
          );
        }
      } finally {
        polling = false;
      }
    }, UI_CONFIG.sessionPollMs);
  }
  return { initialize };
}
