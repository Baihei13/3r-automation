import { D35ECombatTracker } from "../../../systems/D35E/module/combat/combat-tracker.js";
import { MODULE_ID, nativeBuffSeconds, nativeEffectTimer, remaining, durationLabel } from "./time.mjs";

function effectBadges(actor) {
  if (!actor) return [];
  const now = game.time.worldTime;
  const activeBuffs = [...actor.items].filter(item => item.type === "buff" && item.system?.active);
  const buffUuids = new Set(activeBuffs.map(item => item.uuid));
  const result = activeBuffs.map(item => {
    const t = item.getFlag(MODULE_ID, "timer");
    const seconds = t ? remaining(t, now) : nativeBuffSeconds(item);
    return { name: item.name, img: item.img, remaining: seconds == null ? "" : durationLabel(seconds) };
  });
  for (const effect of actor.effects) {
    if (effect.disabled || effect.isSuppressed || buffUuids.has(effect.origin)) continue;
    const t = effect.getFlag(MODULE_ID, "timer") ?? nativeEffectTimer(effect);
    result.push({ name: effect.name, img: effect.img,
      remaining: t ? durationLabel(remaining(t, now)) : "" });
  }
  return result.slice(0, 6);
}

export class BetterD35ECombatTracker extends D35ECombatTracker {
  static PARTS = {
    header: { template: `modules/${MODULE_ID}/templates/combat-header.hbs` },
    tracker: { template: `modules/${MODULE_ID}/templates/combat-tracker.hbs`, scrollable: [".dwt-combat-dashboard"] },
    footer: { template: `modules/${MODULE_ID}/templates/combat-footer.hbs` }
  };

  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = this.viewed;
    context.hasCombat = !!combat;
    context.dwtCurrentName = !game.user.isGM && combat?.combatant?.hidden ? "未知目标" :
      combat?.combatant?.actor?.name ?? combat?.combatant?.name ?? "等待开始";
    context.dwtRound = combat?.round ?? 0;
    context.dwtHasTurns = !!context.turns?.length;
    for (const turn of context.turns ?? []) {
      const combatant = combat?.combatants?.get(turn.id);
      const actor = combatant?.actor;
      const visible = !!actor && (game.user.isGM || (!combatant.hidden && actor.testUserPermission(game.user, "OBSERVER")));
      const canSeeHp = !!actor && (game.user.isGM || actor.testUserPermission(game.user, "OWNER"));
      const hp = canSeeHp ? actor.system?.attributes?.hp : null;
      const value = Number(hp?.value);
      const max = Number(hp?.max);
      turn.dwtShowHp = Number.isFinite(value) && Number.isFinite(max) && max > 0;
      turn.dwtHp = turn.dwtShowHp ? `${value} / ${max}` : "";
      turn.dwtHpPercent = turn.dwtShowHp ? Math.max(0, Math.min(100, 100 * value / max)) : 0;
      turn.dwtEffects = visible ? effectBadges(actor) : [];
      turn.dwtHasEffects = turn.dwtEffects.length > 0;
    }
  }
}

export function installCombatTracker() {
  if (game.system.id !== "D35E") return;
  CONFIG.ui.combat = BetterD35ECombatTracker;
}
