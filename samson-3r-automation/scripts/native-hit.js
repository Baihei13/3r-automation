import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";
import { createTransientView } from "./transient-view.js";
import { applyMartialDefense } from "./martial-context.js";
import { windAttackBonus } from "./martial-terrain.js";
import { conditionActorLive } from "./condition-jobs.js";
import { MODULE_ID } from "./catalog.js";
import { martialMissChanceForRoll,applyMartialMissChance } from "./martial-miss.js";

// Capture the installed D35E implementation before installing our damage
// observer. Touch effects need its defense/concealment/fortification pipeline,
// without a second HP writer or a speculative critical checkbox.
const nativeApply=ActorDamageHelper.applyDamage,queues=new Map();
export function nativeDamageQueue(work) {
  const next=(queues.get("damage")??Promise.resolve()).catch(()=>{}).then(work);
  queues.set("damage",next);
  return next.finally(()=>{if(queues.get("damage")===next)queues.delete("damage");});
}
export async function nativeHitCheck(message,attacker,target,{touch=true,index=0}={}) {
  return nativeDamageQueue(async()=>{
    if(!conditionActorLive(target)||!conditionActorLive(attacker))throw new Error("接触攻击来源或目标已删除，未应用效果。");
    const chat=message.flags?.D35E?.chatTemplateData?.attacks?.[index];
    if(!chat?.hasAttack||!Number.isFinite(chat.attack?.total))throw new Error("来源卡缺少原生攻击结果，未应用效果。");
    if(chat.fumble||chat.attack.isFumble||chat.attack.conditionMiss)return {hit:false,crit:false};
    const item=attacker.items.get(message.flags?.D35E?.chatTemplateData?.item?.id),spell=item?.type==="spell";
    // D35E rejects nonmagical enh=0 against incorporeal creatures. A spell is
    // magical even when it is not a +1 weapon. These are calculation arguments,
    // not an enhancement bonus written onto the spell or the actor.
    const enhancement=spell?Math.max(1,Number(item.system.enh)||0):Number(item?.system.enh)||0;
    const incorporeal=Boolean(attacker.system.traits?.incorporeal||item?.system.properties?.inc||item?.flags?.[MODULE_ID]?.clericPlan==="energy"
      ||item?.system.damage?.parts?.some(part=>["energy-force","energy-positive","energy-negative"].includes(part[2])));
    let observed=false,hit=false,crit=false;
    // A read-only calculation view forwards native methods with their real
    // receiver. Only the zero-damage write and unrelated defense actions are
    // suppressed; actual damage/ability damage is committed by the effect once.
    const view=createTransientView(target,{update:async()=>target,updateDamageReductionPoolItems:async()=>{},getAndApplyCombatChangesSpecialActions:async()=>[]});
    const pre=Hooks.on("D35E.DamageRoll.preHitCheck",(actor,v)=>{if(actor.uuid===target.uuid)applyMartialDefense(target,attacker,v,{touch});});
    const result=Hooks.on("D35E.DamageRoll.hit",(actor,v)=>{if(actor.uuid===target.uuid){observed=true;hit=v.hit;crit=v.crit;}});
    const fortify=Hooks.on("D35E.DamageRoll.rollFortify",(actor,v)=>{if(actor.uuid===target.uuid&&v.fortifySuccessfull)crit=false;});
    const calculated=Hooks.on("D35E.DamageRoll.calculateDamage",(actor,v)=>{if(actor.uuid===target.uuid&&v.finalDamage.incorporealMiss)hit=false;});
    const conceal=Hooks.on("D35E.DamageRoll.preCheckConcealment",(actor,v)=>{
      if(actor.uuid===target.uuid)applyMartialMissChance(v,martialMissChanceForRoll(chat.attack,attacker));
    });
    try {
      await nativeApply.call(ActorDamageHelper,{},chat.attack.total,chat.hasCritConfirm?(Number(chat.critConfirm?.total)||0)+windAttackBonus(attacker,target):0,
        Boolean(chat.natural20??chat.attack.isNatural20),Boolean(chat.natural20Crit),Boolean(chat.fumble),Boolean(chat.fumbleCrit),
        [],[],null,null,enhancement,false,false,view,attacker.id,attacker.token?.id,null,incorporeal,touch);
    }finally{Hooks.off("D35E.DamageRoll.preHitCheck",pre);Hooks.off("D35E.DamageRoll.hit",result);Hooks.off("D35E.DamageRoll.rollFortify",fortify);Hooks.off("D35E.DamageRoll.calculateDamage",calculated);Hooks.off("D35E.DamageRoll.preCheckConcealment",conceal);}
    return observed&&conditionActorLive(target)?{hit:Boolean(hit),crit:Boolean(hit&&crit)}:null;
  });
}
