import { MODULE_ID, ACTIONS } from "./state.js";
import { owned, displayName, itemAvailability, itemActionRoute } from "./model.js";
import { automationApi } from "./integration.js";

const escape = value => String(value).replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export async function postHudAction(actor,token,{label,kind=null,detail="",declared=false,context=null}) {
  const cost=ACTIONS.find(action=>action.id===kind)?.name;
  const name=token?.name??actor.name;
  try { return await ChatMessage.create({
    speaker:ChatMessage.getSpeaker({actor,token:token?.document??token}),
    whisper:[],blind:false,
    content:`<section class="trh-chat-action"><header><strong>${escape(name)}</strong><span>${escape(declared?"动作声明":"操作记录")}</span></header><h3>${escape(label)}</h3>${cost?`<p class="trh-chat-cost">${escape(cost)}${kind==="aao"?"攻击":"动作"}</p>`:""}${detail?`<p>${escape(detail)}</p>`:""}</section>`,
    flags:{[MODULE_ID]:{operation:{label,kind,declared,tokenUuid:token?.document?.uuid,
      combatId:context?.combatId??null,round:context?.round??null}}}
  }); }catch(error) {
    console.error(`${MODULE_ID}: 操作聊天记录发送失败`,error);
    ui.notifications.warn(`“${label}”已经处理，但聊天记录发送失败；请告知DM，不要重复执行。`);
    return null;
  }
}

async function attackForWeapon(actor, weapon) {
  let attacks = actor.items.filter(item => item.type === "attack" && item.system.originalWeaponId === weapon.id);
  if (!attacks.length) {
    // Native creation preserves existing attacks. No weapon properties or equipment state are changed.
    await actor.createAttackFromWeapon(weapon, { deleteExistingAttack: false });
    attacks = actor.items.filter(item => item.type === "attack" && item.system.originalWeaponId === weapon.id);
  }
  if (attacks.length === 1) return attacks[0];
  if (!attacks.length) throw new Error("系统未能为这件武器生成攻击，请在角色卡中检查武器数据。");
  const id = await foundry.applications.api.DialogV2.wait({
    window: { title: "选择攻击方式" },
    content: `<p>${escape(weapon.name)}有多个攻击方式，请选择本次使用的方式。</p>`,
    buttons: attacks.map((item, index) => ({ action: `attack-${index}`, label: escape(item.name), callback: () => item.id })),
    rejectClose: false
  });
  return actor.items.get(id) ?? null;
}

/** Read native results, never replace rolls, resource checks, or action accounting. */
export async function useNative(actor, token, itemId, event, reminderContext, common = null) {
  if (!owned(actor)) throw new Error("你没有操纵这个角色的权限。");
  let item = actor.items.get(itemId);
  if (!item) throw new Error("这个条目已经移除，请重新选择。");
  const route = itemActionRoute(item);
  const availability = itemAvailability(item, actor,route);
  if (availability.reference && route?.mode !== "configure") { await item.sheet.render(true); return { state: "details" }; }
  if(route?.mode==="configure"&&route.available===false){ui.notifications.warn(route.label||"当前不能配置这项能力。");return {state:"blocked"};}
  if (availability.unavailable) { ui.notifications.warn(availability.reason); return { state: "blocked", reason: availability.reason }; }
  if (common === "aao") {
    automationApi()?.checkConditionAction?.(actor,item,{kind:"immediate",common:"aao"});
  }
  if (item.type === "weapon") item = await attackForWeapon(actor, item);
  if (!item) return { state: "cancelled" };
  if (["buff", "aura"].includes(item.type)) {
    const active=!item.system.active;
    await item.update({ "system.active": active });
    return { state: "toggled",label:displayName(item),active };
  }
  const allowedIds = new Set([item.id]);
  if (item.type === "full-attack") {
    for (const value of Object.values(item.system.attacks ?? {})) if (value?.id) allowedIds.add(value.id);
  }
  let actualCard = false;
  let hasChat = false;
  let multipleAttacks = false;
  let fullSelection = null;
  let charging = false;
  let customCompletion = null;
  let customResult = null;
  let customChat = false;
  // D35E custom hooks return early. Await the owning module's work rather than
  // mistaking that early return for cancellation or recording before completion.
  const completionHookId = Hooks.on("D35E.ItemUse.preUseItem", (usedItem, usedActor, hook) => {
    if (usedItem.id === item.id && usedActor?.uuid === actor.uuid && hook.threeRCompletion)
      customCompletion = hook.threeRCompletion;
  });
  const dialogListeners = new AbortController();
  const dialogHookId = Hooks.on("renderDialog", (app, html) => {
    const root = html?.nodeType === 1 ? html : html?.[0];
    if (!root?.querySelector("form.attack-form")) return;
    const matches = Array.from(allowedIds).some(id =>
      app.title === `${game.i18n.localize("D35E.Use")}: ${actor.items.get(id)?.name} - ${actor.name}`);
    if (!matches || item.type === "spell") return;
    const preset = common === "charge" ? "charge" : common === "defensive" ? "defensive" : null;
    if (preset) { const box = root.querySelector(`[name='${preset}']`); if (box) box.checked = true; }
    charging = Boolean(root.querySelector("[name='charge']")?.checked);
    root.addEventListener("change", event => { if (event.target.name === "charge") charging = event.target.checked; }, { signal: dialogListeners.signal });
    // Read the actual native choice; multiple projectiles alone do not imply a full-round action.
    fullSelection = app.data?.default === "multi";
    root.addEventListener("click", event => {
      const button = event.target.closest("button[data-button]");
      if (button) charging = Boolean(root.querySelector("[name='charge']")?.checked);
      if (button?.dataset.button === "multi") fullSelection = true;
      else if (button?.dataset.button === "normal") fullSelection = false;
    }, { capture: true, signal: dialogListeners.signal });
  });
  // The description-only full-attack card cannot count as executing an attack.
  const hookId = Hooks.on("createChatMessage", message => {
    const data = message.flags?.D35E?.chatTemplateData;
    const template = message.flags?.D35E?.template ?? "";
    if ((message.author?.id ?? message.user?.id ?? message.user) !== game.user.id) return;
    if (customCompletion && message.speaker?.actor === actor.id
      && (!token || !message.speaker.token || message.speaker.token === token.id)) {
      customChat = true; hasChat = true;
    }
    if (data?.actor?.id !== actor.id || !allowedIds.has(data?.item?.id)) return;
    const tokenId = data.tokenId?.split(".").at(-1) ?? message.speaker?.token;
    if (token && tokenId && tokenId !== token.id) return;
    hasChat = true;
    if (!/\/attack-roll\.html$|\/spell-failure-card\.html$/.test(template)) return;
    actualCard = true;
    if (data.attacks?.length > 1) multipleAttacks = true;
  });
  const before = Number(item.charges);
  let result;
  let rolled;
  try {
    result = await item.use({ ev: event, skipDialog: false });
    if (result?.roll) rolled = await result.roll;
    if (customCompletion) customResult = await customCompletion;
  } finally {
    Hooks.off("createChatMessage", hookId);
    Hooks.off("renderDialog", dialogHookId);
    Hooks.off("D35E.ItemUse.preUseItem", completionHookId);
    dialogListeners.abort();
  }
  const after = Number(actor.items.get(item.id)?.charges);
  // The GM receipt is authoritative for martial actions, including ending a
  // stance (which has no charge change). A waiting chat card is not execution.
  if(item.flags?.["samson-3r-automation"]?.martial&&customCompletion){
    if(customResult?.state!=="performed")return {state:customResult?.state==="cancelled"?"cancelled":"pending",reason:customResult?.reason};
    return {state:"performed",kind:customResult.kind??route?.kind,label:displayName(item),hasChat};
  }
  const resourceUsed = Number.isFinite(before) && Number.isFinite(after) && after < before;
  const performed = actualCard || rolled?.rolled === true || result === true || result?.documentName === "ChatMessage" || resourceUsed || customChat;
  if (route?.mode === "configure") return { state: "handled" };
  if (!performed && customCompletion && route && !route.kind) return { state: "handled" };
  if (!performed) return { state: result?.wasRolled === false || result?.roll === false ? "cancelled" : "unknown" };

  let kind = item.type === "full-attack" || fullSelection === true ? "full" : route?.kind ?? item.system.activation?.type;
  if (charging) kind = "full";
  if (common === "aao") kind = "immediate";
  if (multipleAttacks && fullSelection === null && item.type !== "spell" && item.type !== "full-attack" && common !== "aao") kind = null;
  if (kind === "attack") kind = reminderContext.offTurn ? "immediate" : "standard";
  if (kind === "round") kind = "full";
  if (kind === "aao") kind = "immediate";
  if (!["standard", "move", "swift", "immediate", "full", "free"].includes(kind)) kind = null;
  return { state: "performed", kind, label: displayName(item),hasChat };
}

export function reportError(error) {
  console.error(`${MODULE_ID}: HUD操作失败`, error);
  ui.notifications.error(`HUD操作失败：${error.message}`);
}
