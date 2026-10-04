import { MODULE_ID, clockLabel, durationLabel, nativeBuffSeconds, nativeEffectTimer, remaining } from "./time.mjs";
import { weatherSummary } from "./calendar-weather.js";
import { conditionPresentation, nativeConditionPresentation } from "./condition-presentation.js";

let timeStrip;
let effectPanel;
let effectCard;
let effectEntries = new Map();
let activeEffectKey = null;
let activeActorUuid = null;
let cardPinned = false;
let cardRequest = 0;
let cardCloseTimer;
let panelRender = 0;
let openTimelineWindow;
let openCalendarWindow;

function selectedActor() {
  const actor = canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!actor) return null;
  if (!game.user.isGM && !actor.testUserPermission(game.user, "OBSERVER")) return null;
  return actor;
}

function shortTime(seconds) {
  if (seconds == null) return "∞";
  if (seconds <= 0) return "0";
  if (seconds >= 86400) return `${Math.ceil(seconds / 86400)}天`;
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}时`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}分`;
  return `${Math.ceil(seconds)}秒`;
}

function visibleEffects(actor) {
  const now = game.time.worldTime;
  const result = [];
  const buffUuids = new Set();
  const representedStatuses = new Set();
  effectEntries = new Map();
  for (const item of actor.items) {
    if (item.type !== "buff" || !item.system?.active) continue;
    buffUuids.add(item.uuid);
    const t = item.getFlag(MODULE_ID, "timer");
    const seconds = t ? remaining(t, now) : nativeBuffSeconds(item);
    const condition=conditionPresentation(item);
    if(condition&&(seconds==null||seconds>0))for(const id of condition.ids)representedStatuses.add(id);
    const row = { key: item.uuid, name: condition?.name??item.name, img: condition?.img??item.img, kind: condition?"状态":"增益",
      time: seconds == null ? "未记录结束时间" : durationLabel(seconds), badge: seconds == null ? "—" : shortTime(seconds) };
    result.push(row);
    effectEntries.set(row.key, { row, document: item, actor, condition });
  }
  for (const effect of actor.effects) {
    if (effect.disabled || effect.isSuppressed || buffUuids.has(effect.origin)) continue;
    const statuses=[...(effect.statuses??[])];
    if(!statuses.length&&effect.getFlag("core","statusId"))statuses.push(effect.getFlag("core","statusId"));
    // Hide only duplicate native icon markers, not foreign effects carrying changes.
    if(effect.getFlag("D35E","show")!==undefined&&!effect.changes?.length&&statuses.length
      &&statuses.every(id=>representedStatuses.has(id)))continue;
    // Old automatic cast markers remain available in the timeline, but are not
    // buffs. Only hide this module's empty markers, never native/other effects.
    if (effect.getFlag(MODULE_ID, "autoSpell") && !effect.changes?.length
      && !effect.statuses?.size && !effect.origin) continue;
    for (const status of statuses) representedStatuses.add(status);
    const t = effect.getFlag(MODULE_ID, "timer") ?? nativeEffectTimer(effect);
    const seconds = t ? remaining(t, now) : null;
    const condition=conditionPresentation(effect);
    const row = { key: effect.uuid, name: condition?.name??effect.name, img: condition?.img??effect.img, kind: condition?"状态":"效果",
      time: seconds == null ? "未记录结束时间" : durationLabel(seconds), badge: seconds == null ? "—" : shortTime(seconds) };
    result.push(row);
    effectEntries.set(row.key, { row, document: effect, actor, condition });
  }
  for (const [statusId, active] of Object.entries(actor.system?.attributes?.conditions ?? {})) {
    if (!active || representedStatuses.has(statusId)) continue;
    const status = CONFIG.statusEffects?.find(entry => entry.id === statusId);
    if (!status) continue;
    const row = { key: `status:${statusId}`, name: game.i18n.localize(status.name ?? status.label ?? statusId),
      img: status.img ?? status.icon ?? "icons/svg/aura.svg", kind: "状态", time: "未记录结束时间", badge: "—" };
    result.push(row);
    effectEntries.set(row.key, { row, status, actor, condition:nativeConditionPresentation(statusId) });
  }
  return result;
}

function cancelCardClose() {
  clearTimeout(cardCloseTimer);
  cardCloseTimer = null;
}

function closeEffectCard() {
  cancelCardClose();
  cardRequest++;
  activeEffectKey = null;
  cardPinned = false;
  if (effectCard) effectCard.hidden = true;
}

function scheduleCardClose() {
  if (cardPinned) return;
  cancelCardClose();
  cardCloseTimer = setTimeout(closeEffectCard, 220);
}

function ensureEffectCard() {
  if (effectCard?.isConnected) return effectCard;
  effectCard = document.createElement("aside");
  effectCard.id = "dwt-effect-card";
  effectCard.hidden = true;
  effectCard.setAttribute("role", "dialog");
  effectCard.setAttribute("aria-label", "效果详情");
  effectCard.addEventListener("pointerenter", cancelCardClose);
  effectCard.addEventListener("pointerleave", scheduleCardClose);
  effectCard.addEventListener("click", event => {
    const action = event.target.closest("[data-dwt-card-action]")?.dataset.dwtCardAction;
    if (action === "close") closeEffectCard();
    if (action === "time" && game.user.isGM) openTimelineWindow?.();
    if (action === "edit") effectEntries.get(activeEffectKey)?.document?.sheet?.render(true);
    if(action==="condition") {
      const entry=effectEntries.get(activeEffectKey);
      game.modules.get("samson-3r-automation")?.api?.openConditions?.(entry?.actor,entry?.condition?.ids?.[0]).catch(console.error);
    }
  });
  document.body.append(effectCard);
  return effectCard;
}

function positionEffectCard(button) {
  if (!button?.isConnected || !effectCard || effectCard.hidden) return;
  const anchor = button.getBoundingClientRect();
  const width = effectCard.offsetWidth;
  const height = effectCard.offsetHeight;
  const left = anchor.left >= width + 20 ? anchor.left - width - 12 : anchor.right + 12;
  effectCard.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, left))}px`;
  effectCard.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, anchor.top))}px`;
}

async function effectCardData(entry) {
  const { row, actor, status } = entry;
  const doc = entry.document;
  const condition=entry.condition;
  let source = null;
  const sourceUuid=doc?.getFlag(MODULE_ID, "sourceItemUuid")??(condition?doc?.getFlag("samson-3r-automation","sourceItemUuid"):null);
  if (sourceUuid) {
    source = await fromUuid(sourceUuid).catch(() => null);
  }
  source ??= doc?.documentName === "Item" ? doc : null;
  if (!source && doc?.origin) source = await fromUuid(doc.origin).catch(() => null);
  if (source?.parent?.documentName === "Actor" &&
    !source.testUserPermission(game.user, "OBSERVER")) source = null;

  let raw = "";
  if(condition)raw=condition.description;
  else if (source?.type === "spell" && source.getChatDescription) {
    try { raw = await source.getChatDescription(); }
    catch (error) {
      console.warn(`${MODULE_ID}: spell detail unavailable`, source.uuid, error);
      raw = source.system?.shortDescription ?? source.system?.description?.value ?? "";
    }
  }
  else if (source?.getDescription) raw = await source.getDescription(source.showUnidentifiedData);
  else raw = source?.system?.description?.value ?? doc?.description ?? status?.description ?? "";
  raw=String(raw).replace(/<section\b[^>]*\bdata-3r-bonuses\b[^>]*>[\s\S]*?<\/section>/gi,"");
  const description = raw ? await foundry.applications.ux.TextEditor.enrichHTML(String(raw), {
    relativeTo: condition?doc??actor:source??doc, secrets: game.user.isGM || actor.testUserPermission(game.user, "OWNER"),
    rollData: source?.getActorItemRollData?.() ?? actor.getRollData?.()
  }) : "";
  return { name: row.name, actorName: actor.name,
    sourceName: condition?(source?.type==="spell"?source.name:condition.sourceName??""):
      source?.name !== row.name ? source?.name ?? "" : "", kind: row.kind,
    time: row.time, description, hasDescription: !!description,
    canCondition:!!condition&&actor.isOwner&&typeof game.modules.get("samson-3r-automation")?.api?.openConditions==="function",
    canEdit: !!doc && (game.user.isGM || doc.testUserPermission(game.user, "OWNER")),
    canRemove: game.user.isGM && !!doc, canAdjustTime: game.user.isGM && !!doc };
}

async function openEffectCard(button, { pin = false } = {}) {
  const key = button?.dataset.dwtKey;
  const entry = effectEntries.get(key);
  if (!entry) return;
  if (cardPinned && !pin && activeEffectKey !== key) return;
  const keepPinned = cardPinned && activeEffectKey === key;
  cancelCardClose();
  activeEffectKey = key;
  cardPinned = pin || keepPinned;
  const request = ++cardRequest;
  const card = ensureEffectCard();
  card.innerHTML = "<div class=\"dwt-effect-loading\">正在读取效果说明…</div>";
  card.hidden = false;
  positionEffectCard(button);
  try {
    const data = await effectCardData(entry);
    if (request !== cardRequest || activeEffectKey !== key) return;
    card.innerHTML = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/effect-card.hbs`, data
    );
    positionEffectCard(button);
  } catch (error) {
    if (request !== cardRequest) return;
    console.error(`${MODULE_ID}: could not show effect details`, error);
    card.textContent = "效果说明暂时无法读取。";
  }
}

async function removeEffect(key) {
  if (!game.user.isGM) return;
  const entry = effectEntries.get(key);
  const doc = entry?.document;
  if (!doc) return;
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "移除效果" },
    content: `<p>确定移除「${foundry.utils.escapeHTML(entry.row.name)}」吗？</p>`
  });
  if (!confirmed) return;
  const marker=doc.getFlag("samson-3r-automation","conditionMarker");
  if(marker&&game.modules.get("samson-3r-automation")?.api?.clearCondition)await game.modules.get("samson-3r-automation").api.clearCondition(entry.actor,marker);
  else if (doc.documentName === "Item" && doc.type === "buff") await doc.update({ "system.active": false });
  else if (doc.documentName === "ActiveEffect") await doc.delete();
  closeEffectCard();
}

function ensureTimeStrip() {
  const content = document.querySelector("#sidebar-content");
  if (!content) return null;
  if (timeStrip?.isConnected && timeStrip.parentElement === content) return timeStrip;
  timeStrip = document.createElement("section");
  timeStrip.id = "dwt-time-strip";
  timeStrip.innerHTML = `
    <div class="dwt-time-heading"><span><i class="fa-solid fa-clock"></i> 世界时间</span>
      <div><button type="button" data-dwt-action="calendar" title="打开月历和天气"><i class="fa-solid fa-calendar-days"></i> 日历</button>
      <button type="button" data-dwt-action="open" title="打开可拖动的详细时间轴"><i class="fa-solid fa-up-right-from-square"></i> 时间轴</button></div></div>
    <strong class="dwt-time-value"></strong>
    <div class="dwt-time-weather"><i class="fa-solid fa-cloud" aria-hidden="true"></i><span></span></div>
    <div class="dwt-time-gm">
      <button type="button" data-dwt-action="advance" data-seconds="60">+1分钟</button>
      <button type="button" data-dwt-action="advance" data-seconds="600">+10分钟</button>
      <button type="button" data-dwt-action="advance" data-seconds="3600">+1小时</button>
    </div>`;
  timeStrip.querySelector(".dwt-time-gm").hidden = !game.user.isGM;
  timeStrip.addEventListener("click", async event => {
    const button = event.target.closest("[data-dwt-action]");
    if (!button) return;
    if (button.dataset.dwtAction === "open") return openTimelineWindow?.();
    if (button.dataset.dwtAction === "calendar") return openCalendarWindow?.();
    if (button.dataset.dwtAction !== "advance" || !game.user.isGM) return;
    const seconds = Number(button.dataset.seconds);
    if (Number.isSafeInteger(seconds) && seconds > 0) await game.time.advance(seconds);
  });
  content.prepend(timeStrip);
  return timeStrip;
}

function updateTimeStrip() {
  const strip = ensureTimeStrip();
  if (!strip) return;
  strip.querySelector(".dwt-time-value").textContent = clockLabel(game.time.worldTime, game.time.calendar);
  const weather = weatherSummary();
  strip.querySelector(".dwt-time-weather span").textContent = `${weather.name}${weather.temperature ? ` · ${weather.temperature}` : ""}`;
  strip.querySelector(".dwt-time-weather i").className = `fa-solid ${weather.icon}`;
}

function ensureEffectPanel() {
  const column = document.querySelector("#ui-right-column-1") ?? document.querySelector("#ui-top");
  if (!column) return null;
  if (effectPanel?.isConnected && effectPanel.parentElement === column) return effectPanel;
  effectPanel = document.createElement("section");
  effectPanel.id = "dwt-effects-panel";
  effectPanel.setAttribute("aria-label", "所选角色的效果");
  effectPanel.addEventListener("pointerover", event => {
    const button = event.target.closest("[data-dwt-key]");
    if (button && !button.contains(event.relatedTarget)) openEffectCard(button).catch(console.error);
  });
  effectPanel.addEventListener("pointerout", event => {
    const button = event.target.closest("[data-dwt-key]");
    if (button && !button.contains(event.relatedTarget)) scheduleCardClose();
  });
  effectPanel.addEventListener("focusin", event => {
    const button = event.target.closest("[data-dwt-key]");
    if (button) openEffectCard(button).catch(console.error);
  });
  effectPanel.addEventListener("focusout", scheduleCardClose);
  effectPanel.addEventListener("click", event => {
    const button = event.target.closest("[data-dwt-key]");
    if (!button) return;
    if (cardPinned && activeEffectKey === button.dataset.dwtKey) closeEffectCard();
    else openEffectCard(button, { pin: true }).catch(console.error);
  });
  effectPanel.addEventListener("contextmenu", event => {
    const button = event.target.closest("[data-dwt-key]");
    if (!button || !game.user.isGM || !effectEntries.get(button.dataset.dwtKey)?.document) return;
    event.preventDefault();
    removeEffect(button.dataset.dwtKey).catch(console.error);
  });
  document.addEventListener("pointerdown", event => {
    if (effectCard?.contains(event.target) || effectPanel?.contains(event.target)) return;
    closeEffectCard();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && activeEffectKey) closeEffectCard();
  });
  column.append(effectPanel);
  return effectPanel;
}

async function updateEffectPanel() {
  const renderId = ++panelRender;
  const panel = ensureEffectPanel();
  if (!panel) return;
  const actor = selectedActor();
  if (!actor) { panel.hidden = true; activeActorUuid = null; closeEffectCard(); return; }
  if (actor.uuid !== activeActorUuid) closeEffectCard();
  activeActorUuid = actor.uuid;
  const effects = visibleEffects(actor);
  panel.hidden = effects.length === 0;
  if (panel.hidden) { closeEffectCard(); return; }
  const html = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/effects-panel.hbs`, { actorName: actor.name, effects }
  );
  if (renderId !== panelRender) return;
  panel.innerHTML = html;
  if (activeEffectKey && !effectEntries.has(activeEffectKey)) closeEffectCard();
  else if (activeEffectKey) {
    const button = [...panel.querySelectorAll("[data-dwt-key]")].find(el => el.dataset.dwtKey === activeEffectKey);
    if (button) openEffectCard(button, { pin: cardPinned }).catch(console.error);
  }
}

export function initSurface({ openTimeline, openCalendar }) {
  openTimelineWindow = openTimeline;
  openCalendarWindow = openCalendar;
  updateTimeStrip();
  updateEffectPanel().catch(console.error);
  const refreshEffects = foundry.utils.debounce(() => {
    updateEffectPanel().catch(console.error);
    if (ui.combat?.rendered) ui.combat.render({ parts: ["tracker"] }).catch(console.error);
  }, 80);
  for (const hook of ["controlToken", "canvasReady", "createItem", "updateItem", "deleteItem",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateActor", "updateWorldTime"]) {
    Hooks.on(hook, refreshEffects);
  }
  Hooks.on("updateWorldTime", updateTimeStrip);
  Hooks.on("updateScene", updateTimeStrip);
  Hooks.on("canvasReady", updateTimeStrip);
  Hooks.on("renderSidebar", updateTimeStrip);
}
