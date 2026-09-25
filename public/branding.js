/* Shared tab icon setup for the Vue app and standalone pages. */
(() => {
  const logoURL = "/logo.svg";
  const icon =
    document.querySelector('link[rel="icon"]') ||
    document.createElement("link");
  icon.rel = "icon";
  icon.type = "image/svg+xml";
  icon.href = logoURL;
  if (!icon.isConnected) document.head.append(icon);

  async function iconDataURL() {
    const response = await fetch(logoURL);
    if (!response.ok)
      throw new Error("공유 문서 아이콘을 불러오지 못했습니다.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    return "data:image/svg+xml;base64," + btoa(String.fromCharCode(...bytes));
  }
  window.CodeWithBrand = Object.freeze({ logoURL, iconDataURL });
})();
