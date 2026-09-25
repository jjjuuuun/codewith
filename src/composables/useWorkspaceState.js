import { reactive } from "vue";
export function useWorkspaceState() {
  return reactive({
    user: null,
    workspaces: [],
    w: null,
    view: "home",
    specId: null,
    tab: "requirements",
    mode: "discuss",
    settings: { provider: "codex", effort: "auto", model: "" },
    models: [],
    messages: [],
    selectedFiles: [],
    connected: false,
    busy: false,
    job: null,
    showNav: false,
    showAI: false,
    draft: "",
    planDraft: "",
    chatAttachments: [],
    chatUploading: false,
    get chatMode() {
      return this.view === "spec" && this.tab === "design" ? "plan" : "chat";
    },
    chatQueue: [],
    chatSendVersion: 0,
    chatQueuePaused: false,
    chatPreview: "",
    chatThread: null,
    navHidden: localStorage.getItem("codewith.navHidden") === "true",
    chatHidden: localStorage.getItem("codewith.chatHidden") === "true",
    chatWidth: Number(localStorage.getItem("codewith.chatWidth")) || 390,
  });
}
