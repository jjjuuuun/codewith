import { ref, computed, onBeforeUnmount } from "vue";
import { isChatVisible } from "../services/panel-visibility.js";
export function usePanelLayout(S) {
  const viewport = ref(innerWidth),
    resizing = ref(false);
  const max = computed(() => Math.floor(viewport.value / 2));
  const chatVisible = computed(() => isChatVisible(S, viewport.value));
  const min = computed(() => Math.min(360, max.value));
  const width = computed(() =>
    Math.max(min.value, Math.min(max.value, S.chatWidth)),
  );
  const resize = () => {
    viewport.value = innerWidth;
  };
  window.addEventListener("resize", resize);
  const save = () => localStorage.setItem("codewith.chatWidth", S.chatWidth);
  function start(event) {
    if (viewport.value <= 950) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.value = true;
  }
  function move(event) {
    if (resizing.value)
      S.chatWidth = Math.max(
        min.value,
        Math.min(max.value, viewport.value - event.clientX),
      );
  }
  function end() {
    if (resizing.value) {
      resizing.value = false;
      save();
    }
  }
  function key(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    S.chatWidth = Math.max(
      min.value,
      Math.min(
        max.value,
        event.key === "Home"
          ? min.value
          : event.key === "End"
            ? max.value
            : S.chatWidth + (event.key === "ArrowLeft" ? 20 : -20),
      ),
    );
    save();
  }
  onBeforeUnmount(() => window.removeEventListener("resize", resize));
  return { width, min, max, chatVisible, resizing, start, move, end, key };
}
