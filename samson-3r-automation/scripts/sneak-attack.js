import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { fragileState, weaponFor } from "./fragile.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";
import { shadowConcealment } from "./martial-shadow.js";

// PF Unchained Rogue / CRB flanking; 3.5 SRD Rogue has different concealment/type restrictions.
const key=item=>item?.getFlag(MODULE_ID,"key");
const conditions=actor=>actor?.system.attributes?.conditions??{};
const attacks=new Set(["mwak","rwak"]);
const active=item=>effectIsActive(item)&&(!["weapon","equipment"].includes(item.type)||item.system.equipped&&!item.system.melded)
  &&!item.hasUnmetRequirements?.(foundry.utils.deepClone(item.actor.getRollData()))?.length;
const flag=(actor,name)=>Boolean(actor?.getFlag("D35E",name)||actor?.items.some(i=>i.system.changeFlags?.[name]&&active(i)));
const ability=(actor,tag,names)=>actor?.items.some(i=>active(i)&&(i.system.customTag===tag||names.includes(i.originalName)||names.includes(i.name)));
const dice=actor=>Math.max(0,Math.floor(Number(actor?.system.attributes?.sneakAttackDiceTotal)||0));
const supported=item=>item?.actor&&attacks.has(item.system.actionType)&&item.hasAttack&&item.hasDamage;
const sneakKnown=actor=>dice(actor)>0||actor.items.some(i=>key(i)==="sneak-attack"&&active(i)
  ||i.type==="class"&&key(i)==="unchained-rogue"&&Number(i.system.levels)>0);
const pfRule=actor=>actor.items.some(i=>key(i)==="sneak-attack"&&["pf","pfu"].includes(i.getFlag(MODULE_ID,"source"))&&active(i));
const uncanny=actor=>flag(actor,"uncannyDodge")||ability(actor,"uncannyDodge",["Uncanny Dodge","直觉闪避"]);
const improved=actor=>flag(actor,"improvedUncannyDodge")||ability(actor,"improvedUncannyDodge",["Improved Uncanny Dodge","精通直觉闪避"]);
const elemental=actor=>actor.system.attributes?.creatureType==="elemental"||actor.items.some(i=>i.type==="race"&&i.system.subTypes?.includes("elemental"));
const rogueLevels=actor=>actor?.items.filter(i=>i.type==="class"&&(key(i)==="unchained-rogue"||["rogue","unchainedRogue"].includes(i.system.customTag)))
  .reduce((n,i)=>n+(Number(i.system.levels)||0),0)??0;
const dodgeClassLevels=actor=>actor?.items.filter(i=>i.type==="class"&&(["rogue","unchainedRogue","barbarian"].includes(i.system.customTag)||key(i)==="unchained-rogue"))
  .reduce((n,i)=>n+(Number(i.system.levels)||0),0)??0;

function actorToken(actor,savedId) {
  const tokens=canvas.tokens?.placeables??[];
  if(savedId)return tokens.find(t=>t.id===savedId&&t.actor?.uuid===actor.uuid)??null;
  if(actor.token)return tokens.find(t=>t.id===actor.token.id)??null;
  const matching=tokens.filter(t=>t.actor?.uuid===actor.uuid);
  const controlled=matching.filter(t=>t.controlled);
  return controlled.length===1?controlled[0]:matching.length===1?matching[0]:null;
}
function feetUnit() {
  const units=String(canvas.scene?.grid?.units??"").trim().toLowerCase();
  if(["ft","feet","foot","尺","英尺"].includes(units))return 1;
  if(["m","meter","meters","metre","metres","米"].includes(units))return 0.3048;
  return null;
}
function centers(token) {
  const size=canvas.grid.size;
  const cols=Math.max(1,Math.round(token.w/size)),rows=Math.max(1,Math.round(token.h/size));
  return Array.from({length:cols*rows},(_,i)=>({x:token.x+(i%cols+0.5)*token.w/cols,
    y:token.y+(Math.floor(i/cols)+0.5)*token.h/rows,elevation:Number(token.document.elevation)||0}));
}
function distance(a,b) {
  const unit=feetUnit();if(!unit)return null;
  const values=centers(a).flatMap(p=>centers(b).map(q=> {
    if(canvas.scene.grid.type!==CONST.GRID_TYPES.SQUARE)return Number(canvas.grid.measurePath([p,q]).distance)/unit;
    // 3R/PF: first diagonal 5 ft, second 10 ft. A Euclidean ruler would
    // incorrectly put an adjacent diagonal foe outside a 5-ft threat.
    // Unequal elevations need the table's 3D reach ruling. Do not silently
    // flatten a flying creature into the ground-level threat area.
    if(Math.abs(p.elevation-q.elevation)>1e-6)return null;
    const [middle,high]=[Math.abs(p.x-q.x)/canvas.grid.size,Math.abs(p.y-q.y)/canvas.grid.size].sort((x,y)=>x-y);
    const round=value=>Math.abs(value-Math.round(value))<1e-6?Math.round(value):value;
    const diagonal=round(middle),steps=round(high);
    return (steps+Math.floor(diagonal/2))*(Number(canvas.scene.grid.distance)||5)/unit;
  }));
  return values.length&&values.every(Number.isFinite)?Math.min(...values):null;
}
function clearLine(source,target,type="sight") {
  return centers(source).some(p=>centers(target).some(q=>!source.checkCollision(q,{origin:p,type,mode:"any"})));
}
function incapacitated(actor) {
  const c=conditions(actor);
  return ["dead","dying","unconscious","helpless","paralyzed","stunned","pinned","dazed"].some(k=>c[k])
    ||actor.statuses?.has("dazed");
}
function reach(item) {
  const actor=item.actor,weapon=weaponFor(item);
  const size=actor.system.traits?.size;
  const declared=actor.system.traits?.reach;
  const base=declared!=null&&String(declared).trim()!==""?Number(declared):["med","sm","medium","small"].includes(size)?5:null;
  if(base==null||!Number.isFinite(base))return null;
  const extended=Boolean((weapon?.system.properties??item.system.originalWeaponProperties)?.rch);
  return {min:extended?base:0,max:extended?base*2:base};
}
function armed(item) {
  if(item.system.melded||fragileState(weaponFor(item))==="destroyed")return false;
  const weapon=weaponFor(item);
  if(weapon)return weapon.system.equipped&&!weapon.system.melded&&weapon.system.weaponSubtype!=="ranged"
    &&(!item.system.actionType||item.system.actionType==="mwak");
  if(item.type==="weapon")return item.system.equipped&&item.system.weaponSubtype!=="ranged";
  if(item.type!=="attack"||item.system.actionType!=="mwak")return false;
  if(item.system.attackType==="natural")return true;
  const unarmed=["unarmed","unarmedstrike","unarmed strike"].includes(String(item.system.baseWeaponType).toLowerCase())||/徒手|^Unarmed Strike$/i.test(item.name);
  return item.system.attackType==="weapon"&&(!unarmed||ability(item.actor,"improvedUnarmedStrike",["Improved Unarmed Strike","精通徒手击打"]));
}
function threatens(source,target,item=null) {
  if(incapacitated(source.actor))return {value:false,reason:"不能行动，不能威胁目标"};
  const d=distance(source,target);if(d==null)return {value:null,reason:"无法确认距离：地图单位或双方高差需确认"};
  if(conditions(source.actor).blind&&!blindsight(source,target))return {value:false,reason:"目盲且没有能感知目标的盲视"};
  const choices=item?[item]:source.actor.items.filter(i=>armed(i)&&(i.type==="weapon"||i.system.actionType==="mwak"));
  let unknown=false;
  const reasons=new Set(),feet=value=>Number(value.toFixed(2));
  for(const attack of choices) {
    const name=weaponFor(attack)?.name??attack.name;
    if(!armed(attack)){reasons.add(`${name}不是当前可用且已装备的近战武器／天然攻击`);continue;}
    const r=reach(attack);
    if(!r){unknown=true;reasons.add(`${name}的触及距离未记录`);continue;}
    if(r.max<=0){reasons.add(`${name}的触及为0尺，不能威胁目标`);continue;}
    if(d<=r.min) {
      reasons.add(r.min>0?`${name}是长触及武器：目标距离${feet(d)}尺，在${feet(r.min)}尺以内，不能用它威胁目标（最大触及${feet(r.max)}尺）`
        :`${name}与目标占据同一位置，不能自动确认威胁`);
      continue;
    }
    if(d>r.max+1e-6){reasons.add(`${name}最大触及${feet(r.max)}尺，目标距离${feet(d)}尺，超出范围`);continue;}
    // Blocking walls prevent an automatic threat. Bars/windows and unusual attacks can be adjudicated.
    if(!clearLine(source,target)){reasons.add(`${name}与目标之间的视线被墙壁阻挡`);continue;}
    if(!clearLine(source,target,"move")){reasons.add(`${name}与目标之间的攻击路径被墙壁阻挡`);continue;}
    return {value:true};
  }
  return {value:unknown?null:false,reason:reasons.size?[...reasons].join("；"):"没有已装备的可用近战武器或天然攻击"};
}
// Reuse the same equipped-weapon, reach and wall checks for movement opportunities.
export function movementThreats(document, movement) {
  const mover = document.object;
  if (!mover?.actor || !canvas.grid?.size) return [];
  const path = [movement.origin, ...movement.passed.waypoints];
  const cell = point => `${Math.floor((point.x + mover.w / 2) / canvas.grid.size)}:${Math.floor((point.y + mover.h / 2) / canvas.grid.size)}`;
  const departed = path.slice(0, -1).filter((point, index) => cell(point) !== cell(path[index + 1]));
  const at = point => ({ actor: mover.actor, x: point.x, y: point.y, w: mover.w, h: mover.h, document: { elevation: point.elevation } });
  return (canvas.tokens?.placeables ?? []).filter(enemy => enemy.actor && enemy.id !== document.id
    && Number(enemy.document.disposition) * Number(document.disposition) < 0
    && !enemy.actor.items.some(item => key(item) === "common-total-defense" && effectIsActive(item))
    && departed.some(point => threatens(enemy, at(point)).value === true));
}
function opposite(a,b,target) {
  const left=target.x,right=target.x+target.w,top=target.y,bottom=target.y+target.h;
  const dx=b.x-a.x,dy=b.y-a.y,epsilon=1e-6;
  const between=(v,min,max)=>v>=min-epsilon&&v<=max+epsilon;
  if(between(a.x,left,right)&&between(a.y,top,bottom)||between(b.x,left,right)&&between(b.y,top,bottom))return false;
  if(dx!==0) {
    const t1=(left-a.x)/dx,t2=(right-a.x)/dx;
    if(between(t1,0,1)&&between(t2,0,1)&&between(a.y+t1*dy,top,bottom)&&between(a.y+t2*dy,top,bottom))return true;
  }
  if(dy!==0) {
    const t1=(top-a.y)/dy,t2=(bottom-a.y)/dy;
    if(between(t1,0,1)&&between(t2,0,1)&&between(a.x+t1*dx,left,right)&&between(a.x+t2*dx,left,right))return true;
  }
  return false;
}
function islandStance(actor) {
  // The live effect is authoritative. Learning a stance or an old selection
  // flag alone must not grant it after switching, disabling or deleting it.
  return actor.items.some(item=>item.type==="buff"&&effectIsActive(item)
    &&item.flags?.[MODULE_ID]?.martialEffect?.stance
    &&item.flags[MODULE_ID].martialEffect.definition==="island-of-blades");
}
function adjacent(a,b) {
  if(a.document.level!=null&&b.document.level!=null&&a.document.level!==b.document.level)return false;
  if(Number(a.document.elevation||0)!==Number(b.document.elevation||0))return false;
  if(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)return false;
  // Any occupied square may touch an enemy square, including diagonally.
  // Adjacency is a grid relation, not a fixed 5-ft ruler or opposite-side test.
  const size=canvas.grid.size;
  return centers(a).some(p=>centers(b).some(q=>Math.abs(p.x-q.x)<=size+1e-6
    &&Math.abs(p.y-q.y)<=size+1e-6));
}
function flank(source,target,item) {
  if(item.system.actionType!=="mwak")return {value:false};
  if(target.actor.system.attributes?.creatureType==="ooze"||elemental(target.actor))return {value:false,reason:"目标类型不能被夹击"};
  if(canvas.scene.grid.type!==CONST.GRID_TYPES.SQUARE)return {value:null,reason:"此地图不是方格地图，夹击待GM裁定"};
  if(improved(target.actor)) {
    const defender=dodgeClassLevels(target.actor);
    if(!defender)return {value:null,reason:"精通直觉闪避的相关职业等级未记录"};
    if(rogueLevels(source.actor)<defender+4)return {value:false,reason:"精通直觉闪避阻止夹击"};
  }
  const ownThreat=threatens(source,target,item);
  if(ownThreat.value!==true)return {value:ownThreat.value,reason:`攻击者：${ownThreat.reason}`};
  const disposition=Number(source.document.disposition),enemy=Number(target.document.disposition);
  const sides=[CONST.TOKEN_DISPOSITIONS.FRIENDLY,CONST.TOKEN_DISPOSITIONS.HOSTILE];
  if(!sides.includes(disposition)||!sides.includes(enemy))return {value:null,reason:"中立或未指定阵营的Token，敌我关系未明确"};
  if(disposition===enemy)return {value:false,reason:"攻击者与目标是同一阵营，未形成对敌夹击"};
  const island=islandStance(source.actor),near=adjacent(source,target);
  for(const ember of canvas.tokens.placeables.filter(t=>t.document.flags?.[MODULE_ID]?.martialEmber)) {
    const marker=ember.document.flags[MODULE_ID].martialEmber;
    const summoner=canvas.tokens.placeables.find(t=>t.actor?.uuid===marker.source)?.actor;
    if(!summoner?.items.some(i=>i.type==="buff"&&effectIsActive(i)&&i.flags?.[MODULE_ID]?.martialEffect?.sceneStamp===marker.stamp))continue;
    if(Number(ember.document.disposition)!==disposition||ember.document.level!==target.document.level||Number(ember.document.elevation)!==Number(target.document.elevation))continue;
    if(!game.user.isGM&&(!ember.isVisible||ember.document.hidden))continue;
    const d=distance(ember,target);if(d==null||d<=0||d>5+1e-6||!clearLine(ember,target)||!clearLine(ember,target,"move"))continue;
    if(island&&near&&adjacent(ember,target)||centers(source).some(p=>centers(ember).some(q=>opposite(p,q,target))))return {value:true,reason:"乱心之焰的小型火元素威胁目标，形成夹击"};
  }
  let unknown=false;
  const failures=new Set();
  for(const ally of canvas.tokens.placeables) {
    if(ally.id===source.id||ally.id===target.id||!ally.actor||Number(ally.document.disposition)!==disposition)continue;
    if(!game.user.isGM&&(!ally.isVisible||ally.document.hidden))continue;
    const name=ally.document.name??ally.actor.name;
    // Island of Blades grants this benefit to BOTH adjacent allies. It does
    // not require them to stand opposite each other or both know the stance.
    if(near&&adjacent(ally,target)&&(island||islandStance(ally.actor))) {
      if(clearLine(ally,target)&&clearLine(ally,target,"move"))
        return {value:true,reason:`剑刃外壳：你与${name}均与敌人相邻`};
      failures.add(`剑刃外壳：${name}与敌人之间有墙壁阻挡`);
    }
    const positions=centers(source).some(p=>centers(ally).some(q=>opposite(p,q,target)));
    if(!positions)continue;
    const threat=threatens(ally,target);unknown ||= threat.value===null;
    if(threat.value===true)return {value:true,reason:`${name}从相对边威胁目标`};
    failures.add(`${name}：${threat.reason}`);
  }
  return {value:unknown?null:false,reason:failures.size?[...failures].join("；"):"没有站在目标相对边／角的同伴"};
}
function detectionModes(observer) {
  const modes=observer.document.detectionModes??{};
  // v14 uses a TypedObjectField keyed by mode ID; the value has no id field.
  // Read legacy arrays too, without modifying the TokenDocument.
  return Array.isArray(modes)?modes:Object.entries(modes).map(([id,mode])=>({...mode,id}));
}
function detectionVisibility(observer,target,ids) {
  const vision=observer.vision;
  if(!vision?.active)return null;
  const level=canvas.scene.levels?.get(target.document.level);
  if(!level)return null;
  const points=target.document.getVisibilityTestPoints();
  let checked=false;
  for(const mode of detectionModes(observer)) {
    if(!mode.enabled||!ids.includes(mode.id))continue;
    const detector=CONFIG.Canvas.detectionModes[mode.id];
    if(!detector?.testVisibility)continue;
    checked=true;
    const config={object:target,level,tests:points.map(point=>({point,level,los:new Map()}))};
    if(detector.testVisibility(vision,mode,config))return true;
  }
  return checked?false:null;
}
function blindsight(observer,target) {
  const d=distance(observer,target);if(d==null)return false;
  const range=Number(observer.actor.system.attributes?.senses?.blindsight)||0;
  const unit=feetUnit();
  return range>0&&d<=range||detectionModes(observer).some(m=>m.id==="blindSight"&&m.enabled&&Number(m.range)>0&&unit&&d<=Number(m.range)/unit);
}
function detectsInvisible(observer,target) {
  if(!clearLine(observer,target))return false;
  const d=distance(observer,target);if(d==null)return false;
  const senses=observer.actor.system.attributes?.senses??{};
  if([senses.blindsight,senses.truesight].some(r=>Number(r)>0&&d<=Number(r)))return true;
  if(blindsight(observer,target))return true;
  const modes=detectionModes(observer).filter(m=>m.id==="seeInvisibility"&&m.enabled);
  return modes.length?detectionVisibility(observer,target,["seeInvisibility"]):false;
}
function sight(source,target) {
  if(!clearLine(source,target))return {value:false,reason:"墙壁阻挡视线"};
  if(blindsight(source,target))return {value:true};
  if(conditions(source.actor).blind)return {value:false,reason:"攻击者目盲，不能看清要害"};
  if(conditions(target.actor).invisible) {
    const detection=detectsInvisible(source,target);
    if(detection!==true)return {value:detection,reason:detection===null?"识破隐形的视野未启用，待GM裁定":"不能看见隐形目标"};
  }
  // A GM's all-seeing canvas is never evidence of this creature's vision.
  if(!canvas.scene.tokenVision)return {value:true};
  // v14 basicSight is darkvision; illuminated targets use lightPerception.
  const visible=detectionVisibility(source,target,["basicSight","lightPerception","seeInvisibility","blindSight"]);
  return visible===true?{value:true}:visible===false?{value:false,reason:"攻击者不能通过自身视野看清目标"}
    :{value:null,reason:"攻击Token视野或地图楼层未记录，能否看清待GM裁定"};
}
function firstTurn(target) {
  const combat=game.combat,record=combat?.getFlag(MODULE_ID,"sneakInitiative");
  if(!combat?.started||combat.scene?.id!==canvas.scene.id||combat.round!==1||!record)return false;
  const combatant=combat.turns?.find(c=>c.tokenId===target.id);
  if(!combatant||!record.roster.includes(combatant.id)||record.acted.includes(combatant.id))return false;
  return combat.turns.indexOf(combatant)>combat.turn;
}
function deniedDex(source,target,pf) {
  const c=conditions(target.actor);
  if(["helpless","paralyzed","stunned","unconscious","pinned","cowering"].some(k=>c[k])
    ||c.blind&&!blindsight(target,source)||flag(target.actor,"loseDexToAC"))return "目标失去敏捷防御";
  // 3.5 grappling denies Dexterity only against creatures outside that grapple.
  if(!pf&&c.grappled&&!conditions(source.actor).grappled)return "目标正被他人擒抱";
  if(!uncanny(target.actor)&&(c.flatFooted||firstTurn(target)))return "目标措手不及／尚未轮到首次行动";
  if(!uncanny(target.actor)&&conditions(source.actor).invisible) {
    const detection=detectsInvisible(target,source);
    if(detection===null)return {pending:true,reason:"目标有识破隐形能力，但其视野未启用，待GM裁定"};
    if(detection===false)return "目标不能看见隐形攻击者";
  }
  return null;
}
export function evaluateSneak(item,context={}) {
  const actor=item.actor,result={eligible:false,flanking:false,flankingReason:"",flankingPending:false,dice:dice(actor),reason:"",pending:false};
  const stop=(reason,pending=false)=>({...result,reason,pending});
  if(!supported(item))return stop("本次不是带伤害的武器攻击");
  const targetIds=context.targetIds??[...game.user.targets].map(t=>t.id);
  if(targetIds.length!==1)return stop("请只指定一个目标；多目标攻击须分别结算",true);
  const source=actorToken(actor,context.sourceId),target=canvas.tokens?.get(targetIds[0]);
  if(!source||!target?.actor||source.id===target.id)return stop("无法唯一确定攻击者与目标Token",true);
  result.targetId=target.id;
  if(incapacitated(actor))return stop("攻击者不能行动");
  const mode=game.user.isGM?context.mode??"auto":context.mode==="off"?"off":"auto";
  if(mode==="gm-flank")return {...result,eligible:result.dice>0,flanking:item.system.actionType==="mwak",
    flankingReason:"GM裁定本次夹击",
    reason:result.dice>0?"GM裁定本次夹击且符合全部偷袭条件":"GM裁定本次夹击；没有可用的原生偷袭伤害骰"};
  if(mode==="gm-eligible") {
    let f={value:null,reason:"地图夹击判定接口不可用"};
    try {f=flank(source,target,item);}catch(error){console.error(MODULE_ID,error);}
    return {...result,eligible:result.dice>0,flanking:f.value===true,flankingReason:f.reason,flankingPending:f.value===null,
      reason:result.dice>0?"GM裁定本次符合全部偷袭条件":"没有可用的原生偷袭伤害骰，不能凭裁定增加骰数"};
  }
  const pf=pfRule(actor);
  let f;
  try {
    // Keep the native checkbox as a per-attack ruling, not an override of
    // distance, vision, immunity or the actor's actual sneak attack dice.
    f=typeof context.flanking==="boolean"?{value:context.flanking&&item.system.actionType==="mwak",
      reason:context.flanking?"本次攻击窗口已指定夹击":"本次攻击窗口已取消夹击"}:flank(source,target,item);
  }catch(error) {
    console.error(MODULE_ID,"夹击判定程序错误",error);
    f={value:null,reason:"自动夹击判定发生程序错误",error:true};
  }
  result.flanking=f.value===true;
  result.flankingReason=f.reason??(item.system.actionType==="rwak"?"远程攻击不获得夹击加值":"未形成夹击");
  result.flankingPending=f.value===null;
  result.flankingError=Boolean(f.error);
  if(mode==="off")return stop("本次关闭偷袭");
  if(result.dice<=0)return stop(sneakKnown(actor)?"已有偷袭能力，但系统偷袭骰数为0；请由GM刷新客户端完成旧职业数据修复":"没有偷袭能力",sneakKnown(actor));
  try {
    const d=distance(source,target);
    if(d==null)return stop("地图距离单位未识别或双方高差需GM裁定",true);
    if(item.system.actionType==="rwak"&&d>30+1e-6)return stop("远程偷袭超出30尺");
    if(item.system.actionType==="mwak") {
      const r=reach(item);if(!r)return stop("近战触及未记录",true);
      if(d>r.max+1e-6||r.min>0&&d<=r.min)return stop("目标不在本次武器的触及范围内");
      if(!clearLine(source,target,"move"))return stop("墙壁阻挡攻击；特殊障碍待GM裁定",true);
    }
    const inherent=Boolean(item.system.nonLethal||item.system.nonLethalNoPenalty);
    if(context.nonLethal&&!inherent)return stop("致命武器改作非致命攻击不能偷袭");
    const concealment=Math.max(Number(target.actor.system.attributes?.concealment?.total)||0,shadowConcealment(target.actor,target));
    if(concealment>=(pf?50:1)&&!blindsight(source,target))return stop(pf?"目标有全隐蔽":"3R偷袭不能对隐蔽目标使用");
    const type=target.actor.system.attributes?.creatureType;
    if(elemental(target.actor)||(!pf&&["undead","construct","ooze","plant"].includes(type))||pf&&type==="ooze")return stop("此规则下该生物类型免疫偷袭");
    if(target.actor.system.traits?.incorporeal)return stop("虚体的精准伤害例外须GM裁定",true);
    if(target.actor.system.combinedResistances?.some(r=>r.uid==="damage-precision"&&r.immunity))return stop("目标免疫精准伤害");
    const visible=sight(source,target);if(visible.value!==true)return stop(visible.reason,visible.value===null);
    const denial=deniedDex(source,target,pf);
    if(denial?.pending&&!result.flanking)return stop(denial.reason,true);
    if(typeof denial==="string"||result.flanking)return {...result,eligible:true,reason:typeof denial==="string"?denial:f.reason};
    return stop(f.reason??"目标既未被夹击，也未失去敏捷防御",f.value===null);
  }catch(error) {
    console.error(MODULE_ID,"偷袭判定程序错误",error);
    // A vision/API failure must not discard an independently valid flank.
    return {...stop("自动偷袭判定发生程序错误，本次未加入偷袭伤害",true),error:true};
  }
}

export function prepareSneakAttack(chat,options) {
  if(options.critical||!supported(chat.item))return options;
  const context=chat.rollData.threeRSneak??{};
  let result;
  try {result=evaluateSneak(chat.item,context);}
  catch(error) {console.error(MODULE_ID,"偷袭判定程序错误",error);result={eligible:false,flanking:false,pending:true,error:true,flankingError:true,reason:"自动攻击判定发生程序错误，本次未加入自动加值或偷袭伤害"};}
  chat._threeRSneak=result;
  // Replace the native aggregate once; critical confirmation inherits these same extra parts.
  const extra=(options.extraParts??[]).filter(p=>p.part!=="@flanking"&&!p.threeRFlanking);
  chat.rollData.flanking=result.flanking?2:0;
  chat.rollData.attackToggles={...chat.rollData.attackToggles,flanking:result.flanking};
  if(result.flanking)extra.push({part:"2",value:2,source:"无名加值",threeRFlanking:true});
  return {...options,extraParts:extra};
}
export function sneakDamage(chat,options) {
  const result=chat._threeRSneak;
  if(!result?.eligible||chat.attack?.isFumble||options.multiattack>0)return;
  // D35E fortification discards this UID when damage is applied; do not roll it a second time here.
  options.extraParts=[...(options.extraParts??[]),[`${result.dice}d6`,"精准伤害","damage-precision","偷袭"]];
}
function verdict(result,attack) {
  const notes=[];
  if(result.flanking)notes.push("夹击：+2无名加值");
  // Read the saved native damage rolls, including on old cards. Eligibility
  // alone does not prove damage was rolled (e.g. an attack-only roll).
  let precision=false;
  try {
    precision=JSON.parse(attack.normalDamage||"[]").some(roll=>roll.damageTypeUid==="damage-precision"&&roll.source==="偷袭");
  }catch(_) { /* No readable saved damage: do not claim a sneak damage roll. */ }
  if(result.eligible&&!attack.attack?.isFumble&&precision)
    notes.push(`偷袭：额外${result.dice}d6精准伤害（命中后结算，不乘重击）`);
  return notes.length?`${notes.join("。")}。`:"";
}
// D35E keeps attack in its serialized chat data, but drops custom fields on
// the ChatAttack instance. Preserve the rolled verdict, never recompute it
// against today's token positions when an old message is displayed.
export function finishSneakAttack(chat,options) {
  if(!options.critical&&chat._threeRSneak)chat.attack.threeRSneak={...chat._threeRSneak};
}

const openAttacks=new Set(),dialogAttacks=new WeakMap(),attackForms=new WeakMap(),attackObservers=new Map();
let dialogFrame=null;
function refreshAttackDialogs() {
  if(!attackObservers.size||dialogFrame!==null)return;
  // Only open native attack dialogs observe changes. Coalesce UI work; never
  // update an Actor, recalculate a sheet or retain a movement task queue.
  dialogFrame=requestAnimationFrame(()=>{
    dialogFrame=null;
    for(const [app,observer] of attackObservers) {
      if(!observer.form.isConnected){attackObservers.delete(app);continue;}
      observer.refresh();
    }
  });
}
function attackDialog(app,html) {
  const root=html?.[0]??html;
  const form=root?.matches?.("form.attack-form")?root:root?.querySelector?.("form.attack-form");
  if(!form)return;
  let context=dialogAttacks.get(app);
  if(!context) {
    const title=app.data?.title??app.title;
    const candidates=[...openAttacks].filter(c=>!c.dialog&&c.title===title);
    // Simultaneous identical dialogs must not borrow the wrong actor/item.
    if(candidates.length!==1)return;
    context=candidates[0];context.dialog=app;dialogAttacks.set(app,context);
  }
  if(attackForms.has(form))return;
  const item=context.item,source=actorToken(context.actor);
  const state={sourceId:source?.id};attackForms.set(form,state);
  const box=form.querySelector('[name="flanking"]');
  if(!box)return;
  const note=document.createElement("p");note.className="three-r-flanking-status";
  const section=box.closest(".form-group")?.parentElement;
  if(section)section.insertAdjacentElement("afterend",note);else form.append(note);
  const refresh=()=> {
    const targetIds=form.querySelector('[name="target-ids"]')?.value.split(";").filter(Boolean)??[...game.user.targets].map(t=>t.id);
    let result;
    try {result=evaluateSneak(item,{...state,targetIds,
      nonLethal:Boolean(form.querySelector('[name="nonLethal"]')?.checked)});}
    catch(error){console.error(MODULE_ID,"攻击窗口判定程序错误",error);result={flankingError:true,flankingReason:"自动夹击判定发生程序错误"};}
    box.checked=Boolean(result.flanking);
    box.title=result.flankingReason??"自动判断夹击；可使用原有勾选指定本次夹击，偷袭仍检查其他条件";
    note.textContent=`${result.flanking?"夹击 +2":result.flankingPending?"夹击未能确认":"未获得夹击加值"}：${result.flankingReason||result.reason||"未形成夹击"}`;
  };
  form.addEventListener("change",event=> {
    if(event.target===box)state.flanking=box.checked;
    refresh();
  });attackObservers.set(app,{form,refresh});refresh();
}

export function installSneakRules() {
  Hooks.on("D35E.ItemRolls.postRollDamage",(item,rolls)=> {
    for(const roll of rolls)if(roll.damageTypeUid==="damage-precision"&&roll.source==="偷袭")roll.damageType="精准伤害";
  });
  const rollAttack=ItemUse.prototype.rollAttack;
  ItemUse.prototype.rollAttack=function(fullAttack,form,temporaryItem,actor,data,...rest) {
    if(!supported(this.item))return rollAttack.call(this,fullAttack,form,temporaryItem,actor,data,...rest);
    const root=form?.[0]??form;
    const attackForm=root?.matches?.("form.attack-form")?root:root?.querySelector?.("form.attack-form");
    const state=attackForms.get(attackForm);
    const ids=root?.querySelector?.('[name="target-ids"]')?.value;
    const copy=foundry.utils.deepClone(data);
    copy.threeRSneak={sourceId:state?.sourceId??actorToken(actor)?.id,
      targetIds:ids!=null?ids.split(";").filter(Boolean):[...game.user.targets].map(t=>t.id),
      nonLethal:Boolean(root?.querySelector?.('[name="nonLethal"]')?.checked),mode:"auto",
      flanking:state?state.flanking:root?.querySelector?.('[name="flanking"]')?.checked?true:undefined};
    return rollAttack.call(this,fullAttack,form,temporaryItem,actor,copy,...rest);
  };
  // v14 exposes a read-only ESM namespace. Use the supported render hook,
  // scoped to a pending D35E attack, instead of assigning renderTemplate.
  const useAttack=ItemUse.prototype.useAttack;
  ItemUse.prototype.useAttack=async function(options={},actor=this.item.actor,...rest) {
    if(!supported(this.item)||options.skipDialog||actor&&actor.uuid!==this.item.actor.uuid)
      return useAttack.call(this,options,actor,...rest);
    const owner=actor??this.item.actor;
    const context={item:this.item,actor:owner,title:`${game.i18n.localize("D35E.Use")}: ${this.item.name} - ${owner.name}`};
    openAttacks.add(context);
    try {return await useAttack.call(this,options,actor,...rest);}
    finally {openAttacks.delete(context);if(context.dialog)attackObservers.delete(context.dialog);}
  };
  Hooks.on("renderDialog",(app,html)=> {
    try {attackDialog(app,html);}catch(error){console.error(MODULE_ID,"攻击窗口",error);}
  });
  Hooks.on("closeDialog",app=>attackObservers.delete(app));
  Hooks.on("updateToken",(token,change)=>{
    if(!attackObservers.size||token.parent?.id!==canvas.scene?.id)return;
    if(["x","y","width","height","elevation","level","disposition","hidden"].some(k=>Object.hasOwn(change,k)))refreshAttackDialogs();
  });
  Hooks.on("moveToken",token=>{if(token.parent?.id===canvas.scene?.id)refreshAttackDialogs();});
  for(const event of ["createToken","deleteToken"])Hooks.on(event,token=>{
    if(token.parent?.id===canvas.scene?.id)refreshAttackDialogs();
  });
  for(const event of ["createItem","deleteItem"])Hooks.on(event,item=>{
    if(item.actor&&["buff","aura","weapon","attack","feat","class","race"].includes(item.type))refreshAttackDialogs();
  });
  Hooks.on("updateItem",(item,change)=>{
    if(!attackObservers.size||!item.actor)return;
    const flat=foundry.utils.flattenObject(change);
    if(Object.keys(flat).some(k=>k.startsWith("system.")||k.startsWith(`flags.${MODULE_ID}.martialEffect`)))refreshAttackDialogs();
  });
  Hooks.on("updateActor",(actor,change)=>{
    if(!attackObservers.size)return;
    const flat=foundry.utils.flattenObject(change);
    if(Object.keys(flat).some(k=>k.startsWith("system.attributes.conditions")||k.startsWith("system.traits.")||k.startsWith("flags.D35E.")))refreshAttackDialogs();
  });
  Hooks.on("renderChatMessageHTML",(message,html)=> {
    if(!message.isContentVisible||message.flags?.D35E?.template!=="systems/D35E/templates/chat/attack-roll.html")return;
    const root=html?.[0]??html,rows=root?.querySelectorAll?.(".chat-attack");if(!rows)return;
    const attacks=message.flags.D35E.chatTemplateData?.attacks??[];
    attacks.forEach((attack,i)=> {
      const result=attack.attack?.threeRSneak,row=rows[i];
      if(!result||!row||row.querySelector(".three-r-sneak-result"))return;
      const text=verdict(result,attack);
      if(!text)return;
      const note=document.createElement("p");note.className="three-r-sneak-result";
      note.textContent=text;
      row.append(note);
    });
  });
  // Record only combats observed from their first regular turn. Mid-combat activation is not guessed.
  Hooks.on("updateCombat",(combat,change)=> {
    if(game.users.activeGM?.id!==game.user.id||!("round" in change||"turn" in change))return;
    if(!combat.started){if(combat.getFlag(MODULE_ID,"sneakInitiative"))combat.unsetFlag(MODULE_ID,"sneakInitiative").catch(error=>console.error(MODULE_ID,error));return;}
    const old=combat.getFlag(MODULE_ID,"sneakInitiative");
    if(!old&&(combat.round!==1||combat.turn!==0))return;
    const record=old??{roster:combat.turns.map(c=>c.id),acted:[]};
    const passed=combat.round>1?record.roster:combat.turns.slice(0,combat.turn+1).map(c=>c.id);
    const acted=[...new Set([...record.acted,...passed])];
    combat.setFlag(MODULE_ID,"sneakInitiative",{roster:record.roster,acted}).catch(error=>console.error(MODULE_ID,error));
  });
}
