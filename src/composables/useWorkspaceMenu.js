import { onBeforeUnmount } from "vue";
export function useWorkspaceMenu({ S, refreshList }) {
  async function toggleWorkspaceMenu() {
    if (S.workspaceMenuOpen) {
      S.workspaceMenuOpen = false;
      return;
    }
    await refreshList();
    S.workspaceMenuOpen = true;
  }
  function closeWorkspaceMenu() {
    S.workspaceMenuOpen = false;
  }
  function outside(e) {
    if (!e.target.closest(".workspace-picker")) closeWorkspaceMenu();
  }
  function menuKey(e) {
    const menu = e.currentTarget.querySelector("#workspace-menu");
    if (!S.workspaceMenuOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeWorkspaceMenu();
      e.currentTarget.querySelector(".workspace-switch")?.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const items = [...menu.querySelectorAll("button")],
        i = items.indexOf(document.activeElement);
      items[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : e.key === "ArrowDown"
              ? (i + 1) % items.length
              : (i - 1 + items.length) % items.length
      ]?.focus();
    }
  }
  window.addEventListener("click", outside);
  onBeforeUnmount(() => window.removeEventListener("click", outside));
  return { toggleWorkspaceMenu, closeWorkspaceMenu, menuKey };
}
