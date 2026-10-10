import { MODULE_ID } from "./state.js";

const queues = new Map();
const live = new Map();
function movementCombat(token) {
  const document = token?.document ?? token;
  const combat = game.combat;
  if (!document || !combat?.started || (combat.scene?.id ?? combat.sceneId) !== document.parent?.id
    || document.parent?.id !== canvas.scene?.id) return null;
  return combat.combatants.some(entry => entry.tokenId === document.id) ? combat : null;
}
const turnKey = token => {
  const combat = movementCombat(token);
  return combat ? `${combat.id}:${combat.round}` : null;
};
const unit = () => /^(m|米|公尺|met(er|re)s?)$/i.test(String(canvas.scene?.grid.units ?? "").trim()) ? 0.3048 : /^(ft|feet|foot|尺|英尺)$/i.test(String(canvas.scene?.grid.units ?? "").trim()) ? 1 : null;
async function save(document, next) {
  live.set(document.uuid, next);
  const write = (queues.get(document.uuid) ?? Promise.resolve()).catch(() => {}).then(() => {
    // A queued movement must not write into a later round or after combat ends.
    if (!document.parent?.tokens.has(document.id) || turnKey(document) !== next.turn) { if(live.get(document.uuid)===next)live.delete(document.uuid); return false; }
    return document.setFlag(MODULE_ID, "movement", next).then(() => true);
  });
  queues.set(document.uuid, write);
  try { return await write; }
  catch (error) { if (live.get(document.uuid) === next) live.delete(document.uuid); throw error; }
  finally { if (queues.get(document.uuid) === write) queues.delete(document.uuid); }
}
export function movementState(token) {
  if (!token) return { mode: "normal", distance: 0, cost: 0, stepLeft: 0, normalLeft: 0, units: "尺" };
  const document = token.document ?? token;
  const saved = live.get(document.uuid) ?? document.getFlag(MODULE_ID, "movement");
  const turn = turnKey(document);
  const state = turn && saved?.turn === turn ? saved : { turn, mode: "normal", distance: 0, cost: 0, revision: (saved?.revision ?? 0) };
  const speed = Math.max(0, Number(document.actor?.system.attributes?.speed?.land?.total) || 0);
  return { ...state, tracking: Boolean(turn), speed, stepping: state.mode === "step", units: canvas.scene?.grid.units || "未知单位", stepLeft: state.mode === "step" ? Math.max(0, 5 * (unit() ?? 0) - state.cost) : 0,
    normalLeft: state.mode === "step" ? 0 : unit() === null ? "—" : Math.max(0, speed * unit() - state.cost) };
}
export async function startStep(token) {
  const document = token.document ?? token;
  if (!document.isOwner) throw new Error("没有棋子的操纵权限。");
  if (!movementCombat(document)) throw new Error("当前棋子需加入已开始的战斗，才能使用五尺快步。");
  if (unit() === null) throw new Error("地图单位需要设为尺、ft或米，才能计算五尺快步。");
  const state = movementState(document);
  if (state.distance > 0 || state.mode === "step") throw new Error("本回合已经移动或使用快步，不能再开始快步。");
  if (state.speed < 5) throw new Error("当前速度不足五尺，不能快步。");
  const next = { turn: turnKey(document), mode: "step", distance: 0, cost: 0, revision: (state.revision ?? 0) + 1 };
  if (!await save(document, next)) throw new Error("战斗轮次已改变，请在当前轮重新选择快步。");
}
export async function resetMovement(token) {
  const document = token.document ?? token;
  if (!document.isOwner || !movementCombat(document)) return false;
  if (!game.user.isGM) throw new Error("战斗中由DM更正移动记录，不能自行恢复快步距离。");
  const next = { turn: turnKey(document), mode: "normal", distance: 0, cost: 0, revision: (movementState(document).revision ?? 0) + 1 };
  return save(document, next);
}
const displacement = movement => movement.passed.waypoints.some(point => CONFIG.Token.movement.actions[point.action]?.teleport);
export function installMovement(refresh) {
  Hooks.on("preMoveToken", (document, movement, operation) => {
    if (!movementCombat(document) || operation.isUndo || operation.threeRForcedMovement || displacement(movement)) return;
    const state = movementState(document);
    if (state.mode !== "step") return;
    const cost = Number(movement.passed.cost) + Number(movement.pending.cost);
    const distance = Number(movement.passed.distance) + Number(movement.pending.distance);
    if (!Number.isFinite(cost) || !Number.isFinite(distance) || cost > state.stepLeft + 1e-6 || distance > 5 * (unit() ?? 0) - state.distance + 1e-6 || cost > distance + 1e-6) {
      ui.notifications.warn("快步只剩五尺内的安全移动；超出距离或地形成本的移动已取消。");
      return false;
    }
  });
  Hooks.on("moveToken", (document, movement, operation, user) => {
    if (!movementCombat(document) || user.id !== game.user.id || !document.isOwner || operation.isUndo || operation.threeRForcedMovement || displacement(movement)) return;
    const distance = Number(movement.passed.distance), cost = Number(movement.passed.cost);
    if (!Number.isFinite(distance) || !Number.isFinite(cost) || distance <= 0) return;
    const before = movementState(document);
    const next = { turn: before.turn, mode: before.mode, distance: before.distance + distance, cost: before.cost + cost, revision: (before.revision ?? 0) + 1 };
    save(document, next).catch(error => ui.notifications.error(`移动记录保存失败：${error.message}`)).finally(refresh);
  });
  Hooks.on("updateToken", (document, change) => {
    const prefix = `flags.${MODULE_ID}.movement`;
    if (!change.flags?.[MODULE_ID]?.movement && !Object.keys(change).some(key => key === prefix || key.startsWith(`${prefix}.`))) return;
    const incoming = document.getFlag(MODULE_ID, "movement");
    const cached = live.get(document.uuid);
    if (incoming && (!cached || incoming.turn === cached.turn && (incoming.revision ?? 0) >= (cached.revision ?? 0))) live.delete(document.uuid);
  });
  Hooks.on("updateCombat", refresh);
  Hooks.on("deleteCombat", () => { live.clear(); refresh(); });
  Hooks.on("createCombatant", refresh);
  Hooks.on("deleteCombatant", refresh);
  Hooks.on("canvasTearDown", () => live.clear());
}
