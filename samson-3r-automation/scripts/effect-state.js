import { MODULE_ID } from "./catalog.js";

// The timeline may change the deadline. It takes precedence over the original cast.
export function effectDeadline(item) {
  const timeline=item.getFlag?.("d35e-world-timeline","timer")?.end;
  const original=item.getFlag?.(MODULE_ID,"expiresAt");
  return Number.isFinite(timeline)?timeline:Number.isFinite(original)?original:null;
}
export function effectIsActive(item,now=game.time.worldTime) {
  if(!["buff","aura"].includes(item.type))return true;
  const end=effectDeadline(item);
  return Boolean(item.system.active)&&(end===null||end>now);
}

// Only the old module factory's disabled native timer is migrated. Keep custom
// native timers, document IDs, effects, and the original cast's CL/deadline.
export async function repairTimedBuffs(actor) {
  const updates=[];
  for(const item of actor.items) {
    const mark=item.getFlag(MODULE_ID,"key"),native=item.system?.timeline;
    const end=effectDeadline(item),cl=Number(item.getFlag(MODULE_ID,"cl"));
    if(item.type!=="buff"||!mark||mark==="mending-casting"||!Number.isFinite(end))continue;
    const update={_id:item.id};
    const legacy=!item.getFlag(MODULE_ID,"nativeTimerVersion")&&native?.enabled===false
      &&native.deleteOnExpiry===false&&!String(native.formula??"").trim()&&Number(native.total)>0;
    if(legacy) {
      const saved=item.getFlag("d35e-world-timeline","timer");
      const seconds=Number.isFinite(saved?.seconds)&&saved.seconds>0?saved.seconds:Number(native.total)*6;
      const total=seconds/6;
      // Count time already spent, rather than granting the full duration again.
      const paused=(actor.getFlag(MODULE_ID,"suppressedSpells")??[]).find(entry=>entry.uuid===item.uuid);
      const reference=Number.isFinite(paused?.started)?paused.started:game.time.worldTime;
      const elapsed=Math.min(total,Math.max(0,total-(end-reference)/6));
      Object.assign(update,{"system.timeline.enabled":true,"system.timeline.total":total,
        "system.timeline.formula":String(total),"system.timeline.elapsed":elapsed,"system.timeline.deleteOnExpiry":true,
        [`flags.${MODULE_ID}.nativeTimerVersion`]:1,
        [`flags.${MODULE_ID}.nativeTimerRepair`]:{at:game.time.worldTime,level:item.system.level,
          timeline:foundry.utils.deepClone(native),deadline:end}});
    }
    if(!Number(item.system.level)&&Number.isFinite(cl)&&cl>0) {
      update["system.level"]=cl;
      if(!legacy)update[`flags.${MODULE_ID}.nativeLevelRepair`]={previous:item.system.level,cl};
    }
    if(Object.keys(update).length>1)updates.push(update);
  }
  if(updates.length)await actor.updateEmbeddedDocuments("Item",updates);
}

export async function expireTimedBuff(item) {
  if(!item.actor?.items.has(item.id))return;
  // Only known generated temporary effects have inactive leftovers cleaned up.
  if(!item.system.active&&item.getFlag(MODULE_ID,"nativeTimerVersion")!==1)return;
  const native=item.system?.timeline;
  // Reuse D35E's expiry operation; no second per-turn countdown is added.
  if(item.system.active&&native?.enabled&&typeof item.addElapsedTime==="function") {
    const left=Math.max(0,Number(native.total)-Number(native.elapsed??0));
    if(Number.isFinite(left))return item.addElapsedTime(left);
  }
  if(native?.deleteOnExpiry)return item.actor.deleteEmbeddedDocuments("Item",[item.id]);
  if(item.system.active)return item.update({"system.active":false});
}
