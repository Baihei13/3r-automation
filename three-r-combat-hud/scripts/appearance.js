import { MODULE_ID } from "./state.js";

// Client-local themes; shared layout and original CSS surfaces.
export const THEMES = {
  noir: "绯红舞台 · P5风格", glass: "全息玻璃", fantasy: "古金遗迹 · 暗黑奇幻",
  neon: "夜城终端 · 2077风格", parchment: "王庭羊皮纸", illustrated: "自选画幕",
  steel: "冷钢战术", ember: "暖金冒险"
};
export const LAYOUTS = { command: "指令布局：左侧角色卡＋右下菜单", compact: "紧凑底栏：两排带名称格子" };

export function loadHudStyles() {
  // Running servers can retain the old manifest. Reuse the existing stylesheet
  // path and load this version directly, so CSS caching cannot omit the themes.
  const url = new URL("../styles/hud.css", import.meta.url);
  url.searchParams.set("v", "0.5.1");
  const id = "three-r-combat-hud-styles";
  document.getElementById(id)?.remove();
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.id = id; link.rel = "stylesheet"; link.href = url.href;
    link.addEventListener("load", () => {
      // Foundry's initial stylesheet can be cached independently of this link.
      // Drop only this module's older style links after the new file has loaded.
      const ownDirectory = new URL(".", url);
      for (const other of document.querySelectorAll('link[rel~="stylesheet"]')) {
        if (other === link) continue;
        try {
          const oldUrl = new URL(other.href, document.baseURI);
          if (oldUrl.origin === ownDirectory.origin && oldUrl.pathname.startsWith(ownDirectory.pathname)) other.remove();
        } catch { /* Leave unrelated or invalid links alone. */ }
      }
      resolve(true);
    }, { once: true });
    link.addEventListener("error", () => reject(new Error("3r战斗HUD外观样式加载失败，请检查模块文件是否完整。")), { once: true });
    document.head.append(link);
  });
}

export function registerAppearance(refresh) {
  game.settings.register(MODULE_ID, "stylishSolidPanels", {
    name: "指令布局使用实心卡片", hint: "角色卡和列表使用清晰的实心底色。关闭后使用背景不透明度设置，文字与图标保持清楚。",
    scope: "client", config: true, type: Boolean, default: true, onChange: refresh
  });
  for (const [key, name, hint, choices, value] of [
    ["theme", "HUD主题", "只改变外观。所有主题都保留中文名称、法术筛选和原生检定。", THEMES, "noir"],
    ["layout", "HUD布局", "指令面板使用独立头像卡与分类菜单；紧凑底栏适合地图空间较少时使用。", LAYOUTS, "command"]
  ]) game.settings.register(MODULE_ID, key, {
    name, hint, scope: "client", config: true, type: String, choices, default: value, onChange: refresh
  });
  game.settings.register(MODULE_ID, "backgroundImage", {
    name: "HUD自选背景图片", hint: "用于“自选画幕”主题。填写自己在Foundry中的图片路径；留空使用深色底板。",
    scope: "client", config: true, type: String, default: "", onChange: refresh
  });
}

export function appearanceContext() {
  const themeValue = game.settings.get(MODULE_ID, "theme");
  const layoutValue = game.settings.get(MODULE_ID, "layout");
  const theme = Object.hasOwn(THEMES, themeValue) ? themeValue : "noir";
  const layout = Object.hasOwn(LAYOUTS, layoutValue) ? layoutValue : "command";
  return {
    theme, layout,
    solidPanels: Boolean(game.settings.get(MODULE_ID, "stylishSolidPanels")),
    themeChoices: Object.entries(THEMES).map(([id, name]) => ({ id, name, selected: id === theme })),
    layoutChoices: Object.entries(LAYOUTS).map(([id, name]) => ({ id, name, selected: id === layout }))
  };
}

export function applyAppearance(root, context) {
  root.dataset.theme = context.theme;
  root.dataset.layout = context.layout;
  root.classList.toggle("trh-translucent", !context.solidPanels);
  root.style.removeProperty("--trh-art");
  if (context.theme !== "illustrated") return;
  const path = String(game.settings.get(MODULE_ID, "backgroundImage") || "").trim();
  if (!path) return;
  try {
    const url = new URL(path, document.baseURI);
    if (["http:", "https:"].includes(url.protocol)) root.style.setProperty("--trh-art", `url(${JSON.stringify(url.href)})`);
  } catch { /* Invalid paths leave the readable fallback surface. */ }
}
