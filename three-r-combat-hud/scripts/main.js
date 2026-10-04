import { MODULE_ID } from "./state.js";
import { ThreeRCombatHud } from "./hud.js";
import { owned } from "./model.js";
import { reportError } from "./actions.js";
import { installMovement } from "./movement.js";
import { registerAppearance, loadHudStyles } from "./appearance.js";

let hud;
let stylesReady;

Hooks.once("init", () => {
  stylesReady = loadHudStyles().catch(error => { reportError(error); return false; });
  registerAppearance(() => hud?.refresh());
  game.settings.register(MODULE_ID, "enabled", {
    name: "显示3r战斗HUD", hint: "只影响你自己的操作栏。也可以用Alt+H切换。",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: value => {
      if (!hud) return;
      hud.enabled = value;
      if (value) hud.refresh(); else hud.close().catch(reportError);
    }
  });
  game.settings.register(MODULE_ID, "scale", {
    name: "HUD大小", hint: "调节按钮和名称的大小，底部栏会随窗口宽度重新排布。",
    scope: "client", config: true, type: Number, default: 100,
    choices: { 85: "85%", 100: "100%", 115: "115%" }, onChange: () => hud?.refresh()
  });
  game.settings.register(MODULE_ID, "backgroundOpacity", {
    name: "HUD背景不透明度", hint: "数值越低越透明。只改变底板、按钮底色和展开面板，不会让名称、图标和生命数值变淡。",
    scope: "client", config: true, type: Number, default: 45,
    range: { min: 10, max: 100, step: 5 }, onChange: () => hud?.refresh()
  });
  game.keybindings.register(MODULE_ID, "toggle", {
    name: "显示／隐藏3r战斗HUD", editable: [{ key: "KeyH", modifiers: ["Alt"] }],
    onDown: () => { hud?.toggle().catch(reportError); return true; }
  });
  game.modules.get(MODULE_ID).api = {
    open: () => { if (hud) return game.settings.set(MODULE_ID, "enabled", true); },
    toggle: () => hud?.toggle(),
    // For later integrations. This records a reminder, never spends a native action.
    recordAction: (kind, label = "手动记录") => {
      const choice = hud?.selection().choice;
      if (!choice || !owned(choice.actor)) return false;
      hud.store.record(hud.store.context(choice.actor, choice.token), kind, label);
      hud.refresh();
      return true;
    }
  };
});

Hooks.once("ready", async () => {
  if (game.system.id !== "D35E") return;
  if (!await stylesReady) return;
  hud = new ThreeRCombatHud();
  installMovement(() => hud.refresh());
  hud.refresh();
  console.info(`${MODULE_ID}: 0.5.4，基础技能逐项配图，状态结算可选联动，八套主题共用稳定布局。`);
});

Hooks.on("getSceneControlButtons", controls => {
  if (game.system.id !== "D35E" || !controls.tokens?.tools) return;
  controls.tokens.tools.threeRCombatHud = {
    name: "threeRCombatHud", title: "3r战斗HUD", icon: "fa-solid fa-gamepad", button: true,
    onChange: () => hud?.toggle().catch(reportError)
  };
});

Hooks.on("controlToken", (token, controlled) => {
  if (!hud) return;
  if (controlled && owned(token.actor)) {
    hud.drawer = null;
    hud.query = "";
    hud.book = "";
    hud.level = "";
    hud.actionFilter = "";
    hud.scroll = 0;
    hud.status = "";
  }
  hud.refresh();
});
Hooks.on("canvasTearDown", () => {
  if (!hud) return;
  hud.currentChoice = null;
  hud.drawer = null;
  hud.close().catch(reportError);
});
for (const hook of ["canvasReady", "targetToken", "updateActor", "createActor", "deleteActor",
  "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
  "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant",
  "createToken", "updateToken", "deleteToken", "updateWorldTime", "collapseSidebar", "renderSidebar"]) {
  Hooks.on(hook, () => hud?.refresh());
}
window.addEventListener("resize", () => hud?.refresh(), { passive: true });
