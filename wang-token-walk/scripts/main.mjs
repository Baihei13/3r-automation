import {
  refreshSheetIndex,
  listSheets,
  getSheetEntry,
  saveWorldSheet,
  deleteWorldSheet,
  getWorldSheets,
} from "./sheet-registry.mjs";
import {
  MODULE_ID,
  installWalkEngine,
  enableWalk,
  disableWalk,
  testWalkInPlace,
  resolveToken,
} from "./walk-engine.mjs";
import { openWalkConfig, WalkConfigApp } from "./walk-config-app.mjs";
import { openSheetEditor, SheetEditorApp } from "./sheet-editor-app.mjs";
import { getActorAnimation, getItemAnimation } from "./animation-data.mjs";
import { openItemAnimationEditor, AnimationEditorApp } from "./animation-editor-app.mjs";
import { openActorPresetEditor, ActorPresetEditorApp } from "./preset-editor-app.mjs";
import { installAnimationTriggers } from "./animation-triggers.mjs";
import { playAttack, playCast } from "./animation-triggers.mjs";

function registerSettings() {
  game.settings.register(MODULE_ID, "worldSheets", {
    name: "World Walk Sheets",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // 高级：仍保留路径清单，默认折叠在设置里且文案标明「高级」
  game.settings.register(MODULE_ID, "extraManifests", {
    name: "WANGTOKENWALK.Settings.ExtraManifests",
    hint: "WANGTOKENWALK.Settings.ExtraManifestsHint",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "defaultFps", {
    name: "WANGTOKENWALK.Settings.DefaultFps",
    hint: "WANGTOKENWALK.Settings.DefaultFpsHint",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    range: { min: 4, max: 24, step: 1 },
  });
  game.settings.register(MODULE_ID, "hpPath", {
    name: "生命值字段路径",
    hint: "挨打和死亡动画读取的角色字段；默认适用于 PF2e、D&D 5e 和部分其他系统。其他系统可填它的生命值路径。留空则关闭生命值触发。",
    scope: "world", config: true, type: String,
    default: "system.attributes.hp.value",
  });
}

function registerKeybinding() {
  game.keybindings.register(MODULE_ID, "openConfig", {
    name: "WANGTOKENWALK.Title",
    editable: [{ key: "KeyK", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      openWalkConfig();
      return true;
    },
  });
}

function injectTokenHudButton(hud, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const col = root.querySelector(".col.middle") || root.querySelector(".col.left") || root;
  if (!col || root.querySelector("#wang-token-walk-hud-btn")) return;
  const btn = document.createElement("div");
  btn.className = "control-icon";
  btn.id = "wang-token-walk-hud-btn";
  btn.dataset.tooltip = game.i18n.localize("WANGTOKENWALK.HudTooltip");
  btn.innerHTML = `<i class="fas fa-person-walking"></i>`;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openWalkConfig();
  });
  col.appendChild(btn);
}

Hooks.once("init", () => {
  registerSettings();
  registerKeybinding();
});

Hooks.once("ready", async () => {
  installWalkEngine();
  await installAnimationTriggers();
  await refreshSheetIndex();

  game.wangTokenWalk = {
    MODULE_ID,
    listSheets,
    getSheetEntry,
    refreshSheetIndex,
    saveWorldSheet,
    deleteWorldSheet,
    getWorldSheets,
    enableWalk,
    disableWalk,
    testWalkInPlace,
    resolveToken,
    openConfig: openWalkConfig,
    openSheetEditor,
    openActorAnimationEditor: openActorPresetEditor,
    openItemAnimationEditor,
    getActorAnimation,
    getItemAnimation,
    playAttack,
    playCast,
    AnimationEditorApp,
    ActorPresetEditorApp,
    WalkConfigApp,
    SheetEditorApp,
  };

  game.wangPf2eHomebrew = game.wangPf2eHomebrew || {};
  Object.assign(game.wangPf2eHomebrew, {
    enableTokenWalkAnim: (opts) => enableWalk(opts),
    testWalkInPlace: (opts) => testWalkInPlace(opts),
    createTokenWalkDemo: async () => openWalkConfig(),
  });

  console.log(`${MODULE_ID} | ready — sheets:`, listSheets().map((s) => s.id));
});

Hooks.on("renderTokenHUD", (hud, html) => injectTokenHudButton(hud, html));

function mayEditItem(item) {
  return item?.documentName === "Item" && item.actor && (game.user.isGM || item.isOwner);
}

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const item = app.document;
  if (item?.documentName === "Actor" && (game.user.isGM || item.isOwner)) {
    if (!controls.some((control) => control.action === "wangTokenWalkActor")) controls.unshift({
      label: "角色帧", icon: "fas fa-person-walking", action: "wangTokenWalkActor",
      onClick: () => openActorPresetEditor(item),
    });
    return;
  }
  if (!mayEditItem(item) || controls.some((control) => control.action === "wangTokenWalkItem")) return;
  controls.unshift({
    label: "动作帧", icon: "fas fa-person-running", action: "wangTokenWalkItem",
    onClick: () => openItemAnimationEditor(item),
  });
});

Hooks.on("getItemSheetHeaderButtons", (sheet, buttons) => {
  const item = sheet.item;
  if (!mayEditItem(item) || buttons.some((button) => button.class === "wang-token-walk-item")) return;
  buttons.unshift({
    label: "动作帧", icon: "fas fa-person-running", class: "wang-token-walk-item",
    onclick: () => openItemAnimationEditor(item),
  });
});

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const actor = sheet.actor;
  if (!actor || (!game.user.isGM && !actor.isOwner)) return;
  if (buttons.some((button) => button.class === "wang-token-walk-actor")) return;
  buttons.unshift({
    label: "角色帧", icon: "fas fa-person-walking", class: "wang-token-walk-actor",
    onclick: () => openActorPresetEditor(actor),
  });
});

// Legacy actor/item sheets may render header controls without wiring the
// callbacks supplied by get*SheetHeaderButtons. Bind the visible control too.
function bindLegacyHeaderControl(html, selector, open) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const button = root?.querySelector(selector);
  if (!button || button.dataset.wangTokenWalkBound) return;
  button.dataset.wangTokenWalkBound = "true";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve().then(open).catch((error) => {
      console.error(`${MODULE_ID} | 无法打开帧动画编辑器`, error);
      ui.notifications.error("无法打开帧动画编辑器；请查看控制台错误。");
    });
  });
}

Hooks.on("renderActorSheet", (sheet, html) => {
  if (sheet.actor) bindLegacyHeaderControl(html, ".wang-token-walk-actor", () => openActorPresetEditor(sheet.actor));
});

Hooks.on("renderItemSheet", (sheet, html) => {
  if (sheet.item) bindLegacyHeaderControl(html, ".wang-token-walk-item", () => openItemAnimationEditor(sheet.item));
});
