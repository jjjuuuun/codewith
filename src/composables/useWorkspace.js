import { t as __t } from "../i18n/index.js";
import { useActionDispatcher } from "./useActionDispatcher.js";
import { useWorkspaceState } from "./useWorkspaceState.js";
import { usePanelLayout } from "./usePanelLayout.js";
import { useNotifications } from "./useNotifications.js";
import { useWorkspaceMenu } from "./useWorkspaceMenu.js";

import { createDocumentActions } from "../actions/document.js";
import { createNavigationActions } from "../actions/navigation.js";
import { createChatActions } from "../actions/chat.js";
import { createTransferActions } from "../actions/transfer.js";
import { createSharingActions } from "../actions/sharing.js";
import { useWorkspaceData } from "./useWorkspaceData.js";
import { useNavigation } from "./useNavigation.js";
import { useChat } from "./useChat.js";
import { useWorkspaceSettings } from "./useWorkspaceSettings.js";
import { useExchange } from "./useExchange.js";
import { useInstructions } from "./useInstructions.js";
import { useRemoval } from "./useRemoval.js";
import { useSession } from "./useSession.js";

import { useEditors } from "./useEditors.js";

import { useAIConnection } from "./useAIConnection.js";
import { useResources } from "./useResources.js";
import { useDocumentEditors } from "./useDocumentEditors.js";
import { useProjectSource } from "./useProjectSource.js";
import { usePlans } from "./usePlans.js";

import { useAccess } from "./useAccess.js";

import {
  ref,
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  provide,
  inject,
} from "vue";
import { aiAPI } from "../services/api.js";
const workspaceKey = Symbol("codewith-workspace");
export function useWorkspace() {
  return inject(workspaceKey);
}
export function provideWorkspace() {
  const dispose = [];
  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    dispose.push(() => target.removeEventListener(event, handler, options));
  }
  const $ = (s, root = document) => root.querySelector(s),
    $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const S = useWorkspaceState();
  const editors = useEditors({
    canEdit: () => editable(),
    onClose: () => onDialogClose(),
  });
  const {
    openDialog,
    openInline,
    modalDirty,
    requestModalClose,
    readRows,
    getField,
    setField,
    setError,
    setContent,
    onField,
    control,
  } = editors;
  const modal = {
    get open() {
      return !!editors.state.dialog;
    },
    close: editors.closeDialog,
  };
  const { notification, toast } = useNotifications();
  const timers = { login: null };
  const projectSourceUI = useProjectSource({
    editors,
    getField,
    setContent,
    S,
    openDialog,
    render,
    toast,
    instanceId: () => accessUI.config.instanceId,
  });
  const planUI = usePlans({
    syncRoute: (...args) => syncRoute(...args),
    editors,
    setField,
    onField,
    prepareSource: () => projectSourceUI.beforeAI(),
    openDialog,
    S,
    render,
    renderChat: (...args) => renderChat(...args),
    openInline,
    editable: () => editable(),
    toast,
    mutate: (...args) => mutate(...args),
  });
  const chatSpec = () => (S.view === "spec" ? spec() : null);
  const editable = () => S.w && S.w.role !== "viewer",
    spec = () => S.w?.document.specs.find((s) => s.id === S.specId);
  async function onDialogClose() {
    clearInterval(timers.login);
    if (!AIFlow.pending) return;
    AIFlow.pending = false;
    await aiAPI("/login/cancel", { method: "POST" }).catch(() => {});
    if (S.user) {
      S.settings = await serverSettings().catch(() => S.settings);
      S.connected = false;
      await refreshModels().catch(() => {});
      renderChat();
    }
  }

  const accessUI = useAccess({
    setField,
    setError,
    onField,
    openDialog,
    modal,
    initialize: (...args) => initialize(...args),
    render,
    getState: () => S,
    toast,
  });

  const ready = ref(false);
  const mode = ref("personal");
  function renderAuth() {
    ready.value = true;
    mode.value = accessUI.config.mode;
  }
  function render() {
    ready.value = true;
    mode.value = accessUI.config.mode;
    if (S.view === "spec" && S.w && !spec()) {
      S.view = "workspace";
      syncRoute({ replace: true });
    }
    return nextTick();
  }
  function renderMain() {
    return render();
  }
  const renderChat = () => nextTick();

  const { editSpec, editRequirement, editItem, fileDialog } =
    useDocumentEditors({
      S,
      spec,
      openDialog,
      mutate: (...args) => mutate(...args),
      syncRoute: (...args) => syncRoute(...args),
      loadChats: (...args) => loadChats(...args),
      render,
      openInline,
      readRows,
      editable,
    });

  const { resourceDialog, editResource } = useResources({
    S,
    openInline,
    readRows,
    mutate: (...args) => mutate(...args),
  });
  async function runAction(name, el) {
    try {
      return await dispatch(name, el);
    } catch (err) {
      if (editors.state.dialog) setError(err.message);
      else toast(err.message);
    }
  }
  function homeClick(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (editors.state.inline?.onSave || S.busy)
      return toast(
        __t(
          "작성 중인 내용을 저장하거나 취소하고, AI 응답이 완료된 뒤 이동해 주세요.",
        ),
      );
    return goHome();
  }

  const {
    AIFlow,
    beginAIAuth,
    finishAIAuth,
    disconnectAI,
    aiDialog,
    aiWizard,
    setProvider,
    connectAPIKey,
    startOfficialLogin,
  } = useAIConnection({
    editors,
    getField,
    setField,
    setError,
    setContent,
    control,
    S,
    modal,
    timers,
    renderChat,
    refreshModels: (...args) => refreshModels(...args),
    serverSettings: (...args) => serverSettings(...args),
    persistSettings: (...args) => persistSettings(...args),
    initialize: (...args) => initialize(...args),
    toast,
    openDialog,
  });

  const { saveDoc, mutate, refreshList } = useWorkspaceData({
    S,
    spec,
    render: (...args) => render(...args),
    toast: (...args) => toast(...args),
  });
  const { syncRoute, applyRoute, loadWorkspace, goHome } = useNavigation({
    S,
    listen: (...args) => listen(...args),
    editors,
    modal,
    renderAuth: (...args) => renderAuth(...args),
    render: (...args) => render(...args),
    toast: (...args) => toast(...args),
    serverChats: (...args) => serverChats(...args),
  });
  const {
    loadChats,
    serverSettings,
    serverChats,
    refreshModels,
    persistSettings,
    aiOptions,
    sendChat,
    cancelQueued,
    resumeQueue,
    openChatHistory,
    loadChatHistory,
    newChat,
    renameChat,
    deleteChat,
    previewChat,
    regenerateLast,
    attachmentUI,
    editMessage,
    continueAnswer,
  } = useChat({
    plans: planUI,
    S,
    chatSpec,
    renderChat: (...args) => renderChat(...args),
    render: (...args) => render(...args),
    toast: (...args) => toast(...args),
    openDialog: (...args) => openDialog(...args),
    projectSourceUI,
    modal,
    syncRoute,
  });
  const {
    workspaceDialog,
    joinWorkspaceDialog,
    editWorkspaceDialog,
    personalSettingsDialog,
    deleteWorkspaceDialog,
    deleteSpecDialog,
    profileDialog,
  } = useWorkspaceSettings({
    S,
    openDialog: (...args) => openDialog(...args),
    getMode: () => accessUI.config.mode,
    refreshList: (...args) => refreshList(...args),
    loadWorkspace: (...args) => loadWorkspace(...args),
    setContent: (...args) => setContent(...args),
    render: (...args) => render(...args),
    toast: (...args) => toast(...args),
    goHome: (...args) => goHome(...args),
    editable,
    spec,
    syncRoute: (...args) => syncRoute(...args),
    loadChats: (...args) => loadChats(...args),
    renderChat: (...args) => renderChat(...args),
    modal,
  });
  const { download, template, exchangeDialog, exportHTML } = useExchange({
    S,
    openDialog: (...args) => openDialog(...args),
    refreshList: (...args) => refreshList(...args),
    loadWorkspace: (...args) => loadWorkspace(...args),
    editable,
    saveDoc: (...args) => saveDoc(...args),
    spec,
    loadChats: (...args) => loadChats(...args),
    render: (...args) => render(...args),
    onField: (...args) => onField(...args),
    setError: (...args) => setError(...args),
    setField: (...args) => setField(...args),
  });
  const { editInstruction } = useInstructions({
    S,
    openDialog: (...args) => openDialog(...args),
    mutate: (...args) => mutate(...args),
    control: (...args) => control(...args),
    getField: (...args) => getField(...args),
    onField: (...args) => onField(...args),
    setField: (...args) => setField(...args),
    setError: (...args) => setError(...args),
  });
  const { confirmRemoval } = useRemoval({
    S,
    openDialog: (...args) => openDialog(...args),
    mutate: (...args) => mutate(...args),
  });
  const { initialize } = useSession({
    S,
    getAccess: () => accessUI,
    serverSettings: (...args) => serverSettings(...args),
    applyRoute: (...args) => applyRoute(...args),
    profileDialog: (...args) => profileDialog(...args),
    joinWorkspaceDialog: (...args) => joinWorkspaceDialog(...args),
    refreshModels: (...args) => refreshModels(...args),
    renderAuth: (...args) => renderAuth(...args),
    renderChat: (...args) => renderChat(...args),
    renderMain: (...args) => renderMain(...args),
    render: (...args) => render(...args),
    syncRoute: (...args) => syncRoute(...args),
    spec,
    goHome: (...args) => goHome(...args),
    modal,
    editors,
    toast: (...args) => toast(...args),
  });
  const { toggleWorkspaceMenu, closeWorkspaceMenu, menuKey } = useWorkspaceMenu(
    { S, refreshList },
  );
  const panel = usePanelLayout(S);
  const handlers = {
    ...createDocumentActions({
      personalSettingsDialog,
      editWorkspaceDialog,
      S,
      confirmRemoval,
      editInstruction,
      mutate,
      modal,
      workspaceDialog,
      joinWorkspaceDialog,
      deleteWorkspaceDialog,
      editSpec,
      deleteSpecDialog,
      editRequirement,
      openDialog,
      readRows,
      openInline,
      spec,
      editItem,
      fileDialog,
      resourceDialog,
      editResource,
    }),
    ...createNavigationActions({
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
    }),
    ...createChatActions({
      openChatHistory,
      loadChatHistory,
      newChat,
      renameChat,
      deleteChat,
      previewChat,
      regenerateLast,
      AIFlow,
      aiWizard,
      beginAIAuth,
      aiDialog,
      aiOptions,
      disconnectAI,
      startOfficialLogin,
      getField,
      setField,
      setContent,
      connectAPIKey,
      openDialog,
      S,
      renderChat,
      sendChat,
      chatSpec,
      editRequirement,
      loadChats,
      render,
      toast,
    }),
    ...createTransferActions({
      openDialog,
      download,
      S,
      saveDoc,
      toast,
      exchangeDialog,
      template,
      exportHTML,
      editable,
      spec,
      modal,
      render,
    }),
    ...createSharingActions({ S, renderMain, toast, openDialog }),
  };
  const { dispatch } = useActionDispatcher({
    S,
    editors,
    plans: planUI,
    projectSource: projectSourceUI,
    access: accessUI,
    source: projectSourceUI,
    handlers,
    toast,
  });
  onMounted(initialize);

  onBeforeUnmount(() => {
    dispose.forEach((fn) => fn());

    clearInterval(timers.login);
  });
  const context = {
    openDialog,
    notification,
    menuKey,
    panel,
    S,
    editors,
    runAction,
    homeClick,
    ready,
    mode,
    currentSpec: computed(spec),
    canEdit: computed(editable),
    accessConfig: computed(() => accessUI.config),
    plans: planUI,
    projectSource: projectSourceUI,
    sendChat,
    attachmentUI,
    editMessage,
    continueAnswer,
    cancelQueued,
    resumeQueue,
    render,
    persistSettings: (...args) => persistSettings(...args),
    refreshModels: (...args) => refreshModels(...args),
    toast,
    setModel: async (value) => {
      S.settings.model = value;
      S.settings.effort = "auto";
      try {
        await persistSettings();
      } catch (e) {
        toast(e.message);
      }
    },
    setEffort: async (value) => {
      S.settings.effort = value;
      try {
        await persistSettings();
      } catch (e) {
        toast(e.message);
      }
    },
  };
  provide(workspaceKey, context);
  return context;
}
