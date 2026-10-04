import { MODULE_ID } from "./catalog.js";
import { applyCondition, actorQueue } from "./condition-tools.js";
import { conditionState } from "./condition-state.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";

export const conditionSpell=item=>({"pf-spell-castigate":"castigate","pf-spell-rebuke":"rebuke"})[item?.getFlag(MODULE_ID,"key")];
export const sameDeity=(caster,target)=>Boolean(String(caster.system.details.deity??"").trim())&&String(caster.system.details.deity).trim().toLocaleLowerCase()===String(target.system.details.deity??"").trim().toLocaleLowerCase();
export function conditionSpellEligibility(item,actor,target) {
  const id=conditionSpell(item),c=conditionState(target),immunity=target.system.traits.ci?.value??[];
  if(id==="castigate"&&(c.dead||["construct","undead"].includes(target.system.attributes.creatureType)))return "目标不是活物";
  if(id==="castigate"&&(immunity.includes("fear")||immunity.includes("mindAffecting")))return "目标免疫";
  if(id==="rebuke"&&actor.getFlag(MODULE_ID,"magicalSilence"))return "施法者处于魔法沉默";
  return null;
}
export async function applyConditionSpell(item,actor,target,{cl,dc,saveFailed,start,message,pending}) {
  const id=conditionSpell(item),receipt=`${message.uuid}:${target.uuid}`,source={sourceActor:actor.uuid,sourceItemUuid:item.uuid,sourceName:item.name,start,receipt};
  const progress=pending.effectProgress??={};
  const persist=()=>message.setFlag(MODULE_ID,"cardResolution",pending);
  if(id==="castigate") {
    const seconds=saveFailed?6*cl:6;
    if(start+seconds<=game.time.worldTime)return false;
    return applyCondition(target,saveFailed?"cowering":"shaken",{...source,seconds,context:{saveDC:dc,save:"will",mindAffecting:true,
      ...(saveFailed?{repeatSaveAtTurn:true,createdTurn:game.combat?.started?`${game.combat.id}:${game.combat.round}:${game.combat.turn}`:null,repeatSavePenalty:sameDeity(actor,target)?-2:0}:{} )}});
  }
  if(id!=="rebuke")return false;
  const same=sameDeity(actor,target),count=same?Math.min(10,cl):Math.min(5,Math.floor(cl/2));
  if(progress.damageTotal===undefined){const roll=await new Roll35e(count>0?`${count}d${same?6:8}`:"0").roll();progress.damageTotal=roll.total;await persist();await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`叱责 → ${target.name}`});}
  const amount=saveFailed?progress.damageTotal:Math.floor(progress.damageTotal/2),sonic=Math.floor(amount/2),divine=amount-sonic;
  const resist=ActorDamageHelper.getERForActor(target).find(entry=>/^(damage|energy)-sonic$/.test(entry.uid)||/sonic|音波/i.test(entry.name));
  let sound=resist?.immunity?0:Math.max(0,sonic-(Number(resist?.value)||0));
  if(!resist?.immunity&&resist?.vulnerable)sound=Math.floor(sound*1.5);
  else if(!resist?.immunity&&resist?.half)sound=Math.ceil(sound/2);
  // Store the receipt with the HP change, so reopening an interrupted card
  // cannot apply this target's damage twice. Use native simple-damage HP rules.
  await actorQueue(target,async()=>{
    const receipts=target.getFlag(MODULE_ID,"conditionDamageReceipts")??{};
    if(receipts[receipt])return;
    const hp=target.system.attributes.hp,temp=Number(hp.temp)||0,damage=sound+divine,absorbed=Math.min(temp,damage);
    await target.update({"system.attributes.hp.temp":temp-absorbed,"system.attributes.hp.value":Math.clamp(Number(hp.value)-(damage-absorbed),-100,hp.max),
      [`flags.${MODULE_ID}.conditionDamageReceipts`]:{...receipts,[receipt]:true}});
  });
  if(saveFailed) {
    let seconds=progress.seconds??6;
    if(same&&progress.seconds===undefined){const duration=await new Roll35e("1d4").roll();seconds=duration.total*6;progress.seconds=seconds;await persist();await duration.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:"叱责：震慑持续轮数"});}
    if(start+seconds>game.time.worldTime)await applyCondition(target,same?"stunned":"staggered",{...source,seconds,context:{saveDC:dc,save:"fort"}});
  }
  return true;
}
