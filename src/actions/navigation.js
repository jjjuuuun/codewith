import { api } from "../services/api.js";
import { isChatVisible } from "../services/panel-visibility.js";

export function createNavigationActions({
  editors,
  S,
  render,
  editSpec,
  loadChats,
  requestModalClose,
  modal,
  syncRoute,
  renderAuth,
  goHome,
  renderChat,
  renderMain,
  toggleWorkspaceMenu,
  closeWorkspaceMenu,
  loadWorkspace,
  $$,
}) {
  const onInlineCancel = async (name, el) => {
    return editors.closeInline();
  };
  const onHomeStep = async (name, el) => {
    {
      const step = el.dataset.step;
      if (step === "project") {
        S.view = "project";
        return render();
      }
      if (step === "new-spec") return editSpec(true);
      if (!S.w.document.specs.length) return editSpec(true);
      S.specId = S.w.document.specs[0].id;
      S.view = "spec";
      S.tab = "design";
      await loadChats();
      return render();
    }
  };
  const onClose = async (name, el) => {
    return requestModalClose();
  };
  const onDiscardModal = async (name, el) => {
    return modal.close();
  };
  const onKeepModal = async (name, el) => {
    if (editors.state.dialog) editors.state.dialog.unsaved = false;
    return;
  };
  const onToggleNav = async (name, el) => {
    if (innerWidth <= 600) {
      S.showNav = !S.showNav;
      S.navHidden = false;
    } else {
      S.navHidden = !S.navHidden;
      localStorage.setItem("codewith.navHidden", S.navHidden);
    }
    return render();
  };
  const onToggleAi = async (name, el) => {
    const visible = isChatVisible(S, innerWidth);
    S.showAI = !visible;
    S.chatHidden = visible;
    localStorage.setItem("codewith.chatHidden", S.chatHidden);
    return render();
  };
  const onLogout = async (name, el) => {
    await api("/auth/logout", { method: "POST" });
    S.user = null;
    S.w = null;
    S.models = [];
    S.connected = false;
    syncRoute({ replace: true, path: "/" });
    return renderAuth();
  };
  const onView = async (name, el) => {
    if (el.dataset.view === "home") return goHome();
    S.view = el.dataset.view;
    S.showNav = false;
    S.messages = [];
    S.draft = "";
    S.chatLoading = true;
    if (!S.chatHidden && innerWidth > 950) S.showAI = true;
    syncRoute();
    render();
    await loadChats();
    return renderChat();
  };
  const onTab = async (name, el) => {
    S.tab = el.dataset.tab;
    syncRoute();
    return renderMain();
  };
  const onSpec = async (name, el) => {
    const id = el.dataset.id;
    S.specId = id;
    S.view = "spec";
    S.tab = "requirements";
    S.showNav = false;
    S.messages = [];
    S.draft = "";
    S.chatLoading = true;
    syncRoute();
    render();
    await loadChats();
    return renderChat();
  };
  const onWorkspaces = async (name, el) => {
    return toggleWorkspaceMenu();
  };
  const onSwitchWorkspace = async (name, el) => {
    const id = el.dataset.id;
    modal.close();
    closeWorkspaceMenu();
    return loadWorkspace(id);
  };
  const onRequirementNav = async (name, el) => {
    const id = el.dataset.id,
      sid = el.dataset.spec;
    S.specId = sid;
    S.view = "spec";
    S.tab = "requirements";
    S.showNav = false;
    syncRoute();
    await render();
    $$("[data-requirement-card]")
      .find(
        (x) => x.dataset.requirementCard === id && x.dataset.specCard === sid,
      )
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  };
  return {
    "inline-cancel": (el) => onInlineCancel("inline-cancel", el),
    "home-step": (el) => onHomeStep("home-step", el),
    close: (el) => onClose("close", el),
    "discard-modal": (el) => onDiscardModal("discard-modal", el),
    "keep-modal": (el) => onKeepModal("keep-modal", el),
    "toggle-nav": (el) => onToggleNav("toggle-nav", el),
    "toggle-ai": (el) => onToggleAi("toggle-ai", el),
    logout: (el) => onLogout("logout", el),
    view: (el) => onView("view", el),
    tab: (el) => onTab("tab", el),
    spec: (el) => onSpec("spec", el),
    workspaces: (el) => onWorkspaces("workspaces", el),
    "switch-workspace": (el) => onSwitchWorkspace("switch-workspace", el),
    "requirement-nav": (el) => onRequirementNav("requirement-nav", el),
  };
}
