import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { conditionActionRestriction, CONDITION_NAMES } from "./condition-state.js";

const queues=new Map();
const states=item=>item.getFlag(MODULE_ID,"nativeConditions")??[];
export function actionRestriction(actor,item) {
  return conditionActionRestriction(actor,item);
}
export function syncNativeConditions(actor) {
  if(game.users.activeGM!==game.user||!actor)return Promise.resolve();
  const previous=queues.get(actor.uuid)??Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
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
    if(JSON.stringify(saved)!==JSON.stringify(record))update[`flags.${MODULE_ID}.conditionOrigins`]=record;
    if(Object.keys(update).length)await actor.update(update,{threeRConditionSync:true});
  });
  queues.set(actor.uuid,next);
  return next.finally(()=>{if(queues.get(actor.uuid)===next)queues.delete(actor.uuid);});
}
export function installNativeConditions() {
  const report=error=>{console.error(MODULE_ID,error);ui.notifications.error(`状态同步失败：${error.message}`);};
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    const reason=actionRestriction(actor,item);
    if(reason){hook.customUse=true;ui.notifications.warn(reason);}
  });
  for(const event of ["createItem","updateItem","deleteItem"])
    Hooks.on(event,item=>{if(item.actor&&(states(item).length||Object.keys(item.actor.getFlag(MODULE_ID,"conditionOrigins")??{}).length))syncNativeConditions(item.actor).catch(report);});
  Hooks.on("preUpdateActor",(actor,change,options)=>{
    if(options.threeRConditionSync)return;
    const saved=actor.getFlag(MODULE_ID,"conditionOrigins");
    if(!saved)return;
    const record=foundry.utils.deepClone(saved);
    let modified=false;
    for(const state of Object.keys(record)) {
      const value=change[`system.attributes.conditions.${state}`]??change.system?.attributes?.conditions?.[state]??change[`flags.${MODULE_ID}.conditions.${state}`]??change.flags?.[MODULE_ID]?.conditions?.[state];
      if(typeof value!=="boolean")continue;
      record[state].previous=value;modified=true;
    }
    if(modified)change[`flags.${MODULE_ID}.conditionOrigins`]=record;
  });
  Hooks.on("updateActor",(actor,change,options)=>{
    if(options.threeRConditionSync||game.users.activeGM!==game.user)return;
    const cleared=Object.keys(actor.getFlag(MODULE_ID,"conditionOrigins")??{}).filter(state=>
      (change[`system.attributes.conditions.${state}`]??change.system?.attributes?.conditions?.[state]??change[`flags.${MODULE_ID}.conditions.${state}`]??change.flags?.[MODULE_ID]?.conditions?.[state])===false);
    if(!cleared.length)return;
    const updates=actor.items.filter(effectIsActive).filter(item=>states(item).some(state=>cleared.includes(state))).map(item=>{
      const remaining=states(item).filter(state=>!cleared.includes(state));
      return {_id:item.id,...(!remaining.length&&!item.system.changes?.length?{"system.active":false}:{}),[`flags.${MODULE_ID}.nativeConditions`]:remaining};
    });
    (async()=>{if(updates.length)await actor.updateEmbeddedDocuments("Item",updates);await syncNativeConditions(actor);})().catch(report);
  });
}
