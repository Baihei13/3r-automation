import { MODULE_ID } from "./catalog.js";
import { getState,martial,stateView,profileId,martialCombat } from "./martial-state.js";

const queues=new Map(),live=new Map();
const report=error=>{console.error(MODULE_ID,"阴影宠儿移动记录",error);ui.notifications.error(`阴影宠儿移动记录未保存：${error.message}`);};
function clock(actor) {
  const saved=stateView(actor),combat=martialCombat(actor);
  if(combat?.started)return `combat:${combat.id}:${Number(saved.turn)||0}`;
  return `${saved.encounter?`manual:${saved.encounter.id}`:`exploration:${actor.uuid}`}:${Number(saved.turn)||0}`;
}
function shadowStance(actor) {
  if(!profileId(actor))return null;
  const s=getState(actor,{readOnly:true}),item=s.activeStance,m=martial(item);
  if(!s.id||!s.level||!s.saved.profiles[s.id]||m?.definition!=="child-of-shadow"||m.retired||m.profile!==s.id)return null;
  return actor.items.find(i=>i.type==="buff"&&i.system.active&&i.flags?.[MODULE_ID]?.martialEffect?.stance
    &&i.flags[MODULE_ID].martialEffect.definition==="child-of-shadow"
    &&i.flags[MODULE_ID].sourceItemUuid===item.uuid);
}
function tokenFor(actor) {
  if(actor.isToken)return actor.token;
  const targets=[...game.user.targets].filter(t=>t.actor?.uuid===actor.uuid);
  if(targets.length===1)return targets[0].document;
  const combat=martialCombat(actor),scene=combat?(combat.scene??game.scenes.get(combat.sceneId)):canvas.scene;
  const tokens=(scene?.tokens?.contents??[]).filter(t=>t.actor?.uuid===actor.uuid);
  // A linked actor with several simultaneous tokens has no unique position.
  return tokens.length===1?tokens[0]:null;
}
export function shadowMovement(actor,token=null) {
  const current=clock(actor),document=token?.document??token??tokenFor(actor);
  const record=document?(live.get(document.uuid)??document.flags?.[MODULE_ID]?.martialMovement):null;
  return {clock:current,feet:current&&record?.clock===current?Number(record.feet)||0:0,document};
}
export function shadowConcealment(actor,token=null) {
  if(!actor)return 0;
  const stance=shadowStance(actor);if(!stance)return 0;
  const movement=shadowMovement(actor,token),meta=stance.flags[MODULE_ID].martialEffect;
  if(meta.context?.antimagic)return 0;
  const record=movement.document?(live.get(movement.document.uuid)??movement.document.flags?.[MODULE_ID]?.martialMovement):null;
  const confirmed=meta.shadowConfirmedClock===movement.clock&&Number(meta.shadowUndoRevision||0)===Number(record?.undoRevision||0);
  return movement.clock&&(!record?.needsConfirmation&&movement.feet>=10-1e-6||confirmed)?20:0;
}
export async function confirmShadowMovement(actor) {
  const stance=shadowStance(actor),current=clock(actor);
  if(!stance||!current)throw new Error("先进入阴影宠儿，再补确认本次行动的移动。");
  const movement=shadowMovement(actor),record=movement.document?(live.get(movement.document.uuid)??movement.document.flags?.[MODULE_ID]?.martialMovement):null;
  await stance.update({[`flags.${MODULE_ID}.martialEffect.shadowConfirmedClock`]:current,[`flags.${MODULE_ID}.martialEffect.shadowUndoRevision`]:Number(record?.undoRevision)||0},{updateChanges:false});
}
export function installShadowMovement() {
  Hooks.on("moveToken",(document,movement,operation)=>{
    const actor=document.actor;
    if(game.users.activeGM!==game.user||!actor||!profileId(actor)||operation.threeRForcedMovement)return;
    const combat=martialCombat(actor),current=clock(actor);
    // Outside a tracked encounter, only record this stance's movement. A DM
    // can confirm movement before entry and advance the exploration action.
    if(!combat&&!stateView(actor).encounter&&!shadowStance(actor))return;
    if(!current)return;
    if(combat?.started) {
      if((combat.scene?.id??combat.sceneId)!==document.parent.id||!operation.isUndo&&combat.combatant?.tokenId!==document.id)return;
    }
    if(!operation.isUndo&&movement.passed.waypoints.some(point=>CONFIG.Token.movement.actions[point.action]?.teleport))return;
    // API moves (repositioning/forced movement) require explicit DM confirmation.
    if(!operation.isUndo&&!operation.threeRVoluntaryMovement&&!["dragging","keyboard"].includes(movement.method))return;
    const units=String(document.parent.grid.units??"").trim();
    const unit=/^(ft|feet|foot|尺|英尺)$/i.test(units)?1:/^(m|米|公尺|met(er|re)s?)$/i.test(units)?0.3048:null;
    if(unit===null&&!operation.isUndo)return;
    const feet=Number(movement.passed.distance)/(unit??1);
    if(!operation.isUndo&&(!Number.isFinite(feet)||feet<=0))return;
    const before=live.get(document.uuid)??document.flags?.[MODULE_ID]?.martialMovement;
    const next=before?.clock===current?foundry.utils.deepClone(before):{clock:current,feet:0,parts:[]};
    if(operation.isUndo) {
      next.feet=0;next.parts=[];next.needsConfirmation=true;next.undoRevision=Number(next.undoRevision||0)+1;
    }else {
      const origin=movement.origin,key=`${movement.id}:${origin.x}:${origin.y}:${origin.elevation}:${origin.level}`;
      const prior=next.parts.find(row=>row.key===key),increment=Math.max(0,feet-(prior?.feet??0));
      if(!increment)return;
      if(prior)prior.feet=feet;else next.parts.push({key,feet});
      next.feet+=increment;
    }
    live.set(document.uuid,next);
    const write=(queues.get(document.uuid)??Promise.resolve()).catch(()=>{}).then(async()=>{
      await movement.animation.ended;
      if(game.users.activeGM!==game.user||clock(actor)!==current)return;
      await document.update({[`flags.${MODULE_ID}.martialMovement`]:next});
    });
    queues.set(document.uuid,write);
    write.catch(error=>{if(live.get(document.uuid)===next)live.delete(document.uuid);report(error);}).finally(()=>{
      if(queues.get(document.uuid)===write)queues.delete(document.uuid);
      if(live.get(document.uuid)===next)live.delete(document.uuid);
    });
  });
  Hooks.on("canvasTearDown",()=>live.clear());
}
