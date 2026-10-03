import { MODULE_ID } from "./time.mjs";

const executing = new Set();
const pending = new Map();
const processed = new Set();
let requestQueue = Promise.resolve();
let clockQueue = Promise.resolve();
const queueRest = (...args) => {
  const result = clockQueue.catch(() => {}).then(() => restWithClock(...args));
  clockQueue = result;
  return result;
};
const channel = `module.${MODULE_ID}`;
const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

async function nativeRest(actor, rest, args) {
  const updates = [];
  // Empty-target view preserves native private receivers and captures the un-awaited final update.
  const view = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "update") return (...values) => {
        const promise = actor.update(...values); updates.push(promise); return promise;
      };
      const value = Reflect.get(actor, property, actor);
      return typeof value === "function" && property !== "constructor" ? value.bind(actor) : value;
    },
    getPrototypeOf() { return Reflect.getPrototypeOf(actor); }
  });
  const result = await rest.call(view, ...args);
  await Promise.all(updates);
  return result;
}

async function restWithClock(actor, health, daily, care, invoke, requester = null) {
  if (!game.user.isGM) throw new Error("世界时间由DM控制。");
  const previous = game.settings.get(MODULE_ID, "lastRest");
  const join = previous?.id && previous.mode !== "recover" && Array.isArray(previous.actors) && Math.abs(game.time.worldTime - previous.end) < 1 && !previous.actors.includes(actor.uuid);
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `${actor.name}：休息与世界时间` }, rejectClose: false,
    content: `<p>${requester ? `${escape(requester.name)}请求` : ""}${escape(actor.name)}休息。</p><p>生命恢复：${health ? "是" : "否"}；每日能力恢复：${daily ? "是" : "否"}；长期照料：${care ? "是" : "否"}。</p><p>同一队伍休息时，先推进一次8小时，其他角色选择同次休息，避免每人再推进8小时。</p>`,
    buttons: [
      { action: "new", label: "新休息：推进8小时", callback: () => "new" },
      ...(join ? [{ action: "join", label: "加入同次休息：不重复推进", callback: () => "join" }] : []),
      { action: "recover", label: "仅恢复：时间已由DM处理", callback: () => "recover" }
    ]
  });
  if (!choice) return { completed: false, cancelled: true };
  const start = game.time.worldTime;
  if (choice === "new") await game.time.advance(8 * 3600);
  await game.modules.get(MODULE_ID)?.api?.processExpirations?.();
  await game.modules.get("samson-3r-automation")?.api?.processTime?.();
  executing.add(actor.uuid);
  try {
    await invoke();
    // The adapter awaits native final updates before reporting recovery.
    await actor.refresh({ stopUpdates: false });
    const session = choice === "join" ? { ...previous, actors: [...previous.actors, actor.uuid] }
      : { id: foundry.utils.randomID(), start, end: game.time.worldTime, actors: [actor.uuid], mode: choice };
    await game.settings.set(MODULE_ID, "lastRest", session);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${escape(actor.name)}休息完成：${choice === "new" ? "世界时间推进8小时" : choice === "join" ? "加入队伍同一次8小时休息" : "DM确认仅恢复，不推进时间"}；${daily ? "每日资源与能力已恢复" : "未选择恢复每日资源"}。</p>` });
    return { completed: true, sessionId: session.id };
  } finally { executing.delete(actor.uuid); }
}

export function installRestSync() {
  const rest = CONFIG.Actor.documentClass.prototype.rest;
  CONFIG.Actor.documentClass.prototype.rest = function(health, daily, care, ...args) {
    if (executing.has(this.uuid)) return nativeRest(this, rest, [health, daily, care, ...args]);
    if (!this.testUserPermission(game.user, "OWNER")) throw new Error("没有该角色的休息权限。");
    if (game.users.activeGM?.id === game.user.id) return queueRest(this, health, daily, care, () => nativeRest(this, rest, [health, daily, care, ...args]));
    const gm = game.users.activeGM;
    if (!gm) { ui.notifications.warn("需要在线DM确认休息和世界时间；本次未恢复资源。"); return Promise.resolve({ completed: false }); }
    const id = foundry.utils.randomID();
    ui.notifications.info("已请求DM确认本次休息；确认前不恢复每日资源，也不改变世界时间。");
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ completed: false, requested: true }); ui.notifications.warn("休息等待超时；请先让DM核对或关闭旧请求，再重新申请，避免重复推进时间。"); }, 180000);
      pending.set(id, { resolve, timer, gm: gm.id });
      game.socket.emit(channel, { type: "rest-request", id, sender: game.user.id, gm: gm.id, uuid: this.uuid, health: Boolean(health), daily: Boolean(daily), care: Boolean(care) });
    });
  };
  game.socket.on(channel, data => {
    if (data?.type === "rest-result") {
      const entry = pending.get(data.id);
      if (!entry || data.receiver !== game.user.id || data.gm !== entry.gm) return;
      clearTimeout(entry.timer); pending.delete(data.id);
      entry.resolve({ completed: data.completed === true, remote: true });
      return;
    }
    if (data?.type !== "rest-request" || !game.user.isGM || data.gm !== game.user.id || game.users.activeGM?.id !== game.user.id || processed.has(data.id)) return;
    if (typeof data.id !== "string" || typeof data.uuid !== "string" || typeof data.sender !== "string") return;
    processed.add(data.id);
    if (processed.size > 128) processed.delete(processed.values().next().value);
    requestQueue = requestQueue.catch(() => {}).then(async () => {
      let completed = false;
      try {
        const requester = game.users.get(data.sender), actor = await fromUuid(data.uuid);
        if (!requester?.active || actor?.documentName !== "Actor" || !actor.testUserPermission(requester, "OWNER")) throw new Error("请求角色或操纵权限无效。");
        const result = await queueRest(actor, data.health === true, data.daily === true, data.care === true,
          () => actor.rest(data.health === true, data.daily === true, data.care === true), requester);
        completed = result.completed;
      } catch (error) { ui.notifications.error(`休息未完成：${error.message}`); }
      game.socket.emit(channel, { type: "rest-result", id: data.id, receiver: data.sender, gm: game.user.id, completed });
    });
  });
}
