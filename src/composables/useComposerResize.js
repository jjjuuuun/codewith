import { UI_CONFIG } from "../config/ui.js";
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

export function useComposerResize(panel) {
  const height = ref(UI_CONFIG.composerMinHeight);
  const maximum = ref(UI_CONFIG.composerInitialMaxHeight);
  const minimum = computed(() =>
    Math.min(UI_CONFIG.composerMinHeight, maximum.value),
  );
  let observer;
  let drag;
  const clamp = (value) =>
    Math.max(minimum.value, Math.min(maximum.value, value));
  function measure() {
    const available = panel.value?.clientHeight;
    if (!available) return;
    maximum.value = Math.floor(available * UI_CONFIG.composerMaxRatio);
    height.value = clamp(height.value);
  }
  function start(event) {
    if (event.button !== 0) return;
    measure();
    drag = { id: event.pointerId, y: event.clientY, height: height.value };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event) {
    if (drag?.id !== event.pointerId) return;
    height.value = clamp(drag.height + drag.y - event.clientY);
  }
  function end(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event) {
    const values = {
      ArrowUp: height.value + UI_CONFIG.composerKeyboardStep,
      ArrowDown: height.value - UI_CONFIG.composerKeyboardStep,
      Home: minimum.value,
      End: maximum.value,
    };
    if (!(event.key in values)) return;
    event.preventDefault();
    height.value = clamp(values[event.key]);
  }
  onMounted(() => {
    observer = new ResizeObserver(measure);
    observer.observe(panel.value);
    measure();
  });
  onBeforeUnmount(() => observer?.disconnect());
  return { height, maximum, minimum, start, move, end, key };
}
