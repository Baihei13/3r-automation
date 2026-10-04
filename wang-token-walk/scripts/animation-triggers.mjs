import { getActorAnimation, getItemAnimation } from "./animation-data.mjs";
import { playTokenAnimation, releaseHeldAnimation } from "./walk-engine.mjs";

const MODULE_ID = "wang-token-walk";
const HP = new Map();
const LAST_USE = new Map();
const PLAYED_CASTS = new Set();
const CAST_CONTEXTS = [];
let castAdapterInstalled = false;

function hpValue(actor) {
  const path = game.settings.get(MODULE_ID, "hpPath");
  if (typeof path !== "string" || !path.trim()) return null;
  const raw = foundry.utils.getProperty?.(actor, path.trim());
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function activeTokens(actor) {
  if (!actor || !canvas?.ready) return [];
  return (canvas.tokens?.placeables || []).filter((token) =>
    token.actor && (token.actor === actor || token.actor.uuid === actor.uuid));
}

function seedHp() {
  HP.clear();
  LAST_USE.clear();
  PLAYED_CASTS.clear();
  for (const token of canvas.tokens?.placeables || []) {
    const value = hpValue(token.actor);
    if (value !== null) HP.set(token.id, value);
  }
}

function safePlay(token, animation, options) {
  if (!animation) return;
  playTokenAnimation(token, animation, options).catch((error) =>
    console.warn(`${MODULE_ID} | animation`, error));
}

function checkHp(token, previous = HP.get(token.id)) {
  const current = hpValue(token.actor);
  if (current === null) return;
  HP.set(token.id, current);
  if (previous === undefined || previous === null || previous === current) return;
  if (previous > 0 && current <= 0) {
    safePlay(token, getActorAnimation(token.actor, "death"), { kind: "death", holdLast: true });
  } else if (current < previous && current > 0) {
    safePlay(token, getActorAnimation(token.actor, "hit"), { kind: "hit" });
  } else if (previous <= 0 && current > 0) {
    releaseHeldAnimation(token);
  }
}

function messageKind(message) {
  if (message.flags?.[MODULE_ID]?.castEvent) return "onCast";
  const context = message.flags?.pf2e?.context || {};
  const type = String(context.type || message.flags?.dnd5e?.roll?.type ||
    message.rolls?.[0]?.options?.type || "");
  if (type === "damage-roll" || /damage/i.test(type)) return "onDamage";
  if (/attack/i.test(type)) return context.outcome === "criticalSuccess" ||
    message.rolls?.[0]?.isCritical || message.flags?.dnd5e?.roll?.isCritical ? "onCrit" : "onAttack";
  return "onUse";
}

async function resolveMessageItem(message) {
  const direct = message.item;
  if (direct?.documentName === "Item") return direct;
  const flags = message.flags || {};
  const native = flags.D35E?.chatTemplateData;
  if (native?.item?.id) {
    const speaker = message.speaker || {};
    const actor = speaker.scene && speaker.token
      ? game.scenes?.get(speaker.scene)?.tokens.get(speaker.token)?.actor
      : game.actors?.get(speaker.actor || native.actor?.id);
    const item = actor?.items?.get(native.item.id);
    if (item) return item;
  }
  const uuid = flags[MODULE_ID]?.castEvent?.itemUuid || flags.pf2e?.origin?.uuid || flags.dnd5e?.item?.uuid ||
    flags.dnd5e?.origin?.uuid || flags.core?.sourceId;
  if (!uuid) return direct?.documentName === "Item" ? direct : null;
  try {
    const document = await fromUuid(uuid);
    return document?.documentName === "Item" ? document : null;
  } catch (error) {
    console.warn(`${MODULE_ID} | resolve item`, error);
    return null;
  }
}

function messageToken(message, item) {
  if (!canvas?.ready) return null;
  const speaker = message.speaker || {};
  if (speaker.scene && speaker.scene !== canvas.scene?.id) return null;
  if (speaker.token) return canvas.tokens?.get(speaker.token) || null;
  const actor = item?.actor || game.actors?.get?.(speaker.actor);
  const matches = activeTokens(actor);
  return matches.length === 1 ? matches[0] : null;
}

function matchesTrigger(animation, kind) {
  return animation && (animation.trigger === "onUse" || animation.trigger === kind ||
    (animation.trigger === "onAttack" && kind === "onCrit"));
}

function configuredAttack(token, item, kind = "onAttack") {
  const specific = getItemAnimation(item);
  if (matchesTrigger(specific, kind)) return specific;
  if (item?.type === "spell") return null;
  return getActorAnimation(token.actor, "attack");
}

function configuredCast(token, item) {
  const specific = getItemAnimation(item);
  if (matchesTrigger(specific, "onCast") || (item?.hasAttack && matchesTrigger(specific, "onAttack"))) return specific;
  return getActorAnimation(token.actor, "cast");
}

export async function playCast({ token = null, actor = null, item = null } = {}) {
  const matches = token ? [token] : activeTokens(actor || item?.actor);
  const target = matches.length === 1 ? matches[0] : null;
  if (!target) return false;
  const animation = configuredCast(target, item);
  return animation ? playTokenAnimation(target, animation, { kind: "action" }) : false;
}

export async function playAttack({ token = null, actor = null, item = null } = {}) {
  const matches = token ? [token] : activeTokens(actor || item?.actor);
  const target = matches.length === 1 ? matches[0] : null;
  if (!target) return false;
  const animation = configuredAttack(target, item);
  return animation ? playTokenAnimation(target, animation, { kind: "action" }) : false;
}

async function onMessage(message) {
  if (message.flags?.["samson-3r-automation"]?.cast?.derivedTarget) return;
  const item = await resolveMessageItem(message);
  const kind = messageKind(message);
  const token = messageToken(message, item);
  if (!token || (item?.actor && token.actor?.id !== item.actor.id)) return;
  // D35E posts spell descriptions before its actual action card, and also
  // when merely viewing rules. Neither should play an item onUse animation.
  if (item?.type === "spell" && message.flags?.D35E && kind === "onUse") return;
  if (kind === "onCast") {
    const cast = message.flags[MODULE_ID].castEvent;
    const key = `${token.id}:${cast.id}`;
    if (PLAYED_CASTS.has(key)) return;
    const animation = configuredCast(token, item);
    if (!animation) return;
    PLAYED_CASTS.add(key);
    if (PLAYED_CASTS.size > 512) PLAYED_CASTS.delete(PLAYED_CASTS.values().next().value);
    safePlay(token, animation, { kind: "action" });
    return;
  }
  const specific = getItemAnimation(item);
  const animation = matchesTrigger(specific, kind) ? specific
    : (["onAttack", "onCrit"].includes(kind) && item?.type !== "spell" ? getActorAnimation(token.actor, "attack") : null);
  if (!animation) return;
  if (animation.trigger === "onUse") {
    const key = `${token.id}:${item?.uuid || message.id}`;
    const now = performance.now();
    if (now - (LAST_USE.get(key) ?? -Infinity) < 2000) return;
    LAST_USE.set(key, now);
    if (LAST_USE.size > 512) LAST_USE.delete(LAST_USE.keys().next().value);
  }
  safePlay(token, animation, { kind: "action" });
}

async function installD35ECastAdapter() {
  if (castAdapterInstalled || String(game.system.id).toLowerCase() !== "d35e") return;
  // Wrap the installed public ItemUse method, preserving existing wrappers.
  // Its context lasts only for the actual native use, never for item.roll()
  // invoked separately to post a rules description. No system file is edited.
  const path = `systems/${game.system.id}/module/item/extensions/use.js`;
  const route = foundry.utils.getRoute?.(path) || `/${path}`;
  const { ItemUse } = await import(route);
  const original = ItemUse.prototype.useSpell;
  if (typeof original !== "function") throw new Error("D35E没有可用的原生施法入口，通用施法动画未接入。");
  ItemUse.prototype.useSpell = async function(event, options = {}, actor = null) {
    const item = options.replacementItem || this.item;
    if (!item || !actor) return original.call(this, event, options, actor);
    const context = { id: foundry.utils.randomID(16), item, actor };
    CAST_CONTEXTS.push(context);
    try { return await original.call(this, event, options, actor); }
    finally { const index = CAST_CONTEXTS.indexOf(context); if (index >= 0) CAST_CONTEXTS.splice(index, 1); }
  };
  Hooks.on("preCreateChatMessage", message => {
    const data = message.flags?.D35E?.chatTemplateData;
    if (!data?.item?.id || message.flags?.["samson-3r-automation"]?.cast?.derivedTarget) return;
    const speaker = message.speaker || {};
    const actor = speaker.scene && speaker.token
      ? game.scenes?.get(speaker.scene)?.tokens.get(speaker.token)?.actor
      : game.actors?.get(speaker.actor || data.actor?.id);
    const context = [...CAST_CONTEXTS].reverse().find(entry => entry.item.id === data.item.id && entry.actor.uuid === actor?.uuid);
    if (!context) return;
    const template = message.flags.D35E.template;
    const expected = context.item.hasAction ? "attack-roll.html" : "item-card.html";
    if (template !== `systems/D35E/templates/chat/${expected}`) return;
    message.updateSource({ [`flags.${MODULE_ID}.castEvent`]: { id: context.id, itemUuid: context.item.uuid } });
  });
  castAdapterInstalled = true;
}

export async function installAnimationTriggers() {
  Hooks.on("canvasReady", seedHp);
  Hooks.on("createToken", (doc) => {
    const value = hpValue(doc.object?.actor);
    if (value !== null) HP.set(doc.id, value);
  });
  Hooks.on("deleteToken", (doc) => HP.delete(doc.id));
  Hooks.on("updateActor", (actor) => {
    for (const token of activeTokens(actor)) checkHp(token);
  });
  Hooks.on("updateToken", (doc) => {
    if (doc.object?.actor) checkHp(doc.object);
  });
  Hooks.on("createChatMessage", (message) => {
    onMessage(message).catch((error) => console.warn(`${MODULE_ID} | message`, error));
  });
  // D35E exposes its own attack hook. Its chat messages do not consistently
  // carry an item UUID, so this adapter supplies the item directly.
  Hooks.on("D35E.ItemUse.preRollAllAttacks", (item) => {
    if (item?.type === "spell") return; // Actual spell cards use castEvent once.
    playAttack({ item }).catch((error) => console.warn(`${MODULE_ID} | D35E attack`, error));
  });
  try { await installD35ECastAdapter(); }
  catch (error) { console.error(`${MODULE_ID} | casting adapter`, error); ui.notifications.error(`通用施法动画接入失败：${error.message}`); }
  if (canvas?.ready) seedHp();
}
