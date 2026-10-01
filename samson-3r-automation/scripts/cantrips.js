import { MODULE_ID } from "./catalog.js";

const SETTING = "unlimitedCantrips";
const ownsRule = () => game.users.activeGM === game.user;
const relevantSpellChange = changes => changes.system?.level !== undefined
  || changes.system?.spellbook !== undefined
  || changes.system?.preparation?.preparedAmount !== undefined
  || changes["system.level"] !== undefined
  || changes["system.spellbook"] !== undefined
  || changes["system.preparation.preparedAmount"] !== undefined;

async function applyToSpell(item) {
  if (!ownsRule() || item.type !== "spell" || !item.actor) return;
  const old = item.getFlag(MODULE_ID, "cantripOriginal");
  const level = Number(item.system.level);
  const spellbook = item.actor.system.attributes?.spells?.spellbooks?.[item.system.spellbook || "primary"];
  const prepared = Boolean(spellbook?.spontaneous) || Number(item.system.preparation?.preparedAmount ?? 0) > 0;
  const pfClass = item.actor.items.some(entry => ["witch","oracle","dual-cursed-oracle"].includes(entry.getFlag(MODULE_ID,"key")));
  const unlimited = (game.settings.get(MODULE_ID, SETTING) || pfClass) && level === 0 && Number(item.system.slOffset??0)<=0 && Boolean(spellbook) && prepared;
  if (unlimited && !old) {
    await item.update({
      "flags.samson-3r-automation.cantripOriginal": {
        atWill: Boolean(item.system.atWill),
        autoDeductCharges: Boolean(item.system.preparation?.autoDeductCharges)
      },
      "system.atWill": true,
      "system.preparation.autoDeductCharges": false
    });
  } else if (!unlimited && old) {
    await item.update({ "system.atWill": old.atWill,
      "system.preparation.autoDeductCharges": old.autoDeductCharges });
    await item.unsetFlag(MODULE_ID, "cantripOriginal");
  }
}

async function applyToWorld() {
  if (!ownsRule()) return;
  const actors = new Map(game.actors.map(actor=>[actor.uuid,actor]));
  for(const scene of game.scenes)for(const token of scene.tokens)if(!token.actorLink&&token.actor)actors.set(token.actor.uuid,token.actor);
  for (const actor of actors.values()) {
    for (const item of actor.items.filter(entry => entry.type === "spell")) await applyToSpell(item);
  }
}

export function registerCantripSetting() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "PF 规则：已准备／已知的 0 环法术无限使用",
    hint: "额外让3R职业已准备／已知的0环无限使用。PF女巫戏法、先知祷念本来就无限；未准备的女巫戏法、升环超魔版本仍按正常次数使用。",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => applyToWorld().catch(error => console.error(`${MODULE_ID}: cantrip setting`, error))
  });
}

export function activateCantripRule() {
  Hooks.on("canvasReady", () => applyToWorld().catch(console.error));
  Hooks.on("createItem", item => applyToSpell(item).catch(console.error));
  Hooks.on("updateItem", (item, changes) => {
    if (!relevantSpellChange(changes)) return;
    applyToSpell(item).catch(console.error);
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (!ownsRule()) return;
    if (!Object.keys(changes).some(key => key === "system" || key.startsWith("system.attributes.spells.spellbooks"))) return;
    for (const item of actor.items.filter(entry => entry.type === "spell" && Number(entry.system.level) === 0)) {
      applyToSpell(item).catch(console.error);
    }
  });
  return applyToWorld();
}

export const refreshCantripRule = applyToWorld;
