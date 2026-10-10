import { stateView,martialCombat,martial } from "./martial-state.js";
import { feetDistance } from "./martial-context.js";

const records=new Map();
const clock=actor=>{const combat=martialCombat(actor);if(combat?.started)return combat.combatant?.actor?.uuid===actor.uuid?`${combat.id}:${combat.round}:${combat.turn}`:null;const s=stateView(actor);return s.manualActing?`manual:${s.turn}`:null;};
export function runupFeet(source,direction) {
  const record=records.get(source.document.uuid),points=record?.points;
  if(!record||record.clock!==clock(source.actor)||!points?.length)return 0;
  const last=points.at(-1);if(last.x!==source.document.x||last.y!==source.document.y)return 0;
  let distance=0;
  for(let n=points.length-2;n>=0;n--) {
    const a=points[n],b=points[n+1],dx=b.x-a.x,dy=b.y-a.y;
    if(Math.abs(dx*direction.y-dy*direction.x)>1e-6||dx*direction.x+dy*direction.y<=0||a.elevation!==b.elevation||a.level!==b.level)break;
    distance+=feetDistance(a,b);if(distance>=20)break;
  }
  return distance;
}
export function installMartialRunup() {
  Hooks.on("moveToken",(document,movement,operation)=>{
    const actor=document.actor;
    if(!actor||operation.isUndo||operation.threeRForcedMovement||!actor.items.some(i=>martial(i)?.definition==="sudden-leap"))return;
    if(!operation.threeRVoluntaryMovement&&!["dragging","keyboard"].includes(movement.method))return;
    if(movement.passed.waypoints.some(p=>CONFIG.Token.movement.actions[p.action]?.teleport)){records.delete(document.uuid);return;}
    const current=clock(actor);if(!current){records.delete(document.uuid);return;}
    const prior=records.get(document.uuid),origin=movement.origin;
    const key=`${movement.id}:${origin.x}:${origin.y}:${origin.elevation}:${origin.level}`;
    const tail=prior?.points.at(-1),continuous=prior?.clock===current&&tail?.x===origin.x&&tail?.y===origin.y;
    const base=prior?.clock===current&&prior.key===key?prior.base:continuous?prior.points:[origin];
    records.set(document.uuid,{clock:current,key,base,points:[...base,...movement.passed.waypoints].slice(-64)});
    while(records.size>128)records.delete(records.keys().next().value);
  });
  Hooks.on("deleteToken",document=>records.delete(document.uuid));
  Hooks.on("canvasTearDown",()=>records.clear());
}
