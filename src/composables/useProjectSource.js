import { t as __t } from "../i18n/index.js";
import ProjectFolderBrowser from "../components/forms/ProjectFolderBrowser.vue";
import { field, btn } from "../services/form-fields.js";
import { api } from "../services/api.js";
import { h, ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  memory,
  handles,
  collect,
  uploaded,
  inspectProjectSource,
} from "../services/project-files.js";

export function useProjectSource({
  editors,
  S,
  openDialog,
  render,
  toast,
  instanceId,
}) {
  const refreshing = ref(false);
  const connecting = ref(false);
  const status = ref("checking");
  const detail = ref("");
  const previous = ref(null);
  let cachedHandle = null,
    checkSequence = 0;
  const labels = {
    checking: __t("연결 확인 중…"),
    connected: __t("연결됨"),
    snapshot: __t("사본 연결됨"),
    disconnected: __t("연결 안 됨"),
    permission: __t("재연결 필요"),
    missing: __t("재연결 필요"),
    unavailable: __t("접근 불가"),
  };
  const statusLabel = computed(() =>
    connecting.value ? __t("연결 중…") : labels[status.value],
  );
  const connected = computed(() =>
    ["connected", "snapshot"].includes(status.value),
  );
  const key = (wid) => instanceId() + ":" + S.user?.id + ":" + wid;
  const endpoint = (wid) => "/workspaces/" + wid + "/project-source";
  function history(k, value) {
    try {
      const storageKey = "codewith-project-previous:" + k;
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  }
  async function remember(k, c, handle) {
    if (!c) return;
    const value = {
      kind: c.kind,
      label: c.label,
      path: c.path,
      excluded: c.excluded || [],
    };
    history(k, value);
    if (S.w && key(S.w.id) === k) previous.value = value;
    if (handle) {
      memory.set(k + ":previous", handle);
      await handles(k + ":previous", handle);
    }
  }
  async function check() {
    if (!S.w || !S.user) return null;
    const wid = S.w.id,
      k = key(wid),
      sequence = ++checkSequence;
    status.value = "checking";
    try {
      const { connection: c, available = true } = await api(endpoint(wid));
      const handle =
        c?.kind === "browser" ? memory.get(k) || (await handles(k)) : null;
      const old = history(k);
      const oldHandle =
        memory.get(k + ":previous") || (await handles(k + ":previous"));
      const access = await inspectProjectSource(c, handle, available);
      if (!S.w || key(S.w.id) !== k)
        throw Error(
          __t(
            "워크스페이스가 변경되었습니다. 현재 워크스페이스에서 다시 실행하세요.",
          ),
        );
      if (sequence !== checkSequence)
        return { connection: c, handle, access, wid, k };
      cachedHandle = handle || (!c ? oldHandle : null);
      previous.value = old;
      S.w.projectSource = c;
      status.value = access.state;
      detail.value = access.message;
      if (handle) memory.set(k, handle);
      if (c) await remember(k, c, handle);
      return { connection: c, handle, access, wid, k };
    } catch (error) {
      if (sequence === checkSequence && S.w && key(S.w.id) === k) {
        status.value = "unavailable";
        detail.value = error.message;
      }
      throw error;
    }
  }
  async function reload(wid) {
    const workspace = await api("/workspaces/" + wid);
    if (S.w?.id === wid) {
      S.w = workspace;
      await check();
      render();
    }
  }
  const recheck = () => {
    check().catch(() => {});
  };
  watch(
    [() => S.user?.id, () => S.w?.id, () => S.w?.projectSource?.revision],
    () => {
      cachedHandle = null;
      previous.value = null;
      detail.value = "";
      status.value = "checking";
      recheck();
    },
    { flush: "post" },
  );
  onMounted(() => {
    recheck();
    window.addEventListener("focus", recheck);
  });
  onBeforeUnmount(() => {
    checkSequence++;
    window.removeEventListener("focus", recheck);
  });
  async function open(startIn) {
    const wid = S.w.id;
    let handle, list;
    try {
      // Invoke the native picker before any network await so user activation is retained.
      if (window.showDirectoryPicker && window.isSecureContext) {
        handle = await window.showDirectoryPicker({
          mode: "read",
          ...(startIn ? { startIn } : {}),
        });
      } else {
        list = await new Promise((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.webkitdirectory = true;
          input.multiple = true;
          input.onchange = () => resolve([...input.files]);
          input.oncancel = () => resolve([]);
          input.click();
        });
        if (!list.length) return;
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      throw error;
    }
    connecting.value = true;
    try {
      const { connection } = await api(endpoint(wid));
      const excluded = connection?.excluded || [];
      const files = handle
        ? await collect(handle, excluded)
        : await uploaded(list, excluded);
      const label = handle?.name || list[0].webkitRelativePath.split("/")[0];
      await api(endpoint(wid), {
        method: "POST",
        body: {
          kind: handle ? "browser" : "upload",
          label,
          files,
          excluded,
          revision: connection?.revision ?? null,
        },
      });
      if (handle) {
        memory.set(key(wid), handle);
        await handles(key(wid), handle);
      } else {
        memory.delete(key(wid));
        await handles(key(wid), undefined, true);
      }
      await reload(wid);
      toast(__t("프로젝트 폴더를 연결했습니다."));
      return true;
    } finally {
      connecting.value = false;
    }
  }
  async function uploadHandle(wid, c, handle) {
    const k = key(wid);
    const files = await collect(handle, c?.excluded || []);
    const result = await api(endpoint(wid), {
      method: "POST",
      body: {
        kind: "browser",
        label: handle.name,
        excluded: c?.excluded || [],
        files,
        revision: c?.revision ?? null,
      },
    });
    memory.set(k, handle);
    await handles(k, handle);
    await remember(k, result.connection, handle);
    await reload(wid);
  }
  async function beforeAI() {
    const context = await check();
    if (!context) return;
    const { connection: c, handle, access, wid } = context;
    if (!c) return;
    if (!["connected", "snapshot"].includes(access.state))
      throw Error(access.message);
    if (c.kind !== "browser") return;
    try {
      await uploadHandle(wid, c, handle);
    } catch (error) {
      await check();
      throw error;
    }
  }
  async function reconnect() {
    const wid = S.w.id;
    const prior = previous.value || S.w.projectSource;
    const handle = cachedHandle;
    if (!prior) return open();
    if (prior.kind === "upload" || (prior.kind === "browser" && !handle))
      return open();
    // Permission requests must start in the click handler, before any network await.
    if (prior.kind === "browser") {
      const permission = await handle.requestPermission({ mode: "read" });
      if (permission !== "granted") {
        status.value = "permission";
        detail.value = __t("폴더 읽기 권한이 허용되지 않았습니다.");
        return;
      }
    }
    connecting.value = true;
    try {
      const { connection: current } = await api(endpoint(wid));
      if (prior.kind === "browser")
        await uploadHandle(
          wid,
          { ...prior, revision: current?.revision ?? null },
          handle,
        );
      else {
        await api(endpoint(wid), {
          method: "POST",
          body: { ...prior, revision: current?.revision ?? null },
        });
        await reload(wid);
      }
      toast(__t("이전 프로젝트 폴더를 다시 연결했습니다."));
    } catch (error) {
      await check();
      throw error;
    } finally {
      connecting.value = false;
    }
  }
  async function handleAction(name, el) {
    if (S.busy) return toast(__t("AI 응답을 완료하거나 중지해 주세요."));
    if (connecting.value || refreshing.value) return;
    if (editors.state.inline)
      return toast(__t("작성 중인 내용을 저장하거나 취소해 주세요."));
    const parentEditor = editors.state.dialog?.options.personalSettings
      ? editors.state.dialog
      : undefined;
    if (name === "project-source-open") {
      const wid = S.w.id;
      const current = (await api(endpoint(wid))).connection;
      if (
        S.w?.id !== wid ||
        (parentEditor && editors.state.dialog !== parentEditor)
      )
        return;
      return openDialog(
        __t("프로젝트 폴더 연결"),
        [
          h(
            "p",
            {},
            __t(
              "이 프로젝트 폴더를 코드 읽기와 AI 파일 수정·명령 실행에 함께 사용합니다. CodeWith가 실행되는 컴퓨터에서 접근할 수 있는 경로를 선택하세요.",
            ),
          ),
          field(
            __t("프로젝트 절대 경로"),
            "path",
            current?.path || "",
            "input",
            {
              required: true,
            },
          ),
          h(ProjectFolderBrowser, {
            endpoint: endpoint(wid),
            name: "folderBrowser",
            items: [],
            formRows: true,
          }),
        ],
        async (form) => {
          const path = String(form.get("path")).trim();
          await api(endpoint(wid), {
            method: "POST",
            body: {
              kind: "server",
              path,
              label:
                path.split(/[\\/]/).filter(Boolean).at(-1) || __t("프로젝트"),
              revision: current?.revision ?? null,
            },
          });
          await reload(wid);
          await remember(key(wid), S.w.projectSource);
          toast(__t("프로젝트 폴더를 연결했습니다."));
        },
        {
          save: __t("연결"),
          parentEditor,
          footerStart: btn(
            "project-source-upload",
            __t("폴더 사본 가져오기"),
            "small ghost",
            {
              title: __t(
                "서버에서 접근할 수 없는 폴더를 코드 분석용으로 가져옵니다. 실제 파일 수정과 명령 실행에는 사용하지 않습니다.",
              ),
            },
          ),
        },
      );
    }
    if (name === "project-source-upload") {
      const editor = editors.state.dialog;
      if (await open()) {
        if (editors.state.dialog === editor) editors.closeDialog();
      }
      return;
    }
    if (name === "project-source-reconnect") return reconnect();
    if (name === "project-source-refresh") {
      const wid = S.w.id,
        c = (await api(endpoint(wid))).connection;
      if (!c || c.kind === "upload") return open();
      refreshing.value = true;
      try {
        if (c.kind === "browser") await beforeAI();
        else await api(endpoint(wid) + "/refresh", { method: "POST" });
        await reload(wid);
        toast(__t("프로젝트 코드를 다시 읽었습니다."));
      } finally {
        refreshing.value = false;
      }
      return;
    }
    if (name === "project-source-disconnect") {
      const wid = S.w.id,
        c = (await api(endpoint(wid))).connection;
      if (
        S.w?.id !== wid ||
        (parentEditor && editors.state.dialog !== parentEditor)
      )
        return;
      openDialog(
        __t("프로젝트 연결 해제"),
        [
          h("p", {}, [
            __t(
              "내 계정의 작업 폴더 연결과 분석용 사본을 제거합니다. 실제 파일과 저장한 계획서는 유지하며, 이 브라우저에는 재연결을 위한 이전 폴더 정보를 남깁니다.",
            ),
          ]),
        ],
        async () => {
          const k = key(wid);
          await remember(k, c, memory.get(k) || (await handles(k)));
          await api(endpoint(wid), {
            method: "DELETE",
            body: { revision: c?.revision ?? null },
          });
          memory.delete(key(wid));
          await handles(key(wid), undefined, true);
          await reload(wid);
          toast(__t("프로젝트 연결을 해제했습니다."));
        },
        { save: __t("연결 해제"), parentEditor },
      );
    }
  }
  return {
    handle: handleAction,
    beforeAI,
    refreshing,
    connecting,
    status,
    statusLabel,
    connected,
    detail,
    previous,
    check,
  };
}
