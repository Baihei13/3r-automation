import { MODULE_ID } from "./catalog.js";
import { DicePF } from "../../../systems/D35E/module/dice.js";
import { createTransientView } from "./transient-view.js";
import { typedBonus, has, curseLevel } from "./rules-bridge.js";
import { effectIsActive } from "./effect-state.js";

const activeChecks = new Map();
const day = () => Math.floor(game.time.worldTime / 86400);
export const promiseAvailable = actor => !(actor.getFlag(MODULE_ID, "promise")?.used && actor.getFlag(MODULE_ID, "promise")?.day === day());
const rolled = result => Array.isArray(result) ? result.some(rolled) : Number.isFinite(result?.total);

function addChoice(root, actor, context) {
  const form = root.querySelector("form");
  if (!form || form.querySelector("[data-three-r-check-choice]")) return;
  context.boxes ??= {};
  for (const choice of context.choices ?? [{ id: "promise", text: "守律：履约誓言 · +4士气加值。勾选表示本次正在履行对他人的承诺。" }]) {
  const row = document.createElement("label");
  row.dataset.threeRCheckChoice = choice.id;
  row.style.cssText = "display:flex;align-items:center;gap:6px;margin:6px 0;padding:6px;border:1px solid #96754c;";
  const box = document.createElement("input");
  box.type = "checkbox"; box.name = `three-r-${choice.id}`; box.checked = false;
  box.disabled = choice.id === "promise" && !promiseAvailable(actor);
  const text = document.createElement("span");
  text.textContent = choice.text + (choice.id === "promise" ? ` 今日剩余${box.disabled ? 0 : 1}次。` : "");
  row.append(box, text); form.append(row);
  context.boxes[choice.id] = box;
  }
}

function bindDialog(app, root, context, apply) {
  if (context.app && context.app !== app) return;
  context.app = app;
  addChoice(root, context.actor, context);
  if (app._threeRCheckBound) return;
  app._threeRCheckBound = true;
  for (const button of Object.values(app.data.buttons ?? {})) {
    const callback = button.callback;
    if (typeof callback !== "function") continue;
    button.callback = function(...args) {
      if (context.started) return;
      context.selected = Boolean(context.boxes?.promise?.checked);
      context.selections = Object.fromEntries(Object.entries(context.boxes ?? {}).map(([id, box]) => [id, box.checked && !box.disabled]));
      if (context.selected && !promiseAvailable(context.actor)) {
        ui.notifications.warn("守律的今日次数已被使用，本次未掷骰。");
        return;
      }
      context.started = true;
      apply(context);
      const execution = callback.apply(this, args);
      // The ability helper closes before its asynchronous roll completes. Keep that promise.
      if (execution?.then) context.execution = execution;
      return execution;
    };
  }
}

export function installCheckOptions() {
  const d20 = DicePF.d20Roll;
  DicePF.d20Roll = function(config) {
    const speaker = config.speaker;
    const actor = (speaker?.scene && speaker?.token ? game.scenes.get(speaker.scene)?.tokens.get(speaker.token)?.actor : null) ?? game.actors.get(speaker?.actor);
    const context = actor && activeChecks.get(actor.uuid);
    if (context?.kind !== "ability" || context.diceBound || config.title !== context.abilityTitle) return d20.call(this, config);
    context.diceBound = true;
    context.extra.push(...(config.dynamicBonuses ?? []));
    context.title = `${config.title} - ${context.displayName}`;
    return d20.call(this, { ...config, title: context.title, event: {}, fastForward: false,
      dynamicBonuses: context.extra, dialogOptions: { ...config.dialogOptions, id: context.id } });
  };
}

export async function withOptionalCheck(actor, kind, id, options, invoke) {
  // Existing explicit ability menus already supply their own single-roll effect.
  const choices = [];
  if (has(actor,"legalistic")) choices.push({id:"promise",text:"守律：履约誓言 · +4士气加值。勾选确认本次正在履行对他人的承诺。"});
  const diplomacy=kind==="skill"&&["dip","int"].includes(id)?actor.items.find(item=>item.getFlag(MODULE_ID,"key")==="spell-effect-diplomacy"&&effectIsActive(item)):null;
  if(diplomacy)choices.push({id:"diplomacy",text:"增强交涉 · +2表现加值，完成本次检定后法术结束。"});
  const guidance=actor.items.find(item=>item.getFlag(MODULE_ID,"key")==="card-effect-guidance"&&effectIsActive(item));
  if(guidance&&["skill","save"].includes(kind))choices.push({id:"guidance",text:"神导术 · 本次检定＋1表现加值，使用后法术结束。"});
  const lifebound=has(actor,"lifebound")&&!actor.items.some(item=>item.getFlag(MODULE_ID,"key")==="lifebound-check"&&effectIsActive(item));
  if(lifebound&&kind==="save")choices.push({id:"lifebound",text:"生命之缚 · 对抗即死、负能量或移除负向等级时，豁免＋2种族加值。"});
  if(lifebound&&kind==="ability"&&id==="con"&&Number(actor.system.attributes.hp.value)<0
    &&Number(actor.system.attributes.hp.value)>-Number(actor.system.abilities.con.total)
    &&!["undead","construct"].includes(actor.system.attributes.creatureType))
    choices.push({id:"lifebound",text:"生命之缚 · 本次为稳定伤势体质检定，＋2种族加值。"});
  if(kind==="skill"&&["dip","int","sen"].includes(id)&&has(actor,"legalistic")&&curseLevel(actor,"legalistic")>=5&&!actor.items.some(item=>item.getFlag(MODULE_ID,"key")==="legalistic-conversation"&&item.system.active))choices.push({id:"conversation",text:"守律：一对一交谈 · +3表现加值。勾选确认正在与一个人交谈。"});
  if (!choices.length || actor.items.some(item => item.getFlag(MODULE_ID, "key") === "legalistic-promise" && item.system.active)) return invoke(actor);
  if (activeChecks.has(actor.uuid)) throw new Error("该角色还有一个检定窗口未完成，请先完成或关闭它。");
  if (!actor.sourceDetails) await actor.refresh({ stopUpdates: false });
  const context = { actor, kind, choices, id: `three-r-check-${foundry.utils.randomID()}`, displayName: `${actor.name} · 可选能力`, extra: [], selected: false, started: false,
    abilityTitle: kind === "ability" ? game.i18n.localize("D35E.AbilityTest").format(CONFIG.D35E.abilities[id]) : null };
  activeChecks.set(actor.uuid, context);
  const overrides = { name: context.displayName, sourceDetails: foundry.utils.deepClone(actor.sourceDetails) };
  const view = createTransientView(actor, overrides);
  const save = /^(fort|ref|will)/.exec(id)?.[1];
  const path = kind === "skill" ? `system.skills.${id}.changeBonus` : `system.attributes.savingThrows.${save}.total`;
  const target = kind === "skill" ? [`skill.${id.split(".subSkills.")[0]}`, "skills"] : kind === "save" ? [save, "allSavingThrows"] : [`${id}Checks`, "allChecks"];
  const hook = Hooks.on("renderDialog", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const field = kind === "skill" ? "sk-bonus" : kind === "save" ? "st-bonus" : "bonus";
    const titleMatches = kind === "ability" ? app.id === context.id : String(app.data?.title).endsWith(` - ${context.displayName}`);
    if (!root || !titleMatches || !root.querySelector(`[name='${field}']`)) return;
    bindDialog(app, root, context, () => {
      overrides.name = actor.name;
      // Re-read live bonuses at submission, then add only the missing part of +4 morale.
      overrides.sourceDetails = foundry.utils.deepClone(actor.sourceDetails);
      if (context.selected) {
        const value = Math.max(0, 4 - typedBonus(actor, "morale", target));
        if (kind === "ability") context.extra.push({ name: "士气加值", value });
        else (overrides.sourceDetails[path] ??= []).push({ name: "士气加值", value });
      }
      const competence=Math.max(context.selections.diplomacy?2:0,context.selections.conversation?3:0,context.selections.guidance?1:0);
      if(competence)(overrides.sourceDetails[path]??=[]).push({name:"表现加值",value:Math.max(0,competence-typedBonus(actor,"competence",target))});
      if(context.selections.lifebound) {
        const row={name:"生命之缚：种族加值",value:Math.max(0,2-typedBonus(actor,"racial",target))};
        if(kind==="ability")context.extra.push(row);
        else (overrides.sourceDetails[path]??=[]).push(row);
        if(kind==="ability")context.extra.push({name:"负生命值：稳定检定减值",value:Number(actor.system.attributes.hp.value)});
      }
    });
  });
  try {
    const result = await invoke(view, { ...options, skipDialog: false, event: {} });
    const actual = context.execution ? await context.execution : result;
    if (context.selected && rolled(actual)) await actor.setFlag(MODULE_ID, "promise", { day: day(), used: true, usedAt: game.time.worldTime });
    if(context.selections?.diplomacy&&rolled(actual)&&actor.items.has(diplomacy.id))await diplomacy.update({"system.active":false});
    if(context.selections?.guidance&&rolled(actual)&&actor.items.has(guidance.id))await guidance.delete();
    if(kind==="ability"&&context.selections?.lifebound) {
      const roll=Array.isArray(actual)?actual.find(entry=>Number.isFinite(entry?.total)):actual;
      if(roll?.total>=10)await actor.update({"system.attributes.conditions.stable":true});
    }
    return actual || result;
  } finally {
    Hooks.off("renderDialog", hook);
    activeChecks.delete(actor.uuid);
  }
}

export async function withOptionalAttack(actor, item, records, invoke) {
  const guidance=actor?.items.find(effect=>effect.getFlag(MODULE_ID,"key")==="card-effect-guidance"&&effectIsActive(effect));
  if (!actor || (!has(actor, "legalistic")&&!guidance) || records.has(actor.uuid)) return invoke();
  if (activeChecks.has(actor.uuid)) throw new Error("该角色还有一个检定窗口未完成，请先完成或关闭它。");
  const choices=[];
  if(has(actor,"legalistic"))choices.push({id:"promise",text:"守律：履约誓言 · 本次攻击＋4士气加值。"});
  if(guidance)choices.push({id:"guidance",text:"神导术 · 本次攻击＋1表现加值，使用后法术结束。"});
  const context = { actor, choices,started: false, selected: false };
  activeChecks.set(actor.uuid, context);
  const title = `${game.i18n.localize("D35E.Use")}: ${item.name} - ${actor.name}`;
  const record = { item: item.id, used: false };
  const hook = Hooks.on("renderDialog", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root?.querySelector("form.attack-form") || app.data?.title !== title) return;
    bindDialog(app, root, context, () => {
      record.promise=context.selected;
      if(context.selections.guidance)record.guidanceId=guidance.id;
      if(record.promise||record.guidanceId)records.set(actor.uuid, record);
    });
  });
  try {
    const result = await invoke();
    if (result?.roll) await result.roll;
    if (context.selected && record.used) await actor.setFlag(MODULE_ID, "promise", { day: day(), used: true, usedAt: game.time.worldTime });
    if(record.used&&record.guidanceId&&actor.items.has(record.guidanceId))await actor.items.get(record.guidanceId).delete();
    return result;
  } finally {
    Hooks.off("renderDialog", hook); activeChecks.delete(actor.uuid);
    if (records.get(actor.uuid) === record) records.delete(actor.uuid);
  }
}
