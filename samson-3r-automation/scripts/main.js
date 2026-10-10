import { MODULE_ID, SOURCES, KNOWLEDGE_SKILLS, KNOWLEDGE_LABELS } from "./catalog.js";
import { installSamson } from "./install.js";
import { registerCantripSetting, activateCantripRule, refreshCantripRule } from "./cantrips.js";
import { openCharacterPanel } from "./character-panel.js";
import { itemRepairs } from "./item-data.js";
import { applyMartialRepair } from "./martial-template.js";
import { loadSpellTexts, localizeSpellHeaders } from "./spell-text.js";
import { installPresentation } from "./presentation.js";
import { effectIsActive } from "./effect-state.js";
import { repairFragile } from "./fragile.js";
import { installMovementOpportunities } from "./movement-opportunities.js";
import { registerContentSearch, installContentSearchButton, openContentSearch } from "./content-search.js";
import { loadCharacterContent } from "./content.js";
import { loadPFCharacterFoundation,installPFCharacterFoundation,preparePFImport,registerPFFeatureCache,syncWorldPFFeatures } from "./pf-character-foundation.js";
import { loadClericContent } from "./cleric-content.js";
import { loadPF1Content } from "./pf1-content.js";
import { loadMartialContent } from "./martial-content.js";
import { registerSwordsageFeatureCache,syncWorldSwordsageFeatures } from "./martial-class-features.js";
import { installMartialRuntime,martialAPI } from "./martial-runtime.js";
import { learningDialog } from "./martial-sheet.js";
import { activateRules, completeActors, applySpellBuff, processRuleTime, timedBuff, casterLevel, typedBonus, recordAction, hudItemAction } from "./rules-bridge.js";
import { installConditionRuntime, assertConditionAction, commitConditionAction } from "./condition-runtime.js";
import { applyCondition, clearCondition, editConditionContext, registerConditionTools } from "./condition-tools.js";
import { conditionState } from "./condition-state.js";
import { useDivinePersistent, installHolySymbolUse } from "./divine-metamagic.js";
import { conditionOperation } from "./condition-actions.js";
import { completeConditionRest } from "./condition-vitals.js";

let panel;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function samsonActor(actor = null) {
  if (actor) return actor;
  const controlled = canvas?.tokens?.controlled?.[0]?.actor;
  if (controlled?.testUserPermission(game.user, "OWNER")) return controlled;
  return game.actors.find(entry => entry.getFlag(MODULE_ID, "samson") === true) ?? null;
}

function has(actor, key) {
  return actor.items.some(item => item.getFlag(MODULE_ID, "key") === key
    && effectIsActive(item));
}

function knowledgeReady(actor) {
  return has(actor, "知识虔诚") && Object.entries(actor.system.skills ?? {})
    .some(([key, skill]) => /^k(ar|du|en|ge|hi|lo|na|no|pl|re|ps)$/.test(key)
      && Number(skill.rank ?? 0) >= 5);
}

function weaponFocusReady(actor) {
  return has(actor, "武器专攻：巨剑") && Number(actor.system.attributes?.bab?.total ?? 0) >= 1;
}

function targetType() {
  if (game.user.targets.size !== 1) return "";
  const target = [...game.user.targets][0];
  const raw = String(target.actor?.system?.attributes?.creatureType ?? "");
  return Object.keys(KNOWLEDGE_SKILLS).find(type => type.toLowerCase() === raw.toLowerCase()) ?? "";
}

function knowledgeBonus(total) {
  if (total <= 15) return 1;
  if (total <= 25) return 2;
  if (total <= 30) return 3;
  if (total <= 35) return 4;
  return 5;
}

async function knowledgeDevotion(actor, type) {
  if (!knowledgeReady(actor)) return ui.notifications.warn("知识虔诚尚未满足任意知识技能 5 级的前提。");
  const combat = game.combat;
  if (!combat?.active) return ui.notifications.warn("先开始一场战斗，再进行知识虔诚检定。");
  const skill = KNOWLEDGE_SKILLS[type];
  if (!skill) return ui.notifications.warn("请选择目标的生物类型。");
  const ranks = Number(actor.system.skills?.[skill]?.rank ?? 0);
  if (ranks < 1) return ui.notifications.warn(`${KNOWLEDGE_LABELS[skill]}没有技能级数，不能对该类型发动知识虔诚。`);
  const record = actor.getFlag(MODULE_ID, "knowledgeDevotion") ?? {};
  if (record.combat === combat.id && record.bonuses?.[type] != null) {
    return ui.notifications.warn(`本场战斗已对${type}检定，不能重复。`);
  }
  const roll = await actor.rollSkill(skill,{skipDialog:true});
  if(roll?.total==null)return;
  const bonus = knowledgeBonus(roll.total);
  const bonuses = record.combat === combat.id ? { ...record.bonuses } : {};
  bonuses[type] = bonus;
  await actor.setFlag(MODULE_ID, "knowledgeDevotion", { combat: combat.id, bonuses });
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>知识虔诚：${type}／${KNOWLEDGE_LABELS[skill]}；本场战斗对该类型攻击与伤害 +${bonus} 洞察加值。</p>`});
  renderPanel(actor);
}

function isGreatsword(item) {
  const weapon = item.actor?.items.get(item.system.originalWeaponId) ?? item;
  return weapon.getFlag(MODULE_ID, "key") === "greatsword"
    || /^(greatsword|巨剑|巨剑\s*greatsword)$/i.test(weapon.name)
    || /^greatsword$/i.test(item.system.baseWeaponType ?? "");
}

function applyCombatBonuses(item, rollData) {
  const actor = item.actor;
  if (!actor) return;
  const weapon = actor.items.get(item.system.originalWeaponId) ?? item;
  if (!["mwak", "rwak", "msak", "rsak"].includes(item.system.actionType)&&!item.hasDamage) return;
  if(has(actor,"stone-fist")&&["mwak","msak"].includes(item.system.actionType)&&rollData.item?.ability?.attack==="str")
    rollData.item.attackBonus=`(${rollData.item.attackBonus||0}) + (${actor.getRollData().stoneFistAttackGain})`;
  delete rollData.samsonKnowledgeBonus;
  const attack = [];
  if (["mwak", "rwak"].includes(item.system.actionType) && isGreatsword(item)
    && weaponFocusReady(actor) && item.system.proficient) attack.push(1);
  const combat = game.combat;
  const record = actor.getFlag(MODULE_ID, "knowledgeDevotion");
  const type = targetType();
  const devotion = knowledgeReady(actor) && combat?.active && record?.combat === combat.id && type
    ? Number(record.bonuses?.[type] ?? 0) : 0;
  if (devotion) {
    attack.push(Math.max(0,devotion-typedBonus(actor,"insight",["attack",["mwak","msak"].includes(item.system.actionType)?"mattack":"rattack"])));
    const damage=Math.max(0,devotion-typedBonus(actor,"insight",["damage",["mwak","rwak"].includes(item.system.actionType)?"wdamage":"sdamage"]));
    rollData.samsonKnowledgeBonus = { value:damage, type };
  }
  if (attack.length) {
    rollData.item ??= {};
    rollData.item.attackBonus = [rollData.item.attackBonus || "0", ...attack].join(" + ");
  }
}

function applyKnowledgeDamage(chatAttack, options) {
  const bonus = chatAttack.rollData?.samsonKnowledgeBonus;
  if (!bonus || !chatAttack.item?.actor || !knowledgeReady(chatAttack.item.actor)) return;
  // D35E reuses the base parts for normal damage, criticals and extra arrows.
  // Keep the shared array intact so the bonus is added once per damage roll.
  options.extraParts = [...(options.extraParts??[]),
    [`@critMult*(${bonus.value})`, `知识虔诚：洞察加值（${bonus.type}）`, "base"]];
}

function buffData(name, changes, seconds, key) {
  return timedBuff(name,key,seconds,changes,{sourceActor:"self"});
}

async function replaceBuff(actor, key, data) {
  const prior = actor.items.filter(item => item.getFlag(MODULE_ID, "key") === key);
  if (prior.length) await actor.deleteEmbeddedDocuments("Item", prior.map(item => item.id));
  await actor.createEmbeddedDocuments("Item", [data]);
}

async function divineFavor(actor, persistent = false) {
  if(persistent)return useDivinePersistent(actor);
  const spell = actor.items.find(item => item.getFlag(MODULE_ID, "key") === "spell-Divine Favor");
  if (!spell) return ui.notifications.error("角色缺少神恩法术。");
  if (Number(spell.system.preparation?.preparedAmount ?? 0) < 1) {
    return ui.notifications.warn("神恩没有已准备的法术次数。");
  }
  return spell.use();
}

async function stoneFist(actor) {
  const potion = actor.items.find(item => item.getFlag(MODULE_ID, "key") === "fist-of-stone-potion");
  if (!potion || Number(potion.system.quantity ?? 0) < 1) return ui.notifications.warn("石拳术药水已用完。");
  await potion.update({ "system.quantity": potion.system.quantity - 1 });
  await recordAction(actor,"standard");
  await replaceBuff(actor, "stone-fist", buffData("石拳术", [
    ["@stoneFistAttackGain", "misc", "cmb", "untyped"]
  ], 60, "stone-fist"));
  const previous=actor.items.filter(i=>i.getFlag(MODULE_ID,"key")==="stone-fist-slam");
  if(previous.length)await actor.deleteEmbeddedDocuments("Item",previous.map(i=>i.id));
  await actor.createEmbeddedDocuments("Item",[{name:"石拳术：猛击",type:"attack",img:"systems/D35E/icons/attack/monster/slam.png",
    system:{actionType:"mwak",attackType:"natural",proficient:true,activation:{type:"attack",cost:1},
      ability:{attack:"str",damage:"str",damageMult:1.5,critRange:"20",critMult:2},
      damage:{parts:[["1d6 + floor((@abilities.str.mod + @stoneFistAttackGain) * @ablMult) - floor(@abilities.str.mod * @ablMult)","Bludgeoning"]]}},
    flags:{[MODULE_ID]:{key:"stone-fist-slam",requiresBuff:"stone-fist"}}}]);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${escapeHtml(actor.name)}使用石拳术药水：攻击、擒抱、击破物品时获得等效的＋6力量增强加值；可作1d6猛击。持续1分钟。</p>` });
  renderPanel(actor);
}

async function slam(actor, secondary = false) {
  if (!has(actor, "stone-fist")) return ui.notifications.warn("石拳术尚未生效。");
  const attack=actor.items.find(i=>i.getFlag(MODULE_ID,"key")==="stone-fist-slam");
  if(!attack)return ui.notifications.warn("请重新使用石拳术药水生成原生猛击条目。");
  const data=attack.toObject();
  data.system.primaryAttack=!secondary;
  data.system.ability.damageMult=secondary?0.5:1.5;
  const temporary=new CONFIG.Item.documentClass(data,{parent:actor});
  const result=await temporary.uses.useAttack({skipDialog:true,temporaryItem:true},actor);
  if(result?.roll)await result.roll;
}

async function breakObject(actor) {
  if (!has(actor, "stone-fist")) return ui.notifications.warn("石拳术尚未生效。");
  const str = Number(actor.system.abilities?.str?.mod ?? 0);
  const roll = await new Roll(`1d20 + ${str + actor.getRollData().stoneFistAttackGain}`).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
    flavor: "石拳术：击破／压碎物品力量检定（仅本项获得等效力量 +6）" });
}

async function lore(actor) {
  const level = actor.items.filter(item => item.type === "class" && item.getFlag(MODULE_ID, "key") === "cloistered-cleric")
    .reduce((sum, item) => sum + Number(item.system.levels ?? 0), 0);
  const intMod = Number(actor.system.abilities?.int?.mod ?? 0);
  const history = Number(actor.system.skills?.khi?.rank ?? 0) >= 5 ? 2 : 0;
  const roll = await new Roll(`1d20 + ${level} + ${intMod} + ${history}`).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "修道牧师学问：DM 按逸闻知识难度判定；不能取 10 或 20" });
}

async function chooseEnergy(actor, mode) {
  if (!game.user.isGM) return ui.notifications.warn("正能量或负能量须由 GM 确认。");
  await actor.setFlag(MODULE_ID, "energyMode", mode);
  ui.notifications.info(`角色已选择${mode === "positive" ? "正能量：驱散不死生物、自发治疗" : "负能量：呵斥不死生物、自发造成伤害"}。`);
  renderPanel(actor);
}

async function turnUndead(actor) {
  const mode = actor.getFlag(MODULE_ID, "energyMode");
  if (!mode) return ui.notifications.warn("GM 需要先为角色确定正能量或负能量。");
  if (Number(actor.system.attributes?.turnUndeadUses ?? 0) < 1) return ui.notifications.warn("今日驱散／呵斥次数已用完。");
  await actor.rollTurnUndead(mode === "positive" ? "不死生物（驱散）" : "不死生物（呵斥）");
}

async function spontaneousSpell(actor, spellId) {
  const mode = actor.getFlag(MODULE_ID, "energyMode");
  if (!mode) return ui.notifications.warn("GM 需要先为角色确定正能量或负能量。");
  const spell = actor.items.get(spellId);
  if (!spell || spell.type !== "spell" || Number(spell.system.level) !== 1
    || Number(spell.system.preparation?.preparedAmount ?? 0) < 1
    || spell.system.isDomainSpell || spell.system.specialPrepared) {
    return ui.notifications.warn("请选择一项已准备的非领域 1 环牧师法术。");
  }
  const name=mode==="positive"?"Cure Light Wounds":"Inflict Light Wounds";
  const pack=game.packs.get("world.samson-phb");
  const source=(await pack.getDocuments()).find(i=>i.getFlag(MODULE_ID,"key")===`spell-${name}`);
  if(!source)return ui.notifications.warn("来源合集中缺少转换法术。");
  const data=source.toObject();for(const field of ["_id","folder","ownership","_stats"])delete data[field];
  data.system.spellbook=spell.system.spellbook;
  data.system.preparation.preparedAmount=0;
  data.system.isDomainSpell=false;
  const replacement=actor.items.find(i=>i.getFlag(MODULE_ID,"key")===`spell-${name}`)
    ?? (await actor.createEmbeddedDocuments("Item",[data]))[0];
  await spell.uses.useSpell(null,{replacement:true,replacementItem:replacement},actor);
  renderPanel(actor);
}

async function expireBuffs() {
  return processRuleTime();
}

function renderPanel(actor = samsonActor()) {
  if (!actor) return ui.notifications.warn("请先选中要操作的角色 Token。");
  if (!actor.testUserPermission(game.user, "OWNER")) return ui.notifications.warn("需要该角色的所有者权限。");
  panel ??= document.createElement("section");
  panel.id = "samson-automation-panel";
  const options = Object.keys(KNOWLEDGE_SKILLS).map(type => `<option value="${type}" ${type === targetType() ? "selected" : ""}>${type}</option>`).join("");
  const record = actor.getFlag(MODULE_ID, "knowledgeDevotion");
  const known = game.combat?.active && record?.combat === game.combat.id
    ? Object.entries(record.bonuses ?? {}).map(([type, bonus]) => `${type} +${bonus}`).join("、") : "无";
  const energy = actor.getFlag(MODULE_ID, "energyMode");
  const prepared = actor.items.filter(item => item.type === "spell" && Number(item.system.level) === 1
    && Number(item.system.preparation?.preparedAmount ?? 0) > 0 && !item.system.isDomainSpell && !item.system.specialPrepared);
  const spellOptions = prepared.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  panel.innerHTML = `<header><strong>${escapeHtml(actor.name)} · 3r自动化</strong><button type="button" data-action="close" aria-label="关闭">×</button></header>
    <p>知识虔诚：${!has(actor, "知识虔诚") ? "未选取" : knowledgeReady(actor) ? "已满足前提" : "已选择，但未满足知识 5 级前提"}；本场结果：${known}</p>
    <p>武器专攻：${!has(actor, "武器专攻：巨剑") ? "未选取" : weaponFocusReady(actor) ? "BAB 前提已满足，擅长巨剑时生效" : "已选择，但 BAB 尚未达到 +1"}。巨剑攻击按前提自动加值。</p>
    <p>牧师能量选择：${energy === "positive" ? "正能量" : energy === "negative" ? "负能量" : "尚未决定"}。</p>
    ${game.user.isGM ? `<div class="samson-actions"><button data-action="positive">选正能量</button><button data-action="negative">选负能量</button></div>` : ""}
    <label>目标类型 <select name="creatureType">${options}</select></label>
    <label>转换准备的 1 环法术 <select name="preparedSpell">${spellOptions}</select></label>
    <div class="samson-actions">
      <button data-action="knowledge">知识虔诚检定</button><button data-action="lore">学问检定</button>
      <button data-action="turn">驱散／呵斥不死生物</button><button data-action="spontaneous">自发转换轻伤法术</button>
      <button data-action="favor">施放神恩（1 分钟）</button><button data-action="persistent">持久神恩（24 小时）</button>
      ${actor.items.some(item=>item.getFlag(MODULE_ID,"key")==="fist-of-stone-potion")?'<button data-action="potion">使用石拳药水</button>':""}
      ${has(actor,"stone-fist")?'<button data-action="slam">石拳猛击</button><button data-action="secondarySlam">石拳次要攻击</button><button data-action="breakObject">石拳击破物品</button>':""}
    </div>
    <small>准备的神恩 ${actor.items.find(item => item.getFlag(MODULE_ID, "key") === "spell-Divine Favor")?.system.preparation?.preparedAmount ?? 0} 次；驱散剩余 ${actor.system.attributes?.turnUndeadUses ?? 0} 次${actor.items.some(item=>item.getFlag(MODULE_ID,"key")==="fist-of-stone-potion")?`；石拳药水 ${actor.items.find(item=>item.getFlag(MODULE_ID,"key")==="fist-of-stone-potion").system.quantity??0} 瓶`:""}。</small>`;
  if (!panel.isConnected) document.body.append(panel);
  panel.onclick = async event => {
    const action = event.target.closest("button")?.dataset.action;
    if (!action) return;
    if (action === "close") { panel.remove(); return; }
    try {
      if (action === "knowledge") await knowledgeDevotion(actor, panel.querySelector("[name='creatureType']").value);
      if (action === "lore") await lore(actor);
      if (action === "positive" || action === "negative") await chooseEnergy(actor, action);
      if (action === "turn") await turnUndead(actor);
      if (action === "spontaneous") await spontaneousSpell(actor, panel.querySelector("[name='preparedSpell']").value);
      if (action === "favor") await divineFavor(actor);
      if (action === "persistent") await divineFavor(actor, true);
      if (action === "potion") await stoneFist(actor);
      if (action === "slam") await slam(actor);
      if (action === "secondarySlam") await slam(actor, true);
      if (action === "breakObject") await breakObject(actor);
    } catch (error) { console.error(`${MODULE_ID}: action failed`, error); ui.notifications.error(`角色操作失败：${error.message}`); }
  };
}

function openAutomation(actor = samsonActor()) {
  return actor?.getFlag(MODULE_ID, "characterKey") ? openCharacterPanel(actor) : renderPanel(actor);
}

Hooks.once("init", () => {
  registerCantripSetting();
  registerContentSearch();
  registerConditionTools();
  Hooks.on("renderChatMessageHTML",(message,html)=>{
    if(message.flags?.[MODULE_ID]?.cast?.persistentSeconds!==86400)return;
    const root=html?.nodeType===1?html:html?.[0];if(!root||root.querySelector(".three-r-persistent-cast"))return;
    const note=document.createElement("p");note.className="three-r-persistent-cast";
    note.textContent="神圣超魔：法术持久 · 本次持续24小时，原法术位不提高，消耗7次驱散／斥喝。";
    (root.querySelector(".chat-card")??root).append(note);
  });
  game.modules.get(MODULE_ID).api = { search: openContentSearch, open: openAutomation, openCharacter: openCharacterPanel, install: installSamson, repairFragile, processTime: processRuleTime,
    martial:martialAPI,
    applyCondition, clearCondition, openConditions:editConditionContext, conditionState, conditionOperation, checkConditionAction:assertConditionAction, commitConditionAction, completeConditionRest, hudItemAction,
    commonAction: async (actor,action) => {
      if(action!=="defense" || !actor.testUserPermission(game.user,"OWNER")) throw new Error("动作或操纵权限无效。");
      assertConditionAction(actor,null,{kind:"standard",common:action});
      const amount=Number(actor.system.skills?.tmb?.rank)>=5?6:4;
      const old=actor.items.filter(item=>item.getFlag(MODULE_ID,"key")==="common-total-defense");
      if(old.length)await actor.deleteEmbeddedDocuments("Item",old.map(item=>item.id));
      await actor.createEmbeddedDocuments("Item",[timedBuff("全防御","common-total-defense",6,[[String(amount),"ac","ac","dodge"]])]);
      return true;
    }
  };
});

Hooks.once("ready", async () => {
  if (game.system.id !== "D35E") return;
  const api=game.modules.get(MODULE_ID).api;
  let phase="内容搜索入口";
  api.startup={state:"loading",phase};
  try {
  installContentSearchButton();
  phase="法术全文";
  await loadSpellTexts();
  phase="角色资料";
  await loadCharacterContent();
  phase="PF种族与职业规则";await loadPFCharacterFoundation();
  phase="3R牧师资料";
  await loadClericContent();
  phase="PF1资料";
  await loadPF1Content();
  phase="武术资料";
  await loadMartialContent();
  phase="规则与界面";
  localizeSpellHeaders();
  installPresentation();
  activateRules();
  phase="状态与伤势功能";
  installConditionRuntime();
  phase="武术页与结算";
  installMartialRuntime();
  phase="移动与其他入口";
  installMovementOpportunities();
  Hooks.on("preCreateItem", item => {
    const update = itemRepairs(item);
    if (Object.keys(update).length) item.updateSource(update);
  });
  installPFCharacterFoundation();
  installHolySymbolUse();
  Hooks.on("D35E.ItemUse.preRollAllAttacks", applyCombatBonuses);
  Hooks.on("D35E.ChatAttack.preAddDamage", applyKnowledgeDamage);
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    if(hook.customUse)return;
    const actions={"知识虔诚":()=>knowledgeDevotion(actor,targetType()),"修道牧师：学问":()=>lore(actor),
      "驱散不死生物":()=>turnUndead(actor),"神圣超魔：法术持久":()=>useDivinePersistent(actor),
      "holy-symbol":()=>useDivinePersistent(actor,item),
      "fist-of-stone-potion":()=>stoneFist(actor),"自发转换治疗法术":()=>renderPanel(actor)};
    const action=actions[item.getFlag(MODULE_ID,"key")];
    if(action){hook.customUse=true;hook.threeRCompletion=Promise.resolve().then(action);hook.threeRCompletion.catch(error=>ui.notifications.error(error.message));}
  });
  activateCantripRule().catch(error => console.error(`${MODULE_ID}: cantrip rule`, error));
  Hooks.on("updateWorldTime", () => expireBuffs().catch(console.error));
  Hooks.on("renderActorSheet", (app, html) => {
    if (!app._samson3rDropPatched && typeof app.addItemFromDropData === "function") {
      const originalDrop = app.addItemFromDropData.bind(app);
      app.addItemFromDropData = async dropData => {
        const uuid = dropData?.uuid;
        if (!uuid?.startsWith("Compendium.world.samson-pf1-")&&!Object.keys(SOURCES).some(source =>
          uuid?.startsWith(`Compendium.world.samson-${source}.Item.`))) return originalDrop(dropData);
        const item = await fromUuid(uuid);
        if (!(item instanceof Item)) return originalDrop(dropData);
        const key = item.getFlag(MODULE_ID, "key");
        if(item.getFlag(MODULE_ID,"martial")) {
          const entry=item.getFlag(MODULE_ID,"martial");
          try{const answer=await learningDialog(app.actor,entry.kind==="stance"?"stance":"move",false,entry.definition);
          if(!answer)return;
          return await martialAPI.command({actorUuid:app.actor.uuid,op:"learn",...answer});}
          catch(error){ui.notifications.error(error.message);return;}
        }
        if (item.type === "feat" && !["extra-hex", "additional-traits"].includes(key)
          && app.actor.items.some(existing => existing.getFlag(MODULE_ID, "key") === key
            && existing.getFlag(MODULE_ID, "source") === item.getFlag(MODULE_ID, "source"))) {
          ui.notifications.warn(`${item.name}已经在角色卡里。`);
          return;
        }
        const data = item.toObject();
        delete data._id;
        delete data.folder;
        delete data.ownership;
        delete data._stats;
        delete data.system.uniqueId;
        try { if(!await preparePFImport(app.actor,data))return; }
        catch(error){ui.notifications.warn(error.message);return;}
        app.enrichDropData?.(data);
        return app.importItem(data, "compendium");
      };
      app._samson3rDropPatched = true;
    }
    const root = html instanceof HTMLElement ? html : html?.[0];
    root?.querySelectorAll(".samson-open, .samson-import-feat").forEach(button => button.remove());
  });
  if (game.users.activeGM === game.user) {
    phase="职业与规则合集安装";await installSamson();
    phase="旧世界武术模板迁移";
    for(const item of game.items)if(item.flags?.[MODULE_ID]?.martial){
      const update=itemRepairs(item);if(Object.keys(update).length)await applyMartialRepair(item,update);
    }
    phase="PF职业归属同步";await syncWorldPFFeatures();
    phase="角色规则同步";await completeActors();await refreshCantripRule();await expireBuffs();
  }
  phase="贤者之剑职业特性";await registerSwordsageFeatureCache();await syncWorldSwordsageFeatures();
  phase="PF职业能力表";await registerPFFeatureCache();
  api.startup={state:"ready",phase:"初始化完成",libraryInstaller:game.users.activeGM===game.user};
  } catch(error) {
    api.startup={state:"failed",phase,error:error.message};
    console.error(`${MODULE_ID}: startup failed at ${phase}`,error);
    ui.notifications.error(`3r自动化启动未完成（${phase}）：${error.message}`,{permanent:true});
  }
});
