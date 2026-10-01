import { MODULE_ID } from "./catalog.js";
import { allSeeds } from "./content.js";
import { isDivineFavor } from "./spell-text.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";
import { ItemRolls } from "../../../systems/D35E/module/item/extensions/rolls.js";
import { ItemSpellHelper } from "../../../systems/D35E/module/item/helpers/itemSpellHelper.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { ChatAttack } from "../../../systems/D35E/module/item/chat/chatAttack.js";
import { dispatchCharacterAction } from "./character-panel.js";
import { syncProgression, chooseFinesseWeapons, chooseShadowStance, weaponKind } from "./progression.js";
import { ItemChatAction } from "../../../systems/D35E/module/item/chat/chatAction.js";
import { utilityKind, prepareUtility, applyUtility, utilityTime } from "./spell-utilities.js";
import { withBonusDetails, normalizeBonusType } from "./bonus-types.js";
import { ItemEnhancementHelper } from "../../../systems/D35E/module/item/helpers/itemEnhancementHelper.js";
import { throwTanglefoot, escapeTanglefoot, captureTanglefootAttack, clearTanglefoot } from "./tanglefoot.js";
import { installStackingRules } from "./stacking.js";
import { createTransientView } from "./transient-view.js";
import { describeAttackSources, localizeChatHtml } from "./presentation.js";
import { effectDeadline, effectIsActive } from "./effect-state.js";
import { installFragileRules, prepareFragileAttack, finishFragileAttack, fragileDamageOptions, fragileState, weaponFor } from "./fragile.js";
import { installSneakRules, prepareSneakAttack, finishSneakAttack, sneakDamage } from "./sneak-attack.js";
import { applyWeaponFinesse } from "./weapon-finesse.js";

export const key = item => item?.flags?.[MODULE_ID]?.key;
export const has = (actor,k) => actor.items.some(i=>key(i)===k && effectIsActive(i));
export const worldActors = () => {
  const actors = new Map(game.actors.map(actor=>[actor.uuid,actor]));
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink && token.actor) actors.set(token.actor.uuid,token.actor);
  return [...actors.values()];
};
export async function recordAction(actor,type) {
  const combat=game.combat;if(!combat?.started)return;
  const combatant=combat.combatants.find(c=>c.actor?.uuid===actor.uuid);if(!combatant?.isOwner)return;
  if(type==="move")await combatant.setFlag("D35E","usedMoveAction",true);
  else if(type==="standard")await combatant.setFlag("D35E","usedAttackAction",true);
  else if(type==="swift"||type==="immediate") {
    await combatant.setFlag("D35E","usedSwiftAction",true);
    if(type==="immediate"&&combat.current.combatantId!==combatant.id)
      await combatant.setFlag(MODULE_ID,"nextSwiftSpent",true);
  }
}
export const oathPenalty=(target,caster)=>Math.max(0,...target.items.filter(i=>key(i)==="legalistic-oathbreaker"&&i.system.active&&i.getFlag(MODULE_ID,"sourceActor")===caster?.uuid).map(i=>Number(i.getFlag(MODULE_ID,"penalty"))||0));
function resistanceFacade(actor,total) {
  const system=foundry.utils.deepClone(actor.system);system.attributes.sr.total=total;
  // Native resistance dialog retains its optional modifiers without editing the Actor.
  return createTransientView(actor,{system});
}
const report = error => { console.error(MODULE_ID,error); ui.notifications.error(`3r自动化：${error.message}`); };
const activeGM = () => game.users.activeGM === game.user;
export const casterLevel = (item,actor=item.actor) => {
  const data = foundry.utils.deepClone(actor.getRollData()); data.item = foundry.utils.deepClone(item.system);
  ItemSpellHelper.adjustSpellCL(item,data.item,data);
  const cl=Number(data.cl);
  if(!Number.isFinite(cl)||cl<=0)throw new Error(`${item.name}的施法者等级为0或无效，请先关联法术书与施法职业。`);
  return cl;
};
const selfOnly = actor => !game.user.targets.size || (game.user.targets.size===1 && [...game.user.targets][0].actor?.uuid===actor.uuid);
const personalSpell=item=>["personal","self"].includes(item.system.range?.units)||/^(自身|个人|you|self)$/i.test(String(item.system.spellTarget??"").trim());
export const curseLevel = (actor,curse) => {
  const oracle=actor.items.filter(i=>["oracle","dual-cursed-oracle"].includes(key(i))).reduce((n,i)=>n+Number(i.system.levels),0);
  if (actor.getFlag(MODULE_ID,"fixedCurse") === curse) return 1;
  if (!actor.getFlag(MODULE_ID,"fixedCurse")) return Math.min(oracle,4);
  return oracle+Math.floor((Number(actor.system.attributes?.hd?.total??oracle)-oracle)/2);
};
export function timedBuff(name,k,seconds,changes=[],extra={}) {
  if(seconds!=null&&(!Number.isFinite(seconds)||seconds<=0))throw new Error(`${name}的持续时间无效，未创建增益。`);
  const now=game.time.worldTime;
  return {name,type:"buff",img:"icons/svg/aura.svg",system:{active:true,buffType:"temp",changes,
    description:{value:`<p>${name}</p>`},timeline:{enabled:false,total:seconds/6,elapsed:0,deleteOnExpiry:false}},
    flags:{[MODULE_ID]:{key:k,...extra,...(Number.isFinite(seconds)?{expiresAt:now+seconds}:{})},
      ...(Number.isFinite(seconds)?{"d35e-world-timeline":{timer:{start:now,seconds,end:now+seconds}}}:{})}};
}
export async function replaceTimedBuff(actor,data) {
  data.system.description.value=withBonusDetails(data);
  const mark=data.flags[MODULE_ID];
  const old=actor.items.filter(i=>i.type==="buff" && key(i)===mark.key && i.getFlag(MODULE_ID,"sourceActor")===mark.sourceActor
    && (!mark.weaponId||i.getFlag(MODULE_ID,"weaponId")===mark.weaponId));
  if (old.length) await actor.deleteEmbeddedDocuments("Item",old.map(i=>i.id));
  const [result]=await actor.createEmbeddedDocuments("Item",[data]);
  await syncLuck(actor);
  await syncSpellResistance(actor);
  return result;
}
const spellKey = item => isDivineFavor(item)?"favor":
  /虔诚护盾|shield.?of.?faith/i.test(`${item.name} ${key(item)}`)?"shield":
  /enhanced-diplomacy|增强交涉/.test(`${item.name} ${key(item)}`)?"diplomacy":
  /spell-Magic Weapon|魔化武器/.test(`${key(item)} ${item.name}`)?"weapon":null;
export const handlesSpell = item => Boolean(spellKey(item)||utilityKind(item));
export async function applySpellBuff(item, actor=item.actor, {seconds=null,cl=null,targets=null,weaponId=null,...utility}={}) {
  cl=Number(cl)>0&&Number.isFinite(Number(cl))?Number(cl):casterLevel(item,actor);
  if(utilityKind(item))return applyUtility(item,actor,{cl,...utility});
  const kind=spellKey(item);
  if (!kind) return;
  const selected=targets ?? [...game.user.targets].map(t=>t.actor).filter(Boolean);
  if(kind!=="favor" && selected.length>1)throw new Error("这个法术须逐个目标施放，不能同时指定多个目标。");
  const target=kind==="favor"?actor:selected.length===1?selected[0]:actor;
  if (!target.testUserPermission(game.user,"OWNER")) throw new Error("请由GM施放到这个目标；你没有目标的编辑权限。");
  let duration=seconds ?? (kind==="favor"||kind==="diplomacy"?60:60*cl);
  if (seconds==null && target.uuid===actor.uuid && has(actor,"reclusive") && curseLevel(actor,"reclusive")>=5) duration*=2;
  const bonus=kind==="favor"?Math.min(3,Math.max(1,Math.floor(cl/3))):Math.min(5,2+Math.floor(cl/6));
  const changes=kind==="favor"?[[String(bonus),"attack","attack","luck"],[String(bonus),"damage","wdamage","luck"]]
    :kind==="shield"?[[String(bonus),"ac","ac","deflection"]]:[];
  const data=timedBuff(item.name,`spell-effect-${kind}`,duration,changes,{sourceActor:actor.uuid,sourceItemUuid:item.uuid,cl});
  data.img=item.img;
  data.system.description.value=await item.getChatDescription();
  data.flags["d35e-world-timeline"].sourceItemUuid=item.uuid;
  if (kind==="weapon") {
    const weapons=target.items.filter(i=>i.type==="weapon"&&i.system.weaponType!=="natural");
    const id=weaponId??await choose("魔化武器：选择制造武器（不含天然武器）",weapons.map(i=>[i.id,i.name]));
    if (!id) return;
    if(!weapons.some(i=>i.id===id))throw new Error("魔化武器的目标武器已经移除或不符合条件。");
    data.flags[MODULE_ID].weaponId=id;
  }
  await replaceTimedBuff(target,data);
}
export async function choose(title,choices) {
  if (!choices.length) throw new Error("没有符合条件的条目。");
  const escape=t=>String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  return Dialog.prompt({title,content:`<select name="choice">${choices.map(([v,n])=>`<option value="${escape(v)}">${escape(n)}</option>`).join("")}</select>`,label:"确定",rejectClose:false,
    callback:html=>(html[0]??html).querySelector('[name="choice"]').value});
}
const weaponPending=new Map();
async function weaponAttack(item) {
  if (!activeGM()||item.type!=="weapon"||!item.actor||!key(item)||!item.system.equipped) return;
  if (weaponPending.has(item.uuid)) return weaponPending.get(item.uuid);
  const promise=item.actor.createAttackFromWeapon(item,{deleteExistingAttack:false});
  weaponPending.set(item.uuid,promise);
  try { await promise; } finally {weaponPending.delete(item.uuid);}
}
const luckPending=new Set();
const srPending=new Set();
const srSources=actor=>actor.items.filter(i=>key(i)==="covenant-sr"||key(i)==="reclusive");
const srContribution=(actor,sources)=> (actor.sourceDetails?.["system.attributes.sr.total"]??[])
  .filter(row=>sources.some(item=>row.name===item.name||row.name.endsWith(`→ ${item.name}]`)))
  .reduce((n,row)=>n+(Number(row.value)||0),0);
export function spellResistanceValue(actor,excludedCaster=null) {
  const sources=srSources(actor);
  const external=Math.max(0,Number(actor.system.attributes.sr.total)-srContribution(actor,sources));
  return Math.max(external,...sources.filter(item=>effectIsActive(item))
    .filter(item=>key(item)!=="covenant-sr"||item.getFlag(MODULE_ID,"sourceActor")!==excludedCaster)
    .map(item=>Number(item.getFlag(MODULE_ID,"spellResistance"))||0));
}
export async function syncSpellResistance(actor) {
  if(!actor?.isOwner||srPending.has(actor.uuid))return;
  const sources=srSources(actor);if(!sources.length)return;
  srPending.add(actor.uuid);
  try {
    await actor.refresh();
    const external=Math.max(0,Number(actor.system.attributes.sr.total)-srContribution(actor,sources));
    const active=sources.filter(i=>effectIsActive(i));
    const winner=active.sort((a,b)=>Number(b.getFlag(MODULE_ID,"spellResistance")??0)-Number(a.getFlag(MODULE_ID,"spellResistance")??0))[0];
    const updates=[];
    for(const item of sources) {
      const rows=(item.system.changes??[]).filter(r=>r[2]!=="spellResistance");
      const amount=item===winner?Math.max(0,Number(item.getFlag(MODULE_ID,"spellResistance")??0)-external):0;
      if(amount)rows.push([String(amount),"misc","spellResistance","untyped"]);
      if(JSON.stringify(rows)!==JSON.stringify(item.system.changes??[]))updates.push({_id:item.id,"system.changes":rows});
    }
    if(updates.length){await actor.updateEmbeddedDocuments("Item",updates,{stopUpdates:true});await actor.refresh();}
  }finally{srPending.delete(actor.uuid);}
}
export async function syncLuck(actor) {
  if (!actor.isOwner || luckPending.has(actor.uuid)) return;
  luckPending.add(actor.uuid);
  try {
    const enabled=has(actor,"fates-favored"); const updates=[];
    for (const item of actor.items) {
      const old=item.getFlag(MODULE_ID,"luckOriginal");
      const rows=item.system.changes??[];
      if (!enabled && old) {
        const restore=rows.map((r,index)=>old[index]!=null?[old[index],...r.slice(1)]:r);
        updates.push({_id:item.id,"system.changes":restore,[`flags.${MODULE_ID}.-=luckOriginal`]:null});
      } else if (enabled && rows.some(r=>r[3]==="luck")) {
        const originals={};let changed=false;
        const replacement=rows.map((r,index)=> {
          if (r[3]!=="luck")return r;
          const base=old?.[index]??r[0]; originals[index]=base;
          const formula=`((${base}) > 0 ? (${base}) + 1 : (${base}))`;
          if (r[0]!==formula)changed=true;
          return [formula,...r.slice(1)];
        });
        if(changed)updates.push({_id:item.id,"system.changes":replacement,[`flags.${MODULE_ID}.luckOriginal`]:originals});
      }
    }
    if (updates.length) {await actor.updateEmbeddedDocuments("Item",updates,{stopUpdates:true});await actor.refresh();}
  } finally {luckPending.delete(actor.uuid);}
}
export async function completeActors() {
  if (!activeGM())return;
  for (const actor of worldActors()) {
    const witch=actor.items.find(i=>key(i)==="witch");
    if(witch&&has(actor,"witch-watcher")&&!witch.getFlag(MODULE_ID,"watcherSlotsRepaired")) {
      const seed=allSeeds().find(i=>key(i)==="witch");
      if(seed&&JSON.stringify(witch.system.spellsPerLevel)===JSON.stringify(seed.system.spellsPerLevel))
        await witch.update({"system.spellsPerLevel":seed.system.spellsPerLevel.map(([l,...s])=>[l,...s.map(v=>String(Number(v)<0?-1:Number(v)-1))]),[`flags.${MODULE_ID}.watcherSlotsRepaired`]:true});
    }
    for(const spell of actor.items.filter(i=>i.type==="spell" && actor.items.some(c=>["oracle","dual-cursed-oracle"].includes(key(c))))) {
      if(spell.system.components?.divineFocus)await spell.update({"system.components.divineFocus":0});
    }
    for(const weapon of actor.items.filter(i=>i.type==="weapon"&&key(i)))await weaponAttack(weapon);
    const finesse=actor.getFlag(MODULE_ID,"finesseWeapons");
    if(finesse?.some(id=>actor.items.has(id)))await actor.setFlag(MODULE_ID,"finesseWeapons",[...new Set(finesse.map(id=>actor.items.has(id)?weaponKind(actor.items.get(id)):id))]);
    for(const effect of actor.effects.filter(e=>e.getFlag("d35e-world-timeline","autoSpell"))) {
      const spell=await fromUuid(effect.getFlag("d35e-world-timeline","sourceItemUuid")??"").catch(()=>null);
      if(!isDivineFavor(spell))continue;
      const end=effect.getFlag("d35e-world-timeline","timer")?.end;
      if(end>game.time.worldTime)await applySpellBuff(spell,actor,{seconds:end-game.time.worldTime,targets:[]});
      await effect.delete();
    }
    await syncLuck(actor);
    await syncProgression(actor);
    await syncSpellResistance(actor);
  }
}
let castContexts=[];
const promiseAttacks=new Map();
export async function promiseAttack(actor,item) {
  if(promiseAttacks.has(actor.uuid))throw new Error("还有一次履约攻击尚未结算。");
  const record={item:item.id,used:false};promiseAttacks.set(actor.uuid,record);
  try {const result=await item.use();if(result?.roll)await result.roll;return record.used;}
  finally {promiseAttacks.delete(actor.uuid);}
}
export function typedBonus(actor,type,targets,rollData=null) {
  let highest=0;
  const base=foundry.utils.deepClone(rollData??actor.getRollData());
  for(const effect of actor.items) {
    if(!effectIsActive(effect))continue;
    if(["weapon","equipment"].includes(effect.type)&&(!effect.system.equipped||effect.system.melded||effect.broken))continue;
    if(effect.type==="feat"&&effect.hasUnmetRequirements?.(foundry.utils.deepClone(base)).length)continue;
    const groups=[{rows:effect.system.changes??[],data:effect.getRollData()}];
    for(const enhancement of effect.system.enhancements?.items??[]) {
      const data=ItemEnhancementHelper.getEnhancementData(foundry.utils.deepClone(enhancement));
      groups.push({rows:data.changes??[],data:effect.getRollData(),enhancement:data.enh});
    }
    for(const group of groups)for(const row of group.rows) {
      if(normalizeBonusType(row[3])!==type||!targets.includes(row[2]))continue;
      const data={...base,item:group.data,enhancement:group.enhancement};
      highest=Math.max(highest,Number(new Roll35e(String(row[0]),data).evaluateSync().total)||0);
    }
  }
  return highest;
}
const actorForMessage = message => {
  const speaker=message.speaker;
  return (speaker.scene&&speaker.token?game.scenes.get(speaker.scene)?.tokens.get(speaker.token)?.actor:null)??game.actors.get(speaker.actor);
};
async function endWard(actor) {
  const wards=actor?.items.filter(i=>key(i)==="witch-ward"&&i.system.active)??[];
  for(const ward of wards) {
    const caster=await fromUuid(ward.getFlag(MODULE_ID,"sourceActor")??"").catch(()=>null)??game.actors.get(ward.getFlag(MODULE_ID,"sourceActor"));
    await ward.update({"system.active":false});
    ui.notifications.info(`${actor.name}的守护已结束${caster?`（${caster.name}已知晓）`:""}。`);
  }
}
export function activateRules() {
  installStackingRules();
  installFragileRules();
  installSneakRules();
  Hooks.on("updateCombat",combat=> {
    const current=combat.combatant;
    if(current?.isOwner&&current.getFlag(MODULE_ID,"nextSwiftSpent"))
      current.update({"flags.D35E.usedSwiftAction":true,[`flags.${MODULE_ID}.-=nextSwiftSpent`]:null}).catch(report);
  });
  const actorRollData=CONFIG.Actor.documentClass.prototype.getRollData;
  CONFIG.Actor.documentClass.prototype.getRollData=function(...args) {
    const data=actorRollData.apply(this,args);
    data.nobleSelectedAtLevel=Number(this.items.find(i=>key(i)==="noble-scion")?.getFlag(MODULE_ID,"selectedAtLevel"))||0;
    data.celestialGood=["lg","ng","cg","守序善良","中立善良","混乱善良"].includes(this.system.details.alignment)?1:0;
    data.shadowStanceKnown=this.items.some(i=>i.type==="buff"&&i.uuid===this.getFlag(MODULE_ID,"shadowStance"))?1:0;
    const strengthEnhancement=typedBonus(this,"enh",["str"],data);
    data.stoneFistAttackGain=Math.floor((Number(data.abilities?.str?.total??10)+Math.max(0,6-strengthEnhancement)-10)/2)-Number(data.abilities?.str?.mod??0);
    return data;
  };
  Hooks.on("preCreateItem",item=> {
    if(key(item)==="noble-scion"&&item.actor&&!item.getFlag(MODULE_ID,"selectedAtLevel"))
      item.updateSource({[`flags.${MODULE_ID}.selectedAtLevel`]:Math.max(1,Number(item.actor.system.details.level.value)||1)});
  });
  const useSpell=ItemUse.prototype.useSpell;
  ItemUse.prototype.useSpell=async function(ev,options={},actor=this.item.actor) {
    const item=options.replacementItem??this.item;
    const book=actor.system.attributes?.spells?.spellbooks?.[item.system.spellbook??"primary"];
    if(book?.ability && Number(actor.system.abilities[book.ability].total)<10+Number(item.system.level))
      return ui.notifications.warn("施法属性尚未达到10＋法术环级，不能施放。");
    const context={item,actor,targets:personalSpell(item)?[actor]:[...game.user.targets].map(t=>t.actor).filter(Boolean)};
    castContexts.push(context);
    try {
      if(spellKey(item)==="weapon") {
        if(context.targets.length>1)throw new Error("魔化武器请只指定一个目标。");
        const target=context.targets[0]??actor;
        if(!target.isOwner)throw new Error("请由GM向这个目标施放魔化武器。");
        context.weaponId=await choose("魔化武器：选择制造武器",target.items.filter(i=>i.type==="weapon"&&i.system.weaponType!=="natural").map(i=>[i.id,i.name]));
        if(!context.weaponId)return;
      }
      context.cl=casterLevel(item,actor);
      context.utility=await prepareUtility(item,actor,context.cl);
      if(context.utility===false)return;
      return await useSpell.call(this,ev,options,actor);
    } finally{castContexts=castContexts.filter(c=>c!==context);}
  };
  Hooks.on("preCreateChatMessage",message=> {
    const data=message.flags?.D35E?.chatTemplateData;
    if(!data?.isSpell)return;
    const actor=actorForMessage(message);
    const context=castContexts.find(c=>c.item.id===data.item?.id&&c.actor.uuid===actor?.uuid);
    const targets=context&&personalSpell(context.item)?[actor]:data.targets?.length?data.targets.map(t=>canvas.scene?.tokens.get(t.id)?.actor).filter(Boolean):context?.targets??[];
    if(context)message.updateSource({[`flags.${MODULE_ID}.cast`]:{actual:true,automated:handlesSpell(context.item),targetUuids:targets.map(t=>t.uuid),extendSelf:has(actor,"reclusive")&&curseLevel(actor,"reclusive")>=5&&targets.length===1&&targets[0].uuid===actor.uuid,weaponId:context.weaponId,cl:Number(data.cl)>0?Number(data.cl):context.cl,...context.utility}});
  });
  Hooks.on("createChatMessage",message=> {
    if(!activeGM())return;
    const cast=message.getFlag(MODULE_ID,"cast");const data=message.flags?.D35E?.chatTemplateData;
    if(data?.isSpell&&cast?.actual&&cast.automated && !(data.spellFailureSuccess===false && game.settings.get("D35E","fizzleSpellOnArcaneFailure"))) {
      const actor=actorForMessage(message); const item=actor?.items.get(data.item?.id);
      if(!item)return;
      // Native action spells also post their description; only the actual action card creates the buff.
      if(item.hasAction&&message.flags.D35E.template!=="systems/D35E/templates/chat/attack-roll.html")return;
      Promise.all(cast.targetUuids.map(u=>fromUuid(u))).then(targets=>applySpellBuff(item,actor,{cl:cast.cl,weaponId:cast.weaponId,objectUuid:cast.objectUuid,gallons:cast.gallons,targets:targets.filter(Boolean)})).catch(report);
    }
    if(message.flags?.D35E?.template==="systems/D35E/templates/chat/saving-throw.html"&&data?.target&&data.success===false)
      endWard(actorForMessage(message)).catch(report);
    if(message.flags?.D35E?.template==="systems/D35E/templates/chat/attack-roll.html" && data?.targets?.length===1 && data.attacks?.length) {
      const target=canvas.scene?.tokens.get(data.targets[0].id)?.actor;
      if(target&&has(target,"witch-ward")) {
        const ac=Number(target.system.attributes.ac[data.item?.vsTouchAc?"touch":target.system.attributes.conditions?.flatFooted?"flatFooted":"normal"].total);
        if(data.attacks.some(a=>a.hasAttack&&!a.attack.isFumble&&(a.attack.isNatural20||a.attack.total>=ac)))endWard(target).catch(report);
      }
    }
  });
  const attack=ItemRolls.prototype.rollAttack;
  ItemRolls.prototype.rollAttack=async function(options={}) {
    // D35E reads masterwork from this.item.system, not options.data.item.
    // Use a per-roll facade so an enhanced weapon cannot receive both +1s.
    const item=this.item;
    const existing=item.actor?typedBonus(item.actor,"enh",["attack",["mwak","msak"].includes(item.system.actionType)?"mattack":"rattack"]):0;
    const weaponEnh=Number(options.replacedEnh??options.data?.item?.enh??item.system.enh??0);
    const enhanced=weaponEnh>0||existing>0;
    const system=enhanced&&item.system.masterwork?{...item.system,masterwork:false}:null;
    const roller=system?new ItemRolls(createTransientView(item,{system})):this;
    options={...options,...(options.data?{data:foundry.utils.deepClone(options.data)}:{})};
    if(item.actor) {
      if(!options.data) {
        options.data=foundry.utils.deepClone(item.actor.getRollData());
        options.data.item=foundry.utils.mergeObject(foundry.utils.deepClone(item.system),item.getRollData(),{inplace:false});
      }
      applyWeaponFinesse(item,options.data,options);
    }
    if(existing>0)options.replacedEnh=Math.max(0,Math.max(weaponEnh,item.type==="attack"&&item.system.masterwork?1:0)-existing);
    const targets=[...game.user.targets].filter(t=>t.actor);
    const luck=targets.filter(t=>has(t.actor,"witch-protective-luck"));
    if(!options.bonusOnly&&luck.length) {
      if(targets.length!==1)throw new Error("幸庇需要逐目标结算；请只指定一个攻击目标。");
      const bonus=describeAttackSources(await attack.call(roller,{...options,bonusOnly:true}),item.actor);
      const result=await new Roll35e(`2d20kl + (${bonus.total})`,options.data??{}).roll();
      result.descriptionParts=bonus.descriptionParts;
      result.descriptionParts.push({name:"幸庇：攻击掷两次取低",value:"2d20kl"});
      return result;
    }
    return describeAttackSources(await attack.call(roller,options),item.actor);
  };
  const damage=ItemRolls.prototype.rollDamage;
  ItemRolls.prototype.rollDamage=function(options={}) {
    const item=this.item;
    const existing=item.actor?typedBonus(item.actor,"enh",["damage",["mwak","rwak"].includes(item.system.actionType)?"wdamage":"sdamage"]):0;
    const data=options.data?foundry.utils.deepClone(options.data):undefined;
    return damage.call(this,{...options,...(data?{data}:{}),replacedEnh:Math.max(0,Number(options.replacedEnh??0)-existing)});
  };
  const form=ItemUse.prototype.extractFormData;
  ItemUse.prototype.extractFormData=function(...args) {
    const actor=args[13];
    if(actor?.items.some(i=>key(i)==="two-weapon-fighting")) args[25]=Number(actor.system.abilities.dex.total)>=15;
    return form.apply(this,args);
  };
  const addAttack=ChatAttack.prototype.addAttack;
  ChatAttack.prototype.addAttack=async function(options={}) {
    options=prepareFragileAttack(this,options);
    if(!options)return;
    options=prepareSneakAttack(this,options);
    const owner=this.item?.actor;
    const promise=owner&&promiseAttacks.get(owner.uuid);
    if(promise&&promise.item===this.item.id&&!promise.used&&!options.critical) {
      const value=Math.max(0,4-typedBonus(owner,"morale",["attack",this.item.system.actionType==="rwak"?"rattack":"mattack"]));
      options.extraParts=[...(options.extraParts??[]),{part:String(value),value,source:"守律：本次履约（+4士气，按同类最高加值）"}];
      promise.used=true;
    }
    const targets=[...game.user.targets].filter(t=>t.actor);
    // Ward must still contribute AC to this attack; clear it after determining the hit.
    const ac=targets.length===1 ? Number(targets[0].actor.system.attributes.ac[
      this.item?.system.ability?.vsTouchAc?"touch":targets[0].actor.system.attributes.conditions?.flatFooted?"flatFooted":"normal"].total) : null;
    const result=await addAttack.call(this,options);
    finishSneakAttack(this,options);
    await finishFragileAttack(this,options);
    for(const data of [this.attack,this.critConfirm])if(data?.tooltip)data.tooltip=localizeChatHtml(data.tooltip);
    if(!options.critical)captureTanglefootAttack(this);
    if(!options.critical&&ac!=null && !this.attack.isFumble && (this.attack.isNatural20 || this.attack.total>=ac)
      && targets[0].actor.isOwner)await endWard(targets[0].actor);
    return result;
  };
  const addDamage=ChatAttack.prototype.addDamage;
  ChatAttack.prototype.addDamage=function(options={}) {
    if(this._threeRFragileUnavailable)return;
    return addDamage.call(this,fragileDamageOptions(this,options));
  };
  const use=ItemUse.prototype.useAttack;
  ItemUse.prototype.useAttack=async function(...args) {
    const actor=args[1]??this.item.actor;
    if(fragileState(weaponFor(this.item))==="destroyed")return ui.notifications.warn("武器已摧毁，不能攻击。");
    if(actor?.isOwner&&actor.items.some(i=>["buff","aura"].includes(i.type)&&i.system.active&&!effectIsActive(i))) {
      if(activeGM())await processRuleTime();
      await actor.refresh();
    }
    return use.apply(this,args);
  };
  Hooks.on("D35E.ChatAttack.preAddDamage",(chatAttack,options)=> {
    if(chatAttack.rollData.shadowBladeDex!=null)options.extraParts=[...(options.extraParts??[]),[`@critMult*(${chatAttack.rollData.shadowBladeDex})`,"影之刃：敏捷伤害修正（无名加值）","base"]];
    sneakDamage(chatAttack,options);
  });
  Hooks.on("D35E.ItemUse.preRollAllAttacks",(item,data)=> {
    const actor=item.actor; const weapon=actor?.items.get(item.system.originalWeaponId);
    if(weapon) {
      const enchant=actor.items.find(i=>key(i)==="spell-effect-weapon"&&effectIsActive(i)&&i.getFlag(MODULE_ID,"weaponId")===weapon.id);
      if(enchant){data.item.enh=Math.max(Number(data.item.enh)||0,1);data.item.masterwork=false;}
    }
    const choices=actor?.getFlag(MODULE_ID,"finesseWeapons")??[];
    if(has(actor,"finesse-training")&&Number(actor.items.find(i=>key(i)==="unchained-rogue")?.system.levels)>=3&&choices.includes(weaponKind(weapon))&&data.item.ability.damage)data.item.ability.damage="dex";
    const stance=actor?.items.find(i=>i.uuid===actor.getFlag(MODULE_ID,"shadowStance"));
    const shadowWeapon=key(weapon)==="sleeve-blade"||/^(dagger|shortsword|short sword|sai|siangham|spikedchain|spiked chain|unarmedstrike|unarmed strike)$/.test(weaponKind(weapon))||/匕首|短剑|刺链|徒手击打|三叉铁尺|铁尺/.test(weapon?.name??"");
    if(has(actor,"shadow-blade")&&stance?.system.active&&shadowWeapon&&item.system.actionType==="mwak")data.shadowBladeDex=Number(actor.system.abilities.dex.mod);
  });
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=> {
    if(fragileState(weaponFor(item))==="destroyed"){hook.customUse=true;ui.notifications.warn("武器已摧毁，不能使用。");return;}
    if(key(item)==="tanglefoot"){hook.customUse=true;throwTanglefoot(item).catch(report);return;}
    if(key(item)==="tanglefoot-escape"){hook.customUse=true;escapeTanglefoot(actor).catch(report);return;}
    if(key(item)==="shadow-blade"){hook.customUse=true;chooseShadowStance(actor).catch(report);return;}
    const unmet=item.hasUnmetRequirements();
    if(unmet.length){hook.customUse=true;ui.notifications.warn(`${item.name}已选取但暂不生效：${unmet.join("、")}`);return;}
    const needed=item.getFlag(MODULE_ID,"requiresBuff");
    if(needed&&!has(actor,needed)){hook.customUse=true;ui.notifications.warn("对应增益未激活，这项临时攻击不能使用。");return;}
    if(item.getFlag(MODULE_ID,"unselected")){hook.customUse=true;ui.notifications.warn("尚未选择这项启示；请按升级名额正式选择。");return;}
    if(key(item)==="fortune" && Number(actor.items.find(i=>["oracle","dual-cursed-oracle"].includes(key(i)))?.system.levels)<5){hook.customUse=true;ui.notifications.warn("幸运启示须先知5级。");return;}
    if(key(item)==="finesse-training"){hook.customUse=true;chooseFinesseWeapons(actor).catch(report);return;}
    const actions={"protective-luck":"luck",ward:"ward",cackle:"cackle","covenant-ally":"covenant-reset","legalistic":"curse-menu",reclusive:"curse-settings","misfortune":"misfortune",fortune:"fortune",lifebound:"lifebound","samsaran-magic":"samsaran-menu","trapfinding":"trap-menu","sneak-attack":"native-attack"};
    const action=actions[key(item)]??(/^(covenant|samsaran)-(health|safeguard|solace|sr|languages|deathwatch|stabilize)$/.test(key(item)??"")?key(item):null);
    if(action){hook.customUse=true;dispatchCharacterAction(actor,action).catch(report);}
  });
  const rollSkill=CONFIG.Actor.documentClass.prototype.rollSkill;
  CONFIG.Actor.documentClass.prototype.rollSkill=async function(skill,options={}) {
    const diplomacy=this.items.find(i=>key(i)==="spell-effect-diplomacy"&&i.system.active);
    let benefit=null,temporary=null;
    if(has(this,"celestial-agenda")&&["lg","ng","cg","守序善良","中立善良","混乱善良"].includes(this.system.details.alignment)
      && await Dialog.confirm({title:"神圣之路：检定用途",content:"<p>本次技能检定是在欺骗或威胁他人吗？符合时承受−2减值。</p>"}))
      temporary=await replaceTimedBuff(this,timedBuff("神圣之路：欺骗／威胁","celestial-deception-check",null,[["-2","skill",`skill.${skill}`,"penalty"]]));
    const additional=temporary;
    temporary=null;
    if(diplomacy && ["dip","int"].includes(skill) && await Dialog.confirm({title:"使用增强交涉？",content:"<p>本次检定获得+2表现加值，使用后法术结束。</p>"})) {
      benefit=diplomacy;
      temporary=await replaceTimedBuff(this,timedBuff("增强交涉：本次检定","diplomacy-check",null,[["2","skill",`skill.${skill}`,"competence"]]));
    }
    if(skill==="src"&&has(this,"trapfinding")&&await Dialog.confirm({title:"本次是在搜索陷阱吗？",content:"<p>寻找陷阱只对搜索陷阱额外加值；一般搜索不加。</p>"})) {
      const level=Number(this.items.find(i=>key(i)==="unchained-rogue")?.system.levels)||1;
      temporary=await replaceTimedBuff(this,timedBuff("寻找陷阱：本次搜索","trap-search-check",null,[[String(Math.max(1,Math.floor(level/2))),"skill","skill.src","untyped"]]));
    }
    let result;
    try {result=await rollSkill.call(this,skill,options);return result;}
    finally {
      if(temporary&&this.items.has(temporary.id))await temporary.delete();
      if(additional&&this.items.has(additional.id))await additional.delete();
      if(benefit&&result?.total!=null)await benefit.update({"system.active":false});
    }
  };
  Hooks.on("preUpdateActor",(actor,change)=> {
    const next=change["system.attributes.hp.temp"]??change.system?.attributes?.hp?.temp;
    if(next==null || change[`flags.${MODULE_ID}.temporaryHealth`] || change.flags?.[MODULE_ID]?.temporaryHealth)return;
    const record=actor.getFlag(MODULE_ID,"temporaryHealth");
    if(!record?.owner)return;
    const old=Number(actor.system.attributes.hp.temp)||0;
    if(Number(next)<=old)change[`flags.${MODULE_ID}.temporaryHealth`]={...record,amount:Math.max(0,record.amount-(old-Number(next))),other:Math.min(Number(record.other)||0,Math.max(0,Number(next)))};
    else change[`flags.${MODULE_ID}.temporaryHealth`]={...record,owner:null,amount:0,other:Number(next)};
  });
  Hooks.on("createItem",item=> {weaponAttack(item).catch(report);if(item.actor){syncLuck(item.actor).catch(report);syncSpellResistance(item.actor).catch(report);}});
  const expireNewOrChanged=item=> {
    if(item.actor&&item.type==="buff"&&item.system.active&&!effectIsActive(item))processRuleTime().catch(report);
  };
  Hooks.on("createItem",expireNewOrChanged);
  Hooks.on("updateItem",expireNewOrChanged);
  Hooks.on("updateItem",(item,change)=> {if(item.actor && (change.system||Object.keys(change).some(k=>k.startsWith("system.changes")||k==="system.active")))syncLuck(item.actor).catch(report);});
  Hooks.on("updateItem",(item,change)=> {if(item.actor&&(change.system||Object.keys(change).some(k=>k.startsWith("system.changes")||k==="system.active"||k.endsWith(".spellResistance"))))syncSpellResistance(item.actor).catch(report);});
  Hooks.on("updateItem",(item,change)=> {
    if(!activeGM()||!item.actor||key(item)!=="tanglefoot-entangled")return;
    if(change["system.active"]===false||change.system?.active===false)clearTanglefoot(item.actor,item).catch(report);
    else if(change["system.active"]===true||change.system?.active===true)item.actor.update({"system.attributes.conditions.entangled":true}).then(()=>item.actor.refresh()).catch(report);
  });
  Hooks.on("deleteItem",item=> {if(activeGM()&&item.actor&&key(item)==="tanglefoot-entangled")clearTanglefoot(item.actor,item).catch(report);});
  Hooks.on("updateItem",(item,change)=> {if(item.actor&&(change["system.levels"]!=null||change.system?.levels!=null))syncProgression(item.actor).catch(report);});
  Hooks.on("updateActor",(actor,change)=>{if(change[`flags.${MODULE_ID}.fixedCurse`]!=null||change.flags?.[MODULE_ID]?.fixedCurse!=null||change.system?.abilities||change.system?.details?.alignment||Object.keys(change).some(k=>k.startsWith("system.abilities.")||k==="system.details.alignment"))syncProgression(actor).catch(report);});
  Hooks.on("deleteItem",item=> {if(item.actor){syncLuck(item.actor).catch(report);syncSpellResistance(item.actor).catch(report);syncProgression(item.actor).catch(report);}});
  const rest=CONFIG.Actor.documentClass.prototype.rest;
  if(rest)CONFIG.Actor.documentClass.prototype.rest=async function(health,daily,...args) {
    const result=await rest.call(this,health,daily,...args);
    if(daily) {await this.setFlag(MODULE_ID,"samsaranSpells",{used:[]});const record=this.getFlag(MODULE_ID,"covenant");if(record)await this.setFlag(MODULE_ID,"covenant",{...record,used:0,preparedAt:game.time.worldTime});}
    return result;
  };
  Hooks.on("D35E.ItemSpellHelper.postAdjustSpellCL",(item,data)=> {
    const context=castContexts.find(c=>c.item.id===item.id&&c.actor.uuid===item.actor?.uuid);
    if(context&&has(context.actor,"reclusive") && (item.system.spellDurationData?.units==="inst"||item.system.duration?.units==="inst")
      && context.targets.length===1&&context.targets[0].uuid===context.actor.uuid) {data.cl+=1;data.spellPenetration+=1;}
  });
  Hooks.on("preCreateActiveEffect",effect=> {
    const actor=effect.parent;
    if(actor?.documentName!=="Actor" || !has(actor,"reclusive") || curseLevel(actor,"reclusive")<10)return;
    if([...effect.statuses].some(s=>/charm/i.test(s))){ui.notifications.info(`${actor.name}免疫魅惑（隐居诅咒）。`);return false;}
  });
  const chatAction=ItemChatAction._onChatCardAction;
  ItemChatAction._onChatCardAction=async function(event) {
    const button=event.target.closest?.(".card-buttons button");
    const id=button?.closest(".message")?.dataset.messageId;
    const message=game.messages.get(id),caster=message?actorForMessage(message):null;
    if(button?.dataset.action==="rollSR"&&caster) {
      const selected=game.user.targets.size?[...game.user.targets]:canvas.tokens.controlled;
      event.preventDefault();
      for(const token of selected) {
        const target=token.actor;if(!target?.isOwner)continue;
        const exemption=target.items.find(i=>key(i)==="covenant-sr"&&i.system.active&&[caster.id,caster.uuid].includes(i.getFlag(MODULE_ID,"sourceActor")));
        const betrayal=target.items.find(i=>key(i)==="legalistic-oathbreaker"&&i.system.active&&i.getFlag(MODULE_ID,"sourceActor")===caster.uuid);
        if(exemption || betrayal) {
          const resistance=Math.max(0,spellResistanceValue(target,exemption?caster.uuid:null)-oathPenalty(target,caster));
          await CONFIG.Actor.documentClass.prototype.rollSpellPowerResistance.call(resistanceFacade(target,resistance),Number(button.dataset.spellpen),"sr");
        } else await target.rollSpellResistance(Number(button.dataset.spellpen));
      }
      return;
    }
    if(button?.dataset.action==="rollSave"&&caster) {
      const item=caster.items.get(message.flags.D35E.chatTemplateData?.item?.id);
      const selected=game.user.targets.size?[...game.user.targets]:canvas.tokens.controlled;
      if(item && selected.some(t=>t.actor&&(has(t.actor,"reclusive")||oathPenalty(t.actor,caster)))) {
        event.preventDefault();
        for(const token of selected) {
          const target=token.actor;if(!target?.isOwner)continue;
          if(target.uuid!==caster.uuid&&has(target,"reclusive")&&curseLevel(target,"reclusive")>=10&&/charm|魅惑/i.test(item.system.subschool??"")) {
            ui.notifications.info(`${target.name}免疫此魅惑法术。`);continue;
          }
          const penalty=oathPenalty(target,caster);
          let temporary;
          if(penalty)temporary=await replaceTimedBuff(target,timedBuff("守律：抵抗该先知的法术","oathbreaker-save-check",null,[[String(-penalty),"savingThrows","allSavingThrows","penalty"]]));
          try {await target.rollSavingThrow(button.dataset.value,button.dataset.ability,Number(button.dataset.target));}
          finally{if(temporary&&target.items.has(temporary.id))await temporary.delete();}
        }
        return;
      }
    }
    return chatAction.call(this,event);
  };
}
export function within(actor,target,feet) {
  const a=canvas.tokens.placeables.find(t=>t.actor?.uuid===actor.uuid),b=canvas.tokens.placeables.find(t=>t.actor?.uuid===target.uuid);
  if(!a||!b)return false;
  const limit=/^(m|米|公尺|meters?)$/i.test(canvas.scene.grid.units)?feet*0.3:feet;
  return canvas.grid.measurePath([a.center,b.center]).distance<=limit;
}
let timeQueue=Promise.resolve();
export function processRuleTime() {
  timeQueue=timeQueue.catch(report).then(processTime);
  return timeQueue;
}
async function processTime() {
  if(!activeGM())return;
  for(const actor of worldActors()) {
    await utilityTime(actor);
    for(const item of actor.items.filter(i=>i.type==="buff")) {
      if(!item.system.active) {if(key(item)==="covenant-health")await revokeHealth(actor,item);continue;}
      const end=effectDeadline(item);
      if(Number.isFinite(end)&&end<=game.time.worldTime) {
        if(key(item)==="covenant-health")await revokeHealth(actor,item);
        if(key(item)==="tanglefoot-entangled")await clearTanglefoot(actor,item);
        else await item.update({"system.active":false});
      }
    }
    const suppressed=actor.getFlag(MODULE_ID,"suppressedSpells")??[];
    const kept=[];
    for(const entry of suppressed) {
      if(entry.restoreAt>game.time.worldTime){kept.push(entry);continue;}
      const item=await fromUuid(entry.uuid).catch(()=>null);
      if(!item)continue;
      const update=item.type==="buff"?{"system.active":entry.active}:{disabled:entry.disabled};
      if(item.documentName==="ActiveEffect" && Number.isFinite(item.duration.startTime))update["duration.startTime"]=item.duration.startTime+entry.seconds;
      if(entry.end!=null) {
        update[`flags.${MODULE_ID}.expiresAt`]=entry.end+entry.seconds;
        update["flags.d35e-world-timeline.timer"]={start:game.time.worldTime,seconds:Math.max(0,entry.end-entry.started),end:entry.end+entry.seconds};
      }
      await item.update(update);
    }
    if(kept.length!==suppressed.length)await actor.setFlag(MODULE_ID,"suppressedSpells",kept);
    const mental=actor.getFlag(MODULE_ID,"mentalSaves")??[];
    let changed=false;
    for(const entry of mental) {
      if(entry.nextAt>game.time.worldTime||curseLevel(actor,"legalistic")<10)continue;
      const effect=await fromUuid(entry.uuid).catch(()=>null);
      if(!effect || effect.disabled || (effect.type==="buff"&&!effect.system.active)){entry.finished=true;changed=true;continue;}
      let attempts=0;
      while(entry.nextAt<=game.time.worldTime && attempts++<60) {
        const roll=await new Roll35e(`1d20 + @attributes.savingThrows.${entry.save}.total`,actor.getRollData()).roll();
        const die=roll.terms[0].total;
        const passed=die===20||(die!==1&&roll.total>=entry.dc);
        await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`守律：每分钟抵抗${effect.name}，DC${entry.dc}，${passed?"成功，效果结束":"失败"}`});
        entry.nextAt+=60;changed=true;
        if(passed){await effect.update(effect.type==="buff"?{"system.active":false}:{disabled:true});entry.finished=true;break;}
      }
    }
    if(changed)await actor.setFlag(MODULE_ID,"mentalSaves",mental.filter(e=>!e.finished));
  }
}

export async function grantHealth(actor,item,amount) {
  const current=Number(actor.system.attributes.hp.temp)||0;
  const old=actor.getFlag(MODULE_ID,"temporaryHealth");
  const other=old?.owner?Number(old.other)||0:current;
  const active=amount>=other;
  await actor.update({"system.attributes.hp.temp":Math.max(other,amount),[`flags.${MODULE_ID}.temporaryHealth`]:{
    owner:active?item.uuid:null,amount:active?amount:0,other,provided:item.uuid}});
}
async function revokeHealth(actor,item) {
  const record=actor.getFlag(MODULE_ID,"temporaryHealth");
  if(record?.provided!==item.uuid)return;
  if(record.owner===item.uuid)await actor.update({"system.attributes.hp.temp":record.other??0});
  await actor.unsetFlag(MODULE_ID,"temporaryHealth");
}

