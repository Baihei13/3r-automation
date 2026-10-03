import { MODULE_ID, timer, remaining, durationLabel, nativeBuffSeconds, nativeEffectTimer, clockLabel } from "./time.mjs";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { Item35E } from "../../../systems/D35E/module/item/entity.js";
import { installCombatTracker } from "./combat-tracker.js";
import { initSurface } from "./surface.js";
import { initCalendarWeather, openCalendarWeather, registerCalendarSettings, loadCalendarDefinition } from "./calendar-weather.js";
import { installRestSync } from "./rest.js";
import { installCombatClock } from "./combat-clock.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
let timelineApp;
let expiryQueue = Promise.resolve();

const SPELL_UNIT_SECONDS = {
  round: 6, rounds: 6, roundPerLevel: 6,
  turn: 60, turns: 60,
  minute: 60, minutes: 60, minutePerLevel: 60,
  hour: 3600, hours: 3600, hourPerLevel: 3600,
  day: 86400, days: 86400
};

function durationFromSpell(item) {
  const structured = item.system?.spellDurationData;
  if (SPELL_UNIT_SECONDS[structured?.units] && String(structured.value ?? "").trim()) return structured;
  // Older and translated spell packs sometimes retain only the system's duration text.
  // Accept simple, unambiguous phrases only; never guess from a spell description.
  const raw = String(item.system?.spellDuration ?? "").trim()
    .replace(/\s*\(\s*d\s*\)\s*$/i, "").replace(/\s+/g, " ");
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(轮|回合|rounds?|分钟|min\.?|minutes?|小时|hours?|天|days?)\s*(?:\/\s*(等级|施法者等级|level)|每(?:施法者)?等级)?$/i);
  if (!match) return null;
  const unitText = match[2].toLowerCase();
  const unit = /^(轮|回合|round)/.test(unitText) ? "round" :
    /^(分钟|min)/.test(unitText) ? "minute" :
    /^(小时|hour)/.test(unitText) ? "hour" : "day";
  const perLevel = !!match[3] || /每(?:施法者)?等级$/.test(raw);
  return { units: perLevel && unit !== "day" ? `${unit}PerLevel` : unit,
    value: perLevel ? `${match[1]}*@cl` : match[1] };
}

function casterFromMessage(message, data) {
  const scene = game.scenes.get(message.speaker?.scene);
  const tokenActor = scene?.tokens?.get(message.speaker?.token)?.actor;
  if (tokenActor) return tokenActor;
  return game.actors.get(data.actor?.id ?? message.speaker?.actor);
}

function spellSeconds(item, actor, chatData) {
  const duration = durationFromSpell(item);
  const multiplier = SPELL_UNIT_SECONDS[duration?.units];
  if (!multiplier) return null; // Instant, permanent, special, see-text and calendar months/years need a human decision.
  const formula = String(duration.value ?? "").trim();
  if (!formula) return null;
  const perLevel = /PerLevel$/.test(duration.units);
  const book = actor.system?.attributes?.spells?.spellbooks?.[item.system?.spellbook];
  const actualCL = Number(chatData.cl);
  const bookCL = Number(book?.cl?.total) + Number(item.system?.clOffset ?? 0);
  const cl = Number.isFinite(actualCL) && actualCL > 0 ? actualCL : bookCL;
  if ((perLevel || formula.includes("@cl")) && (!Number.isFinite(cl) || cl <= 0)) return null;
  const rollData = foundry.utils.deepClone(actor.getRollData());
  rollData.item = item.system;
  if (Number.isFinite(cl) && cl > 0) rollData.cl = cl;
  let roll;
  try { roll = Roll35e.safeEvaluate(formula, rollData, null, { suppressError: true }); }
  catch (_) { return null; }
  if (roll.err || roll.warning || !Number.isFinite(roll.total) || roll.total <= 0) return null;
  const units = roll.total * (perLevel && !formula.includes("@cl") ? cl : 1);
  const seconds = Math.ceil(units * multiplier);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 10 * 365 * 86400 ? seconds : null;
}

async function trackCastSpell(message) {
  if (!isProcessingGM()) return;
  const template = message.flags?.D35E?.template;
  const data = message.flags?.D35E?.chatTemplateData;
  if (!data?.isSpell) return;
  const actionCard = template === "systems/D35E/templates/chat/attack-roll.html";
  const itemCard = template === "systems/D35E/templates/chat/item-card.html";
  if (!actionCard && !itemCard) return;
  const actor = casterFromMessage(message, data);
  const item = actor?.items?.get(data.item?.id);
  if (!actor || item?.type !== "spell") return;
  // Native targeted buff commands run when the chat button is clicked. Their
  // activated Item owns the duration; casting alone is not an applied effect.
  const nativeBuffAction = (item.system.specialActions ?? []).some(action =>
    typeof action.action === "string" && Item35E.parseAction(action.action).some(command =>
      command.action === "Activate" && command.parameters?.[0] === "buff"));
  if (nativeBuffAction) return;
  if (game.modules.get("samson-3r-automation")?.active) {
    const cast=message.getFlag("samson-3r-automation","cast");
    if (!cast?.actual || cast.automated) return;
  }
  if (data.spellFailureSuccess === false && game.settings.get("D35E", "fizzleSpellOnArcaneFailure")) return;
  if (itemCard && item.hasAction) return; // Its cast also posts an attack card; avoid a duplicate timer.
  if (actor.effects.some(effect => effect.getFlag(MODULE_ID, "sourceMessageId") === message.id)) return;
  let seconds = spellSeconds(item, actor, data);
  if(message.getFlag("samson-3r-automation","cast")?.extendSelf && seconds && !/^\s*(永久|permanent|专注|concentration)/i.test(item.system.spellDuration??""))seconds*=2;
  if (!seconds) return;
  const targetNames = (data.targets ?? []).map(target => target.name).filter(Boolean).join("、");
  const label = targetNames ? `${item.name}（目标：${targetNames}）` : item.name;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: `⏱ ${label}`,
    img: item.img,
    changes: [],
    flags: { [MODULE_ID]: {
      timer: timer(game.time.worldTime, seconds),
      autoSpell: true,
      sourceItemUuid: item.uuid,
      sourceMessageId: message.id
    } }
  }]);
  timelineApp?.render();
}

function isProcessingGM() {
  return game.user.isGM && (!game.users.activeGM || game.users.activeGM.id === game.user.id);
}

function accessibleActors() {
  const actors = new Map();
  const add = actor => {
    if (!actor || (!game.user.isGM && !actor.testUserPermission(game.user, "OBSERVER"))) return;
    actors.set(actor.uuid, actor);
  };
  for (const actor of game.actors.contents) add(actor);
  // Include unlinked token actors on the viewed scene, which are not in game.actors.
  for (const token of canvas?.scene?.tokens?.contents ?? []) add(token.actor);
  return [...actors.values()];
}

function entries() {
  const result = [];
  const now = game.time.worldTime;
  for (const actor of accessibleActors()) {
    for (const item of actor.items) {
      if (item.type !== "buff" || !item.system?.active) continue;
      const ownTimer = item.getFlag(MODULE_ID, "timer");
      const native = nativeBuffSeconds(item);
      const t = ownTimer ?? null;
      result.push({ actor, doc: item, kind: "buff", timer: t, native,
        note: t ? "世界时间" : native ? "3R 战斗轮；可开始世界时间追踪" : "未设置时长" });
    }
    for (const effect of actor.effects) {
      if (effect.disabled || effect.isSuppressed) continue;
      const ownTimer = effect.getFlag(MODULE_ID, "timer");
      const native = nativeEffectTimer(effect);
      const t = ownTimer ?? native;
      result.push({ actor, doc: effect, kind: "effect", timer: t, native: null,
        note: effect.getFlag(MODULE_ID, "autoSpell") ? "系统法术时长 · 仅计时" :
          ownTimer ? "世界时间" : native ? "Active Effect 时长" : "未设置时长" });
    }
  }
  result.sort((a, b) => (a.timer?.end ?? Infinity) - (b.timer?.end ?? Infinity)
    || a.actor.name.localeCompare(b.actor.name) || a.doc.name.localeCompare(b.doc.name));
  return result.map((entry, index) => {
    const t = entry.timer;
    const left = t ? remaining(t, now) : entry.native;
    return {
      key: index,
      uuid: entry.doc.uuid,
      actorName: entry.actor.name,
      name: entry.doc.name,
      img: entry.doc.img,
      kind: entry.kind === "buff" ? "3R 增益" : "Active Effect",
      note: entry.note,
      hasTimer: !!t,
      ownTimer: !!entry.doc.getFlag(MODULE_ID, "timer"),
      remaining: left == null ? "—" : durationLabel(left),
      endSeconds: t?.end ?? null,
      end: t ? clockLabel(t.end, game.time.calendar) : "",
      progress: t ? Math.max(0, Math.min(100, 100 * remaining(t, now) / t.seconds)) : 0,
      expired: t && left <= 0
    };
  });
}

async function processExpirations() {
  if (!isProcessingGM()) return;
  const now = game.time.worldTime;
  const timesUp = game.modules.get("times-up")?.active;
  let count = 0;
  for (const actor of accessibleActors()) {
    for (const item of [...actor.items]) {
      if (item.type !== "buff" || !item.system?.active) continue;
      if(game.modules.get("samson-3r-automation")?.active && Number.isFinite(item.getFlag("samson-3r-automation","expiresAt")))continue;
      const t = item.getFlag(MODULE_ID, "timer");
      if (!t || !Number.isFinite(t.end) || t.end > now) continue;
      try {
        // Honor the native "delete on expiry" choice. Native combat already
        // counts rounds; only finish expired world timers here, never tick twice.
        if(item.system.timeline?.enabled&&typeof item.addElapsedTime==="function") {
          const left=Math.max(0,Number(item.system.timeline.total)-Number(item.system.timeline.elapsed??0));
          if(!Number.isFinite(left))continue;
          await item.addElapsedTime(left);
        }else if(item.system.timeline?.deleteOnExpiry)await actor.deleteEmbeddedDocuments("Item",[item.id]);
        else await item.update({ "system.active": false });
        count++;
      } catch (error) { console.error(`${MODULE_ID}: failed to expire buff`, item.uuid, error); }
    }
    for (const effect of [...actor.effects]) {
      if (effect.disabled || effect.isSuppressed) continue;
      const ownTimer = effect.getFlag(MODULE_ID, "timer");
      const t = ownTimer ?? (!timesUp ? nativeEffectTimer(effect) : null);
      if (!t || !Number.isFinite(t.end) || t.end > now) continue;
      try {
        // D35E's delete hook also clears linked conditions and turns off an origin buff.
        await effect.delete();
        count++;
      } catch (error) { console.error(`${MODULE_ID}: failed to expire effect`, effect.uuid, error); }
    }
  }
  if (count) ui.notifications.info(`3R 时间轴：${count} 个效果已到期。`);
  timelineApp?.render();
}

function queueExpiry() {
  expiryQueue = expiryQueue.then(processExpirations).catch(error => console.error(`${MODULE_ID}: expiry failed`, error));
  return expiryQueue;
}

class TimelineApp extends HandlebarsApplicationMixin(ApplicationV2) {
  documents = new Map();
  sliderAbort = null;

  static DEFAULT_OPTIONS = {
    id: "d35e-world-timeline",
    classes: ["d35e-world-timeline"],
    window: { title: "3R 世界时间轴", resizable: true },
    position: { width: 740, height: 650 },
    actions: {
      refresh: TimelineApp.#refresh,
      advance: TimelineApp.#advance,
      applyPreview: TimelineApp.#applyPreview,
      advanceExact: TimelineApp.#advanceExact,
      setTimer: TimelineApp.#setTimer,
      clearTimer: TimelineApp.#clearTimer,
      openDocument: TimelineApp.#openDocument,
      createMarker: TimelineApp.#createMarker
    }
  };

  static PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/timeline.hbs`, scrollable: [".dwt-list"] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const list = entries();
    this.documents.clear();
    for (const actor of accessibleActors()) {
      for (const item of actor.items) this.documents.set(item.uuid, item);
      for (const effect of actor.effects) this.documents.set(effect.uuid, effect);
    }
    context.now = clockLabel(game.time.worldTime, game.time.calendar);
    context.rows = list;
    context.count = list.length;
    context.isGM = game.user.isGM;
    context.selectedActor = canvas?.tokens?.controlled?.[0]?.actor?.name ?? "未选择 Token";
    context.nowSeconds = game.time.worldTime;
    context.markers = list.filter(row => row.endSeconds != null && row.endSeconds > game.time.worldTime)
      .map(row => ({ name: row.name, actorName: row.actorName, endSeconds: row.endSeconds }));
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.sliderAbort?.abort();
    this.sliderAbort = new AbortController();
    const root = this.element;
    const slider = root.querySelector(".dwt-slider");
    const span = root.querySelector(".dwt-span");
    if (!slider || !span) return;
    const now = Number(root.querySelector(".dwt-ruler")?.dataset.now);
    const update = () => {
      const minutes = Number(slider.value);
      const spanMinutes = Number(span.value);
      slider.max = String(spanMinutes);
      if (minutes > spanMinutes) slider.value = String(spanMinutes);
      const previewSeconds = Number(slider.value) * 60;
      const preview = root.querySelector(".dwt-preview");
      if (preview) preview.textContent = previewSeconds
        ? `预览：${clockLabel(now + previewSeconds, game.time.calendar)}（前进 ${durationLabel(previewSeconds)}）`
        : "把滑块拖到目标时间，再点击“应用时间”";
      const apply = root.querySelector("[data-action='applyPreview']");
      if (apply) apply.disabled = previewSeconds === 0;
      const axis = root.querySelector(".dwt-axis");
      if (axis) {
        const labels = axis.querySelectorAll("span");
        if (labels[0]) labels[0].textContent = "现在";
        if (labels[1]) labels[1].textContent = `+${durationLabel(spanMinutes * 30)}`;
        if (labels[2]) labels[2].textContent = `+${durationLabel(spanMinutes * 60)}`;
      }
      for (const marker of root.querySelectorAll(".dwt-marker")) {
        const offset = Number(marker.dataset.end) - now;
        marker.style.left = `${Math.max(0, Math.min(100, offset / (spanMinutes * 60) * 100))}%`;
        marker.hidden = offset < 0 || offset > spanMinutes * 60;
      }
      for (const entry of root.querySelectorAll(".dwt-entry[data-end]")) {
        const end = Number(entry.dataset.end);
        const label = entry.querySelector(".dwt-remaining");
        if (label) label.textContent = durationLabel(end - now - previewSeconds);
        entry.classList.toggle("dwt-preview-expired", end <= now + previewSeconds);
      }
    };
    slider.addEventListener("input", update, { signal: this.sliderAbort.signal });
    span.addEventListener("change", update, { signal: this.sliderAbort.signal });
    update();
  }

  async close(options) {
    this.sliderAbort?.abort();
    if (timelineApp === this) timelineApp = null;
    return super.close(options);
  }

  async #document(target) {
    return this.documents.get(target.dataset.uuid) ?? await fromUuid(target.dataset.uuid);
  }

  static #refresh() { this.render(); }

  static async #advance(_event, target) {
    if (!game.user.isGM) return;
    const seconds = Number(target.dataset.seconds);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return;
    await game.time.advance(seconds);
  }

  static async #applyPreview() {
    if (!game.user.isGM) return;
    const minutes = Number(this.element.querySelector(".dwt-slider")?.value);
    if (!Number.isSafeInteger(minutes) || minutes <= 0) return;
    await game.time.advance(minutes * 60);
    this.render();
  }

  static async #advanceExact() {
    if (!game.user.isGM) return;
    const field = this.element.querySelector(".dwt-exact");
    const value = Number(field?.querySelector("input[name='amount']")?.value);
    const unit = Number(field?.querySelector("select[name='unit']")?.value);
    const seconds = value * unit;
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 10 * 365 * 86400) {
      return ui.notifications.warn("请输入大于 0 且不超过 10 年的整数秒数。");
    }
    await game.time.advance(seconds);
    this.render();
  }

  static async #setTimer(_event, target) {
    if (!game.user.isGM) return;
    const row = target.closest(".dwt-entry");
    const value = Number(row?.querySelector("input[name='amount']")?.value);
    const unit = Number(row?.querySelector("select[name='unit']")?.value);
    const seconds = value * unit;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 10 * 365 * 86400) {
      return ui.notifications.warn("请输入大于 0、且不超过 10 年的时长。");
    }
    const doc = await this.#document(target);
    if (!doc) return;
    const update={ [`flags.${MODULE_ID}.timer`]:timer(game.time.worldTime,seconds) };
    if(doc.type==="buff"&&doc.system.timeline?.enabled)Object.assign(update,{
      "system.timeline.total":seconds/6,"system.timeline.formula":String(seconds/6),"system.timeline.elapsed":0
    });
    await doc.update(update);
    this.render();
  }

  static async #clearTimer(_event, target) {
    if (!game.user.isGM) return;
    const doc = await this.#document(target);
    if (!doc) return;
    await doc.unsetFlag(MODULE_ID, "timer");
    this.render();
  }

  static async #openDocument(_event, target) {
    const doc = await this.#document(target);
    doc?.sheet?.render(true);
  }

  static async #createMarker() {
    if (!game.user.isGM) return;
    const form = this.element.querySelector(".dwt-new-marker");
    const actor = canvas?.tokens?.controlled?.[0]?.actor;
    if (!actor) return ui.notifications.warn("请先在场景中选中一个 Token。");
    const name = form.querySelector("input[name='name']")?.value?.trim();
    const value = Number(form.querySelector("input[name='amount']")?.value);
    const unit = Number(form.querySelector("select[name='unit']")?.value);
    const seconds = value * unit;
    if (!name || !Number.isFinite(seconds) || seconds <= 0 || seconds > 10 * 365 * 86400) {
      return ui.notifications.warn("请填写名称和有效时长（不超过 10 年）。");
    }
    await actor.createEmbeddedDocuments("ActiveEffect", [{ name, img: "icons/svg/aura.svg", changes: [],
      flags: { [MODULE_ID]: { timer: timer(game.time.worldTime, seconds) } } }]);
    this.render();
  }
}

function openTimeline() {
  if (!timelineApp) timelineApp = new TimelineApp();
  timelineApp.render({ force: true });
}

Hooks.once("init", () => {
  registerCalendarSettings();
  game.settings.register(MODULE_ID, "lastRest", { scope: "world", config: false, type: Object, default: {} });
  game.modules.get(MODULE_ID).api = {
    open: openTimeline, openCalendar: openCalendarWeather, processExpirations: queueExpiry
  };
  installCombatTracker();
});

Hooks.once("ready", () => {
  if (game.system.id !== "D35E") return;
  installCombatClock();
  installRestSync();
  loadCalendarDefinition();
  initCalendarWeather();
  initSurface({ openTimeline, openCalendar: openCalendarWeather });
  Hooks.on("updateWorldTime", () => { queueExpiry(); timelineApp?.render(); });
  Hooks.on("updateItem", (item, change) => {
    timelineApp?.render();
    if (!isProcessingGM() || item.type !== "buff") return;
    const wasDeactivated=change?.system?.active===false||change?.["system.active"]===false;
    // Module timers retain cast deadlines while paused/inactive, including old
    // gray entries being repaired. An unrelated item update is not deactivation.
    if (wasDeactivated && item.getFlag(MODULE_ID, "timer")
      && !Number.isFinite(item.getFlag("samson-3r-automation","expiresAt"))) {
      item.unsetFlag(MODULE_ID, "timer").catch(console.error);
      return;
    }
    const wasActivated = change?.system?.active === true || change?.["system.active"] === true;
    const native = nativeBuffSeconds(item);
    if (wasActivated && native >= 60 && !item.getFlag(MODULE_ID, "timer")) {
      item.setFlag(MODULE_ID, "timer", timer(game.time.worldTime, native)).catch(console.error);
    }
  });
  Hooks.on("createItem", item => {
    timelineApp?.render();
    if (!isProcessingGM() || item.type !== "buff") return;
    const native = nativeBuffSeconds(item);
    if (native >= 60 && !item.getFlag(MODULE_ID, "timer")) {
      item.setFlag(MODULE_ID, "timer", timer(game.time.worldTime, native)).catch(console.error);
    }
  });
  Hooks.on("createChatMessage", message => {
    trackCastSpell(message).catch(error => console.error(`${MODULE_ID}: could not track spell`, error));
  });
  for (const event of ["deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "canvasReady"]) {
    Hooks.on(event, () => timelineApp?.render());
  }
  queueExpiry();
});
