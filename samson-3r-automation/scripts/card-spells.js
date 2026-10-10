import { MODULE_ID } from "./catalog.js";
import { timedBuff, replaceTimedBuff, choose, recordAction, spellResistanceValue } from "./rules-bridge.js";
import { effectIsActive, effectDeadline } from "./effect-state.js";
import { syncNativeConditions } from "./native-conditions.js";
import { setSickenedPresentation, setNativeConditionPresentation } from "./condition-effects.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { consumeSpellComponents, charmThreatContext } from "./spell-components.js";
import { conditionSpell, sameDeity, conditionSpellEligibility, applyConditionSpell } from "./condition-spells.js";
import { nativeHitCheck } from "./native-hit.js";
import { conditionActorLive } from "./condition-jobs.js";

export const cardSpell=item=>{
  const id=item?.getFlag(MODULE_ID,"currentCardSpell");
  return id==="command"?undefined:id??conditionSpell(item);
};
const esc=text=>String(text??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dice=result=>Array.isArray(result)?result.find(entry=>Number.isFinite(entry?.total)):result;
const passed=(roll,dc,skill=false)=>{
  const result=dice(roll),die=result?.dice?.find(term=>term.faces===20)?.results?.find(row=>row.active!==false)?.result;
  return result&&(skill?result.total>=dc:die===20||(die!==1&&result.total>=dc));
};
function copyProgress(item) {
  const copy=item.getFlag(MODULE_ID,"copy");
  const completed=Number(copy.completed??0),total=Number(copy.totalCopied??0);
  const elapsed=copy.paused?0:Math.max(0,Math.min(game.time.worldTime,effectDeadline(item))-Number(copy.activeSince??copy.startedAt));
  const added=Math.max(0,Math.min(copy.words-completed,copy.capacity-total,Math.floor(elapsed*250/60)));
  return {words:completed+added,total:total+added};
}
export async function prepareCardCast(item,actor,targets) {
  const id=cardSpell(item);
  if(!id)return {};
  if(targets.length>1&&id!=="rebuke")throw new Error("这个法术需要逐个目标施放。");
  if(["castigate","rebuke"].includes(id)&&!targets.length)throw new Error("请指定法术目标；叱责可同时选中爆发范围内的多个敌人。");
  if(id==="rebuke") {
    const caster=actor.getActiveTokens()[0],scale=/^(m|meter|meters|米|公尺)$/i.test(canvas.scene.grid.units)?0.3048:1;
    if(!caster)throw new Error("请先把施法者放入当前场景。");
    for(const target of targets) {
      const token=[...game.user.targets].find(token=>token.actor?.uuid===target.uuid);
      if(!token||canvas.grid.measurePath([caster.center,token.center]).distance>20*scale+1e-6)throw new Error("叱责目标必须在自身周围20尺爆发范围内。");
      if(target.uuid===actor.uuid||token.document.disposition===caster.document.disposition&&token.document.disposition!==0)throw new Error("叱责只伤害敌人；当前目标与施法者同阵营。");
    }
  }
  if(["charm-person","ray-of-sickening"].includes(id)&&targets.length!==1)throw new Error("请指定一个法术目标。");
  const target=targets[0]??actor;
  if(["enlarge-person","charm-person"].includes(id)&&target.system.attributes.creatureType!=="humanoid")throw new Error("目标必须是类人生物。");
  if(id==="pesh-vigor"&&["undead","construct"].includes(target.system.attributes.creatureType))throw new Error("目标必须是活物。");
  const threat=id==="charm-person"?charmThreatContext(actor,target):null;
  let objectUuid=null,area=null,copy=null;
  if(id==="detect-poison") {
    const kind=await choose("侦测毒性：目标",[["creature","指定的生物"],["item","一个物品"],["area","5尺立方区域"]]);
    if(!kind)return false;
    if(kind==="item") {
      objectUuid=await choose("侦测毒性：物品",target.items.filter(i=>["weapon","equipment","loot","consumable"].includes(i.type)).map(i=>[i.uuid,i.name]));
      if(!objectUuid)return false;
    }
    if(kind==="area") {
      area=await Dialog.prompt({title:"侦测毒性",content:'<label>区域位置<input name="area" type="text"></label>',label:"施放",rejectClose:false,callback:h=>(h[0]??h).querySelector("input").value.trim()});
      if(!area)return false;
    }
  }
  if(id==="amanuensis") {
    copy=await Dialog.prompt({title:"抄写术",content:'<label>原件名称<input name="source" type="text"></label><label>原件字词数<input name="count" type="number" min="1" step="1"></label><label>抄录位置<input name="destination" type="text" value="空白羊皮纸"></label><p>只能抄录普通文字；原件及足够的空白纸页需在近距内。原件上的魔法符文仍可能被触发。</p>',label:"施放",rejectClose:false,callback:h=>{
      const root=h[0]??h;return {source:root.querySelector('[name="source"]').value.trim(),words:Number(root.querySelector('[name="count"]').value),destination:root.querySelector('[name="destination"]').value.trim()};
    }});
    if(!copy)return false;
    if(!copy.source||!copy.destination||!Number.isSafeInteger(copy.words)||copy.words<1)throw new Error("请填写原件、抄录位置和有效字词数。");
  }
  return {cardChoice:{threat,threatened:Boolean(threat?.threatened),target:target.uuid,objectUuid,area,copy},cardSpell:id};
}

const busy=new Set();
const targetBusy=new Set();
async function resolveCast(message,options={}) {
  if(game.users.activeGM!==game.user)throw new Error("请由当前主GM结算这次法术。");
  if(busy.has(message.id))return;
  busy.add(message.id);
  let lockedTarget=null;
  try {
    const cast=message.getFlag(MODULE_ID,"cast"),pending=message.getFlag(MODULE_ID,"cardResolution");
    if(!cast?.actual||!pending||pending.done)return;
    const actor=await fromUuid(pending.actor),target=await fromUuid(pending.target),item=actor?.items.get(pending.item);
    if(!item||!target?.isOwner||!actor?.isOwner)throw new Error("请由能够操纵施法者和目标的GM结算这次法术。");
    if(!conditionActorLive(actor)||!conditionActorLive(target))return;
    if(targetBusy.has(target.uuid))throw new Error("这个目标还有一项法术正在结算，请先完成该项结算。");
    targetBusy.add(target.uuid);lockedTarget=target.uuid;
    const id=cast.cardSpell,cl=Number(cast.cl),choice={...cast.cardChoice},chat=message.flags.D35E.chatTemplateData;
    if(!Number.isFinite(cl)||cl<1)throw new Error("这次施法没有有效的施法者等级。");
    const mode=pending.mode??options.mode??(item.system.save.type?"save":"apply");
    if(!["apply","save","accept"].includes(mode))throw new Error("无效的法术结算选项。");
    if(pending.mode&&options.mode&&pending.mode!==options.mode)throw new Error("这次法术已经开始结算，请继续原来的选项，不能改选重掷。");
    if(mode==="accept"&&actor.uuid!==target.uuid&&game.combat?.started&&target.items.some(entry=>entry.getFlag(MODULE_ID,"key")==="reclusive"))throw new Error("隐居诅咒：战斗中不能自愿接受其他施法者的法术，请进行豁免。");
    if(!pending.mode) {
      pending.mode=mode;pending.threatened=options.threatened??choice.threatened??false;
      await message.setFlag(MODULE_ID,"cardResolution",pending);
    }
    choice.accept=mode==="accept"||id==="amanuensis"&&mode==="apply";
    choice.threatened=pending.threatened;
    let outcome="生效",allowed=true;
    const stateSpell=conditionSpell(item),stateImmune=stateSpell?conditionSpellEligibility(item,actor,target):null;
    if(stateImmune){allowed=false;outcome=stateImmune;}
    if(id==="charm-person") {
      const immunity=target.system.traits.ci?.value??[];
      if(immunity.includes("mindAffecting")||(id==="charm-person"&&immunity.includes("charm"))){allowed=false;outcome="目标免疫";}
    }
    if(id==="ray-of-sickening") {
      if(!pending.nativeAttack){const result=await nativeHitCheck(message,actor,target,{touch:true,index:chat.attacks?.findIndex(entry=>entry.hasAttack)??-1});if(!result)return;pending.nativeAttack=result;await message.setFlag(MODULE_ID,"cardResolution",pending);}
      allowed=pending.nativeAttack.hit;
      if(!allowed)outcome="射线未命中";
    }
    const sr=spellResistanceValue(target,actor.uuid);
    if(allowed&&item.system.sr&&sr>0&&!(id==="amanuensis"&&choice.accept)&&!(choice.accept&&!target.items.some(i=>i.getFlag(MODULE_ID,"key")==="covenant-sr"&&effectIsActive(i)))) {
      // The covenant cannot be lowered; its own caster is excluded by spellResistanceValue.
      const penetration=Number(chat.spellPenetration?.total??chat.attacks?.find(a=>a.spellPenetration)?.spellPenetration?.total);
      let total=pending.resistanceTotal??penetration;
      if(!Number.isFinite(total)) {
        const roll=await new Roll35e("1d20 + @cl + @bonus",{cl,bonus:new Roll35e(actor.getRollData().featSpellPenetrationBonus||"0",actor.getRollData()).evaluateSync().total||0}).roll();
        await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`${item.name}：克服${target.name}的法术抗力 ${sr}`});total=roll.total;
      }
      pending.resistanceTotal=total;
      await message.setFlag(MODULE_ID,"cardResolution",pending);
      allowed=total>=sr;if(!allowed)outcome="被法术抗力抵挡";
    }
    if(allowed&&typeof pending.saveFailed==="boolean") {
      allowed=pending.saveFailed;if(!allowed)outcome="豁免成功";
    }else if(allowed&&mode==="save"&&item.system.save.type&&id!=="comprehend-languages") {
      const book=actor.system.attributes.spells.spellbooks[item.system.spellbook??"primary"];
      const rollData={...actor.getRollData(),cl,sl:Number(item.system.level),ablMod:Number(actor.system.abilities[book.ability]?.mod)||0};
      const nativeDC=Number(chat.dc?.dc??chat.dc);
      const dc=Number.isFinite(nativeDC)&&nativeDC>0?nativeDC:10+rollData.sl+rollData.ablMod;
      const bonus=choice.threatened&&id==="charm-person"?5:id==="castigate"&&sameDeity(actor,target)?-2:0;
      let temporary=null;
      if(bonus)temporary=await replaceTimedBuff(target,timedBuff(bonus>0?"魅惑人类：正在受到威胁":"严加斥责：信奉同一神祇",bonus>0?"charm-threat-save":"castigate-same-god",null,[[String(bonus),"savingThrows","will",bonus>0?"untyped":"penalty"]]));
      let result;
      const save=/^fortitude/.test(item.system.save.type)?"fort":/^reflex/.test(item.system.save.type)?"ref":"will";
      try{result=await target.rollSavingThrow(save,null,dc,{threeRSourceMessage:message.id});}finally{if(temporary&&conditionActorLive(target)&&target.items.get(temporary.id)===temporary)await temporary.delete();}
      if(!dice(result))return;
      const counter=message.flags?.[MODULE_ID]?.counterSaves?.[encodeURIComponent(target.uuid).replaceAll(".","%2E")];
      allowed=!passed(result,dc,Boolean(counter?.skill&&counter.save===save));if(!allowed)outcome="豁免成功";
      pending.saveFailed=allowed;
      await message.setFlag(MODULE_ID,"cardResolution",pending);
    }
    if(!conditionActorLive(actor)||!conditionActorLive(target))return;
    const partial=stateSpell&&!stateImmune&&outcome==="豁免成功";
    if(stateSpell&&(allowed||partial)) {
      const raw=Number(chat.dc?.dc??chat.dc),book=actor.system.attributes.spells.spellbooks[item.system.spellbook??"primary"],dc=raw>0?raw:10+Number(item.system.level)+(Number(actor.system.abilities[book?.ability]?.mod)||0);
      if(await applyConditionSpell(item,actor,target,{cl,dc,saveFailed:allowed,start:pending.start,message,pending})===false)outcome="持续时间已结束";
      else if(partial)outcome=id==="castigate"?"豁免成功，仍战栗一轮":"豁免成功，伤害减半，无附加状态";
    }else if(allowed&&await applyCardEffect(item,actor,target,{cl,choice,start:pending.start,dc:chat.dc?.dc??chat.dc,persistentSeconds:cast.persistentSeconds,extendSelf:cast.extendSelf})===false)outcome="持续时间已结束";
    await message.setFlag(MODULE_ID,"cardResolution",{...pending,done:true,outcome,resolvedAt:game.time.worldTime});
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(item.name)} → ${esc(target.name)}：${{apply:"直接应用",save:"进行豁免",accept:"自愿接受"}[mode]}${id==="charm-person"&&choice.threatened&&mode==="save"?"（威胁＋5）":""}，${esc(outcome)}。</p>`,flags:{[MODULE_ID]:{resolvedCast:message.id}}});
  }finally{busy.delete(message.id);if(lockedTarget)targetBusy.delete(lockedTarget);}
}

async function applyCardEffect(item,actor,target,{cl,choice,start,dc,persistentSeconds,extendSelf}) {
  const id=cardSpell(item);
  const periods={"mage-armor":3600*cl,"enlarge-person":60*cl,"guidance":60,"ray-of-sickening":60*cl,
    "charm-person":3600*cl,"comprehend-languages":600*cl,"ears-of-the-city":6*cl,"pesh-vigor":6*cl,"amanuensis":600*cl};
  let seconds=Number(persistentSeconds)>0?Number(persistentSeconds):periods[id]??0;
  if(extendSelf&&target.uuid===actor.uuid)seconds*=2;
  const remaining=Math.max(0,(start??game.time.worldTime)+seconds-game.time.worldTime);
  if(!remaining&&id!=="detect-poison")return false;
  const changes=id==="mage-armor"?[["4","ac","ac","armor"]]:id==="enlarge-person"?[["2","ability","str","size"],["-2","ability","dex","penalty"]]
    :id==="pesh-vigor"?[["2","ability","str","enh"]]:[];
  const data=timedBuff(item.name,`card-effect-${id}`,id==="detect-poison"?null:remaining,changes,{sourceActor:actor.uuid,sourceItemUuid:item.uuid,cl,saveDC:dc,cardEffect:id});
  data.img=item.img;data.system.description.value=item.system.description.value;
  if(id==="enlarge-person") {
    const sizes=["fine","dim","tiny","sm","med","lg","huge","grg","col"];
    const base=target.system.traits.size,index=sizes.indexOf(base);
    if(index<0||index>=sizes.length-1)throw new Error("目标体型不能继续增大。");
    if(target.items.some(i=>effectIsActive(i)&&i.system.sizeOverride&&sizes.indexOf(i.system.sizeOverride)>index))throw new Error("目标已经受到增大体型的效果影响。");
    data.system.sizeOverride=sizes[index+1];
  }
  if(id==="ray-of-sickening")setSickenedPresentation(data,item.name);
  if(id==="detect-poison") {
    const object=choice.objectUuid?await fromUuid(choice.objectUuid):null,label=choice.area??object?.name??target.name;
    const result=await choose(`侦测毒性：${label}`,[["poison","有毒"],["clear","无毒"],["blocked","被障碍阻挡"]]);
    if(!result)throw new Error("尚未完成毒性判断，请从施法卡继续结算。");
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(label)}：${{poison:"有毒",clear:"无毒",blocked:"法术被障碍阻挡"}[result]}。</p>`});
    if(result==="poison") {
      const alchemy=Object.entries(actor.system.skills.crf?.subSkills??{}).find(([,skill])=>/炼金|alchemy/i.test(skill.name));
      const identify=await choose("辨别毒素（DC20）",[["wis","感知检定"],...(alchemy?[["alchemy","工艺（炼金术）"]]:[]),["skip","暂不辨别"]]);
      let roll;
      if(identify==="wis")roll=await actor.rollAbilityTest("wis");
      if(identify==="alchemy") {
        roll=await actor.rollSkill(`crf.subSkills.${alchemy[0]}`,{target:20});
      }
      if(dice(roll)?.total>=20) {
        const name=await Dialog.prompt({title:"辨明的毒素",content:'<input name="poison" type="text">',label:"告知",rejectClose:false,callback:h=>(h[0]??h).querySelector("input").value.trim()});
        if(name)await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>毒素种类：${esc(name)}。</p>`});
      }
    }
    return;
  }
  if(id==="charm-person")data.flags[MODULE_ID].attitude="friendly";
  if(id==="amanuensis") {
    data.flags[MODULE_ID].copy={...choice.copy,startedAt:start,capacity:2500*cl};
    data.system.description.value=`<p>抄录${esc(choice.copy.source)}到${esc(choice.copy.destination)}。每分钟250词，原件共${choice.copy.words}词，最多抄录${2500*cl}词。只复制普通文字。</p>`;
  }
  if(["pesh-vigor","ears-of-the-city","guidance","charm-person","amanuensis"].includes(id))data.system.activation={type:id==="pesh-vigor"?"free":"standard",cost:1};
  await replaceTimedBuff(target,data);
  await syncNativeConditions(target);
}

async function useEffect(item) {
  const actor=item.actor,id=item.getFlag(MODULE_ID,"cardEffect");
  if(!actor?.isOwner||!effectIsActive(item))throw new Error("该法术效果已经结束。");
  if(id==="pesh-vigor") {
    const cl=Number(item.getFlag(MODULE_ID,"cl")),now=game.time.worldTime;
    const period=game.combat?.started?`${game.combat.id}:${game.combat.round}`:`time:${Math.floor(now/6)}`;
    if(item.getFlag(MODULE_ID,"boostPeriod")===period)throw new Error("本轮已经激发过仙人掌萃的活力。");
    const remaining=Math.max(0,Math.floor((effectDeadline(item)-now)/6));
    const limit=Math.min(4,1+Math.floor(cl/5),remaining);
    if(limit<1)throw new Error("法术没有可用于激发的剩余轮数。");
    const selected=await choose("激发活力",Array.from({length:limit},(_,i)=>[String(i+1),`力量增强＋${4+2*i}，承受${i+1}d6非致命伤害，额外耗用${i+1}轮`]));
    if(!selected)return;
    const steps=Number(selected),roll=await new Roll35e(`${steps}d6`).roll();
    await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:"仙人掌萃的活力：非致命伤害"});
    await actor.update({"system.attributes.hp.nonlethal":Number(actor.system.attributes.hp.nonlethal??0)+roll.total});
    const end=effectDeadline(item)-6*steps;
    await item.update({[`flags.${MODULE_ID}.boostPeriod`]:period,[`flags.${MODULE_ID}.expiresAt`]:end,
      "system.timeline.total":Math.max(0,Number(item.system.timeline.total)-steps),"system.timeline.formula":String(Math.max(0,Number(item.system.timeline.total)-steps)),
      "flags.d35e-world-timeline.timer.end":end,"flags.d35e-world-timeline.timer.seconds":Math.max(0,Number(item.getFlag("d35e-world-timeline","timer")?.seconds)-6*steps)});
    await replaceTimedBuff(actor,timedBuff("仙人掌萃的活力：激发","pesh-vigor-boost",6,[[String(2+2*steps),"ability","str","enh"]],{sourceActor:item.getFlag(MODULE_ID,"sourceActor"),peshParent:item.uuid}));
    await recordAction(actor,"free");
    return;
  }
  if(id==="charm-person") {
    const source=await fromUuid(item.getFlag(MODULE_ID,"sourceActor"));
    if(!source?.isOwner)throw new Error("请由能操纵双方的GM结算魅惑请求。");
    const action=await choose("魅惑人类",[["request","提出通常不愿接受的请求"],["break","受到施法者或盟友威胁，解除魅惑"]]);
    if(action==="break")return item.delete();
    if(action!=="request")return;
    const request=await Dialog.prompt({title:"魅惑请求",content:'<input name="request" type="text"><p>不能要求自杀或明显伤害自己的行为；同一个请求不能重试。</p>',label:"提出请求",rejectClose:false,callback:h=>(h[0]??h).querySelector("input").value.trim()});
    if(!request)return;
    const previous=item.getFlag(MODULE_ID,"charmRequests")??[];
    if(previous.some(entry=>entry.request===request))throw new Error("这个请求已经尝试过，不能重试。");
    const casterRoll=dice(await source.rollAbilityTest("cha"));
    if(!casterRoll)return;
    const targetRoll=dice(await actor.rollAbilityTest("cha"));
    if(!targetRoll)return;
    const a=Number(source.system.abilities.cha.mod),b=Number(actor.system.abilities.cha.mod);
    let success=casterRoll.total>targetRoll.total;
    if(casterRoll.total===targetRoll.total) {
      if(a!==b)success=a>b;
      else {
        let left,right;
        do {
          left=dice(await source.rollAbilityTest("cha"));right=dice(await actor.rollAbilityTest("cha"));
          if(!left||!right)return;
        }while(left.total===right.total);
        success=left.total>right.total;
      }
    }
    await item.setFlag(MODULE_ID,"charmRequests",[...previous,{request,success}]);
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),content:`<p>${esc(request)}：魅力对抗${success?"成功":"失败"}。</p>`});
    return;
  }
  if(id==="amanuensis") {
    const copy=foundry.utils.deepClone(item.getFlag(MODULE_ID,"copy")),progress=copyProgress(item);
    const action=await choose("抄写术",[["progress","查看进度"],[copy.paused?"resume":"pause",copy.paused?"继续抄录":"暂停抄录"],["redirect","改换原件或抄录位置"]]);
    if(!action)return;
    if(action!=="progress") {
      copy.completed=progress.words;copy.totalCopied=progress.total;copy.activeSince=game.time.worldTime;
      if(action==="pause")copy.paused=true;
      if(action==="resume")copy.paused=false;
      if(action==="redirect") {
        const replacement=await Dialog.prompt({title:"抄写术：改换原件",content:`<label>原件名称<input name="source" value="${esc(copy.source)}"></label><label>尚待抄录的词数<input name="words" type="number" min="1" step="1" value="${Math.max(1,copy.words-progress.words)}"></label><label>抄录位置<input name="destination" value="${esc(copy.destination)}"></label><p>原件及空白纸页须在近距内。改换原件不延长法术持续时间。</p>`,label:"继续抄录",rejectClose:false,callback:h=>{
          const root=h[0]??h;return {source:root.querySelector('[name="source"]').value.trim(),words:Number(root.querySelector('[name="words"]').value),destination:root.querySelector('[name="destination"]').value.trim()};
        }});
        if(!replacement)return;
        if(!replacement.source||!replacement.destination||!Number.isSafeInteger(replacement.words)||replacement.words<1)throw new Error("请填写有效的原件、位置及词数。");
        copy.segments=[...(copy.segments??[]),{source:copy.source,destination:copy.destination,words:progress.words}];
        Object.assign(copy,replacement,{completed:0,paused:false});
      }
      await item.setFlag(MODULE_ID,"copy",copy);
    }
    const current=copyProgress(item);
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(copy.source)} → ${esc(copy.destination)}：已抄录${current.words}/${copy.words}词，累计${current.total}词${copy.paused?"，暂停中":""}。</p>`});
    return;
  }
  if(id==="ears-of-the-city") {
    const period=game.combat?.started?`${game.combat.id}:${game.combat.round}`:`time:${Math.floor(game.time.worldTime/6)}`;
    if(item.getFlag(MODULE_ID,"gatherPeriod")===period)throw new Error("本轮已经收集过城市信息。");
    const skill=await choose("聆听城市：收集信息",[["gif","收集信息"],["spt","侦察"],["lis","聆听"]]);
    if(!skill)return;
    const effect=await replaceTimedBuff(actor,setNativeConditionPresentation(
      timedBuff("目盲／耳聋","city-concentration",null,[],{sourceActor:actor.uuid,sourceItemUuid:item.getFlag(MODULE_ID,"sourceItemUuid")}),
      ["blind","deaf"],"聆听城市"));
    await syncNativeConditions(actor);
    try {const roll=await actor.rollSkill(skill);if(dice(roll))await item.setFlag(MODULE_ID,"gatherPeriod",period);}
    finally{await effect.delete();await syncNativeConditions(actor);}
    return;
  }
  if(id==="guidance") {
    const type=await choose("神导术：选择本次检定",[["attack","攻击"],["save","豁免"],["skill","技能"]]);
    if(type==="attack")return ui.notifications.info("请使用武器或攻击条目，并在攻击窗口勾选神导术。");
    if(type==="save") {const save=await choose("豁免",[["fort","强韧"],["ref","反射"],["will","意志"]]);if(save)return actor.rollSavingThrow(save);}
    if(type==="skill") {const skill=await choose("技能",Object.entries(CONFIG.D35E.skills).map(([key,label])=>[key,game.i18n.localize(label)]));if(skill)return actor.rollSkill(skill);}
    return;
  }
  return item.roll();
}

async function ended(item) {
  if(game.users.activeGM!==game.user||!item.actor||item.getFlag(MODULE_ID,"cardEffect")!=="pesh-vigor")return;
  if((item.actor.getFlag(MODULE_ID,"suppressedSpells")??[]).some(entry=>entry.uuid===item.uuid))return;
  if(item.actor.getFlag(MODULE_ID,"lastPeshEnded")===item.uuid)return;
  await item.actor.setFlag(MODULE_ID,"lastPeshEnded",item.uuid);
  const boosts=item.actor.items.filter(i=>i.getFlag(MODULE_ID,"peshParent")===item.uuid&&effectDeadline(i)<=game.time.worldTime);
  if(boosts.length)await item.actor.deleteEmbeddedDocuments("Item",boosts.map(i=>i.id));
  await replaceTimedBuff(item.actor,setNativeConditionPresentation(
    timedBuff("疲乏","pesh-vigor-fatigue",null,[],{sourceActor:item.getFlag(MODULE_ID,"sourceActor"),sourceItemUuid:item.getFlag(MODULE_ID,"sourceItemUuid")}),
    ["fatigued"],"仙人掌萃的活力"));
  await syncNativeConditions(item.actor);
}

async function endedCopy(item) {
  if(game.users.activeGM!==game.user||!item.actor||item.getFlag(MODULE_ID,"cardEffect")!=="amanuensis")return;
  if((item.actor.getFlag(MODULE_ID,"suppressedSpells")??[]).some(entry=>entry.uuid===item.uuid))return;
  if(item.actor.getFlag(MODULE_ID,"lastCopyEnded")===item.uuid)return;
  const copy=item.getFlag(MODULE_ID,"copy");if(!copy)return;
  await item.actor.setFlag(MODULE_ID,"lastCopyEnded",item.uuid);
  const progress=copyProgress(item);
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:item.actor}),content:`<p>抄写术结束：${esc(copy.source)} → ${esc(copy.destination)}，已抄录${progress.words}/${copy.words}词，累计${progress.total}词。</p>`});
}

export function installCardSpells() {
  const report=error=>{console.error(MODULE_ID,error);ui.notifications.error(error.message);};
  Hooks.on("createChatMessage",async message=>{
    if(game.users.activeGM!==game.user)return;
    const cast=message.getFlag(MODULE_ID,"cast"),data=message.flags?.D35E?.chatTemplateData;
    if(cast?.derivedTarget)return;
    if(!cast?.actual||!data?.isSpell)return;
    const item=await fromUuid(data.item?.uuid??"").catch(()=>null);
    const actor=item?.actor??(message.speaker.scene&&message.speaker.token?game.scenes.get(message.speaker.scene)?.tokens.get(message.speaker.token)?.actor:game.actors.get(message.speaker.actor));
    const source=actor?.items.get(data.item?.id);
    if(!source||(source.hasAction&&message.flags.D35E.template!=="systems/D35E/templates/chat/attack-roll.html"))return;
    try{await consumeSpellComponents(actor,cast.materials);}catch(error){
      await message.setFlag(MODULE_ID,"cardResolution",{done:true,outcome:error.message,materialsConsumed:false});report(error);return;
    }
    if(!cast.cardSpell||(data.spellFailureSuccess===false&&game.settings.get("D35E","fizzleSpellOnArcaneFailure")))return;
    const target=cast.targetUuids?.[0]??actor.uuid;
    const pending={actor:actor.uuid,target,item:source.id,start:game.time.worldTime,done:false,spellName:source.name,saveType:source.system.save.type,threat:cast.cardChoice?.threat,materialsConsumed:true};
    await message.setFlag(MODULE_ID,"cardResolution",pending);
    if(cast.cardSpell==="rebuke")for(const uuid of (cast.targetUuids??[]).slice(1)) {
      const enemy=await fromUuid(uuid);if(!enemy)continue;
      await ChatMessage.create({speaker:message.speaker,content:`<p>${esc(source.name)} → ${esc(enemy.name)}</p>`,
        flags:{D35E:{chatTemplateData:foundry.utils.deepClone(data)},[MODULE_ID]:{cast:{...cast,targetUuids:[uuid],derivedTarget:true},cardResolution:{...pending,target:uuid}}}});
    }
  });
  Hooks.on("renderChatMessageHTML",(message,root)=>{
    const pending=message.getFlag(MODULE_ID,"cardResolution");
    if(!pending)return;
    for(const button of root.querySelectorAll('[data-action="rollSave"],[data-action="rollSR"]'))button.remove();
    if(root.querySelector("[data-three-r-resolve]"))return;
    const section=document.createElement("section");section.className="three-r-spell-resolution";section.dataset.threeRResolve=message.id;
    const cast=message.getFlag(MODULE_ID,"cast"),plan=cast?.materials;
    section.innerHTML=`<strong>法术结算</strong>${plan?.requirements?.length?`<p>材料：${esc(plan.requirements.map(entry=>entry.label+(entry.consume?(pending.materialsConsumed?"（已耗用1份）":"（需耗用1份）"):"")).join("、"))}</p>`:""}`;
    if(pending.done){const result=document.createElement("p");result.textContent=pending.outcome;section.append(result);root.append(section);return;}
    if(pending.threat) {
      const threat=pending.threat;
      section.insertAdjacentHTML("beforeend",`<p>交战：${threat.combat?"是":"否"} · 敌对：${threat.known?(threat.hostile?"是":"否"):"未确认"} · 敌对方持械：${threat.armed?"是":"否"}</p><label><input type="checkbox" name="three-r-threat" ${(pending.threatened??threat.threatened)?"checked":""} ${pending.mode?"disabled":""}> 威胁目标：豁免＋5</label>`);
    }
    const controls=document.createElement("div");controls.className="three-r-spell-options";
    const saveType=pending.saveType??message.flags?.D35E?.chatTemplateData?.dc?.type;
    for(const [mode,label] of [["apply","直接应用"],...(saveType?[["save","进行豁免"],["accept","自愿接受"]]:[])]) {
      const button=document.createElement("button");button.type="button";button.textContent=label;
      button.title=mode==="apply"?"跳过豁免，仍检查命中、免疫和法术抗力":mode==="accept"?"自愿放弃豁免，并降低可主动降低的法术抗力":"按原生豁免检定结算";
      button.disabled=game.users.activeGM!==game.user||Boolean(pending.mode&&pending.mode!==mode);
      if(game.users.activeGM!==game.user)button.title="由当前主GM结算";
      button.onclick=()=>resolveCast(message,{mode,threatened:section.querySelector('[name="three-r-threat"]')?.checked}).catch(report);
      controls.append(button);
    }
    section.append(controls);root.append(section);
  });
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    if(hook.customUse)return;
    if(!item.getFlag(MODULE_ID,"cardEffect"))return;
    hook.customUse=true;useEffect(item).catch(report);
  });
  Hooks.on("deleteItem",item=>{ended(item).catch(report);endedCopy(item).catch(report);});
  Hooks.on("updateItem",(item,change)=>{
    if(change["system.active"]===false||change.system?.active===false){ended(item).catch(report);endedCopy(item).catch(report);}
    if((change["system.active"]===true||change.system?.active===true)&&item.actor?.getFlag(MODULE_ID,"lastPeshEnded")===item.uuid&&game.users.activeGM===game.user)item.actor.unsetFlag(MODULE_ID,"lastPeshEnded").catch(report);
  });
}
