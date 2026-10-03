import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";

const queues=new Map();
const states=item=>item.getFlag(MODULE_ID,"nativeConditions")??[];
export function actionRestriction(actor,item) {
  const conditions=actor?.system.attributes.conditions??{};
  const unable=["dead","unconscious","paralyzed","stunned","dazed"].find(state=>conditions[state]);
  if(unable)return `${actor.name}处于${game.i18n.localize(CONFIG.D35E.conditions[unable])}状态，无法行动。`;
  if(conditions.nauseated&&item.system.activation?.type!=="move")return "反胃时只能执行移动动作，不能攻击、施法或作其他需专注的行动。";
  if(conditions.staggered&&["full","round"].includes(item.system.activation?.type))return "恍惚时每轮只能执行一个标准动作或移动动作，不能作整轮动作。";
  return null;
}
export function syncNativeConditions(actor) {
  if(game.users.activeGM!==game.user||!actor)return Promise.resolve();
  const previous=queues.get(actor.uuid)??Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const saved=actor.getFlag(MODULE_ID,"conditionOrigins")??{};
    const record=foundry.utils.deepClone(saved),update={};
    const active=new Set(actor.items.filter(effectIsActive).flatMap(states));
    for(const state of new Set([...Object.keys(record),...active])) {
      if(!Object.hasOwn(actor.system.attributes.conditions,state))continue;
      const current=Boolean(actor.system.attributes.conditions[state]);
      if(active.has(state)) {
        if(!record[state])record[state]={previous:current};
        if(!current)update[`system.attributes.conditions.${state}`]=true;
      } else if(record[state]) {
        if(current!==record[state].previous)update[`system.attributes.conditions.${state}`]=record[state].previous;
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
    Hooks.on(event,item=>{if(item.actor&&states(item).length)syncNativeConditions(item.actor).catch(report);});
  Hooks.on("preUpdateActor",(actor,change,options)=>{
    if(options.threeRConditionSync)return;
    const saved=actor.getFlag(MODULE_ID,"conditionOrigins");
    if(!saved)return;
    const record=foundry.utils.deepClone(saved);
    let modified=false;
    for(const state of Object.keys(record)) {
      const value=change[`system.attributes.conditions.${state}`]??change.system?.attributes?.conditions?.[state];
      if(typeof value!=="boolean")continue;
      record[state].previous=value;modified=true;
    }
    if(modified)change[`flags.${MODULE_ID}.conditionOrigins`]=record;
  });
  Hooks.on("updateActor",(actor,change,options)=>{
    if(options.threeRConditionSync||game.users.activeGM!==game.user)return;
    const cleared=Object.keys(actor.getFlag(MODULE_ID,"conditionOrigins")??{}).filter(state=>
      (change[`system.attributes.conditions.${state}`]??change.system?.attributes?.conditions?.[state])===false);
    if(!cleared.length)return;
    const updates=actor.items.filter(effectIsActive).filter(item=>states(item).some(state=>cleared.includes(state))).map(item=>{
      const remaining=states(item).filter(state=>!cleared.includes(state));
      return {_id:item.id,...(!remaining.length&&!item.system.changes?.length?{"system.active":false}:{}),[`flags.${MODULE_ID}.nativeConditions`]:remaining};
    });
    (async()=>{if(updates.length)await actor.updateEmbeddedDocuments("Item",updates);await syncNativeConditions(actor);})().catch(report);
  });
}
