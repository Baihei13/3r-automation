import { MODULE_ID } from "./catalog.js";
import { martial } from "./martial-state.js";
import { swordsageFeatureAvailable } from "./martial-class-features.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";
import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";
import { ItemChatAction } from "../../../systems/D35E/module/item/chat/chatAction.js";
import { registerMartialEvent,closeMartialEvent,martialEventSource,chooseMartialReaction,saveKind,requestMartialReaction,installMartialReactionBridge } from "./martial-events.js";
import { nativeDamageQueue } from "./native-hit.js";
import { applyMartialDefense,stanceEffect } from "./martial-context.js";
import { windAttackBonus } from "./martial-terrain.js";
import { conditionActorLive } from "./condition-jobs.js";
import { effectIsActive } from "./effect-state.js";
import { nativeAttackActor,martialMissChanceForRoll,applyMartialMissChance } from "./martial-miss.js";

const queues=new Map(),defenseContexts=new WeakMap();
const serial=(key,work)=>{const next=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(work);queues.set(key,next);return next.finally(()=>{if(queues.get(key)===next)queues.delete(key);});};
const messageFor=event=>{const root=event?.target?.closest?.(".message");return game.messages.get(root?.dataset.messageId);};
const selectedActors=()=>[...new Map([...(game.user.targets.size?game.user.targets:canvas.tokens.controlled)].filter(t=>t.actor).map(t=>[t.actor.uuid,t.actor])).values()];
const keyFor=uuid=>encodeURIComponent(uuid).replaceAll(".","%2E");
const attackIndex=event=>{const row=event?.target?.closest?.(".chat-attack");return row?Math.max(0,[...row.parentElement.querySelectorAll(":scope > .chat-attack")].indexOf(row)):0;};
const resultRoll=result=>Array.isArray(result)?result.find(r=>Number.isFinite(r?.total)):result;
export function nativeMartialSave(message,target) {
  return message.flags?.[MODULE_ID]?.nativeSaveResults?.[keyFor(target.uuid)];
}

export function installNativeMartialEvents(onHit) {
  installMartialReactionBridge();
  Hooks.on("createChatMessage",async report=>{
    const mark=report.flags?.[MODULE_ID]?.nativeCritical,author=report.author??report.user;
    if(!mark||game.users.activeGM!==game.user||report.flags?.D35E?.template!=="systems/D35E/templates/chat/damage-description.html")return;
    const source=game.messages.get(mark.message),actor=await fromUuid(mark.actor),target=await fromUuid(mark.target),data=report.flags.D35E.chatTemplateData;
    const origin=source?.flags?.D35E?.chatTemplateData?.attacks?.[mark.index];
    if(!actor||!target||!author||!target.testUserPermission(author,"OWNER")||!origin?.hasAttack||!origin.hasCritConfirm||!data?.hit||!data.crit||data.actor?.id!==target.id||source.flags.D35E.chatTemplateData.actor?.id!==actor.id)return;
    recordBloodCritical(actor,source,target,mark.index).catch(error=>console.error(MODULE_ID,"嗜血重击记录",error));
  });
  Hooks.on("renderChatMessageHTML",(message,html)=>{
    const meta=message.flags?.[MODULE_ID]?.nativeMartial;if(meta?.sequence!=="dual")return;
    const root=html?.nodeType===1?html:html?.[0];if(!root)return;
    const state=meta.dualState??(meta.slot===0?"ready":"waiting");
    const text={ready:meta.slot===0?"狼咬第1击：先结算主手，再结算副手。":"狼咬第2击：副手攻击与伤害独立结算。",waiting:"狼咬第2击已预掷：先结算主手；首击使目标HP降到−1或以下时，本击取消。",stopped:"首击使目标HP降到−1或以下，狼咬第二击已取消。",resolved:"本击已结算。"}[state];
    root.querySelector(".three-r-dual-progress")?.remove();
    const note=document.createElement("p");note.className="three-r-dual-progress";note.textContent=text;
    (root.querySelector(".chat-card")??root).append(note);
    if(state!=="ready")for(const button of root.querySelectorAll('button[data-action="applyDamage"],button[data-action="applyDamageHalf"]')){button.disabled=true;button.title=text;}
  });
  const Actor=CONFIG.Actor.documentClass,save=Actor.prototype.rollSavingThrow,defense=Actor.prototype.rollDefenseDialog;
  Actor.prototype.rollDefenseDialog=function(options={}){return defense.call(this,{...options,...(defenseContexts.get(this)??{})});};
  Hooks.on("createChatMessage",async report=>{
    const mark=report.flags?.[MODULE_ID]?.nativeSaveFor;if(!mark||game.users.activeGM!==game.user)return;
    const actor=await fromUuid(mark.actor),message=game.messages.get(mark.message),meta=message?.flags?.[MODULE_ID]?.nativeMartial,author=report.author??report.user,data=report.flags?.D35E?.chatTemplateData;
    if(!actor||!author||!actor.testUserPermission(author,"OWNER")||!meta?.targets.includes(actor.uuid)||meta.save!==mark.save||report.flags.D35E.template!=="systems/D35E/templates/chat/saving-throw.html"||!Number.isFinite(data?.total))return;
    const die=report.rolls?.[0]?.dice?.find(t=>t.faces===20)?.total;
    if(!Number.isFinite(die))return;
    if(!nativeMartialSave(message,actor))await message.setFlag(MODULE_ID,`nativeSaveResults.${keyFor(actor.uuid)}`,{success:die===20||die!==1&&data.total>=meta.dc});
  });
  Actor.prototype.rollSavingThrow=async function(kind,ability,dc,options={}) {
    const sourceMessage=game.messages.get(options.threeRSourceMessage),stored=sourceMessage?.flags?.[MODULE_ID]?.counterSaves?.[keyFor(this.uuid)];
    if(stored&&stored.save===saveKind(kind)) {
      const roll=Roll35e.fromData(stored.roll),die=roll.dice.find(d=>d.faces===20)?.total,meta=sourceMessage.flags?.[MODULE_ID]?.nativeMartial;
      if(meta&&game.users.activeGM===game.user&&meta.targets.includes(this.uuid)&&meta.save===stored.save&&!nativeMartialSave(sourceMessage,this))
        await sourceMessage.setFlag(MODULE_ID,`nativeSaveResults.${keyFor(this.uuid)}`,{success:stored.skill?roll.total>=meta.dc:die===20||die!==1&&roll.total>=meta.dc});
      return roll;
    }
    const nativeKind={fort:"fortitudepartial",ref:"reflexpartial",will:"willpartial"}[kind]??kind;
    const normal=()=>save.call(this,nativeKind,ability,dc,options);
    let roll,skillSave=false;
    const reportHook=options.threeRSourceMessage?Hooks.on("preCreateChatMessage",message=>{
      if(message.speaker.actor===this.id&&message.flags?.D35E?.template==="systems/D35E/templates/chat/saving-throw.html")message.updateSource({[`flags.${MODULE_ID}.nativeSaveFor`]:{message:options.threeRSourceMessage,actor:this.uuid,save:saveKind(kind)}});
    }):null;
    try {
    if(!options.threeRNativeSave&&game.users.activeGM===game.user&&Number(dc)>0&&saveKind(kind)) {
      const eventKey=registerMartialEvent({kind:"save",target:this.uuid,save:saveKind(kind),dc:Number(dc),label:"即将进行豁免"});
      try{const event=martialEventSource(eventKey);event.sourceMessage=options.threeRSourceMessage;await chooseMartialReaction(this,eventKey,p=>p.saveBonus||p.replaces===saveKind(kind));roll=martialEventSource(eventKey).roll;skillSave=Boolean(martialEventSource(eventKey).skillSave);if(!roll)roll=resultRoll(await normal());}
      finally{closeMartialEvent(eventKey);}
    }else if(!options.threeRNativeSave&&Number(dc)>0&&saveKind(kind)&&options.threeRSourceMessage&&game.users.activeGM&&this.items.some(i=>martial(i)?.kind==="counter")) {
      const reaction=await requestMartialReaction({kind:"save",target:this.uuid,save:saveKind(kind),sourceMessage:options.threeRSourceMessage});
      roll=reaction.roll;skillSave=Boolean(reaction.skillSave);if(!roll)roll=resultRoll(await normal());
    }else roll=resultRoll(await normal());
    if(roll&&options.threeRSourceMessage) {
      const source=game.messages.get(options.threeRSourceMessage),meta=source?.flags?.[MODULE_ID]?.nativeMartial;
      if(meta&&meta.targets.includes(this.uuid)&&meta.save===saveKind(kind)) {
        const die=roll.dice?.find(d=>d.faces===20)?.total;
        const success=skillSave?roll.total>=Number(dc):die===20||die!==1&&roll.total>=Number(dc);
        if(game.users.activeGM===game.user)await source.setFlag(MODULE_ID,`nativeSaveResults.${keyFor(this.uuid)}`,{success});
      }
    }
    return roll;
    }finally{if(reportHook!==null)Hooks.off("preCreateChatMessage",reportHook);}
  };

  // The original attack dialog already identifies charge; do not guess from
  // item names or attach a before-roll counter to a completed attack.
  const attack=ItemUse.prototype.rollAttack;
  ItemUse.prototype.rollAttack=async function(full,form,temporary,actor,data,...args) {
    const command=this.item.flags?.[MODULE_ID]?.martialAttack;
    if(command?.native)data.martialCommand=command;
    if(command?.single)full=false;
    if(martial(this.item))return attack.call(this,full,form,temporary,actor,data,...args);
    const root=form?.nodeType===1?form:form?.[0],charge=root?.querySelector('[name="charge"]')?.checked,reactions={};
    const targets=command?.context?.targets?(await Promise.all(command.context.targets.map(uuid=>fromUuid(uuid)))).filter(a=>a?.documentName==="Actor"):selectedActors();
    for(const target of targets.filter(t=>t.uuid!==actor.uuid)) {
      // Most actors have no available counters. Check only that target before
      // sending a bounded request; ordinary attacks add no chat/queue traffic.
      if(!target.items.some(i=>martial(i)?.kind==="counter"))continue;
      reactions[target.uuid]=await requestMartialReaction({kind:charge?"charge":"attack",target:target.uuid,attacker:actor.uuid,weapon:this.item.uuid,rolled:false,label:charge?`${actor.name}正在冲锋`:`${actor.name}即将攻击`});
    }
    if(Object.values(reactions).some(r=>r.unresolved))throw new Error("冲锋对抗尚未完成，攻击尚未掷出。");
    if(targets.length===1&&Object.values(reactions).some(r=>r.blocked))return {rolled:false,countered:true};
    const chargeBonus=targets.length===1?Number(reactions[targets[0].uuid]?.chargeBonus)||0:0;
    const bonusHook=chargeBonus?Hooks.on("D35E.ItemUse.preRollAllAttacks",(item,_data,attacks)=>{
      if(item===this.item)for(const row of attacks)row.bonus=`(${row.bonus||0})+${chargeBonus}`;
    }):null;
    const hook=Hooks.on("preCreateChatMessage",message=>{
      if(message.speaker.actor===actor.id&&message.flags?.D35E?.chatTemplateData?.item?.id===this.item.id)
        message.updateSource({[`flags.${MODULE_ID}.attackReactions`]:Object.fromEntries(Object.entries(reactions).map(([uuid,r])=>[keyFor(uuid),{ac:r.ac,chargeBonus:chargeBonus?0:r.chargeBonus,unresolved:r.unresolved,blocked:r.blocked}]))});
    });
    try{return await attack.call(this,full,form,temporary,actor,data,...args);}finally{Hooks.off("preCreateChatMessage",hook);if(bonusHook!==null)Hooks.off("D35E.ItemUse.preRollAllAttacks",bonusHook);}
  };

  const apply=ActorDamageHelper.applyDamage;
  ActorDamageHelper.applyDamage=function(...args) {
    // Serialize native applications while their synchronous hit hooks are
    // scoped. Never run a second HP writer for the same weapon damage.
    const completion=nativeDamageQueue(async()=>{
      const message=messageFor(args[0]),meta=message?.flags?.[MODULE_ID]?.nativeMartial;
      const targets=args[14]?[args[14]]:meta?(await Promise.all(meta.targets.map(uuid=>fromUuid(uuid)))).filter(a=>a?.documentName==="Actor"):selectedActors();
      if(meta&&!targets.length)throw new Error("本次武术的原目标已不存在，不能将伤害应用到其他棋子。");
      if(!message||!targets.length)return apply.apply(this,args);
      for(const target of targets) {
        if(!conditionActorLive(target))continue;
        const stamp=`${meta?.id??message.id}:${meta?.slot??0}:${keyFor(target.uuid)}`;
        if(meta&&(game.users.activeGM!==game.user||!meta.targets.includes(target.uuid)))throw new Error("本次武术伤害由主GM对原目标应用。");
        const previous=target.flags?.[MODULE_ID]?.nativeMartialApplied?.[stamp];
        if(meta&&previous){await onHit(message,target,previous);continue;}
        if(meta?.sequence==="dual"&&meta.slot===1) {
          const source=await fromUuid(meta.actor),progress=source?.flags?.[MODULE_ID]?.martial?.receipts?.[meta.id];
          if(!progress||Number(progress.steps.nativeIndex||0)<1)throw new Error("狼咬须先结算主手攻击，再结算副手。");
          if(progress.steps.nativeStopped||Number(target.system.attributes.hp.value)<=-1)throw new Error("目标生命值已降到−1或以下，狼咬第二击取消。");
        }
        const reaction=message.flags?.[MODULE_ID]?.attackReactionUsed?.[keyFor(target.uuid)]?{}:{...(message.flags?.[MODULE_ID]?.attackReactions?.[keyFor(target.uuid)]??{})};
        if(game.users.activeGM===game.user&&Number(args[1])!==Actor.SPELL_AUTO_HIT&&!args[5]) {
          const key=registerMartialEvent({kind:"attack",target:target.uuid,attacker:game.actors.get(args[15])?.uuid,attack:{total:Number(args[1])},rolled:true,label:"敌方攻击已掷，伤害尚未应用"});
          try{await chooseMartialReaction(target,key,p=>p.defense||p.opposedAttack);Object.assign(reaction,martialEventSource(key));}finally{closeMartialEvent(key);}
        }
        if(reaction.blocked) {
          if(meta){await target.update({[`flags.${MODULE_ID}.nativeMartialApplied.${stamp}`]:{hit:false,crit:false}});await onHit(message,target,{hit:false,crit:false});}
          if(game.user.isGM)await message.setFlag(MODULE_ID,`attackReactionUsed.${keyFor(target.uuid)}`,true);
          continue;
        }
        let hit=Boolean(args[13]),crit=false,special=true,hitObserved=Boolean(args[13]);
        const attacker=meta?await fromUuid(meta.actor):nativeAttackActor(message,{tokenId:args[16],actorId:args[15]});
        const sourceAttack=message.flags?.D35E?.chatTemplateData?.attacks?.[attackIndex(args[0])]?.attack;
        if(meta?.flatFooted)defenseContexts.set(target,{flatfooted:true});
        const dr=Hooks.on("D35E.DamageRoll.preCalculateDamage",(actor,v)=>{if(actor.uuid===target.uuid&&meta?.bypassDR)v.dr=[];});
        const conceal=Hooks.on("D35E.DamageRoll.preCheckConcealment",(actor,v)=>{
          if(actor.uuid!==target.uuid)return;
          applyMartialMissChance(v,martialMissChanceForRoll(sourceAttack,attacker));
        });
        const pre=Hooks.on("D35E.DamageRoll.preHitCheck",(actor,v)=>{
          if(actor.uuid!==target.uuid)return;
          if(Number.isFinite(reaction.ac))v.finalAc.ac=reaction.ac;
          if(reaction.defense&&!actor.system.attributes.conditions?.flatFooted)v.finalAc.ac+=reaction.defense;
          v.roll+=Number(reaction.chargeBonus)||0;
          applyMartialDefense(target,attacker,v,{touch:Boolean(args[19])});
        });
        const result=Hooks.on("D35E.DamageRoll.hit",(actor,v)=>{if(actor.uuid===target.uuid){hitObserved=true;hit=v.hit;crit=v.crit;special=!v.finalAc.noCritical;}});
        const fortify=Hooks.on("D35E.DamageRoll.rollFortify",(actor,v)=>{if(actor.uuid===target.uuid&&v.fortifySuccessfull)crit=false;});
        const damageResult=Hooks.on("D35E.DamageRoll.calculateDamage",(actor,v)=>{if(actor.uuid===target.uuid&&v.finalDamage.incorporealMiss)hit=false;});
        let appliedReceipt=null;
        const criticalReport=attacker&&stanceEffect(attacker,"blood-in-the-water")?Hooks.on("preCreateChatMessage",report=>{
          if(hit&&crit&&report.flags?.D35E?.chatTemplateData?.actor?.id===target.id&&report.flags?.D35E?.template==="systems/D35E/templates/chat/damage-description.html")
            report.updateSource({[`flags.${MODULE_ID}.nativeCritical`]:{message:message.id,actor:attacker.uuid,target:target.uuid,index:attackIndex(args[0])}});
        }):null;
        const one=[...args];one[14]=target;
        if(Number(one[2])>0)one[2]+=windAttackBonus(attacker,target);
        if(meta&&message.flags?.[MODULE_ID]?.nativeMartial?.item&&attacker?.items.get(meta.item)?.flags?.[MODULE_ID]?.martial?.definition==="mighty-throw"){one[7]=[];one[8]=[];one[2]=0;}
        const sourceData=message.flags?.D35E?.chatTemplateData;
        const sourceItem=attacker?.items.get(sourceData?.item?._id??sourceData?.item?.id)??sourceData?.item;
        const spellName=sourceItem?.originalName??sourceItem?.name??message.flags?.D35E?.chatTemplateData?.name;
        const missile=(sourceItem?.type==="spell"||sourceData?.isSpell)&&/^(Magic Missile|魔法飞弹|魔法飛彈)$/i.test(String(spellName??"").trim())
          ||sourceItem?.flags?.[MODULE_ID]?.clericSpell==="magic-missile";
        const shielded=missile&&target.items.some(i=>i.flags?.[MODULE_ID]?.clericEffect==="nightshield"&&effectIsActive(i));
        if(shielded) {
          one[7]=[];one[8]=[];one[13]=false;
        }
        try {
        if(shielded)await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:target}),content:"<p>夜之盾：本次魔法飞弹无效。</p>"});
        if(meta?.area) {
          let saved=nativeMartialSave(message,target)?.success;
          if(meta.save&&saved===undefined){await target.rollSavingThrow(meta.save,null,meta.dc,{skipDialog:true,threeRSourceMessage:message.id});saved=nativeMartialSave(message,target)?.success;}
          const armor=target.items.find(i=>i.type==="equipment"&&i.system.equipped&&i.system.equipmentType==="armor"),canEvade=(!armor||armor.system.equipmentSubtype==="lightArmor")&&!target.system.attributes.conditions?.helpless;
          const evades=meta.save==="ref"&&canEvade&&(swordsageFeatureAvailable(target,"evasion")||swordsageFeatureAvailable(target,"improved-evasion"));
          one[0]={target:args[0]?.target,applyHalf:meta.save==="ref"&&(saved===true||saved===false&&canEvade&&swordsageFeatureAvailable(target,"improved-evasion"))};
          if(!meta.areaDamage||saved&&evades){one[13]=true;one[7]=0;hit=true;hitObserved=true;}
        }
        appliedReceipt=Hooks.on("preUpdateActor",(actor,change)=>{
          if(meta&&hitObserved&&actor.uuid===target.uuid&&(foundry.utils.hasProperty(change,"system.attributes.hp.value")||Object.hasOwn(change,"system.attributes.hp.value")))
            foundry.utils.setProperty(change,`flags.${MODULE_ID}.nativeMartialApplied.${stamp}`,{hit,crit,special});
        });
        await apply.apply(this,one);
        }finally{Hooks.off("D35E.DamageRoll.preHitCheck",pre);Hooks.off("D35E.DamageRoll.hit",result);Hooks.off("D35E.DamageRoll.rollFortify",fortify);Hooks.off("D35E.DamageRoll.calculateDamage",damageResult);if(appliedReceipt!==null)Hooks.off("preUpdateActor",appliedReceipt);if(criticalReport!==null)Hooks.off("preCreateChatMessage",criticalReport);Hooks.off("D35E.DamageRoll.preCalculateDamage",dr);Hooks.off("D35E.DamageRoll.preCheckConcealment",conceal);defenseContexts.delete(target);}
        // Closing the native defense dialog is cancellation, not a miss.
        if(!hitObserved&&!args[5])continue;
        if(!conditionActorLive(target))continue;
        if(game.user.isGM&&Object.keys(reaction).length)await message.setFlag(MODULE_ID,`attackReactionUsed.${keyFor(target.uuid)}`,true);
        if(meta) {
          if(!target.flags?.[MODULE_ID]?.nativeMartialApplied?.[stamp])await target.update({[`flags.${MODULE_ID}.nativeMartialApplied.${stamp}`]:{hit,crit,special}});
          await onHit(message,target,{hit,crit,special});
        }
        if(hit&&crit&&attacker&&game.users.activeGM===game.user)await recordBloodCritical(attacker,message,target,attackIndex(args[0]));
      }
    });
    // The installed native chat handler does not await applyDamage. Attach an
    // observer so its errors are shown once; awaiters still receive rejection.
    completion.catch(error=>{console.error("3r武术原生结算",error);ui.notifications.error(error.message);});
    return completion;
  };

  const action=ItemChatAction._onChatCardAction;
  ItemChatAction._onChatCardAction=async function(event) {
    const button=event.target?.closest?.("button[data-action]"),message=messageFor(event),meta=message?.flags?.[MODULE_ID]?.nativeMartial;
    if(button?.dataset.action!=="rollSave")return action.call(this,event);
    const dc=meta?.dc??message?.flags?.D35E?.chatTemplateData?.dc?.dc,kind=meta?.save??saveKind(message?.flags?.D35E?.chatTemplateData?.dc?.type);
    if(!message||!kind||!(Number(dc)>0))return action.call(this,event);
    event.preventDefault();button.disabled=true;
    try {
      for(const actor of selectedActors().filter(a=>(!meta||meta.targets.includes(a.uuid))&&a.isOwner)) {
        if(meta&&nativeMartialSave(message,actor))continue;
        await actor.rollSavingThrow(kind,message.flags?.D35E?.chatTemplateData?.dc?.ability||null,Number(dc),{threeRSourceMessage:message.id});
      }
    }finally{button.disabled=false;}
  };
}

async function recordBloodCritical(actor,message,target,index) {
  return serial(`critical:${actor.uuid}`,async()=>{
  if(!conditionActorLive(actor))return;
  const stance=stanceEffect(actor,"blood-in-the-water");if(!stance)return;
  const stamp=`${message.id}:${index}:${keyFor(target.uuid)}`,meta=stance.flags[MODULE_ID].martialEffect;
  if(meta.criticalReceipts?.includes(stamp))return;
  const count=(game.time.worldTime-Number(meta.lastCritical??-Infinity)<60?Number(meta.bloodCount)||0:0)+1;
  await stance.update({[`flags.${MODULE_ID}.martialEffect.criticalReceipts`]:[...(meta.criticalReceipts??[]),stamp].slice(-64),
    [`flags.${MODULE_ID}.martialEffect.bloodCount`]:count,[`flags.${MODULE_ID}.martialEffect.lastCritical`]:game.time.worldTime,
    "system.changes":[[String(count),"attack","attack","untyped"],[String(count),"damage","wdamage","untyped"]]});
  });
}
