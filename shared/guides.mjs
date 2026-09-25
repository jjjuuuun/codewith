export const guides = Object.freeze([
  { id: "usage", path: "/guide", title: "사용 안내" },
  { id: "deployment", path: "/guide/deployment", title: "운영 안내" },
  { id: "ai", path: "/guide/ai", title: "AI 연결 안내" },
]);
export const guideForPath = (path) =>
  guides.find((guide) => guide.path === path);
