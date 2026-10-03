import { movementThreats } from "./sneak-attack.js";

const notified = new Set();
let round = null;
const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function installMovementOpportunities() {
  Hooks.on("moveToken", (document, movement, operation) => {
    if (game.users.activeGM?.id !== game.user.id || !game.combat?.started || operation.isUndo) return;
    if (movement.passed.waypoints.some(point => CONFIG.Token.movement.actions[point.action]?.teleport)) return;
    const key = `${game.combat.id}:${game.combat.round}`;
    if (round !== key) { notified.clear(); round = key; }
    const state = document.getFlag("three-r-combat-hud", "movement");
    // Only explicitly activated step mode suppresses movement opportunities. Distance alone never does.
    if (state?.turn === key && state.mode === "step") return;
    try {
      const enemies = movementThreats(document, movement).filter(enemy => !notified.has(`${document.uuid}:${enemy.id}`));
      if (!enemies.length) return;
      for (const enemy of enemies) notified.add(`${document.uuid}:${enemy.id}`);
      ChatMessage.create({ whisper: game.users.filter(user => user.isGM).map(user => user.id),
        content: `<p><strong>移动借机提醒</strong>：${escape(document.name)}离开了${enemies.map(enemy => escape(enemy.name)).join("、")}威胁的格子。</p><p>本次是普通移动。撤退起始格、滚翻、特殊能力和借机次数由DM核对；确认后使用攻击者的“借机攻击”动作。此提醒不自动掷骰或扣次数。</p>`
      }).catch(error => console.error("samson-3r-automation 移动借机提醒", error));
    } catch (error) { console.error("samson-3r-automation 移动威胁判定", error); }
  });
  Hooks.on("canvasTearDown", () => { notified.clear(); round = null; });
}
