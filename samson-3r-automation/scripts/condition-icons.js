import { ActorConditions } from "../../../systems/D35E/module/actor/actions/conditions.js";
import { conditionActorLive, reconcileConditionJob } from "./condition-jobs.js";
import { createTransientView } from "./transient-view.js";

const overlays=new Set(["dead","banished"]);
let installed=false;

// D35E 3.1.0 preprocesses death/banishment by toggling an ActiveEffect before
// saving the Actor. That toggle refreshes the Actor against its OLD conditions;
// a missing condition in a bookkeeping update also requests overlay removal.
// Limit the view to preprocessing. All actual calculation and persistence use
// the real Actor; the post-commit native icon reconciler owns these icons.
export async function prepareConditionUpdate(updater,update,change,options={},...args) {
  const actor=updater.actor;
  updater.actor=createTransientView(actor,{getActiveTokens:(...values)=>actor.getActiveTokens(...values).map(token=>{
    const target=token.actor;
    if(!target)return token;
    const view=createTransientView(target,{toggleStatusEffect:(id,settings={})=>
      settings.overlay===true&&overlays.has(id)?Promise.resolve():target.toggleStatusEffect(id,settings)});
    return createTransientView(token,{actor:view});
  })});
  try{return await update.call(updater,change,{...options,updateChanges:false},...args);}
  finally{updater.actor=actor;}
}

export function installConditionIcons() {
  if(installed)return;installed=true;
  const reconcile=ActorConditions.prototype.toggleConditionStatusIcons;
  ActorConditions.prototype.toggleConditionStatusIcons=function(...args) {
    const actor=this.actor;
    if(actor.compendium||!actor.id)return reconcile.apply(this,args);
    return reconcileConditionJob(actor,"native-icons",async()=>{
      await reconcile.apply(this,args);
      if(!conditionActorLive(actor))return;
      const tokens=actor.token?[actor.token]:actor.getActiveTokens();
      const targets=new Set(tokens.map(token=>token.actor??actor));
      for(const target of targets) {
        if(!conditionActorLive(target)||!target.testUserPermission(game.user,"OWNER"))continue;
        const updates=target.effects.filter(effect=>effect.getFlag("D35E","show")!==undefined&&
          effect.statuses?.size===1&&[...effect.statuses].some(id=>overlays.has(id)&&target.system.attributes.conditions[id]===true)&&
          effect.getFlag("core","overlay")!==true).map(effect=>({_id:effect.id,"flags.core.overlay":true}));
        if(updates.length)await target.updateEmbeddedDocuments("ActiveEffect",updates,{stopUpdates:true,threeRConditionMarker:true});
      }
    });
  };
}
