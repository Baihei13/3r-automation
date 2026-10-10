import { MODULE_ID } from "./catalog.js";
import { conditionState, conditionContext } from "./condition-state.js";
import { clearCondition, applyCondition, actorQueue } from "./condition-tools.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { ActorUpdater } from "../../../systems/D35E/module/actor/update/actorUpdater.js";
import { conditionActorLive, conditionBookkeepingOptions, reportConditionError } from "./condition-jobs.js";
import { prepareConditionUpdate } from "./condition-icons.js";
import { conditionAdmin } from "./condition-policy.js";

const gm=()=>game.users.activeGM===game.user;
const report=error=>reportConditionError("伤势结算",error);
const post=(actor,text)=>ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${foundry.utils.escapeHTML(text)}</p>`});
const worldActors=()=>[...new Map([...game.actors,...game.scenes.contents.flatMap(scene=>scene.tokens.contents.filter(token=>!token.actorLink&&token.actor).map(token=>token.actor))].map(actor=>[actor.uuid,actor])).values()];
export async function damageConditionHP(actor,amount) {
  if(!actor?.isOwner||!Number.isFinite(amount)||amount<=0)throw new Error("伤势结算的对象或伤害无效。");
  // Bleeding and strenuous activity lose actual HP, bypassing temporary HP.
  return actorQueue(actor,()=>actor.update({"system.attributes.hp.value":Number(actor.system.attributes.hp.value)-amount,
    ...(conditionState(actor).stable?{"system.attributes.conditions.dying":false}:{} )},{threeRConditionInjury:true}));
}
export async function stabilizeCondition(actor,{aided=true}={}) {
  const hp=Number(actor.system.attributes.hp.value);
  if(!actor.isOwner||hp>=0||conditionState(actor).dead)return false;
  await actor.update({"system.attributes.conditions.dying":false,"system.attributes.conditions.stable":true,
    "system.attributes.conditions.unconscious":true,[`flags.${MODULE_ID}.conditionContext.stable.aided`]:aided,
    [`flags.${MODULE_ID}.injuryClock`]:{mode:"stable",next:game.time.worldTime+3600}});
  return true;
}
export async function completeConditionRest(actor,seconds) {
  if(!actor?.isOwner||!Number.isFinite(seconds)||seconds<3600)return;
  const c=conditionState(actor);
  if(c.dead||c.petrified)return;
  if(seconds>=8*3600) {
    for(const id of ["exhausted","fatigued"])if(c[id]&&conditionContext(actor,id).restRemovable!==false)await clearCondition(actor,id);
  }else if(c.exhausted&&conditionContext(actor,"exhausted").restRemovable!==false) {
    await clearCondition(actor,"exhausted");await applyCondition(actor,"fatigued",{sourceName:"力竭后休息"});
  }
}
async function percent(actor,label) {
  const roll=await new Roll35e("1d100").roll();
  await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:label});
  return roll.total<=10;
}
async function processActor(actor,now) {
  if(!conditionActorLive(actor))return;
  let c=conditionState(actor),clock=actor.getFlag(MODULE_ID,"injuryClock");
  const hp=()=>Number(actor.system.attributes.hp.value);
  const mode=c.dead?null:c.dying?"dying":c.stable&&hp()<0?(c.unconscious?"stable":actor.getFlag(MODULE_ID,"naturalRecovery")?null:"recovering"):null;
  // A new condition starts its own clock; loading an old world never fabricates past damage.
  if(!mode) {if(clock)await actor.update({[`flags.${MODULE_ID}.-=injuryClock`]:null},conditionBookkeepingOptions);}
  else if(!clock||clock.mode!==mode)await actor.update({[`flags.${MODULE_ID}.injuryClock`]:{mode,next:now+(mode==="dying"?6:mode==="stable"?3600:86400)}},conditionBookkeepingOptions);
  else {
    let next=clock.next,steps=0,currentMode=mode;
    while(next<=now&&steps++<1000&&!c.dead&&conditionActorLive(actor)) {
      const success=await percent(actor,currentMode==="dying"?"濒死：10%机会自行稳定":currentMode==="stable"?"稳定：10%机会恢复意识":"无援助恢复：10%机会开始自然恢复");
      if(!conditionActorLive(actor))return;
      if(currentMode==="dying") {
        if(success) {
          await stabilizeCondition(actor,{aided:false});currentMode="stable";next+=3600;
          await post(actor,`${actor.name}伤势自行稳定。`);
        }else {await damageConditionHP(actor,1);next+=6;}
      }else if(currentMode==="stable") {
        if(success) {
          await actor.update({"system.attributes.conditions.unconscious":false,"system.attributes.conditions.disabled":true,
            ...(!c.paralyzed&&!c.petrified&&!actor.getFlag(MODULE_ID,"conditionOrigins")?.helpless?{"system.attributes.conditions.helpless":false}:{})});
          currentMode="recovering";next+=86400;await post(actor,`${actor.name}恢复意识，仍处于失能状态。`);
        }else {
          if(!conditionContext(actor,"stable").aided)await damageConditionHP(actor,1);
          next+=3600;
        }
      }else {
        if(conditionContext(actor,"stable").aided||success) {
          await actor.update({[`flags.${MODULE_ID}.naturalRecovery`]:true},conditionBookkeepingOptions);currentMode=null;break;
        }
        await damageConditionHP(actor,1);next+=86400;
      }
      c=conditionState(actor);
    }
    if(!conditionActorLive(actor))return;
    if(currentMode&&!c.dead)await actor.update({[`flags.${MODULE_ID}.injuryClock`]:{mode:currentMode,next}},conditionBookkeepingOptions);
    else await actor.update({[`flags.${MODULE_ID}.-=injuryClock`]:null},conditionBookkeepingOptions);
  }
  if(!conditionActorLive(actor))return;
  const nonlethal=Number(actor.system.attributes.hp.nonlethal)||0;
  const stamp=actor.getFlag(MODULE_ID,"nonlethalClock");
  if(nonlethal>0&&!c.dead&&!c.petrified) {
    if(!Number.isFinite(stamp))await actor.update({[`flags.${MODULE_ID}.nonlethalClock`]:now},conditionBookkeepingOptions);
    else if(now-stamp>=3600) {
      const hours=Math.floor((now-stamp)/3600),heal=hours*(Number(actor.system.attributes.hd.total)||0);
      await actor.update({"system.attributes.hp.nonlethal":Math.max(0,nonlethal-heal),[`flags.${MODULE_ID}.nonlethalClock`]:stamp+hours*3600});
    }
  }else if(stamp!==undefined)await actor.update({[`flags.${MODULE_ID}.-=nonlethalClock`]:null},conditionBookkeepingOptions);
}
let queue=Promise.resolve();
export function processConditionTime() {
  if(!gm())return Promise.resolve();
  queue=queue.catch(report).then(async()=>{for(const actor of worldActors()) {
    try{await processActor(actor,game.time.worldTime);}catch(error){if(conditionActorLive(actor))report(error);}
  }});
  return queue;
}
export function installConditionVitals() {
  const update=ActorUpdater.prototype.update;
  ActorUpdater.prototype.update=async function(change,options,...args) {
    const requested=foundry.utils.expandObject(change).system?.attributes?.conditions??{};
    let result=await prepareConditionUpdate(this,update,change,options,...args);
    // Same public D35E updateChanges/merge path as ActorUpdater.update, after
    // restoring the real Actor. No temporary view reaches numeric calculation.
    if(options?.updateChanges!==false) {
      const calculated=await this.updateChanges({updated:result},options??{});
      if(calculated?.diff?.items)delete calculated.diff.items;
      result=foundry.utils.mergeObject(result,calculated?.diff??{});
    }
    delete result.effects;
    // The native HP preprocessor overwrites explicitly supplied stable/death
    // results. Keep explicit outcomes of healing, stabilization and death saves.
    for(const [id,value] of Object.entries(requested))if(typeof value==="boolean")result[`system.attributes.conditions.${id}`]=value;
    return result;
  };
  const actorUpdate=CONFIG.Actor.documentClass.prototype.update;
  CONFIG.Actor.documentClass.prototype.update=function(change,options={}) {
    change=foundry.utils.deepClone(change);
    const hp=Number(this.system.attributes.hp.value),value=change["system.attributes.hp.value"]??change.system?.attributes?.hp?.value;
    const numeric=typeof value==="number"?value:typeof value==="string"&&value.startsWith("+")?hp+Number(value):Number(value);
    if(value!==undefined&&Number.isFinite(numeric)&&numeric>hp&&!options.threeRResurrection) {
      const c=conditionState(this);
      if((c.dead||c.petrified)&&!conditionAdmin(options)){ui.notifications.warn(c.dead?"死亡须按复活效果处理，普通治疗无效。":"石化须先解除，普通治疗不能修复石质身体。");return Promise.resolve(this);}
      change["system.attributes.conditions.dying"]=false;
      change["system.attributes.conditions.stable"]=numeric<0;
      if(numeric<0)change[`flags.${MODULE_ID}.conditionContext.stable.aided`]=true;
      else {
        change["system.attributes.conditions.disabled"]=false;
        if(hp<0&&!this.items.some(item=>item.system.active&&item.getFlag(MODULE_ID,"nativeConditions")?.includes("unconscious"))) {
          change["system.attributes.conditions.unconscious"]=false;
          if(!c.paralyzed&&!c.petrified&&!this.getFlag(MODULE_ID,"conditionOrigins")?.helpless)change["system.attributes.conditions.helpless"]=false;
        }
      }
    }
    const nonlethalValue=change["system.attributes.hp.nonlethal"]??change.system?.attributes?.hp?.nonlethal;
    if(value!==undefined||nonlethalValue!==undefined){
      const nextHP=value===undefined?hp:numeric,nextNonlethal=Number(nonlethalValue??this.system.attributes.hp.nonlethal)||0;
      const origins=foundry.utils.deepClone(this.getFlag(MODULE_ID,"nonlethalOrigins")??{});
      const asleep=nextNonlethal>Math.max(0,nextHP);
      if(asleep){origins.helpless??={previous:Boolean(this.system.attributes.conditions.helpless)};change["system.attributes.conditions.helpless"]=true;}
      else if(origins.helpless){
        const c=conditionState(this);
        if(!c.paralyzed&&!c.petrified&&!this.items.some(item=>item.system.active&&item.getFlag(MODULE_ID,"nativeConditions")?.includes("helpless")))change["system.attributes.conditions.helpless"]=origins.helpless.previous;
        delete origins.helpless;
      }
      for(const [id,active] of Object.entries({unconscious:nextNonlethal>Math.max(0,nextHP),staggered:nextNonlethal>0&&nextNonlethal===nextHP})){
        if(active){origins[id]??={previous:Boolean(this.system.attributes.conditions[id])};change[`system.attributes.conditions.${id}`]=true;}
        else if(origins[id]){change[`system.attributes.conditions.${id}`]=origins[id].previous;delete origins[id];}
        // Override the core's comparison against maximum HP, without clearing
        // a separately applied spell or a manual condition.
        else if(!Object.hasOwn(change,`system.attributes.conditions.${id}`))change[`system.attributes.conditions.${id}`]=Boolean(this.system.attributes.conditions[id]);
      }
      const remainsStable=change["system.attributes.conditions.dying"]===false&&(change["system.attributes.conditions.stable"]??this.system.attributes.conditions.stable);
      if(nextHP<0&&!options.threeRResurrection&&!remainsStable){
        change["system.attributes.conditions.unconscious"]=true;
        if(value!==undefined&&numeric<hp)change["system.attributes.conditions.stable"]=false;
      }
      change[`flags.${MODULE_ID}.nonlethalOrigins`]=origins;
    }
    return actorUpdate.call(this,change,options);
  };
  Hooks.on("preUpdateActor",(actor,change,options,userId)=>{
    const current=Number(actor.system.attributes.hp.value),next=change["system.attributes.hp.value"]??change.system?.attributes?.hp?.value;
    if(!Number.isFinite(next)||next<=current||options.threeRResurrection)return;
    const c=conditionState(actor);
    if((c.dead||c.petrified)&&!conditionAdmin({...options,user:game.users.get(options.threeRConditionUserId??userId??game.user.id)})) {
      ui.notifications.warn(c.dead?"死亡不能用普通治疗恢复生命；请按复活效果结算。":"石化的身体不能用普通治疗修复。");
      return false;
    }
    if(next<0) {
      change["system.attributes.conditions.dying"]=false;
      change["system.attributes.conditions.stable"]=true;
      change[`flags.${MODULE_ID}.conditionContext.stable.aided`]=true;
    }else {
      for(const id of ["dying","stable","disabled"])change[`system.attributes.conditions.${id}`]=false;
      // Only clear injury-derived unconsciousness, not an independent spell.
      if(current<0&&!actor.items.some(item=>item.system.active&&item.getFlag(MODULE_ID,"nativeConditions")?.includes("unconscious")))change["system.attributes.conditions.unconscious"]=false;
    }
  });
  Hooks.on("updateActor",(actor,change,options)=>{
    if(!gm()||!conditionActorLive(actor)||options.threeRConditionInjury||options.threeRConditionBookkeeping)return;
    const changed=change.system?.attributes?.hp||Object.keys(change).some(key=>key.startsWith("system.attributes.hp"));
    if(!changed)return;
    const c=conditionState(actor),mode=c.dead?null:c.dying?"dying":c.stable?"stable":null;
    const old=actor.getFlag(MODULE_ID,"injuryClock");
    if(mode&&mode!==old?.mode)actor.update({[`flags.${MODULE_ID}.injuryClock`]:{mode,next:game.time.worldTime+(mode==="dying"?6:3600)}},conditionBookkeepingOptions).catch(error=>{if(conditionActorLive(actor))report(error);});
    if(Number(actor.system.attributes.hp.nonlethal)>0&&!Number.isFinite(actor.getFlag(MODULE_ID,"nonlethalClock")))actor.update({[`flags.${MODULE_ID}.nonlethalClock`]:game.time.worldTime},conditionBookkeepingOptions).catch(error=>{if(conditionActorLive(actor))report(error);});
  });
  Hooks.on("updateWorldTime",()=>processConditionTime().catch(report));
  if(gm())for(const actor of worldActors())if(Number(actor.system.attributes.hp.nonlethal)>0&&!Number.isFinite(actor.getFlag(MODULE_ID,"nonlethalClock")))actor.update({[`flags.${MODULE_ID}.nonlethalClock`]:game.time.worldTime},conditionBookkeepingOptions).catch(error=>{if(conditionActorLive(actor))report(error);});
}
