import { UI_CONFIG } from "../config/ui.js";
import { ref, onBeforeUnmount } from "vue";
export function useNotifications() {
  const notification = ref("");
  let timer;
  function toast(text) {
    notification.value = text;
    clearTimeout(timer);
    timer = setTimeout(() => (notification.value = ""), UI_CONFIG.toastMs);
  }
  onBeforeUnmount(() => clearTimeout(timer));
  return { notification, toast };
}
