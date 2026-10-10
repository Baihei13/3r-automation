import { MODULE_ID } from "./catalog.js";
import { clone,martial,state,getState,classLevel,profileId,martialCombat } from "./martial-state.js";
import { PLANS } from "./martial-plans.js";
import { timedBuff,worldActors } from "./rules-bridge.js";
import { weaponKind } from "./progression.js";
import { applyCondition,actorQueue,syncConditionMarkers } from "./condition-tools.js";
import { conditionState } from "./condition-state.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";
import { ChatAttack } from "../../../systems/D35E/module/item/chat/chatAttack.js";
import { ItemRolls } from "../../../systems/D35E/module/item/extensions/rolls.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";
import { createTransientView } from "./transient-view.js";
import { swordsageFeatureAvailable,syncSwordsageFeatures } from "./martial-class-features.js";
import { installShadowMovement,shadowConcealment,confirmShadowMovement } from "./martial-shadow.js";
import { createCustomChatMessage } from "../../../systems/D35E/module/chat.js";
import { DicePF } from "../../../systems/D35E/module/dice.js";
import { martialEventSource } from "./martial-events.js";
import { installNativeMartialEvents,nativeMartialSave } from "./martial-native.js";
import { chooseClarityTarget,requestClarityTarget,installClarityChoices,feetScale,opposedStanceBonus } from "./martial-context.js";
import { resolveThrow,resolveMinotaur,resolveLeap,resolveEmber,installMartialMapCleanup } from "./martial-map.js";
import { installMartialScent,syncScentTokens } from "./martial-scent.js";
import { installMartialTerrain } from "./martial-terrain.js";
import { installMartialRunup } from "./martial-runup.js";
import { conditionActorLive } from "./condition-jobs.js";
import { bindConditionOperation,martialConditionOptions } from "./condition-policy.js";

const esc=v=>foundry.utils.escapeHTML(String(v??""));
const safeKey=v=>encodeURIComponent(String(v)).replaceAll(".","%2E");
const active=i=>i.type==="buff"&&i.system.active&&i.flags?.[MODULE_ID]?.martialEffect;
const effect=i=>i.flags[MODULE_ID].martialEffect;
const currentStance=actor=>actor.items.find(i=>active(i)&&effect(i).stance);
const total=r=>Array.isArray(r)?r.find(x=>Number.isFinite(x?.total)):r;
const d20=r=>r?.dice?.find(d=>d.faces===20)?.total;
const queues=new Map();
const chosenRolls=new Map();
const serial=(key,work)=>{const next=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(work);queues.set(key,next);return next.finally(()=>{if(queues.get(key)===next)queues.delete(key);});};
const receipt=(actor,id)=>clone(actor.flags?.[MODULE_ID]?.martial?.receipts?.[id]);
const patch=(actor,id,value)=>actor.update({[`flags.${MODULE_ID}.martial.receipts.${id}`]:value},{updateChanges:false,skipMinions:true,skipToken:true});
const post=(actor,content,flags={})=>ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content,flags:{[MODULE_ID]:flags}});
const rollData=actor=>({...actor.getRollData(),martialIL:getState(actor,{readOnly:true}).initiatorLevel});
async function dice(actor,formula,label) {
  const r=await new Roll35e(formula,rollData(actor)).roll();
  await r.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:label});return r;
}
async function cached(actor,id,key,work) {
  let r=receipt(actor,id);if(!conditionActorLive(actor)||!r)throw new Error("武术来源已删除，未追加结算。");if(r.steps[key]!==undefined)return r.steps[key];
  const value=await work();r=receipt(actor,id);if(!conditionActorLive(actor)||!r)throw new Error("武术来源已删除，未追加结算。");r.steps[key]=value;await patch(actor,id,r);return value;
}
const dcFor=(actor,item,p,r)=>p.dc==="skill"?Number(r.steps.skill?.total):10+martial(item).level+Number(actor.system.abilities[p.dcAbility||"wis"].mod||0);
const physical=item=>{const uid=item?.system.damage?.parts?.[0]?.[2];return uid&&uid!=="base"?uid:"damage-slashing";};
const typeFor=(type,item)=>type==="base"?physical(item):type;
const targetDocs=async ids=>(await Promise.all((ids??[]).map(uuid=>fromUuid(uuid)))).filter(a=>a?.documentName==="Actor");

async function makeEffect(target,actor,item,id,{changes=[],until=null,seconds=null,marker={},stance=false}={}) {
  if(!conditionActorLive(target)||!conditionActorLive(actor))throw new Error("效果来源或目标已删除，未创建效果。");
  const stamp=`${id}:${target.uuid}:${marker.role??"effect"}`;
  const old=target.items.find(i=>effectSafe(i)?.stamp===stamp);if(old)return old;
  const origin=state(actor),targetTurn=Number(state(target).turn)||0;
  const clockActor=until?.startsWith("target")?target:actor;
  const combat=martialCombat(clockActor);
  const deadline=until?{actor:clockActor.uuid,phase:until.endsWith("end")?"end":"start",turn:until.startsWith("target")?targetTurn:origin.turn||0,
    until,combatId:combat?.id??null,round:combat?.round??null}:null;
  const data=timedBuff(item.name,`martial-effect-${martial(item).definition}`,seconds,changes,{sourceActor:actor.uuid,sourceItemUuid:item.uuid,
    martialEffect:{definition:martial(item).definition,stamp,stance,deadline,profile:martial(item).profile,...marker}});
  data.img=item.img;data.system.description.value=item.system.description.value;
  return (await target.createEmbeddedDocuments("Item",[data]))[0];
}
const effectSafe=i=>i?.flags?.[MODULE_ID]?.martialEffect;

// Native DR/ER calculation is performed once; applying HP and its receipt is one
// Actor update. A repeated card click cannot subtract HP or ability damage again.
async function applyOutcome(target,actor,item,id,parts,{saved=false,abilities={},energyDrain=0,death=false,bypassDR=false,weapon=null}={}) {
  const stamp=`${safeKey(id)}:${safeKey(target.uuid)}`;
  return actorQueue(target,async()=>{
    if(target.flags?.[MODULE_ID]?.martialApplied?.[stamp])return;
    const hp=target.system.attributes.hp;
    let damage={damage:0,nonLethalDamage:0,damagePoolPossibleReductionsUpdate:[]};
    if(parts.length) {
      const calculation=()=>ActorDamageHelper.calculateDamageToActor(target,parts.map(p=>({damageTypeUid:p.type,roll:{total:p.total}})),weapon?.system.material,weapon?.system.alignment,Number(weapon?.system.enh)||0,false,false,false,false);
      const bypass=Hooks.on("D35E.DamageRoll.preCalculateDamage",(a,v)=>{if(a.uuid===target.uuid&&bypassDR)v.dr=[];});
      try{damage=calculation();}finally{Hooks.off("D35E.DamageRoll.preCalculateDamage",bypass);}
      // Pool deductions have their own marker and never run twice.
      for(const reduction of damage.damagePoolPossibleReductionsUpdate??[]) {
        const pool=target.items.get(reduction.id);if(!pool)continue;
        if(pool.flags?.[MODULE_ID]?.martialPoolReceipts?.[stamp])continue;
        await target.updateDamageReductionPoolItems([reduction]);
        if(!conditionActorLive(target))return;
        if(target.items.get(pool.id)!==pool)continue;
        await pool.update({[`flags.${MODULE_ID}.martialPoolReceipts.${stamp}`]:true});
      }
    }
    if(!conditionActorLive(target))return;
    const incoming=Math.max(0,Number(damage.damage)||0),temp=Math.max(0,Number(hp.temp)||0),absorbed=Math.min(incoming,temp);
    const update={"system.attributes.hp.value":death?-10:Number(hp.value)-incoming+absorbed,"system.attributes.hp.temp":temp-absorbed,
      "system.attributes.hp.nonlethal":Number(hp.nonlethal||0)+Math.max(0,Number(damage.nonLethalDamage)||0),
      [`flags.${MODULE_ID}.martialApplied.${stamp}`]:{at:game.time.worldTime,damage:incoming,saved,source:actor.uuid}};
    for(const [ability,amount] of Object.entries(abilities))update[`system.abilities.${ability}.damage`]=Number(target.system.abilities[ability].damage||0)+amount;
    if(energyDrain)update["system.attributes.energyDrain"]=Number(target.system.attributes.energyDrain||0)+energyDrain;
    await target.update(update);
    await post(actor,`<p>${esc(item.name)} → ${esc(target.name)}：${incoming}点伤害${Object.keys(abilities).length?"，属性伤害已记入":""}${energyDrain?`，负向等级 ${energyDrain}`:""}${death?"，死亡效果":""}。</p>`);
  });
}

export async function leaveMartialStance(actor) {
  const old=actor.items.filter(i=>effectSafe(i)?.stance||effectSafe(i)?.definition==="child-of-shadow"&&effectSafe(i)?.role==="event-concealment");if(old.length)await actor.deleteEmbeddedDocuments("Item",old.map(i=>i.id));
  await syncScentTokens(actor);
}
export async function enterMartialStance(actor,item,context,id) {
  const p=PLANS[martial(item).definition];
  const existing=actor.items.find(i=>effectSafe(i)?.stamp===`${id}:${actor.uuid}:effect`);
  if(!existing){await leaveMartialStance(actor);await makeEffect(actor,actor,item,id,{changes:p.changes??[],stance:true,marker:{context,description:p.note}});}
  if(martial(item).definition==="stance-of-clarity")await chooseClarityTarget(actor,context.focusTarget);
  await syncScentTokens(actor);
  await post(actor,`<p>进入架势：${esc(item.name)}。</p>`);
}

export async function expireMartial(clockActor,phase) {
  if(game.users.activeGM!==game.user)return;
  if(phase==="start")await requestClarityTarget(clockActor);
  for(const actor of worldActors()) {
    const due=actor.items.filter(i=>active(i)&&effect(i).deadline?.actor===clockActor.uuid&&effect(i).deadline.phase===phase);
    for(const i of due) {
      const m=effect(i);
      if(m.ongoing&&phase==="start") {
        const id=`ongoing:${i.id}:${m.ongoing.turns}`;
        const r=await dice(clockActor,m.ongoing.damage,`${i.name}：持续伤害`);
        await applyOutcome(actor,clockActor,i,id,[{type:m.ongoing.type,total:r.total}]);
        const left=m.ongoing.turns-1;
        if(left>0){await i.update({[`flags.${MODULE_ID}.martialEffect.ongoing.turns`]:left});continue;}
      }
      await actor.deleteEmbeddedDocuments("Item",[i.id]);
    }
  }
}

async function attackRoll(actor,item,id,weapon,bonus=0) {
  const r=receipt(actor,id),p=PLANS[martial(item).definition],data=rollData(actor);data.item=clone(weapon.system);
  data.martialCommand={definition:martial(item).definition,context:r.context,id,skillSuccess:r.steps.skill?.success};
  const attacks=[{bonus,label:item.name}];Hooks.call("D35E.ItemUse.preRollAllAttacks",weapon,data,attacks,game.user.id);
  const chat=new ChatAttack(weapon,item.name,actor,data);await chat.addAttack({bonus:attacks[0].bonus,critConfirmBonus:r.steps.skill?.success===false?0:p.criticalBonus||0});
  return {attack:clone(chat.attack),confirmation:clone(chat.critConfirm),data:clone(chat.rollData)};
}
async function weaponDamage(actor,item,id,weapon,{critical=false,saved=false,low=false,special=true}={}) {
  const r=receipt(actor,id),p=PLANS[martial(item).definition],a=r.steps.attack,data=clone(a.data);
  const skill=r.steps.skill,success=skill?.success;
  const extra=(!special&&(p.requiresCritical||p.living))?null:p.extraSaved?(saved?p.extraSaved:p.extraFailed):p.skill&&!success?null:p.extra;
  const parts=extra?[[extra[0],"武技附加伤害",typeFor(extra[1],weapon)]]:[];
  if(p.twoDice&&low)parts.push(["1d6","影刃术：低骰命中","energy-cold"]);
  if(p.replacementSkill) {
    const value=Number(r.steps.replacementDamage.total)*p.replacementMultiplier;
    return [{type:physical(weapon),total:value}];
  }
  if(p.pure) {
    if(!extra)return [];
    const roll=await dice(actor,extra?.[0]??"0",item.name+"：伤害");return [{type:typeFor(extra?.[1]??"base",weapon),total:roll.total}];
  }
  const hook={extraParts:parts,primaryAttack:true,critical,multiattack:0,modifiers:[]};
  Hooks.call("D35E.ChatAttack.preAddDamage",{item:weapon,rollData:data},hook,game.user.id);
  hook.extraParts=hook.extraParts.map(v=>[v[0],v[1],v[2]==="base"?physical(weapon):v[2]]);
  const rolls=await new ItemRolls(weapon).rollDamage({data,critical,extraParts:hook.extraParts,modifiers:hook.modifiers});
  const result=[];for(const entry of rolls){const roll=entry.roll??entry;await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:item.name+"：伤害"});result.push({type:p.convertFire?"energy-fire":entry.damageTypeUid,total:roll.total});}
  if(p.multiplier&&success) {
    // Extra dice are never multiplied. Native critical multiplication is additive
    // with this maneuver multiplier; repeating base damage supplies the delta.
    const fixed=hook.extraParts.filter(part=>String(part[0]).startsWith("@critMult*"));
    for(let n=1;n<p.multiplier;n++) {
      const bases=await new ItemRolls(weapon).rollDamage({data,extraParts:fixed,critical:false});
      for(const entry of bases){await (entry.roll??entry).toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:item.name+"：普通伤害倍率附加骰"});result.push({type:entry.damageTypeUid,total:(entry.roll??entry).total});}
    }
  }
  return result;
}

async function card(actor,item,id,r,detail="") {
  await item.roll();if(detail)await post(actor,detail);
}

// Use the installed system's card, dice, damage buttons and defense dialog.
// No copied card template and no universal DM resolution gate for new uses.
async function nativeAttackCard(actor,item,id,r,weapon) {
  const p=PLANS[martial(item).definition];
  const slot=Number(r.steps.nativeIndex)||0;
  if(game.messages.some(m=>m.flags?.[MODULE_ID]?.nativeMartial?.id===id&&m.flags[MODULE_ID].nativeMartial.actor===actor.uuid&&(m.flags[MODULE_ID].nativeMartial.slot||0)===slot))return;
  const seed=weapon.toObject();delete seed._id;
  const dual=p.sequence==="dual";
  seed.name=dual?`${item.name}：${slot===0?"主手":"副手"}（${weapon.name}）`:item.name;seed.img=item.img;
  seed.system.description=clone(item.system.description);
  seed.system.shortDescription=item.system.shortDescription;
  seed.system.activation=clone(item.system.activation);
  if(martial(item).definition==="mighty-throw") {
    seed.type="attack";seed.system.actionType="mwak";seed.system.attackType="weapon";
    seed.system.ability={attack:"str",damage:"",critRange:21,critMult:1};
    seed.system.damage={parts:[["0","","damage-bludgeoning"]]};seed.system.enh=0;seed.system.damageBonus="";seed.system.attackParts=[];
  }
  if(p.mode==="area") {
    seed.type="attack";seed.system.actionType="save";seed.system.attackType="spell";
    seed.system.damage={parts:[[p.damage||"0","",p.type||"energy-force"]]};
    seed.system.ability={attack:"",damage:"",critRange:20,critMult:1};
    seed.system.attackParts=[];seed.system.enh=0;seed.system.damageBonus="";
  }
  let skillSuccess=true;
  if(p.skill) {
    const target=(await targetDocs(r.context.targets))[0],dc=p.dc==="ac"?Number(target?.system.attributes.ac.normal.total):Number(p.dc);
    const v=await cached(actor,id,"skill",async()=>{const roll=total(await actor.rollSkill(p.skill,{skipDialog:true,...martialConditionOptions(actor,id)}));if(!roll)throw new Error("技能检定未完成，未生成攻击。");return {total:roll.total,success:Number.isFinite(dc)?roll.total>=dc:null};});
    skillSuccess=v.success;
    if(p.jumpOver&&skillSuccess===null) {
      const answer=await foundry.applications.api.DialogV2.wait({window:{title:`DM：${item.name}的实际跳跃`},rejectClose:false,content:`<p>跳跃检定${v.total}。按实际目标高度和起跳情况，是否已成功跃过目标？</p>`,buttons:[{action:"yes",label:"成功跃过",callback:()=>true},{action:"no",label:"未跃过",callback:()=>false}]});
      skillSuccess=answer===true;
      const current=receipt(actor,id);current.steps.skill.success=skillSuccess;await patch(actor,id,current);
    }
    if(p.abortOnSkillFail&&!skillSuccess){await post(actor,`<p>${esc(item.name)}：技能检定失败，招式已消耗，没有攻击。</p>`);return;}
  }
  if(p.replacementSkill)await cached(actor,id,"replacementDamage",async()=>{const roll=total(await actor.rollSkill(p.replacementSkill,{skipDialog:true,...martialConditionOptions(actor,id)}));if(!roll)throw new Error("替代伤害检定未完成。");return {total:roll.total};});
  seed.flags??={};seed.flags[MODULE_ID]={...(seed.flags[MODULE_ID]??{}),martialAttack:{definition:martial(item).definition,id,context:r.context,native:true,single:true,skillSuccess}};
  seed.system.ability.vsTouchAc=Boolean(p.touch||martial(item).definition==="mighty-throw");
  const dc=p.save?dcFor(actor,item,p,receipt(actor,id)):null;
  // Native spell-only DC bonuses do not raise a maneuver's fixed source DC.
  seed.system.save={dc:dc?`${dc}-@featSpellDCBonus`:"",type:p.save?`${{fort:"fortitude",ref:"reflex",will:"will"}[p.save]}${p.mode==="area"&&p.save==="ref"?"half":"partial"}`:"",ability:"",description:""};
  const temporary=new CONFIG.Item.documentClass(seed,{parent:actor});
  bindConditionOperation(temporary,{...martialConditionOptions(actor,id),threeRConditionCommitted:true});
  const progress=receipt(actor,id);
  const meta={id,slot,sequence:p.sequence,dualState:dual?(slot===0?"ready":Number(progress.steps.nativeIndex)>0?"ready":"waiting"):undefined,area:p.mode==="area",areaDamage:Boolean(p.damage),actor:actor.uuid,item:item.id,weapon:r.context.weaponId,targets:r.context.targets,dc,save:p.save,bypassDR:Boolean(p.bypassDR),flatFooted:Boolean(p.flatFooted&&skillSuccess)};
  const hook=Hooks.on("preCreateChatMessage",message=>{
    if(message.speaker.actor===actor.id&&message.flags?.D35E?.template==="systems/D35E/templates/chat/attack-roll.html"&&message.flags.D35E.chatTemplateData?.name===seed.name)
      message.updateSource({[`flags.${MODULE_ID}.nativeMartial`]:meta});
  });
  try {const result=await new ItemUse(temporary).useAttack({skipDialog:true,isFullAttack:false,temporaryItem:true,attackType:dual&&slot===1?"offhand-normal":"primary"},null,true);await result?.roll;}
  finally{Hooks.off("preCreateChatMessage",hook);chosenRolls.delete(id);}
  if(p.selfChanges)await makeEffect(actor,actor,item,id,{changes:p.selfChanges,until:p.until,marker:{role:"self"}});
}

async function nextNativeAttack(actor,item,id,previewIndex=null) {
  const p=PLANS[martial(item).definition],r=receipt(actor,id),index=previewIndex??(Number(r.steps.nativeIndex)||0);
  if(r.steps.nativeStopped)return;
  const weapons=[...new Set([r.context.weaponId,r.context.secondWeaponId].filter(Boolean))];
  if(p.sequence==="dual"&&index>=2||p.extraAttacksPerWeapon&&index>=weapons.length*p.extraAttacksPerWeapon)return;
  const targets=await targetDocs(r.context.targets);
  let target=targets[0];
  if(p.sequence==="path"||p.extraAttacksPerWeapon&&targets.length>1) {
    const remaining=targets.filter(t=>!(r.steps.nativeVisited??[]).includes(t.uuid));if(!remaining.length)return;
    if(remaining.length===1)target=remaining[0];
    else {const answer=await ask(`${item.name}：下一击目标`,`<label>原选目标<select name="target">${remaining.map(t=>`<option value="${esc(t.uuid)}">${esc(t.name)}</option>`).join("")}</select></label>`);if(!answer)return;target=remaining.find(t=>t.uuid===answer.target);}
  }
  if(!target)return;
  const weaponId=p.extraAttacksPerWeapon?weapons[Math.floor(index/p.extraAttacksPerWeapon)]:p.sequence==="dual"&&index===1?r.context.secondWeaponId:r.context.weaponId;
  const weapon=actor.items.get(weaponId);if(!weapon)throw new Error("下一击的武器来源已移除。");
  const seed=weapon.toObject();delete seed._id;
  if(p.sequence==="avalanche")seed.system.attackBonus=`(${seed.system.attackBonus||0})-${4*index}`;
  const temporary=new CONFIG.Item.documentClass(seed,{parent:actor});
  await nativeAttackCard(actor,item,id,{...r,steps:{...r.steps,nativeIndex:index},context:{...r.context,weaponId,targets:[target.uuid]}},temporary);
}
async function advanceNativeAttack(actor,item,id,target,hit,slot) {
  const p=PLANS[martial(item).definition];if(!(p.sequence&&!p.full||p.extraAttacksPerWeapon))return;
  const r=receipt(actor,id),index=Number(r.steps.nativeIndex)||0;
  // A repeated application resumes any failed continuation without advancing
  // the attack count twice or applying the weapon damage again.
  if(index===slot) {
    r.steps.nativeIndex=index+1;
    if(p.sequence==="path")r.steps.nativeVisited=[...(r.steps.nativeVisited??[]),target.uuid];
    if(p.sequence==="avalanche"&&!hit||(p.sequence==="avalanche"||p.sequence==="dual"||p.sameTarget)&&Number(target.system.attributes.hp.value)<=-1)r.steps.nativeStopped=true;
    await patch(actor,id,r);
  }
  if(p.sequence==="dual") {
    for(const message of game.messages.filter(m=>m.flags?.[MODULE_ID]?.nativeMartial?.id===id&&m.flags[MODULE_ID].nativeMartial.actor===actor.uuid)) {
      const meta=message.flags[MODULE_ID].nativeMartial;
      const state=meta.slot<Number(r.steps.nativeIndex)?"resolved":r.steps.nativeStopped?"stopped":"ready";
      if(meta.dualState!==state)await message.setFlag(MODULE_ID,"nativeMartial.dualState",state);
    }
  }
  await nextNativeAttack(actor,item,id);
}

async function applyNativeMartialHit(message,target,{hit,crit,special=true}) {
  const meta=message.flags[MODULE_ID].nativeMartial,actor=await fromUuid(meta.actor),item=actor?.items.get(meta.item);
  if(!item)return;
  const p=PLANS[martial(item).definition],id=meta.id,key=`nativeSpecial:${meta.slot||0}:${safeKey(target.uuid)}`;
  let r=receipt(actor,id);if(!r)return;
  if(r.steps[key]){await advanceNativeAttack(actor,item,id,target,r.steps[key].hit,meta.slot||0);return;}
  if(!hit){r.steps[key]={hit:false};await patch(actor,id,r);await advanceNativeAttack(actor,item,id,target,false,meta.slot||0);return;}
  if(martial(item).definition==="mighty-throw") {
    await resolveThrow(actor,item,id,r,target,{cache:cached,condition:applyCondition,post});
    r=receipt(actor,id);r.steps[key]={hit:true};await patch(actor,id,r);return;
  }
  if(p.requiresCritical&&!special){r.steps[key]={hit:true,special:false};await patch(actor,id,r);await advanceNativeAttack(actor,item,id,target,true,meta.slot||0);return;}
  let saved=false;
  if(p.save) {
    const prior=nativeMartialSave(message,target);
    if(prior)saved=prior.success;
    else {
      const roll=total(await target.rollSavingThrow(p.save,null,meta.dc,{skipDialog:true,threeRSourceMessage:message.id}));
      if(!roll)throw new Error("本次豁免尚未完成，请从原生卡继续，武器伤害不会重复应用。");
      const counter=message.flags?.[MODULE_ID]?.counterSaves?.[safeKey(target.uuid)];
      saved=nativeMartialSave(message,target)?.success??(counter?.skill?roll.total>=meta.dc:d20(roll)===20||d20(roll)!==1&&roll.total>=meta.dc);
    }
  }
  const abilities={};
  const damage=saved?p.savedAbilityDamage??(p.halfAbility?p.abilityDamage:{}):p.abilityDamage;
  for(const [ability,formula] of Object.entries(damage??{})) {
    const value=await cached(actor,id,`nativeAbility:${meta.slot||0}:${safeKey(target.uuid)}:${ability}`,async()=>({total:(await dice(actor,formula,item.name+"：属性伤害")).total}));
    abilities[ability]=saved&&p.halfAbility?Math.floor(value.total/2):value.total;
  }
  if(p.fiveShadow) {
    const branch=(await cached(actor,id,`nativeFiveBranch:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,"1d20",item.name+"：五影蔓延部位")).total}))).total;
    const keys=branch<=7?["dex"]:branch<=14?["str"]:["dex","str",...(saved?[]:["con"])];
    for(const ability of keys){const v=await cached(actor,id,`nativeFiveAbility:${safeKey(target.uuid)}:${ability}`,async()=>({total:(await dice(actor,"2d6",item.name+"：五影属性伤害")).total}));abilities[ability]=saved?Math.floor(v.total/2):v.total;}
    if(!saved&&branch<=14) {
      const changes=branch<=7?[["0","speed","landSpeed","base-replace"]]:[["-6","attack","attack","untyped"],["-6","skill","skill.coc","untyped"]];
      const seconds=(await cached(actor,id,`nativeFiveDuration:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,"1d6",item.name+"：特殊效果持续轮数")).total}))).total*6;
      await makeEffect(target,actor,item,id,{changes,seconds,marker:{role:"five-shadow"}});
    }
  }
  let levels=0;if(!saved&&p.negativeLevels)levels=(await cached(actor,id,`nativeLevels:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,p.negativeLevels,item.name)).total}))).total;
  if(Object.keys(abilities).length||levels||!saved&&p.death)await applyOutcome(target,actor,item,`${id}:special:${meta.slot||0}`,[],{saved,abilities,energyDrain:levels,death:!saved&&p.death});
  if(p.selfDR)await makeEffect(actor,actor,item,id,{until:p.until,marker:{dr:p.selfDR,role:"self"}});
  if(!saved) {
    if(p.condition) {
      const seconds=p.durationRoll?(await cached(actor,id,`nativeDuration:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,p.durationRoll,item.name+"：持续轮数")).total}))).total*6:p.seconds;
      await applyCondition(target,p.condition,{sourceActor:actor,sourceItemUuid:item.uuid,sourceName:item.name,seconds,receipt:id,context:{martial:true}});
      const origin=target.items.find(i=>i.flags?.[MODULE_ID]?.conditionReceipt===id);
      if(origin&&p.until)await origin.update({[`flags.${MODULE_ID}.martialEffect`]:{definition:martial(item).definition,deadline:{actor:target.uuid,phase:p.until.endsWith("end")?"end":"start"}}});
    }
    if(p.changes||p.missChance||p.restriction||p.immobilize)await makeEffect(target,actor,item,id,{changes:p.changes??[],until:p.until,seconds:p.until?null:p.seconds*(p.criticalDuration&&crit?Number(actor.items.get(meta.weapon)?.system.ability.critMult)||1:1),marker:{restriction:p.restriction,immobilize:p.immobilize,missChance:p.missChance}});
  }else if(p.halfChanges)await makeEffect(target,actor,item,id,{changes:p.changes.map(v=>[String(Number(v[0])/2),...v.slice(1)]),seconds:p.seconds,marker:{role:"half-effect"}});
  if(p.ongoing)await makeEffect(target,actor,item,id,{until:"target-start",marker:{role:"ongoing",ongoing:p.ongoing}});
  if(p.extraSaved||p.secondary||p.zone||p.criticalConfirmation||p.movement||p.distanceRoll||p.bypassHardness)
    await post(actor,`<p>${esc(item.name)}：原生武器伤害及已接入的豁免/状态已处理。${p.extraSaved?"按豁免变化的附加伤害尚需DM依全文应用。":""}${p.secondary||p.zone?"次级范围或路线效果需DM处理。":""}${p.movement||p.distanceRoll?"地图落点需DM处理。":""}</p>`);
  r=receipt(actor,id);r.steps[key]={hit:true,saved};await patch(actor,id,r);await advanceNativeAttack(actor,item,id,target,true,meta.slot||0);
}

async function executeNativeCounter(actor,item,id,r) {
  const p=PLANS[martial(item).definition],source=martialEventSource(r.context.eventKey);
  if(!source)throw new Error("敌方事件已结束或重载，请由DM按发动记录处理；不猜测DC或重复消耗。");
  if(p.skill) {
    const roll=total(await actor.rollSkill(p.skill,{skipDialog:true,...martialConditionOptions(actor,id)}));
    if(!roll)throw new Error("应对技能检定未完成。");
    if(p.replaces==="ac")source.ac=roll.total;
    else {source.roll=roll;source.skillSave=true;source.success=roll.total>=source.dc;}
    await post(actor,`<p>${esc(item.name)}：${p.replaces==="ac"?"本次攻击以察言观色检定结果替代AC":"本次豁免使用专注检定，天然1不自动失败"}。</p>`);
  }else if(p.saveBonus) {
    const il=getState(actor,{readOnly:true}).initiatorLevel,buff=await makeEffect(actor,actor,item,id,{changes:[[String(il),"savingThrows",source.save,"untyped"]],marker:{role:"counter-save"}});
    try{await actor.refresh();source.roll=total(await actor.rollSavingThrow(source.save,null,source.dc,{skipDialog:true,threeRNativeSave:true}));}finally{await actor.deleteEmbeddedDocuments("Item",[buff.id]);await actor.refresh();}
  }else if(p.opposedAbility) {
    const enemy=await fromUuid(source.attacker),ability=r.context.opposedAbility;
    if(!enemy||!["str","dex"].includes(ability))throw new Error("冲锋来源或对抗属性已改变。");
    const sizes=["fine","dim","tiny","sm","med","lg","huge","grg","col"],a=sizes.indexOf(actor.system.traits.actualSize??actor.system.traits.size),b=sizes.indexOf(enemy.system.traits.actualSize??enemy.system.traits.size);
    const bonus=a>=0&&b>=0&&(ability==="str"?a>b:a<b)?4:0;
    const extras=[bonus+opposedStanceBonus(actor,enemy,ability),opposedStanceBonus(enemy,actor,ability)];
    const mods=[actor,enemy].map((who,i)=>Number(who.system.abilities[ability].mod)+Number(who.system.abilities[ability].checkMod||0)-Number(who.system.attributes.energyDrain||0)+extras[i]);
    let won;
    for(let attempt=0;attempt<10;attempt++) {
      const values=[];
      for(const [who,extra] of [[actor,extras[0]],[enemy,extras[1]]])values.push(total(await DicePF.d20Roll({parts:["@mod+@checkMod-@drain+@extra"],data:{mod:who.system.abilities[ability].mod,checkMod:who.system.abilities[ability].checkMod||0,drain:Number(who.system.attributes.energyDrain)||0,extra},title:`${item.name}：${ability==="str"?"力量":"敏捷"}对抗${attempt?"（同值同修正重掷）":""}`,speaker:ChatMessage.getSpeaker({actor:who}),fastForward:true,chatTemplate:"systems/D35E/templates/chat/roll-ext.html"})));
      if(values[0].total!==values[1].total){won=values[0].total>values[1].total;break;}
      if(mods[0]!==mods[1]){won=mods[0]>mods[1];break;}
    }
    if(won===undefined){source.unresolved=true;await post(actor,"<p>连续同值同修正，对抗仍未分胜负；本次冲锋攻击保持未掷，由DM续掷对抗。</p>");return;}
    source.blocked=won;source.chargeBonus=won?0:2;
    await post(actor,`<p>${esc(item.name)}：${won?"冲锋攻击被阻止。可选的两格推离由DM在地图上处理":"对抗失败，敌方本次冲锋攻击额外+2"}。</p>`);
  }else if(p.defense)source.defense=Number(p.defense);
  else if(p.opposedAttack) {
    const weapon=actor.items.get(r.context.weaponId),chat=new ChatAttack(weapon,item.name,actor,rollData(actor));await chat.addAttack();
    const wins=chat.attack.total>Number(source.attack?.total);
    if(wins){source.blocked=true;source.redirect=p.redirect;}
    await createCustomChatMessage("systems/D35E/templates/chat/attack-roll.html",{name:item.name,actor,item:weapon,attacks:[chat],hasBoxInfo:true,extraText:`<p>${wins?"对抗成功；重定向使用敌方原攻击与伤害，DM选择合法新目标":"对抗未成功，敌方攻击照常"}。</p>`,hasExtraText:true},{speaker:ChatMessage.getSpeaker({actor}),"flags.D35E.noRollRender":true},{rolls:chat.rolls});
  }else await item.roll();
  if(source.roll&&source.sourceMessage) {
    const message=game.messages.get(source.sourceMessage);
    if(message)await message.setFlag(MODULE_ID,`counterSaves.${safeKey(actor.uuid)}`,{save:source.save,roll:source.roll.toJSON(),skill:Boolean(source.skillSave)});
  }
}

export async function executeMartial(actor,item,r,id) {
  const p=PLANS[martial(item).definition],context=r.context;
  if(!p)throw new Error("招式参数未登记。");
  if(martial(item).kind==="stance") {
    await enterMartialStance(actor,item,context,id);await actor.update({[`flags.${MODULE_ID}.martial.activeStance`]:item.id});
  } else if(p.mode==="boost") {
    if(p.condition&&p.condition!=="incorporeal") {
      await applyCondition(actor,p.condition,{sourceActor:actor,sourceItemUuid:item.uuid,sourceName:item.name,receipt:id,context:{martial:true}});
      const marker=actor.items.find(i=>i.flags?.[MODULE_ID]?.conditionReceipt===id);
      if(marker)await marker.update({[`flags.${MODULE_ID}.martialEffect`]:{definition:martial(item).definition,deadline:{actor:actor.uuid,phase:p.until==="start"?"start":"end"}}});
    }
    await makeEffect(actor,actor,item,id,{changes:p.changes??[],until:p.until,seconds:p.until?null:p.seconds,marker:{plan:clone(p)}});
    if(p.condition==="incorporeal")await post(actor,"<p>虚体的穿墙、AC、物理免疫与50%几率按完整虚体规则由DM结算；此效果标记不改角色永久生物类型。</p>");
    await post(actor,`<p>${esc(item.name)}已发动。</p><p>${esc(p.note??"附加攻击效果应用于持续时间内的近战攻击。")}</p>`);
    if(p.extraAttacksPerWeapon)await nextNativeAttack(actor,item,id);
    if(p.rend||p.trigger)await card(actor,item,id,receipt(actor,id),`<p>额外攻击使用原生攻击卡；撕裂与倒地事件的真实触发仍需DM按全文处理。</p>`);
  } else if(p.mode==="attack") {
    let weapon=actor.items.get(context.weaponId);
    if(p.pure)weapon=new CONFIG.Item.documentClass({name:item.name,type:"attack",system:{actionType:p.touch==="ranged"?"rwak":"mwak",attackType:"weapon",proficient:true,ability:{attack:p.touch==="ranged"?"dex":"str",damage:"",critRange:20,critMult:2},damage:{parts:[["0","","base"]]},activation:{type:martial(item).action,cost:1}}},{parent:actor});
    if(!weapon)throw new Error("原生攻击已移除；保留发动记录，恢复同一操作时请处理攻击来源。");
    if(p.sequence&&!p.full){
      await nextNativeAttack(actor,item,id);
      // Wolf Fang Strike has exactly two known weapon attacks. Show both
      // native rolls now, but permit the second application only after the
      // first outcome; a defeated target cancels the second preview.
      if(p.sequence==="dual")await nextNativeAttack(actor,item,id,1);
      r=receipt(actor,id);r.status="done";r.result={state:"performed",kind:r.kind,commandId:id};await patch(actor,id,r);return r.result;
    }
    if(!p.full&&!p.sequence){await nativeAttackCard(actor,item,id,r,weapon);r=receipt(actor,id);r.status="done";r.result={state:"performed",kind:r.kind,commandId:id};await patch(actor,id,r);return r.result;}
    if(p.skill)await cached(actor,id,"skill",async()=>{const roll=total(await actor.rollSkill(p.skill,{skipDialog:true,...martialConditionOptions(actor,id)}));if(!roll)throw new Error("技能骰未完成。");return {total:roll.total,success:roll.total>=Number(context.dc)};});
    r=receipt(actor,id);
    if(p.abortOnSkillFail&&r.steps.skill?.success===false){await post(actor,`<p>${esc(item.name)}：跳跃失败，招式已消耗，没有攻击。</p>`);}
    else if(p.full||["dual","path","avalanche"].includes(p.sequence)) {
      // Native full attacks retain the character's actual iterative/off-hand data.
      // Sequential attacks cannot all be rolled up front: each hit controls continuation.
      if(p.sequence&&!p.full)await card(actor,item,id,r,`<p>连续攻击的后续次数与路径仍需DM按全文处理，不能把未实现的事件链当成普通攻击。</p>`);
      else {
        await cached(actor,id,"nativeFull",async()=>{
          const seed=weapon.toObject();delete seed._id;seed.flags??={};seed.flags[MODULE_ID]={...seed.flags[MODULE_ID],martialAttack:{definition:martial(item).definition,id,context}};
          const temporary=new CONFIG.Item.documentClass(seed,{parent:actor});
          bindConditionOperation(temporary,{...martialConditionOptions(actor,id),threeRConditionCommitted:true});
          for(let n=0;n<(p.sequence==="two-full"?2:1);n++){const result=await new ItemUse(temporary).useAttack({skipDialog:true,isFullAttack:true,temporaryItem:true});await result?.roll;}
          return true;
        });await post(actor,`<p>${esc(item.name)}：已生成原生全回合攻击卡；命中与伤害通过原生卡结算。</p>`);
      }
    }else {
      await cached(actor,id,"attack",()=>attackRoll(actor,item,id,weapon,(p.attackBonus||0)+(p.skill&&r.steps.skill?.success===false?p.skillFailPenalty||0:0)));
      if(p.twoDice)await cached(actor,id,"attackSecond",()=>attackRoll(actor,item,id,weapon));
      if(p.replacementSkill)await cached(actor,id,"replacementDamage",async()=>{const roll=total(await actor.rollSkill(p.replacementSkill,{skipDialog:true,...martialConditionOptions(actor,id)}));if(!roll)throw new Error("替代伤害检定未完成。");return {total:roll.total};});
      if(p.selfChanges)await makeEffect(actor,actor,item,id,{changes:p.selfChanges,until:p.until,marker:{role:"self"}});
      await card(actor,item,id,receipt(actor,id),p.twoDice?`<p>第二个攻击骰 ${receipt(actor,id).steps.attackSecond.attack.total}；低骰命中才加寒冷伤害。</p>`:"");
    }
  } else if(p.mode==="counter") {
    await executeNativeCounter(actor,item,id,r);
  }else if(p.mode==="movement") {
    if(martial(item).definition==="sudden-leap") {
      await resolveLeap(actor,item,id,r,{cache:cached,condition:applyCondition,post});
      r=receipt(actor,id);r.status="done";r.result={state:"performed",kind:r.kind,commandId:id};await patch(actor,id,r);return r.result;
    }
    if(p.skill)await cached(actor,id,"movementSkill",async()=>{const roll=total(await actor.rollSkill(p.skill,{skipDialog:true,...martialConditionOptions(actor,id)}));if(!roll)throw new Error("移动技能检定未完成。");return {total:roll.total};});
    await card(actor,item,id,receipt(actor,id),`<p>移动结果${receipt(actor,id).steps.movementSkill?`：跳跃 ${receipt(actor,id).steps.movementSkill.total}`:""}；请按原文在地图移动至合法落点。这里不会替代地图碰撞、跳跃距离与借机判断。</p>`);
  }else if(p.mode==="area") {
    await nativeAttackCard(actor,item,id,r,item);
  }else if(p.mode==="throw"||p.mode==="opposed") {
    if(martial(item).definition==="mighty-throw") {
      const touch=new CONFIG.Item.documentClass({name:item.name,type:"attack",system:{actionType:"mwak",attackType:"weapon",proficient:true,baseWeaponType:"unarmed",ability:{attack:"str",damage:"",critRange:21,critMult:1},damage:{parts:[["0","","damage-bludgeoning"]]},activation:{type:"standard",cost:1}}},{parent:actor});
      await nativeAttackCard(actor,item,id,r,touch);
      r=receipt(actor,id);r.status="done";r.result={state:"performed",kind:r.kind,commandId:id};await patch(actor,id,r);return r.result;
    }
    if(martial(item).definition==="charging-minotaur") {
      const target=(await targetDocs(context.targets))[0];if(!target)throw new Error("冲撞目标已不存在。");
      await resolveMinotaur(actor,item,id,r,target,{cache:cached,damage:applyOutcome,post,makeEffect});
      r=receipt(actor,id);r.status="done";r.result={state:"performed",kind:r.kind,commandId:id};await patch(actor,id,r);return r.result;
    }
    await cached(actor,id,"opposed",async()=>{const a=Number(actor.system.abilities.str.mod)||0,b=Number(actor.system.abilities.dex.mod)||0;const roll=await dice(actor,`1d20+${p.mode==="throw"?Math.max(a,b):a}+${p.throwBonus??p.bonus??0}`,item.name+"：对抗初骰（体型/专长由DM补正）");return {total:roll.total};});
    await card(actor,item,id,receipt(actor,id),`<p>对抗初骰 ${receipt(actor,id).steps.opposed.total}。先确认接触攻击、体型、对抗修正与移动要求，再确认差额、距离及落点。</p>`);
  }else if(martial(item).definition==="distracting-ember")await resolveEmber(actor,item,id,r,{cache:cached,makeEffect,post});
  else await card(actor,item,id,r,`<p>${esc(p.note)}。这是场景/动作权限声明；不会凭空召唤战斗单位或额外推进先攻。</p>`);
  r=receipt(actor,id);r.status="done";r.result={state:"performed",kind:r.kind,commandId:id};await patch(actor,id,r);return r.result;
}

async function ask(title,content) {
  return foundry.applications.api.DialogV2.wait({window:{title},rejectClose:false,content:`<form>${content}</form>`,buttons:[{action:"ok",label:"确认",callback:(_e,_b,d)=>Object.fromEntries(new FormData(d.element.querySelector("form")))}]});
}
async function resolveCard(actor,id) {
  if(!game.user.isGM)throw new Error("实际场景结算由DM确认。");
  return serial(`${actor.uuid}:${id}`,async()=>{
    let r=receipt(actor,id),item=actor.items.get(r?.itemId);if(!item)throw new Error("武术发动来源已删除。");
    const p=PLANS[martial(item).definition];let targets=await targetDocs(r.context.targets);
    if(p.mode==="counter"||p.mode==="scene"||p.mode==="initiative"||p.mode==="extra-action") {
      const answer=await ask(item.name,`<p>${esc(p.note??p.trigger)}</p><p>此项由DM对照实际事件结算；不会替换敌方攻击或先攻。</p><label><input name="confirmed" type="checkbox" value="yes" required>已按全文处理事件</label>`);
      if(answer?.confirmed==="yes")await post(actor,`<p>${esc(item.name)}：DM确认事件已处理。</p>`);return;
    }
    if(p.mode==="movement") {
      if(r.steps.moved)return;
      const {tokenUuid,x,y}=r.context,token=tokenUuid?await fromUuid(tokenUuid):null;
      if(!token||token.actor?.uuid!==actor.uuid||x===""||y===""||!Number.isFinite(Number(x))||!Number.isFinite(Number(y)))throw new Error("未提供可用落点；请按卡片移动，系统不会猜位置。");
      const answer=await ask(item.name,`<p>${esc(p.note)}</p><label><input name="legal" type="checkbox" value="yes" required>路线、距离、落点与借机已处理</label>`);
      if(answer?.legal!=="yes")return;
      await token.update({x:Number(x),y:Number(y),[`flags.${MODULE_ID}.martialMoveReceipt`]:id});r.steps.moved=true;await patch(actor,id,r);return;
    }
    if(!targets.length)throw new Error("发动时没有选择目标；不能把后来选中的目标当成原目标。请由DM按全文处理或重新发动另一招。");
    const single=p.mode==="attack"&&!p.full&&p.sequence!=="path"||["throw","opposed"].includes(p.mode)&&p.sequence!=="path-throws";
    if(single&&targets.length!==1)throw new Error("单体招式的原始目标不唯一；请由DM处理这张旧卡，不能向每个目标重复应用同一攻击。");
    if(p.extraAttacksPerWeapon&&targets.length>1) {
      const index=Number(r.steps.sequenceIndex)||0,key=`sequenceTarget:${index}`;
      if(!r.steps[key]) {
        const answer=await ask(item.name+"：下一击目标",`<label>本次额外攻击<select name="target">${targets.map(t=>`<option value="${esc(t.uuid)}">${esc(t.name)}</option>`).join("")}</select></label>`);
        if(!answer)return;r.steps[key]=answer.target;await patch(actor,id,r);
      }
      targets=targets.filter(t=>t.uuid===r.steps[key]);
      if(!targets.length)throw new Error("本击记录的目标已移除，请由DM按原记录处理。");
    }
    for(const target of targets) {
      if(r.steps[`resolved:${safeKey(target.uuid)}`])continue;
      const sequence=p.mode==="attack"&&p.sequence&&!p.full||Boolean(p.extraAttacksPerWeapon);
      if(sequence) {
        const index=Number(r.steps.sequenceIndex)||0;
        if(p.sequence==="dual"&&index>=2||r.steps.sequenceStopped)break;
        const weapons=[...new Set([r.context.weaponId,r.context.secondWeaponId].filter(Boolean))];
        if(p.extraAttacksPerWeapon&&index>=weapons.length*p.extraAttacksPerWeapon)break;
        const weaponId=p.extraAttacksPerWeapon?weapons[Math.floor(index/p.extraAttacksPerWeapon)]:p.sequence==="dual"&&index===1?r.context.secondWeaponId:r.context.weaponId;
        r.steps.sequenceWeaponId=weaponId;await patch(actor,id,r);
        await cached(actor,id,`attack:${index}`,()=>attackRoll(actor,item,id,actor.items.get(weaponId),(p.attackBonus||0)+(p.sequence==="avalanche"?-4*index:0)));
        r=receipt(actor,id);r.steps.attack=r.steps[`attack:${index}`];await patch(actor,id,r);
      }
      const a=r.steps.attack;
      const answer=await ask(`${item.name} → ${target.name}`,`${a?`<p>攻击 ${a.attack.total}；重击确认 ${a.confirmation.total}</p><label>命中结果<select name="hit"><option value="hit">命中</option><option value="critical">确认重击</option><option value="miss">未命中</option></select></label>`:""}${p.rend?'<label>本目标两把武器总命中数<input name="hits" type="number" min="0" value="0"></label>':""}${p.twoDice?'<label>采用的攻击骰<select name="die"><option value="high">高骰</option><option value="low">低骰（命中加寒冷伤害）</option></select></label>':""}<label>豁免<select name="save"><option value="roll">掷原生豁免</option><option value="success">DM确认成功</option><option value="failed">DM确认失败</option><option value="immune">免疫本次特殊效果</option></select></label><label><input name="specialAllowed" type="checkbox" value="yes" checked>特殊效果适用（重击免疫、活物、接地、体型已确认）</label>${p.scaleDistance?'<label>投掷对抗胜出差额<input name="margin" type="number" value="0" min="0"></label>':""}<label><input name="confirmed" type="checkbox" value="yes" required>已核对全文目标条件、失手率、抗力、强击与伤害减免；确认应用</label>`);
      if(answer?.confirmed!=="yes")return;
      if(p.twoDice){const pair=[r.steps.attack,r.steps.attackSecond].sort((x,y)=>x.attack.total-y.attack.total);r.steps.attack=pair[answer.die==="low"?0:1];await patch(actor,id,r);}
      const chosen=r.steps.attack;
      let hit=answer.hit!=="miss"&&(!chosen||!chosen.attack.isFumble&&!chosen.attack.conditionMiss);
      const concealment=shadowConcealment(target),concealKey=`shadowMiss:${safeKey(target.uuid)}:${sequence?r.steps.sequenceIndex||0:0}`;
      if(hit&&chosen&&(concealment||r.steps[concealKey])) {
        const v=await cached(actor,id,concealKey,async()=>{
          const chance=Math.max(concealment,Number(target.system.attributes?.concealment?.total)||0),roll=await dice(actor,"1d100",`${item.name}：${target.name}掩蔽（${chance}%）`);
          return {total:roll.total,chance,miss:roll.total<=chance};
        });
        if(v.miss){hit=false;await post(actor,`<p>${esc(item.name)}因${esc(target.name)}的掩蔽失手。</p>`);}
      }
      const critical=hit&&answer.hit==="critical"&&!PLANS[effectSafe(currentStance(target))?.definition]?.criticalImmune;
      let saved=answer.save==="success",special=answer.specialAllowed==="yes"&&answer.save!=="immune";
      if(hit&&p.save&&special&&answer.save==="roll") {
        const v=await cached(actor,id,`save:${safeKey(target.uuid)}`,async()=>{const roll=total(await target.rollSavingThrow(p.save,null,dcFor(actor,item,p,r),{skipDialog:true}));if(!roll)throw new Error("豁免骰未完成。");const die=d20(roll);return {total:roll.total,success:die===20||die!==1&&roll.total>=dcFor(actor,item,p,r)};});saved=v.success;
      }
      let parts=[];
      if(hit&&(p.mode==="attack"||p.extraAttacksPerWeapon))parts=await cached(actor,id,`damage:${safeKey(target.uuid)}:${sequence?r.steps.sequenceIndex||0:0}`,()=>weaponDamage(actor,item,id,actor.items.get(r.steps.sequenceWeaponId||r.context.weaponId),{critical,saved,special,low:answer.die==="low"}));
      if(p.rend&&Number(answer.hits)>=2){const roll=await cached(actor,id,`rend:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,`${Math.min(20,4+2*Number(answer.hits))}d6`,item.name+"：撕裂")).total}));parts=[{type:physical(actor.items.get(r.context.weaponId)),total:roll.total}];}
      if(hit&&p.mode==="area"&&r.steps.areaDamage)parts=[{type:r.steps.areaDamage.type,total:r.steps.areaDamage.total}];
      if(hit&&["throw","opposed"].includes(p.mode)&&p.damage) {
        const formula=p.scaleDamage?`${2+Math.floor(Number(answer.margin||0)/5)}d6`:p.damage;
        const v=await cached(actor,id,`throwDamage:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,formula,item.name)).total}));parts=[{type:"damage-bludg",total:v.total}];
      }
      const armor=target.items.find(i=>i.type==="equipment"&&i.system.equipped&&i.system.equipmentType==="armor"),canEvade=!conditionState(target).helpless&&(!armor||armor.system.equipmentSubtype==="lightArmor");
      if(p.mode==="area"&&saved) {
        const evasion=p.save==="ref"&&(swordsageFeatureAvailable(target,"evasion")||swordsageFeatureAvailable(target,"improved-evasion"))&&canEvade;
        parts=parts.map(v=>({...v,total:evasion?0:Math.floor(v.total/2)}));
      }else if(p.mode==="area"&&!saved&&p.save==="ref"&&swordsageFeatureAvailable(target,"improved-evasion")&&canEvade)parts=parts.map(v=>({...v,total:Math.floor(v.total/2)}));
      const abilities={};
      if(hit&&special) {
        const damage=saved?p.savedAbilityDamage??(p.halfAbility?p.abilityDamage:{}):p.abilityDamage;
        for(const [ability,formula] of Object.entries(damage??{})) {
          const v=await cached(actor,id,`ability:${safeKey(target.uuid)}:${ability}`,async()=>({total:(await dice(actor,formula,item.name+"：属性伤害")).total}));abilities[ability]=saved&&p.halfAbility?Math.floor(v.total/2):v.total;
        }
      }
      let fiveChanges=[],fiveSeconds=null;
      if(hit&&special&&p.fiveShadow) {
        const branch=(await cached(actor,id,`fiveBranch:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,"1d20",item.name+"：五影蔓延部位")).total}))).total;
        const keys=branch<=7?["dex"]:branch<=14?["str"]:["dex","str",...(saved?[]:["con"])];
        for(const ability of keys){const v=await cached(actor,id,`fiveAbility:${safeKey(target.uuid)}:${ability}`,async()=>({total:(await dice(actor,"2d6",item.name+"：五影属性伤害")).total}));abilities[ability]=saved?Math.floor(v.total/2):v.total;}
        if(!saved&&branch<=14){fiveChanges=branch<=7?[["0","speed","landSpeed","base-replace"]]:[["-6","attack","attack","untyped"],["-6","skill","skill.coc","untyped"]];fiveSeconds=(await cached(actor,id,`fiveDuration:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,"1d6",item.name+"：特殊效果持续轮数")).total}))).total*6;}
      }
      let levels=0;if(hit&&special&&!saved&&p.negativeLevels)levels=(await cached(actor,id,`levels:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,p.negativeLevels,item.name)).total}))).total;
      const outId=sequence?`${id}:attack:${r.steps.sequenceIndex||0}`:id;
      if(hit)await applyOutcome(target,actor,item,outId,parts,{saved,abilities,energyDrain:levels,death:special&&!saved&&p.death,bypassDR:p.bypassDR,weapon:actor.items.get(r.context.weaponId)});
      if(hit&&p.selfDR)await makeEffect(actor,actor,item,id,{until:p.until,marker:{dr:p.selfDR,role:"self"}});
      if(hit&&special&&!saved) {
        if(p.condition) {
          const seconds=p.durationRoll?(await cached(actor,id,`duration:${safeKey(target.uuid)}`,async()=>({total:(await dice(actor,p.durationRoll,item.name+"：持续轮数")).total}))).total*6:p.seconds;
          await applyCondition(target,p.condition,{sourceActor:actor,sourceItemUuid:item.uuid,sourceName:item.name,seconds,receipt:outId,context:{martial:true}});
          // Attach phase expiry to the exact source condition marker, not to the
          // target's shared condition boolean (which may have another origin).
          const origin=target.items.find(i=>i.flags?.[MODULE_ID]?.conditionReceipt===outId);
          if(origin&&p.until)await origin.update({[`flags.${MODULE_ID}.martialEffect`]:{definition:martial(item).definition,deadline:{actor:target.uuid,phase:p.until.endsWith("end")?"end":"start"}}});
        }
        if(p.changes||p.missChance||p.restriction||p.immobilize)await makeEffect(target,actor,item,id,{changes:p.changes??[],until:p.until,seconds:p.until?null:p.seconds*(p.criticalDuration&&critical?Number(actor.items.get(r.context.weaponId)?.system.ability.critMult)||1:1),marker:{restriction:p.restriction,immobilize:p.immobilize,missChance:p.missChance}});
      }
      if(fiveChanges.length)await makeEffect(target,actor,item,id,{changes:fiveChanges,seconds:fiveSeconds,marker:{role:"five-shadow"}});
      if(hit&&special&&saved&&p.halfChanges)await makeEffect(target,actor,item,id,{changes:p.changes.map(v=>[String(Number(v[0])/2),...v.slice(1)]),seconds:p.seconds,marker:{role:"half-effect"}});
      if(hit&&p.ongoing)await makeEffect(target,actor,item,id,{until:"target-start",marker:{role:"ongoing",ongoing:p.ongoing}});
      if(hit&&(p.secondary||p.zone||p.criticalConfirmation||p.movement||p.distanceRoll||p.bypassHardness||p.negativeLevels))await post(actor,`<p>${esc(item.name)}：${esc(target.name)}仍需DM按全文处理${p.secondary?"次级范围与次级目标":""}${p.zone?"路线火墙与每次进入/行动开始伤害":""}${p.criticalConfirmation?"攻击者针对该目标的重击确认加值":""}${p.movement||p.distanceRoll?"实际落点/换位":""}${p.bypassHardness?"物品硬度绕过":""}${p.negativeLevels?"24小时后解除负向等级，豁免不造成永久失级":""}。本卡不把未处理部分冒充完成。</p>`);
      r=receipt(actor,id);
      if(sequence) {
        r.steps.sequenceIndex=(Number(r.steps.sequenceIndex)||0)+1;
        if(p.sequence==="avalanche"&&!hit||Number(target.system.attributes.hp.value)<=-1)r.steps.sequenceStopped=true;
        if(p.sequence==="path")r.steps[`resolved:${safeKey(target.uuid)}`]=true;
      }else r.steps[`resolved:${safeKey(target.uuid)}`]=true;
      await patch(actor,id,r);
      if(sequence)break;
    }
  });
}

export async function configureSwordsage(actor) {
  if(!classLevel(actor))throw new Error("先加入贤者之剑职业。");
  await syncSwordsageFeatures(actor);
  const name="武术知识",existing=Object.entries(actor.system.skills).find(([key,s])=>key==="martialLore"||s.name===name);
  if(!existing)await actor.update({"system.skills.martialLore":{name,ability:"int",rank:0,notes:"战斗卷册；辨识流派专攻的招式时额外+2，仅该用途。",mod:0,rt:true,cs:true,acp:false,background:false,custom:true}});
  await post(actor,"<p>已配置武术知识技能，保留已有技能投入。贤者之剑的先攻与感知AC读取职业等级和已选条件；武器/轻甲擅长按职业全文确认，不自动覆盖角色既有擅长。</p>");
}
export async function senseMagic(actor) {
  if(!swordsageFeatureAvailable(actor,"sense"))throw new Error("感知魔法需要贤者之剑7级且未停用。");
  const answer=await ask("感知魔法：十分钟",'<p>仅武器或盔甲；神器与传承武器不适用。</p><label>物品施法者等级<input name="cl" type="number" min="0" required></label><label><input name="legal" type="checkbox" value="yes" required>已检查目标限制并完成十分钟专注</label>');
  if(answer?.legal!=="yes")return {state:"cancelled"};
  const r=await dice(actor,`1d20+${classLevel(actor)}`,"感知魔法：职业等级检定");
  await post(actor,`<p>DC ${10+Number(answer.cl)}；${r.total>=10+Number(answer.cl)?"成功，由DM揭示性质":"失败，没有得知性质"}。世界时间由DM推进。</p>`);return {state:"performed"};
}

export async function martialEvent(actor) {
  if(!game.user.isGM)throw new Error("架势的敌方事件由DM确认。");
  const stance=currentStance(actor),p=PLANS[effectSafe(stance)?.definition],item=actor.items.get(state(actor).activeStance);
  if(!stance||!item)throw new Error("当前没有武术架势。");
  if(p.event==="critical-hit")throw new Error("嗜血读取原生攻击应用时的实际重击结果，不另行手动增加层数。");
  const answer=await ask(`${item.name}：事件`, `<p>${esc(p.note??p.event??"此架势的数值持续生效。")}</p><label><input name="confirmed" type="checkbox" value="yes" required>已核对事件真实发生及本架势全部条件</label>`);
  if(answer?.confirmed!=="yes")return {state:"cancelled"};
  const id=foundry.utils.randomID();
  if(p.event==="melee-miss")await makeEffect(actor,actor,item,id,{changes:[["2","ac","ac","dodge"]],until:"start",marker:{role:"event-ac"}});
  else if(p.damage) {
    const targets=await targetDocs([...game.user.targets].filter(t=>t.actor).map(t=>t.actor.uuid)),roll=await dice(actor,p.damage,item.name+"：事件伤害");
    for(const target of targets)await applyOutcome(target,actor,item,id,[{type:typeFor(p.type??"base",item),total:roll.total}]);
  }else if(p.event==="moved-ten")await confirmShadowMovement(actor);
  else await post(actor,`<p>${esc(item.name)}：事件条件已由DM确认；${esc(p.note??"对抗修正、移动、借机或目标选择按全文由DM处理。")}。</p>`);
  return {state:"performed"};
}

const preferred={
  "desert-wind":/scimitar|falchion|spear|light.?pick|light.?mace|曲刀|弯刀|大砍刀|弯刃大刀|矛|轻型?镐|轻型硬头锤/i,
  "diamond-mind":/bastard.?sword|katana|rapier|short.?spear|trident|重剑|细剑|短矛|三叉戟/i,
  "setting-sun":/short.?sword|quarterstaff|nunchaku|unarmed|shortsword|短剑|木杖|长棍|双节棍|徒手/i,
  "shadow-hand":/dagger|sai|siangham|short.?sword|spiked.?chain|unarmed|匕首|短剑|刺链|铁尺|十手|破魔锥|徒手/i,
  "stone-dragon":/great.?sword|great.?axe|heavy.?mace|unarmed|巨剑|巨斧|重型硬头锤|徒手/i,
  "tiger-claw":/kukri|kama|hand.?axe|great.?axe|unarmed|claw|反曲刀|镰|手斧|巨斧|徒手|爪/i
};
const preferredWeapon=(actor,item,flow)=>{const weapon=actor.items.get(item.system.originalWeaponId)??item;return preferred[flow]?.test(`${weaponKind(weapon)} ${weapon.name}`);};
export function installMartialEffects() {
  installShadowMovement();
  installMartialMapCleanup();
  installMartialScent();
  installMartialTerrain();
  installMartialRunup();
  installClarityChoices();
  installNativeMartialEvents(applyNativeMartialHit);
  const nativeAttack=ItemRolls.prototype.rollAttack;
  ItemRolls.prototype.rollAttack=async function(options={}) {
    const item=this.item,command=item.flags?.[MODULE_ID]?.martialAttack,p=PLANS[command?.definition],weapon=item.actor?.items.get(item.system.originalWeaponId);
    let roller=this;
    if(swordsageFeatureAvailable(item.actor,"proficiency")&&weapon&&["simple","martial"].includes(weapon.system.weaponType)&&["light","1h","2h"].includes(weapon.system.weaponSubtype)&&!item.system.proficient) {
      const system={...item.system,proficient:true};roller=new ItemRolls(createTransientView(item,{system}));
      if(options.data)options={...options,data:{...options.data,item:{...options.data.item,proficient:true}}};
    }
    if(!command?.native||!p?.twoDice||chosenRolls.has(command.id))return nativeAttack.call(roller,options);
    chosenRolls.set(command.id,true);
    const records=await cached(item.actor,command.id,"nativeTwoDice",async()=>{
      const rolls=[await nativeAttack.call(roller,{...options,data:clone(options.data)}),await nativeAttack.call(roller,{...options,data:clone(options.data)})];
      return rolls.map(roll=>({roll:roll.toJSON(),descriptionParts:clone(roll.descriptionParts)}));
    });
    const values=records.map(record=>{const roll=Roll35e.fromData(record.roll);roll.descriptionParts=clone(record.descriptionParts);return roll;}),sorted=[...values].sort((a,b)=>d20(a)-d20(b)),same=d20(sorted[0])===d20(sorted[1]);
    const answer=await cached(item.actor,command.id,"nativeTwoDiceChoice",async()=>{
      const choice=same?"low":await foundry.applications.api.DialogV2.wait({window:{title:item.name},rejectClose:false,content:`<p>两个d20为${d20(values[0])}、${d20(values[1])}。只选一个用于同一次攻击；低骰命中额外1d6寒冷。</p>`,buttons:[{action:"high",label:"采用高骰",callback:()=>"high"},{action:"low",label:"采用低骰",callback:()=>"low"}]});
      if(!choice)throw new Error("两骰结果已保留，请继续未完成发动，选择本次采用的攻击骰。");
      return choice;
    });
    options.data.martialCommand.low=same||answer==="low";
    return sorted[options.data.martialCommand.low?0:1];
  };
  const nativeDamage=ItemRolls.prototype.rollDamage;
  ItemRolls.prototype.rollDamage=async function(options={}) {
    const command=options.data?.martialCommand,p=PLANS[command?.definition];
    if(!command?.native)return nativeDamage.call(this,options);
    const data=clone(options.data);
    if(p?.replacementSkill||p?.pure||p?.mode==="area"||command.definition==="mighty-throw") {
      data.item.ability.damage="";data.item.enh=0;data.item.damageBonus="";data.attributes.damage={general:0,weapon:0,spell:0};
      for(const key of Object.keys(data))if(key.startsWith("featDamage"))delete data[key];
      if(p.replacementSkill){data.item.damage.parts=[[String(receipt(this.item.actor,command.id).steps.replacementDamage.total*p.replacementMultiplier),"",physical(this.item)]];options={...options,critical:false,extraParts:[]};}
    }
    const result=await nativeDamage.call(this,{...options,data});
    if(p?.multiplier&&command.skillSuccess)for(let n=1;n<p.multiplier;n++)result.push(...await nativeDamage.call(this,{...options,data:clone(data),critical:false,extraParts:(options.extraParts??[]).filter(part=>String(part[0]).startsWith("@critMult*"))}));
    return result;
  };
  const original=CONFIG.Actor.documentClass.prototype.getRollData;
  CONFIG.Actor.documentClass.prototype.getRollData=function(...args) {
    const data=original.apply(this,args),level=classLevel(this);
    // This wrapper also runs for ordinary actors during sheet/HUD updates.
    // They have no Swordsage choices or effects to calculate.
    if(!profileId(this)) {
      data.martialQuickToAct=0;data.martialDefense=0;data.martialWisAC=0;
      data.martialIL=Math.floor(Math.max(0,Number(this.system.attributes?.hd?.total)||0)/2);
      return data;
    }
    const s=getState(this,{readOnly:true}),c=conditionState(this);
    const armor=this.items.find(i=>i.type==="equipment"&&i.system.equipped&&i.system.equipmentType==="armor"),shield=this.items.some(i=>i.type==="equipment"&&i.system.equipped&&i.system.equipmentType==="shield");
    const light=armor?.system.equipmentSubtype==="lightArmor",eligible=light||!armor&&s.profile.choices.unarmored==="yes";
    data.martialQuickToAct=swordsageFeatureAvailable(this,"quick")?1+Math.floor(level/5):0;data.martialIL=s.initiatorLevel;
    if(s.stances.some(i=>martial(i).discipline==="shadow-hand"))data.shadowStanceKnown=1;
    const flow=martial(s.activeStance)?.discipline;
    data.martialDefense=flow&&[swordsageFeatureAvailable(this,"focus-defense-8")?s.profile.choices.defense8:null,swordsageFeatureAvailable(this,"focus-defense-16")?s.profile.choices.defense16:null].includes(flow)&&currentStance(this)?2:0;
    data.martialWisAC=swordsageFeatureAvailable(this,"ac")&&eligible&&!shield&&!c.helpless&&!c.paralyzed&&!c.pinned&&!Number(this.system.attributes.encumbrance?.level)?Math.max(0,Number(data.abilities.wis.mod)||0):0;
    return data;
  };
  Hooks.on("updateWorldTime",async now=>{
    if(game.users.activeGM!==game.user)return;
    for(const actor of worldActors()){const i=currentStance(actor);if(effectSafe(i)?.definition==="blood-in-the-water"&&Number(effect(i).bloodCount)>0&&now-Number(effect(i).lastCritical)>=60)await i.update({"system.changes":[],[`flags.${MODULE_ID}.martialEffect.bloodCount`]:0});}
  });
  Hooks.on("D35E.ItemUse.preRollAllAttacks",(item,data,attacks)=>{
    const actor=item.actor;if(!actor)return;const s=getState(actor,{readOnly:true}),stance=currentStance(actor),sp=PLANS[effectSafe(stance)?.definition];
    const w=actor.items.get(item.system.originalWeaponId)??item;
    const separateFocus=actor.items.some(i=>i.type==="feat"&&/武器专攻|weapon.?focus/i.test(i.name)&&[w.name,weaponKind(w)].some(name=>name&&i.name.toLowerCase().includes(name.toLowerCase())));
    if(swordsageFeatureAvailable(actor,"focus-weapon")&&s.profile.choices.weapon&&preferredWeapon(actor,item,s.profile.choices.weapon)&&!separateFocus)for(const a of attacks)a.bonus=`(${a.bonus||0})+1`;
    const command=data.martialCommand??item.flags?.[MODULE_ID]?.martialAttack;
    if(command){data.martialCommand=command;const p=PLANS[command.definition];
      if(p?.extraAttacks)attacks.push(...Array.from({length:p.extraAttacks},()=>({bonus:0,label:"武技额外攻击"})));
      if(item.flags?.[MODULE_ID]?.martialAttack)for(const a of attacks)a.bonus=`(${a.bonus||0})+${(p?.attackBonus||0)+(p?.skill&&command.skillSuccess===false?p.skillFailPenalty||0:0)}`;
    }
  });
  Hooks.on("D35E.ChatAttack.preAddDamage",(chat,options)=>{
    const commandNative=chat.rollData.martialCommand,planNative=PLANS[commandNative?.definition];
    if(commandNative?.native&&commandNative.definition==="mighty-throw"){options.extraParts=[];return;}
    if(commandNative?.native) {
      const extra=planNative?.skill&&!commandNative.skillSuccess?null:planNative?.extra;
      if(extra)options.extraParts=[...(options.extraParts??[]),[extra[0],"武技附加伤害",typeFor(extra[1],chat.item)]];
      if(planNative?.twoDice&&commandNative.low)options.extraParts=[...(options.extraParts??[]),["1d6","影刃术","energy-cold"]];
      if(planNative?.pure||planNative?.replacementSkill)return;
    }
    const actor=chat.item?.actor;if(!actor||chat.item.system.actionType!=="mwak")return;
    const s=getState(actor,{readOnly:true}),command=chat.rollData.martialCommand,sp=PLANS[effectSafe(currentStance(actor))?.definition];
    const extras=[];
    if(sp?.extra)extras.push(sp.extra);
    for(const i of actor.items.filter(active)){const p=effect(i).plan;if(p?.extra&&!p.trigger)extras.push(p.extra);}
    const p=PLANS[command?.definition],m=martial(actor.items.find(i=>martial(i)?.definition===command?.definition));if(p&&m?.kind==="strike"&&[swordsageFeatureAvailable(actor,"focus-strike-4")?s.profile.choices.strike4:null,swordsageFeatureAvailable(actor,"focus-strike-12")?s.profile.choices.strike12:null].includes(m.discipline))extras.push([`@critMult*(${Math.max(0,Number(actor.system.abilities.wis.mod)||0)})`,"base"]);
    options.extraParts=[...(options.extraParts??[]),...extras.map(([formula,type])=>[formula,"武术效果",typeFor(type,chat.item)])];
    if(actor.items.some(i=>active(i)&&effect(i).plan?.convertFire)){chat.rollData.item.damage.parts=chat.rollData.item.damage.parts.map(v=>[v[0],"火焰","energy-fire"]);options.extraParts=options.extraParts.map(v=>[v[0],"火焰","energy-fire"]);}
  });
  Hooks.on("D35E.DamageRoll.preCalculateDamage",(actor,v)=>{
    for(const i of actor.items.filter(active)) {
      const m=effect(i),p=PLANS[m.definition],dr=m.dr??p?.dr;
      if(dr)v.dr=[...v.dr,{uid:dr[1]||"any",value:dr[0]}];
      if(p?.resistance==="tumble-fire") {
        const ranks=Number(actor.system.skills.tmb?.rank)||0,value=ranks>=19?null:ranks>=14?20:ranks>=9?10:ranks>=4?5:0;
        const old=v.er.find(e=>e.uid==="energy-fire");if(old)v.er=v.er.map(e=>e===old?{...e,value:Math.max(e.value||0,value||0),immunity:e.immunity||value===null}:e);else v.er=[...v.er,{uid:"energy-fire",value:value??0,immunity:value===null}];
      }
    }
  });
  Hooks.on("D35E.DamageRoll.preHitCheck",(actor,v)=>{if(PLANS[effectSafe(currentStance(actor))?.definition]?.criticalImmune)v.finalAc.noCritical=true;});
  Hooks.on("D35E.DamageRoll.preCheckConcealment",(actor,v)=>{
    const chance=shadowConcealment(actor);
    if(!chance||v.finalAc.noCheck)return;
    v.forceConcealRoll=true;
    v.finalAc.concealOverride=Math.max(chance,Number(v.finalAc.concealOverride)||0,v.finalAc.fullConceal?50:v.finalAc.conceal?20:0);
  });
  const use=ItemUse.prototype.use;
  ItemUse.prototype.use=async function(...args) {
    const actor=this.item.actor;
    if(actor){const restrictions=actor.items.filter(active).map(i=>effect(i).restriction),kind=this.item.system.activation?.type;
      if(restrictions.includes("no-actions")&&kind!=="aao"||restrictions.includes("no-standard")&&["standard","full","round"].includes(kind)||restrictions.includes("no-move")&&["move","full","round"].includes(kind)||restrictions.includes("no-full-attack")&&this.item.type==="full-attack")throw new Error("武术效果限制了这次动作；请查看当前效果全文。");
    }return use.apply(this,args);
  };
  Hooks.on("preUpdateToken",(token,change,options)=>{if(!token.actor||change.x===undefined&&change.y===undefined)return;const m=token.actor.items.find(i=>active(i)&&effect(i).immobilize);if(m&&!game.user.isGM){ui.notifications.warn("当前武术效果禁止自主移动；强制位移由DM处理。");return false;}
  });
  Hooks.on("moveToken",(token,movement,options)=>{
    if(game.users.activeGM!==game.user||!token.actor||options.isUndo)return;
    const stance=currentStance(token.actor),p=PLANS[effectSafe(stance)?.definition],scale=feetScale(token.parent);
    if(!p?.endsOnMove||!scale)return;
    const feet=Number(movement.passed.distance)/scale;if(!(feet>0))return;
    serial(`stance-move:${token.actor.uuid}`,async()=>{
      if(game.users.activeGM!==game.user||token.parent.tokens.get(token.id)!==token||!token.actor.items.has(stance.id)||currentStance(token.actor)?.id!==stance.id)return;
      const m=effect(stance),parts=clone(m.moveParts??[]),origin=movement.origin,key=`${movement.id}:${origin.x}:${origin.y}:${origin.elevation}:${origin.level}`;
      const prior=parts.find(row=>row.key===key),increment=Math.max(0,feet-(prior?.feet??0));if(!increment)return;
      if(prior)prior.feet=feet;else parts.push({key,feet});
      const moved=Number(m.moved||0)+increment;
      if(moved>=p.endsOnMove-1e-6){await leaveMartialStance(token.actor);await token.actor.update({[`flags.${MODULE_ID}.martial.activeStance`]:null},{updateChanges:false,skipMinions:true,skipToken:true});await post(token.actor,`<p>${esc(stance.name)}因累计移动至少5尺结束。</p>`);}
      else await stance.update({[`flags.${MODULE_ID}.martialEffect.moved`]:moved,[`flags.${MODULE_ID}.martialEffect.moveParts`]:parts.slice(-32)},{updateChanges:false,skipMinions:true,skipToken:true});
    }).catch(error=>ui.notifications.error(error.message));
  });
  const bind=(message,html)=>{const root=html?.nodeType===1?html:html?.[0];root?.querySelectorAll("[data-martial-resolve]").forEach(button=>{if(button.dataset.martialBound)return;button.dataset.martialBound="yes";button.disabled=!game.user.isGM;button.addEventListener("click",async()=>{button.disabled=true;try{await resolveCard(await fromUuid(button.dataset.actor),button.dataset.martialResolve);}catch(error){ui.notifications.error(error.message);}finally{button.disabled=!game.user.isGM;}});});};
  Hooks.on("renderChatMessage",bind);Hooks.on("renderChatMessageHTML",bind);
}
