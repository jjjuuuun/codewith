export function isChatVisible(state, viewportWidth) {
  return (
    !state.chatHidden &&
    (state.showAI || (state.view === "spec" && viewportWidth > 950))
  );
}
