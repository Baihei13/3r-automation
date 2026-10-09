import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { conditionActionRestriction, CONDITION_NAMES } from "./condition-state.js";
import { conditionActorLive, reconcileConditionJob, conditionMapUpdate, conditionBookkeepingOptions, reportConditionError } from "./condition-jobs.js";

const states=item=>item.getFlag(MODULE_ID,"nativeConditions")??[];
export function actionRestriction(actor,item) {
  return conditionActionRestriction(actor,item);
}
export function syncNativeConditions(actor) {
  if(game.users.activeGM!==game.user||!actor)return Promise.resolve();
  return reconcileConditionJob(actor,"native",async()=>{
    const saved=actor.getFlag(MODULE_ID,"conditionOrigins")??{};
    const record=foundry.utils.deepClone(saved),update={};
    const active=new Set(actor.items.filter(effectIsActive).flatMap(states));
    for(const state of new Set([...Object.keys(record),...active])) {
      if(!CONDITION_NAMES[state])continue;
      const native=Object.hasOwn(actor.system.attributes.conditions,state);
      const path=native?`system.attributes.conditions.${state}`:`flags.${MODULE_ID}.conditions.${state}`;
      const current=Boolean(native?actor.system.attributes.conditions[state]:actor.getFlag(MODULE_ID,"conditions")?.[state]);
      if(active.has(state)) {
        if(!record[state])record[state]={previous:current};
        if(!current)update[path]=true;
      } else if(record[state]) {
        if(current!==record[state].previous)update[path]=record[state].previous;
        delete record[state];
      }
    }
    Object.assign(update,conditionMapUpdate(`flags.${MODULE_ID}.conditionOrigins`,saved,record));
    if(Object.keys(update).length)await actor.update(update,{threeRConditionSync:true,
      ...(Object.keys(update).every(path=>path.startsWith(`flags.${MODULE_ID}.conditionOrigins.`))?conditionBookkeepingOptions:{})});
  });
}
export function installNativeConditions() {
  const report=error=>reportConditionError("状态同步失败",error);
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    const reason=actionRestriction(actor,item);
    if(reason){hook.customUse=true;ui.notifications.warn(reason);}
  });
  const affected=item=>{
    if(item.actor&&(states(item).length||["buff","aura"].includes(item.type)&&Object.keys(item.actor.getFlag(MODULE_ID,"conditionOrigins")??{}).length))syncNativeConditions(item.actor).catch(report);
  };
  for(const event of ["createItem","deleteItem"])Hooks.on(event,item=>affected(item));
  Hooks.on("updateItem",(item,change,options)=>{
    if(options.threeRConditionBookkeeping)return;
    if(Object.keys(foundry.utils.flattenObject(change)).some(key=>key==="system.active"||key.startsWith("system.timeline.")||
      key.startsWith(`flags.${MODULE_ID}.nativeConditions`)||key===`flags.${MODULE_ID}.-=nativeConditions`||key===`flags.${MODULE_ID}.expiresAt`||key===`flags.${MODULE_ID}.-=expiresAt`||key.startsWith("flags.d35e-world-timeline.timer")))affected(item);
  });
  Hooks.on("preUpdateActor",(actor,change,options)=>{
    if(options.threeRConditionSync||options.threeRConditionBookkeeping)return;
    const saved=actor.getFlag(MODULE_ID,"conditionOrigins");
    if(!saved)return;
    const record=foundry.utils.deepClone(saved);
    let modified=false;
    for(const state of Object.keys(record)) {
      const value=change[`system.attributes.conditions.${state}`]??change.system?.attributes?.conditions?.[state]??change[`flags.${MODULE_ID}.conditions.${state}`]??change.flags?.[MODULE_ID]?.conditions?.[state];
      if(typeof value!=="boolean")continue;
      const current=Boolean(actor.system.attributes.conditions[state]??actor.getFlag(MODULE_ID,"conditions")?.[state]);
      // D35E includes derived conditions in full recalculation updates. An
      // unchanged value is not a new manual source for this condition.
      if(value===current)continue;
      record[state].previous=value;modified=true;
    }
    if(modified)change[`flags.${MODULE_ID}.conditionOrigins`]=record;
  });
  Hooks.on("updateActor",(actor,change,options)=>{
    if(options.threeRConditionSync||options.threeRConditionBookkeeping||game.users.activeGM!==game.user||!conditionActorLive(actor))return;
    const cleared=Object.keys(actor.getFlag(MODULE_ID,"conditionOrigins")??{}).filter(state=>
      (change[`system.attributes.conditions.${state}`]??change.system?.attributes?.conditions?.[state]??change[`flags.${MODULE_ID}.conditions.${state}`]??change.flags?.[MODULE_ID]?.conditions?.[state])===false);
    if(!cleared.length)return;
    const updates=actor.items.filter(effectIsActive).filter(item=>states(item).some(state=>cleared.includes(state))).map(item=>{
      const remaining=states(item).filter(state=>!cleared.includes(state));
      return {_id:item.id,...(!remaining.length&&!item.system.changes?.length?{"system.active":false}:{}),[`flags.${MODULE_ID}.nativeConditions`]:remaining};
    });
    (async()=>{
      if(!conditionActorLive(actor))return;
      const current=updates.filter(row=>actor.items.has(row._id));
      if(current.length)await actor.updateEmbeddedDocuments("Item",current);
      if(conditionActorLive(actor))await syncNativeConditions(actor);
    })().catch(error=>{if(conditionActorLive(actor))report(error);});
  });
}
