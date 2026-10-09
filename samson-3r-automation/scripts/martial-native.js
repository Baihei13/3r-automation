import { MODULE_ID } from "./catalog.js";
import { martial } from "./martial-state.js";
import { swordsageFeatureAvailable } from "./martial-class-features.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";
import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";
import { ItemChatAction } from "../../../systems/D35E/module/item/chat/chatAction.js";
import { registerMartialEvent,closeMartialEvent,martialEventSource,chooseMartialReaction,saveKind } from "./martial-events.js";

const queues=new Map(),defenseContexts=new WeakMap();
const serial=(key,work)=>{const next=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(work);queues.set(key,next);return next.finally(()=>{if(queues.get(key)===next)queues.delete(key);});};
const messageFor=event=>{const root=event?.target?.closest?.(".message");return game.messages.get(root?.dataset.messageId);};
const selectedActors=()=>[...new Map([...(game.user.targets.size?game.user.targets:canvas.tokens.controlled)].filter(t=>t.actor).map(t=>[t.actor.uuid,t.actor])).values()];
const keyFor=uuid=>encodeURIComponent(uuid).replaceAll(".","%2E");
const resultRoll=result=>Array.isArray(result)?result.find(r=>Number.isFinite(r?.total)):result;
export function nativeMartialSave(message,target) {
  return message.flags?.[MODULE_ID]?.nativeSaveResults?.[keyFor(target.uuid)];
}

export function installNativeMartialEvents(onHit) {
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
    if(game.users.activeGM!==game.user||martial(this.item))return attack.call(this,full,form,temporary,actor,data,...args);
    const root=form?.nodeType===1?form:form?.[0],charge=root?.querySelector('[name="charge"]')?.checked,reactions={};
    const targets=command?.context?.targets?(await Promise.all(command.context.targets.map(uuid=>fromUuid(uuid)))).filter(a=>a?.documentName==="Actor"):selectedActors();
    for(const target of targets.filter(t=>t.uuid!==actor.uuid)) {
      const eventKey=registerMartialEvent({kind:charge?"charge":"attack",target:target.uuid,attacker:actor.uuid,weapon:this.item.uuid,rolled:false,label:charge?`${actor.name}正在冲锋`:`${actor.name}即将攻击`});
      try{await chooseMartialReaction(target,eventKey,p=>p.replaces==="ac"||charge&&p.opposedAbility);reactions[target.uuid]={...martialEventSource(eventKey)};}
      finally{closeMartialEvent(eventKey);}
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
    const completion=serial("native-damage",async()=>{
      const message=messageFor(args[0]),meta=message?.flags?.[MODULE_ID]?.nativeMartial;
      const targets=args[14]?[args[14]]:selectedActors();
      if(!message||!targets.length)return apply.apply(this,args);
      for(const target of targets) {
        const stamp=`${meta?.id??message.id}:${meta?.slot??0}:${keyFor(target.uuid)}`;
        if(meta&&(game.users.activeGM!==game.user||!meta.targets.includes(target.uuid)))throw new Error("本次武术伤害由主GM对原目标应用。");
        const previous=target.flags?.[MODULE_ID]?.nativeMartialApplied?.[stamp];
        if(meta&&previous){await onHit(message,target,previous);continue;}
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
        const attacker=meta?await fromUuid(meta.actor):(canvas.tokens?.get(args[16])?.actor??game.actors.get(args[15]));
        if(meta?.flatFooted)defenseContexts.set(target,{flatfooted:true});
        const dr=Hooks.on("D35E.DamageRoll.preCalculateDamage",(actor,v)=>{if(actor.uuid===target.uuid&&meta?.bypassDR)v.dr=[];});
        const conceal=Hooks.on("D35E.DamageRoll.preCheckConcealment",(actor,v)=>{
          if(actor.uuid!==target.uuid)return;
          const chance=Math.max(0,...(attacker?.items??[]).filter(i=>i.type==="buff"&&i.system.active).map(i=>Number(i.flags?.[MODULE_ID]?.martialEffect?.missChance)||0));
          if(chance&&!v.finalAc.noCheck){v.forceConcealRoll=true;v.finalAc.concealOverride=Math.max(chance,Number(v.finalAc.concealOverride)||0,v.finalAc.fullConceal?50:v.finalAc.conceal?20:0);}
        });
        const pre=Hooks.on("D35E.DamageRoll.preHitCheck",(actor,v)=>{
          if(actor.uuid!==target.uuid)return;
          if(Number.isFinite(reaction.ac))v.finalAc.ac=reaction.ac;
          if(reaction.defense&&!actor.system.attributes.conditions?.flatFooted)v.finalAc.ac+=reaction.defense;
          v.roll+=Number(reaction.chargeBonus)||0;
        });
        const result=Hooks.on("D35E.DamageRoll.hit",(actor,v)=>{if(actor.uuid===target.uuid){hitObserved=true;hit=v.hit;crit=v.crit;special=!v.finalAc.noCritical;}});
        const fortify=Hooks.on("D35E.DamageRoll.rollFortify",(actor,v)=>{if(actor.uuid===target.uuid&&v.fortifySuccessfull)crit=false;});
        const damageResult=Hooks.on("D35E.DamageRoll.calculateDamage",(actor,v)=>{if(actor.uuid===target.uuid&&v.finalDamage.incorporealMiss)hit=false;});
        let appliedReceipt=null;
        const one=[...args];one[14]=target;
        try {
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
        }finally{Hooks.off("D35E.DamageRoll.preHitCheck",pre);Hooks.off("D35E.DamageRoll.hit",result);Hooks.off("D35E.DamageRoll.rollFortify",fortify);Hooks.off("D35E.DamageRoll.calculateDamage",damageResult);if(appliedReceipt!==null)Hooks.off("preUpdateActor",appliedReceipt);Hooks.off("D35E.DamageRoll.preCalculateDamage",dr);Hooks.off("D35E.DamageRoll.preCheckConcealment",conceal);defenseContexts.delete(target);}
        // Closing the native defense dialog is cancellation, not a miss.
        if(!hitObserved&&!args[5])continue;
        if(game.user.isGM&&Object.keys(reaction).length)await message.setFlag(MODULE_ID,`attackReactionUsed.${keyFor(target.uuid)}`,true);
        if(meta) {
          if(!target.flags?.[MODULE_ID]?.nativeMartialApplied?.[stamp])await target.update({[`flags.${MODULE_ID}.nativeMartialApplied.${stamp}`]:{hit,crit,special}});
          await onHit(message,target,{hit,crit,special});
        }
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
