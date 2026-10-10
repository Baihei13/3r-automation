import { MODULE_ID } from "./catalog.js";
import { martial } from "./martial-state.js";
import { sceneToken,feetDistance,feetScale,sizeIndex,opposedStanceBonus,stanceEffect } from "./martial-context.js";
import { effectIsActive } from "./effect-state.js";
import { DicePF } from "../../../systems/D35E/module/dice.js";
import AbilityTemplate from "../../../systems/D35E/module/pixi/ability-template.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { movementThreats } from "./sneak-attack.js";
import { difficultPath } from "./martial-terrain.js";
import { createTransientView } from "./transient-view.js";
import { runupFeet } from "./martial-runup.js";
import { conditionActorLive } from "./condition-jobs.js";
import { martialConditionOptions } from "./condition-policy.js";

const result=r=>Array.isArray(r)?r.find(x=>Number.isFinite(x?.total)):r;
const feat=(actor,tag,names)=>actor.items.some(i=>i.type==="feat"&&effectIsActive(i)&&(i.system.customTag===tag||names.includes(i.originalName)||names.includes(i.name)));
const nativeFlag=(actor,name)=>actor.getFlag("D35E",name)||actor.items.some(i=>effectIsActive(i)&&i.system.changeFlags?.[name]);
const cleaningObjects=new Map();
function cleanupStampedObject(uuid,stamp) {
  if(cleaningObjects.has(uuid))return cleaningObjects.get(uuid);
  const work=(async()=>{
    const document=await fromUuid(uuid).catch(()=>null);
    if(document?.flags?.[MODULE_ID]?.martialEmber?.stamp!==stamp||document.parent?.tokens.get(document.id)!==document)return;
    try{await document.delete();}catch(error){if(document.parent.tokens.get(document.id)===document)throw error;}
  })();
  cleaningObjects.set(uuid,work);
  return work.finally(()=>{if(cleaningObjects.get(uuid)===work)cleaningObjects.delete(uuid);});
}
const live=token=>token&&canvas.scene?.id===token.document.parent.id&&token.document.parent.tokens.has(token.id);
const center=(token,point)=>({x:point.x+token.w/2,y:point.y+token.h/2,elevation:token.document.elevation,level:token.document.level});
function tokensFor(actor,target,context) {
  const source=sceneToken(actor,context.sourceToken),other=sceneToken(target,context.targetTokens?.[0]);
  if(!live(source)||!live(other))throw new Error("请选择场景中的发动者与唯一目标；位置不明确，尚未结算。");
  if(source.document.level!==other.document.level||source.document.elevation!==other.document.elevation)throw new Error("双方不在同一楼层或高度，不能按地面摔投／冲撞自动结算。");
  return [source,other];
}
function empty(token,point,ignored=[]) {
  const scene=canvas.scene,rect=scene.dimensions?.sceneRect??canvas.dimensions.sceneRect;
  if(rect&&!rect.contains(point.x,point.y)||rect&&!rect.contains(point.x+token.w-1,point.y+token.h-1))return false;
  return !canvas.tokens.placeables.some(other=>other.id!==token.id&&!ignored.includes(other.id)&&other.document.level===token.document.level
    &&Number(other.document.elevation)===Number(token.document.elevation)&&point.x<other.x+other.w&&point.x+token.w>other.x&&point.y<other.y+other.h&&point.y+token.h>other.y);
}
const blocked=(token,point)=>token.checkCollision(center(token,point),{origin:token.center,type:"move",mode:"any"});
export function validateMapSource(actor,context) {
  const source=sceneToken(actor,context.sourceToken);
  if(!live(source)||!feetScale()||canvas.scene.grid.type!==CONST.GRID_TYPES.SQUARE)throw new Error("这招需要当前场景中的角色和尺／米方格地图，招式尚未消耗。");
  return source;
}
function touchReach(source,other) {
  const actor=source.actor,declared=actor.system.traits?.reach;
  const reach=declared!=null&&String(declared).trim()!==""?Number(declared):["med","sm"].includes(actor.system.traits?.actualSize??actor.system.traits?.size)?5:null;
  if(reach==null||!Number.isFinite(reach)||reach<=0)throw new Error("发动者的徒手触及未可靠登记，不能从棋子大小猜距离，招式尚未消耗。");
  const cells=token=>{
    const cols=Math.max(1,Math.round(token.w/canvas.grid.size)),rows=Math.max(1,Math.round(token.h/canvas.grid.size));
    return Array.from({length:cols*rows},(_,i)=>({x:token.x+(i%cols+0.5)*token.w/cols,y:token.y+(Math.floor(i/cols)+0.5)*token.h/rows,elevation:token.document.elevation,level:token.document.level}));
  };
  return cells(source).some(a=>cells(other).some(b=>feetDistance(a,b)<=reach+1e-6&&!source.checkCollision(b,{origin:a,type:"move",mode:"any"})));
}
export async function chooseMapPoint(label,token) {
  if(!live(token)||!feetScale())throw new Error("地图位置或尺／米单位不明确，无法选择落点。");
  ui.notifications.info(label+"：在地图点选落点；右键取消。");
  const template=AbilityTemplate.fromItem({item:{system:{measureTemplate:{type:"circle",size:5*feetScale(),customColor:"#ff9b26"}}}});
  const preview=await template.drawPreview();
  if(!preview?.result)throw new Error("落点选择已取消；已有发动与骰子记录保留，可继续未完成发动。");
  return token.document.getSnappedPosition({x:template.document.x-token.w/2,y:template.document.y-token.h/2});
}
export function validateMapManeuver(actor,target,context,kind) {
  const [source,other]=tokensFor(actor,target,context),a=sizeIndex(actor),b=sizeIndex(target);
  if(!feetScale()||canvas.scene.grid.type!==CONST.GRID_TYPES.SQUARE)throw new Error("摔投／冲撞需要尺或米的方格地图；当前地图尚未接入，招式未消耗。");
  if(a<0||b<0)throw new Error("双方体型尚未登记，无法进行3.5对抗。");
  if(b>a+1)throw new Error("目标比发动者大两级或以上，不能摔绊或冲撞，招式尚未消耗。");
  if(kind==="trip"&&target.system.attributes.conditions?.prone)throw new Error("目标已经倒地，不能再次摔绊，招式尚未消耗。");
  if(kind==="trip"&&(target.system.traits.incorporeal||target.system.attributes.conditions?.incorporeal))throw new Error("目标为虚体，不能按地面摔绊结算，招式尚未消耗。");
  if(kind==="trip"&&!touchReach(source,other))throw new Error("目标不在可接触的近战位置，招式尚未消耗。");
}
async function abilityRoll(actor,ability,extra,label) {
  const data={mod:Number(actor.system.abilities[ability].mod)||0,checkMod:Number(actor.system.abilities[ability].checkMod)||0,drain:Number(actor.system.attributes.energyDrain)||0,extra};
  const roll=result(await DicePF.d20Roll({parts:["@mod","@checkMod","-@drain","@extra"],data,fastForward:true,
    title:label,speaker:ChatMessage.getSpeaker({actor}),chatTemplate:"systems/D35E/templates/chat/roll-ext.html"}));
  if(!roll)throw new Error("对抗检定未完成，已有骰子不会重掷。");
  return {total:roll.total,modifier:data.mod+data.checkMod-data.drain+extra};
}
async function opposed(actor,target,id,kind,cache) {
  const modifier=(who,key)=>Number(who.system.abilities[key].mod)+Number(who.system.abilities[key].checkMod||0)+opposedStanceBonus(who,who===actor?target:actor,key);
  const ability=kind==="trip"&&modifier(actor,"dex")>modifier(actor,"str")?"dex":"str";
  const defense=kind==="trip"&&modifier(target,"dex")>modifier(target,"str")?"dex":"str";
  const stability=target.system.attributes.encumbrance?.quadruped||feat(target,"stability",["Stability","稳固","稳定性"])?4:0;
  const improved=kind==="trip"?feat(actor,"improvedTrip",["Improved Trip","精通拌摔","精通摔绊","精通绊摔"]):feat(actor,"improvedBullRush",["Improved Bull Rush","精通冲撞"]);
  const bonus=(sizeIndex(actor)-4)*4+(kind==="trip"?4:2)+(improved?4:0)+opposedStanceBonus(actor,target,ability);
  const enemyBonus=(sizeIndex(target)-4)*4+stability+opposedStanceBonus(target,actor,defense);
  const cursor=Number(actor.flags?.[MODULE_ID]?.martial?.receipts?.[id]?.steps?.[`mapOpposedCursor:${kind}`])||0;
  for(let n=cursor;n<cursor+20;n++) {
    const a=await cache(actor,id,`mapOpposed:${kind}:${n}:source`,()=>abilityRoll(actor,ability,bonus,kind==="trip"?"暮日投：摔绊检定":"冲锋：冲撞检定"));
    const b=await cache(actor,id,`mapOpposed:${kind}:${n}:target`,()=>abilityRoll(target,defense,enemyBonus,"抵抗"+(kind==="trip"?"摔绊":"冲撞")));
    if(a.total===b.total&&a.modifier===b.modifier)continue;
    return {won:a.total>b.total||a.total===b.total&&a.modifier>b.modifier,difference:a.total-b.total};
  }
  if(conditionActorLive(actor))await actor.update({[`flags.${MODULE_ID}.martial.receipts.${id}.steps.mapOpposedCursor:${kind}`]:cursor+20},{updateChanges:false,skipMinions:true,skipToken:true});
  throw new Error("对抗连续平手，请继续原操作；已完成的检定保留。");
}
export async function resolveThrow(actor,item,id,r,target,{cache,condition,post}) {
  const [source,other]=tokensFor(actor,target,r.context);
  const outcome=await cache(actor,id,"mapTripResult",()=>opposed(actor,target,id,"trip",cache));
  if(!outcome.won){await post(actor,"<p>暮日投：对抗失败；不反摔发动者。</p>");return;}
  const origin=await cache(actor,id,"mapThrowOrigin",()=>({x:other.x,y:other.y}));
  await cache(actor,id,"mapThrowMove",async()=>{
    if(other.document.x!==origin.x||other.document.y!==origin.y)throw new Error("目标在结算期间改变了位置；保留已掷结果，尚未重新摔投。");
    const point=await chooseMapPoint(item.name+"（目标原位置或远离发动者，最多10尺）",other);
    const landing=center(other,point),start=center(other,origin),away={x:start.x-source.center.x,y:start.y-source.center.y};
    if(feetDistance(start,landing)>10+1e-6||((landing.x-start.x)*away.x+(landing.y-start.y)*away.y)<-1e-6||feetDistance(source.center,landing)+1e-6<feetDistance(source.center,start)||!empty(other,point)||blocked(other,point))throw new Error("摔投落点需为空格、远离发动者、不穿墙且在10尺内；请继续原操作重新选落点。");
    if(!live(other))throw new Error("目标已删除，摔投停止。");
    if(point.x!==other.x||point.y!==other.y){const done=await other.document.move(point,{threeRForcedMovement:true,threeRNoOpportunity:true,constrainOptions:{ignoreCost:true}});if(!done)throw new Error("摔投位移被阻止，请继续同一操作。");}
    return true;
  });
  await condition(target,"prone",{sourceActor:actor,sourceItemUuid:item.uuid,sourceName:item.name,receipt:`${id}:trip`});
  await post(actor,"<p>暮日投：目标落地并倒地；不因经过生物占格引发借机。</p>");
}
export function chargeEndpoint(source,other) {
  const dx=other.center.x-source.center.x,dy=other.center.y-source.center.y,length=Math.hypot(dx,dy);if(!length)throw new Error("双方位置重叠，不能冲锋。");
  const edge=Math.min(dx?((source.w+other.w)/2)/Math.abs(dx):Infinity,dy?((source.h+other.h)/2)/Math.abs(dy):Infinity);
  const point=source.document.getSnappedPosition({x:other.center.x-dx*edge-source.w/2,y:other.center.y-dy*edge-source.h/2});
  const distance=feetDistance(source.center,center(source,point)),speed=Number(source.actor.system.attributes.speed.land.total);
  if(distance<10-1e-6||distance>2*speed+1e-6||!empty(source,point)||blocked(source,point))throw new Error("冲锋需直线移动至少10尺、最多两倍速度，且首个攻击落点不能被占据或隔墙。");
  const start=source.center,end=center(source,point),crossing=crossedTokens(source,start,end,[other.id]);
  if(difficultPath(source,point)===true)throw new Error("冲锋路线有未被当前能力忽略的困难地形，不能发动。");
  if(crossing.some(t=>!t.actor.system.attributes.conditions?.helpless))throw new Error("冲锋路线经过其他生物，不能发动。");
  return point;
}
function crossedTokens(source,a,b,ignored=[]) {
  const dx=b.x-a.x,dy=b.y-a.y;
  return canvas.tokens.placeables.filter(t=>t.id!==source.id&&!ignored.includes(t.id)&&t.actor&&t.document.level===source.document.level&&t.document.elevation===source.document.elevation).filter(t=>{
    // Segment against expanded occupied rectangle, for the mover's full size.
    let low=0,high=1;
    for(const [start,delta,min,max] of [[a.x,dx,t.x-source.w/2+1,t.x+t.w+source.w/2-1],[a.y,dy,t.y-source.h/2+1,t.y+t.h+source.h/2-1]]) {
      if(!delta){if(start<min||start>max)return false;continue;}
      const entries=[(min-start)/delta,(max-start)/delta].sort((x,y)=>x-y);low=Math.max(low,entries[0]);high=Math.min(high,entries[1]);if(low>high)return false;
    }
    return high>0&&low<1;
  });
}
export async function resolveMinotaur(actor,item,id,r,target,{cache,damage,post,makeEffect}) {
  const [source,other]=tokensFor(actor,target,r.context);
  const charge=await cache(actor,id,"mapChargePath",()=>{const point=chargeEndpoint(source,other);return {...point,distance:feetDistance(source.center,center(source,point))};});
  await cache(actor,id,"mapCharge",async()=>{const moved=await source.document.move({x:charge.x,y:charge.y},{threeRVoluntaryMovement:true,threeRNoOpportunity:true});if(!moved)throw new Error("冲锋移动未完成，已有发动记录保留。");return true;});
  await makeEffect(actor,actor,item,id,{changes:[["-2","ac","ac","penalty"]],until:"start",marker:{role:"charge-defense"}});
  const outcome=await cache(actor,id,"mapBullrushResult",()=>opposed(actor,target,id,"bullrush",cache));
  if(!outcome.won){await post(actor,"<p>冲撞对抗失败：不造成本招伤害，不推开目标。</p>");return;}
  await cache(actor,id,"mapBullrushMove",async()=>{
    const dx=other.center.x-source.center.x,dy=other.center.y-source.center.y,span=Math.max(Math.abs(dx),Math.abs(dy)),unit=feetScale(),gridDistance=Number(canvas.scene.grid.distance)/unit;
    const maximum=5+5*Math.floor(Math.max(0,outcome.difference)/5);
    const follow=Math.max(5,Math.min(maximum,5*Math.floor((2*Number(actor.system.attributes.speed.land.total)-charge.distance)/5)));
    const choice=follow>5?await foundry.applications.api.DialogV2.wait({window:{title:item.name+"：推进距离"},rejectClose:false,
      content:`<p>可原地推开5尺，或随目标推进（最多${follow}尺）。</p><input name="push" type="number" min="5" max="${follow}" step="5" value="5">`,
      buttons:[{action:"push",label:"推进",callback:(_e,_b,d)=>Number(d.element.querySelector('[name="push"]').value)}]}):5;
    if(!Number.isFinite(choice)||choice<5||choice>follow||choice%5)throw new Error("推进距离未选择；请继续同一操作。");
    let pushed=0;const origin={x:other.x,y:other.y},sourceOrigin={x:source.x,y:source.y};
    for(let step=gridDistance;step<=choice+1e-6;step+=gridDistance) {
      const offset={x:dx/span*step*unit*canvas.grid.size/Number(canvas.scene.grid.distance),y:dy/span*step*unit*canvas.grid.size/Number(canvas.scene.grid.distance)};
      const point=other.document.getSnappedPosition({x:origin.x+offset.x,y:origin.y+offset.y});
      const actual=feetDistance(center(other,origin),center(other,point));
      if(actual>choice+1e-6)break;
      if(point.x===other.document.x&&point.y===other.document.y)continue;
      if(!empty(other,point)||blocked(other,point))break;
      if(!await other.document.move(point,{threeRForcedMovement:true,constrainOptions:{ignoreCost:true}}))break;
      pushed=actual;
      if(choice>5&&!await source.document.move(source.document.getSnappedPosition({x:sourceOrigin.x+offset.x,y:sourceOrigin.y+offset.y}),{threeRVoluntaryMovement:true,threeRNoOpportunity:true}))break;
    }
    return {pushed};
  });
  const amount=await cache(actor,id,"minotaurDamage",async()=>{const roll=await new Roll35e("2d6+@abilities.str.mod",actor.getRollData()).roll();await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:item.name+"：钝击伤害"});return {total:Math.max(0,roll.total)};});
  await damage(target,actor,item,id,[{type:"damage-bludgeoning",total:amount.total}]);
}

export async function resolveEmber(actor,item,id,r,{cache,makeEffect,post}) {
  const source=sceneToken(actor,r.context.sourceToken);if(!live(source))throw new Error("乱心之焰需要场景中的发动者。");
  const stamp=`${actor.uuid}:${id}`;
  const uuid=await cache(actor,id,"emberToken",async()=>{
    const existing=canvas.scene.tokens.find(t=>t.flags?.[MODULE_ID]?.martialEmber?.stamp===stamp);if(existing)return existing.uuid;
    const size=canvas.grid.size,footprint=createTransientView(source,{w:size,h:size});
    const point=await chooseMapPoint(item.name+"：在30尺内选择火元素位置",footprint);
    const location={x:point.x+size/2,y:point.y+size/2,elevation:source.document.elevation};
    if(feetDistance(source.center,location)>30+1e-6||!empty(footprint,point)||source.checkCollision(location,{origin:source.center,type:"move",mode:"any"}))throw new Error("火元素需在30尺内的空位，不能隔墙；已有发动记录保留。");
    if(!conditionActorLive(actor)||!live(source))throw new Error("发动者已删除或离开场景，未放置夹击标记。");
    const token=(await canvas.scene.createEmbeddedDocuments("Token",[{name:"乱心之焰 · 夹击标记",actorId:null,actorLink:false,x:point.x,y:point.y,
      width:1,height:1,elevation:source.document.elevation,level:source.document.level,disposition:source.document.disposition,
      texture:{src:item.img},flags:{[MODULE_ID]:{martialEmber:{stamp,source:actor.uuid,reach:5,threatOnly:true}}}}]))[0];
    if(!conditionActorLive(actor)){await cleanupStampedObject(token.uuid,stamp);throw new Error("发动者已删除，已清理夹击标记。");}
    return token.uuid;
  });
  await makeEffect(actor,actor,item,id,{until:"end",marker:{role:"ember",sceneObjects:[uuid],sceneStamp:stamp}});
  await post(actor,"<p>乱心之焰：小型火元素标记已放置，在5尺触及内参与夹击计算；不进行动作或借机攻击，发动者本次行动结束时移除。</p>");
}
export async function cleanupMartialObjects(item) {
  const m=item.flags?.[MODULE_ID]?.martialEffect;if(!m?.sceneObjects?.length)return;
  for(const uuid of m.sceneObjects)await cleanupStampedObject(uuid,m.sceneStamp);
}
export function installMartialMapCleanup() {
  Hooks.on("deleteItem",item=>{if(game.users.activeGM===game.user)cleanupMartialObjects(item).catch(error=>console.error(MODULE_ID,"武术场景对象清理",error));});
  Hooks.on("deleteActor",actor=>{if(game.users.activeGM===game.user){
    for(const item of actor.items)cleanupMartialObjects(item).catch(error=>console.error(MODULE_ID,"武术场景对象清理",error));
    for(const token of canvas.scene?.tokens??[])if(token.flags?.[MODULE_ID]?.martialEmber?.source===actor.uuid)cleanupStampedObject(token.uuid,token.flags[MODULE_ID].martialEmber.stamp).catch(error=>console.error(MODULE_ID,"未挂载夹击标记清理",error));
  }});
}
export async function resolveLeap(actor,item,id,r,{cache,condition,post}) {
  const source=sceneToken(actor,r.context.sourceToken);if(!live(source))throw new Error("发动者不在当前场景，跳跃尚未结算。");
  const roll=await cache(actor,id,"movementSkill",async()=>{const value=result(await actor.rollSkill("jmp",{skipDialog:true,...martialConditionOptions(actor,id)}));if(!value)throw new Error("跳跃检定未完成。");return {total:value.total};});
  await cache(actor,id,"mapLeap",async()=>{
    if(!live(source))throw new Error("发动者已离开场景，跳跃停止。");
    const point=await chooseMapPoint(item.name+"：选择直线跳跃落点",source),end=center(source,point),distance=feetDistance(source.center,end);
    const direction={x:end.x-source.center.x,y:end.y-source.center.y},run=runupFeet(source,direction);
    const running=run>=20||Boolean(stanceEffect(actor,"leaping-dragon-stance")),maximum=Math.max(0,roll.total)/(running?1:2);
    if(distance>maximum+1e-6||!empty(source,point)||blocked(source,point))throw new Error(`跳跃可达${maximum}尺${running?"（已记录助跑）":"（没有20尺直线助跑，DC加倍）"}；落点不得占据或穿墙。请继续原操作，检定不会重掷。`);
    const side=source.document.disposition;
    const crossed=crossedTokens(source,source.center,end).filter(t=>t.document.disposition!==side||side===CONST.TOKEN_DISPOSITIONS.NEUTRAL),threatened=movementThreats(source.document,{origin:{x:source.x,y:source.y,elevation:source.document.elevation},passed:{waypoints:[{...point,elevation:source.document.elevation}]}});
    const enemies=[...new Map([...crossed,...threatened].map(t=>[t.id,t])).values()];
    const avoids=[];
    const armorSlows=actor.items.some(i=>i.type==="equipment"&&i.system.equipped&&!i.system.melded&&!i.broken&&
      (i.system.equipmentSubtype==="heavyArmor"&&!nativeFlag(actor,"heavyArmorFullSpeed")||i.system.equipmentSubtype==="mediumArmor"&&!nativeFlag(actor,"mediumArmorFullSpeed")));
    const loadSlows=Number(actor.system.attributes.encumbrance?.level)>0&&!nativeFlag(actor,"noEncumbrance");
    if(enemies.length&&Number(actor.system.skills.tmb?.rank)>0&&!loadSlows&&!armorSlows) {
      const tumble=await foundry.applications.api.DialogV2.wait({window:{title:item.name},rejectClose:false,content:"<p>路线经过敌人的威胁范围。是否翻滚避开借机？本次采用加速翻滚（检定−10），保留跳跃距离。</p>",buttons:[{action:"tumble",label:"加速翻滚",callback:()=>true},{action:"normal",label:"直接跳跃",callback:()=>false}]});
      for(let n=0;n<enemies.length;n++)if(tumble){const check=await cache(actor,id,`leapTumble:${enemies[n].id}`,async()=>{const v=result(await actor.rollSkill("tmb",{skipDialog:true,...martialConditionOptions(actor,id)}));if(!v)throw new Error("翻滚检定未完成。");return {total:v.total-10};});if(check.total>=(crossed.includes(enemies[n])?25:15)+2*n)avoids.push(enemies[n].id);}
    }
    if(crossed.some(t=>!avoids.includes(t.id)))throw new Error("未通过穿越生物占格所需的翻滚，不能越过该生物；请选择它之前的合法落点，已有骰子保留。");
    const landing={...point,...(CONFIG.Token.movement.actions.jump?{action:"jump"}:{})};
    if(!await source.document.move(landing,{threeRVoluntaryMovement:true,threeRTumbleAvoids:avoids,...martialConditionOptions(actor,id)}))throw new Error("跳跃移动未完成，请继续同一操作。");
    if(Number(actor.system.skills.jmp.rank)===0&&roll.total<distance*(running?1:2)+5)await condition(actor,"prone",{sourceActor:actor,sourceItemUuid:item.uuid,sourceName:item.name,receipt:`${id}:leap-landing`});
    await post(actor,`<p>猛跃：直线移动${distance}尺${avoids.length?"，已通过相应翻滚检定":""}。</p>`);return true;
  });
}
