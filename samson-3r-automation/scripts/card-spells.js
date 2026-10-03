import { MODULE_ID } from "./catalog.js";
import { timedBuff, replaceTimedBuff, choose, recordAction, spellResistanceValue } from "./rules-bridge.js";
import { effectIsActive, effectDeadline } from "./effect-state.js";
import { syncNativeConditions } from "./native-conditions.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";

export const cardSpell=item=>{
  const id=item?.getFlag(MODULE_ID,"currentCardSpell");
  return id==="command"?undefined:id;
};
const esc=text=>String(text??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dice=result=>Array.isArray(result)?result.find(entry=>Number.isFinite(entry?.total)):result;
const passed=(roll,dc)=>{
  const result=dice(roll),die=result?.dice?.find(term=>term.faces===20)?.results?.find(row=>row.active!==false)?.result;
  return result&&(die===20||(die!==1&&result.total>=dc));
};
const immediate=new Set(["detect-poison","amanuensis"]);
const friendly=new Set(["mage-armor","guidance","enlarge-person","ears-of-the-city","pesh-vigor"]);
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
  if(targets.length>1)throw new Error("这个法术需要逐个目标施放。");
  if(["charm-person","ray-of-sickening"].includes(id)&&targets.length!==1)throw new Error("请指定一个法术目标。");
  const target=targets[0]??actor;
  if(["enlarge-person","charm-person"].includes(id)&&target.system.attributes.creatureType!=="humanoid")throw new Error("目标必须是类人生物。");
  if(id==="pesh-vigor"&&["undead","construct"].includes(target.system.attributes.creatureType))throw new Error("目标必须是活物。");
  const accept=friendly.has(id)&&await Dialog.confirm({title:item.name,content:`<p>${esc(target.name)}自愿接受这次法术吗？</p>`});
  let threatened=false;
  if(id==="charm-person")threatened=await Dialog.confirm({title:item.name,content:"<p>你或你的盟友现在正在威胁或攻击目标吗？</p>"});
  if(id==="pesh-vigor"&&!await Dialog.confirm({title:item.name,content:"<p>施放会耗用价值15金币的一剂仙人掌萃，是否已备齐该材料？</p>"}))return false;
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
  return {cardChoice:{accept,threatened,target:target.uuid,objectUuid,area,copy},cardSpell:id};
}

const busy=new Set();
async function resolveCast(message) {
  if(game.users.activeGM!==game.user)throw new Error("请由当前主GM结算这次法术。");
  if(busy.has(message.id))return;
  busy.add(message.id);
  try {
    const cast=message.getFlag(MODULE_ID,"cast"),pending=message.getFlag(MODULE_ID,"cardResolution");
    if(!cast?.actual||!pending||pending.done)return;
    const actor=await fromUuid(pending.actor),target=await fromUuid(pending.target),item=actor?.items.get(pending.item);
    if(!item||!target?.isOwner||!actor?.isOwner)throw new Error("请由能够操纵施法者和目标的GM结算这次法术。");
    const id=cast.cardSpell,cl=Number(cast.cl),choice={...cast.cardChoice},chat=message.flags.D35E.chatTemplateData;
    if(!Number.isFinite(cl)||cl<1)throw new Error("这次施法没有有效的施法者等级。");
    if(choice.target!==target.uuid)choice.accept=false;
    if(id==="amanuensis") {
      if(typeof pending.copyResists!=="boolean") {
        pending.copyResists=await Dialog.confirm({title:"抄写术：原件",content:"<p>原件或持有人是否抵抗这次抄录？普通无主纸页没有豁免；抵抗时以指定原件或持有人的豁免与法术抗力结算。</p>"});
        await message.setFlag(MODULE_ID,"cardResolution",pending);
      }
      choice.accept=!pending.copyResists;
    }
    let outcome="生效",allowed=true;
    if(id==="charm-person") {
      const immunity=target.system.traits.ci?.value??[];
      if(immunity.includes("mindAffecting")||(id==="charm-person"&&immunity.includes("charm"))){allowed=false;outcome="目标免疫";}
    }
    if(id==="ray-of-sickening") {
      const attack=chat.attacks?.find(entry=>entry.hasAttack)?.attack;
      if(!attack)throw new Error("这张聊天卡没有射线攻击结果。");
      allowed=!attack.isFumble&&(attack.isNatural20||attack.total>=Number(target.system.attributes.ac.touch.total));
      if(!allowed)outcome="射线未命中";
    }
    const sr=spellResistanceValue(target,actor.uuid);
    if(allowed&&item.system.sr&&sr>0&&!(id==="amanuensis"&&choice.accept)&&!(choice.accept&&friendly.has(id)&&!target.items.some(i=>i.getFlag(MODULE_ID,"key")==="covenant-sr"&&effectIsActive(i)))) {
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
    }else if(allowed&&item.system.save.type&&!choice.accept&&id!=="comprehend-languages") {
      const book=actor.system.attributes.spells.spellbooks[item.system.spellbook??"primary"];
      const rollData={...actor.getRollData(),cl,sl:Number(item.system.level),ablMod:Number(actor.system.abilities[book.ability]?.mod)||0};
      const nativeDC=Number(chat.dc?.dc??chat.dc);
      const dc=Number.isFinite(nativeDC)&&nativeDC>0?nativeDC:10+rollData.sl+rollData.ablMod;
      const bonus=choice.threatened&&id==="charm-person"?5:0;
      let temporary=null;
      if(bonus)temporary=await replaceTimedBuff(target,timedBuff("魅惑人类：正在受到威胁","charm-threat-save",null,[["5","savingThrows","will","untyped"]]));
      let result;
      const save=/^fortitude/.test(item.system.save.type)?"fort":/^reflex/.test(item.system.save.type)?"ref":"will";
      try{result=await target.rollSavingThrow(save,null,dc);}finally{if(temporary&&target.items.has(temporary.id))await temporary.delete();}
      if(!dice(result))return;
      allowed=!passed(result,dc);if(!allowed)outcome="豁免成功";
      pending.saveFailed=allowed;
      await message.setFlag(MODULE_ID,"cardResolution",pending);
    }
    if(allowed&&await applyCardEffect(item,actor,target,{cl,choice,start:pending.start,dc:chat.dc?.dc??chat.dc})===false)outcome="持续时间已结束";
    await message.setFlag(MODULE_ID,"cardResolution",{...pending,done:true,outcome,resolvedAt:game.time.worldTime});
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(item.name)} → ${esc(target.name)}：${esc(outcome)}。</p>`,flags:{[MODULE_ID]:{resolvedCast:message.id}}});
  }finally{busy.delete(message.id);}
}

async function applyCardEffect(item,actor,target,{cl,choice,start,dc}) {
  const id=cardSpell(item);
  const periods={"mage-armor":3600*cl,"enlarge-person":60*cl,"guidance":60,"ray-of-sickening":60*cl,
    "charm-person":3600*cl,"comprehend-languages":600*cl,"ears-of-the-city":6*cl,"pesh-vigor":6*cl,"amanuensis":600*cl};
  const remaining=Math.max(0,(start??game.time.worldTime)+(periods[id]??0)-game.time.worldTime);
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
  if(id==="ray-of-sickening")data.flags[MODULE_ID].nativeConditions=["sickened"];
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
    const effect=await replaceTimedBuff(actor,timedBuff("聆听城市：专注","city-concentration",null,[],{nativeConditions:["blind","deaf"],sourceActor:actor.uuid}));
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
  await replaceTimedBuff(item.actor,timedBuff("疲乏","pesh-vigor-fatigue",null,[],{nativeConditions:["fatigued"],sourceActor:item.getFlag(MODULE_ID,"sourceActor")}));
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
    if(!cast?.actual||!cast.cardSpell||!data?.isSpell||(data.spellFailureSuccess===false&&game.settings.get("D35E","fizzleSpellOnArcaneFailure")))return;
    const item=await fromUuid(data.item?.uuid??"").catch(()=>null);
    const actor=item?.actor??(message.speaker.scene&&message.speaker.token?game.scenes.get(message.speaker.scene)?.tokens.get(message.speaker.token)?.actor:game.actors.get(message.speaker.actor));
    const source=actor?.items.get(data.item?.id);
    if(!source||(source.hasAction&&message.flags.D35E.template!=="systems/D35E/templates/chat/attack-roll.html"))return;
    const target=cast.targetUuids?.[0]??actor.uuid;
    await message.setFlag(MODULE_ID,"cardResolution",{actor:actor.uuid,target,item:source.id,start:game.time.worldTime,done:false});
    if(cast.cardChoice?.accept||cast.cardSpell==="comprehend-languages"||immediate.has(cast.cardSpell))resolveCast(message).catch(report);
  });
  Hooks.on("renderChatMessageHTML",(message,root)=>{
    const pending=message.getFlag(MODULE_ID,"cardResolution");
    if(!pending)return;
    for(const button of root.querySelectorAll('[data-action="rollSave"],[data-action="rollSR"]'))button.remove();
    if(pending.done||root.querySelector("[data-three-r-resolve]"))return;
    if(game.users.activeGM!==game.user)return;
    const button=document.createElement("button");button.dataset.threeRResolve=message.id;button.textContent="结算法术";
    button.onclick=()=>resolveCast(message).catch(report);root.append(button);
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
