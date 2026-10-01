import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { fragileState, weaponFor } from "./fragile.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";

// PF Unchained Rogue / CRB flanking; 3.5 SRD Rogue has different concealment/type restrictions.
const key=item=>item?.getFlag(MODULE_ID,"key");
const conditions=actor=>actor?.system.attributes?.conditions??{};
const attacks=new Set(["mwak","rwak"]);
const escaping=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
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
  if(weapon)return weapon.system.equipped&&!weapon.system.melded;
  if(item.type==="weapon")return item.system.equipped&&item.system.weaponSubtype!=="ranged";
  if(item.type!=="attack"||item.system.actionType!=="mwak")return false;
  if(item.system.attackType==="natural")return true;
  const unarmed=["unarmed","unarmedstrike","unarmed strike"].includes(String(item.system.baseWeaponType).toLowerCase())||/徒手|^Unarmed Strike$/i.test(item.name);
  return item.system.attackType==="weapon"&&(!unarmed||ability(item.actor,"improvedUnarmedStrike",["Improved Unarmed Strike","精通徒手击打"]));
}
function threatens(source,target,item=null) {
  if(incapacitated(source.actor))return false;
  const d=distance(source,target);if(d==null)return null;
  if(conditions(source.actor).blind&&!blindsight(source,target))return false;
  const choices=item?[item]:source.actor.items.filter(i=>armed(i)&&(i.type==="weapon"||i.system.actionType==="mwak"));
  let unknown=false;
  for(const attack of choices) {
    if(!armed(attack))continue;
    const r=reach(attack);if(!r){unknown=true;continue;}
    if(r.max<=0||d<=r.min||d>r.max+1e-6)continue;
    // Blocking walls prevent an automatic threat. Bars/windows and unusual attacks can be adjudicated.
    if(clearLine(source,target)&&clearLine(source,target,"move"))return true;
  }
  return unknown?null:false;
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
  if(!ownThreat)return {value:ownThreat,reason:ownThreat===null?"攻击者触及未记录":"攻击者未装备可用近战武器、距离超出触及或被墙壁阻挡"};
  const disposition=source.document.disposition;
  if(!disposition)return {value:null,reason:"中立Token的盟友关系待GM裁定"};
  let unknown=false,oppositeAlly=false;
  for(const ally of canvas.tokens.placeables) {
    if(ally.id===source.id||ally.id===target.id||!ally.actor||ally.document.disposition!==disposition)continue;
    if(!game.user.isGM&&(!ally.isVisible||ally.document.hidden))continue;
    const positions=centers(source).some(p=>centers(ally).some(q=>opposite(p,q,target)));
    if(!positions)continue;
    oppositeAlly=true;
    const threat=threatens(ally,target);unknown ||= threat===null;
    if(threat)return {value:true,reason:"盟友从相对边威胁目标"};
  }
  return {value:unknown?null:false,reason:unknown?"同伴触及未记录":oppositeAlly?
    "相对位置有同伴，但其未装备可用近战武器、不能行动或无法触及目标":"没有站在目标相对边／角的同伴"};
}
function detectionVisibility(observer,target,ids) {
  const vision=observer.vision;
  if(!vision?.active)return null;
  const level=canvas.scene.levels?.get(target.document.level);
  if(!level)return null;
  const points=target.document.getVisibilityTestPoints();
  let checked=false;
  for(const mode of observer.document.detectionModes??[]) {
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
  return range>0&&d<=range||observer.document.detectionModes?.some(m=>m.id==="blindSight"&&m.enabled&&Number(m.range)>0&&d<=Number(m.range));
}
function detectsInvisible(observer,target) {
  if(!clearLine(observer,target))return false;
  const d=distance(observer,target);if(d==null)return false;
  const senses=observer.actor.system.attributes?.senses??{};
  if([senses.blindsight,senses.truesight].some(r=>Number(r)>0&&d<=Number(r)))return true;
  if(blindsight(observer,target))return true;
  const modes=(observer.document.detectionModes??[]).filter(m=>m.id==="seeInvisibility"&&m.enabled);
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
  const visible=detectionVisibility(source,target,["basicSight","seeInvisibility","blindSight"]);
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
  const actor=item.actor,result={eligible:false,flanking:false,dice:dice(actor),reason:"",pending:false};
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
    reason:result.dice>0?"GM裁定本次夹击且符合全部偷袭条件":"GM裁定本次夹击；没有可用的原生偷袭伤害骰"};
  if(mode==="gm-eligible") {
    let autoFlank=false;
    try {autoFlank=flank(source,target,item).value===true;}catch(error){console.error(MODULE_ID,error);}
    return {...result,eligible:result.dice>0,flanking:autoFlank,
      reason:result.dice>0?"GM裁定本次符合全部偷袭条件":"没有可用的原生偷袭伤害骰，不能凭裁定增加骰数"};
  }
  const pf=pfRule(actor),f=flank(source,target,item);
  result.flanking=f.value===true;
  if(mode==="off")return stop("本次关闭偷袭");
  if(result.dice<=0)return stop(sneakKnown(actor)?"已有偷袭能力，但系统偷袭骰数为0；请由GM刷新客户端完成旧职业数据修复":"没有偷袭能力",sneakKnown(actor));
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
  const concealment=Number(target.actor.system.attributes?.concealment?.total)||0;
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
}

export function prepareSneakAttack(chat,options) {
  if(options.critical||!supported(chat.item))return options;
  const context=chat.rollData.threeRSneak??{};
  let result;
  try {result=evaluateSneak(chat.item,context);}
  catch(error) {console.error(MODULE_ID,"偷袭判定",error);result={eligible:false,flanking:false,pending:true,reason:"地图判定接口不可用，待GM裁定"};}
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
function verdict(result) {
  return `${result.flanking?"夹击：+2无名加值":"夹击：未加入加值"}。${result.eligible?`偷袭：额外${result.dice}d6精准伤害（命中后结算，不乘重击）`:result.pending?"偷袭：数据或条件待确认，暂不加入伤害":"偷袭：不触发"}。${result.reason}。`;
}
export function installSneakRules() {
  Hooks.on("D35E.ItemRolls.postRollDamage",(item,rolls)=> {
    for(const roll of rolls)if(roll.damageTypeUid==="damage-precision"&&roll.source==="偷袭")roll.damageType="精准伤害";
  });
  const rollAttack=ItemUse.prototype.rollAttack;
  ItemUse.prototype.rollAttack=function(fullAttack,form,temporaryItem,actor,data,...rest) {
    if(!supported(this.item))return rollAttack.call(this,fullAttack,form,temporaryItem,actor,data,...rest);
    const root=form?.[0]??form,sourceId=root?.querySelector?.('[name="threeR-source-id"]')?.value;
    const ids=root?.querySelector?.('[name="target-ids"]')?.value;
    const mode=root?.querySelector?.('[name="threeR-sneak-mode"]')?.value??"auto";
    const copy=foundry.utils.deepClone(data);
    copy.threeRSneak={sourceId:sourceId??actorToken(actor)?.id,
      targetIds:ids!=null?ids.split(";").filter(Boolean):[...game.user.targets].map(t=>t.id),
      nonLethal:Boolean(root?.querySelector?.('[name="nonLethal"]')?.checked),mode};
    return rollAttack.call(this,fullAttack,form,temporaryItem,actor,copy,...rest);
  };
  const renderer=foundry.applications.handlebars,render=renderer.renderTemplate;
  renderer.renderTemplate=async function(path,data,...rest) {
    const html=await render.call(this,path,data,...rest);
    if(path==="systems/D35E/templates/apps/attack-roll-dialog.html"&&supported(data.item)) {
      const root=document.createElement("div");root.innerHTML=html;
      const form=root.querySelector("form");if(!form)return html;
      const source=actorToken(data.item.actor),targetIds=(data.targets??[]).map(t=>t.id);
      let result;
      try {result=evaluateSneak(data.item,{sourceId:source?.id,targetIds});}
      catch(error){console.error(MODULE_ID,error);result={pending:true,reason:"地图判定接口不可用"};}
      const panel=document.createElement("section");panel.className="three-r-sneak";
      panel.innerHTML=`<h4>夹击与偷袭自动判断 · ${pfRule(data.item.actor)?"PF掉链子游荡者":"3R"}</h4><p>${escaping(verdict(result))}</p>
        <input type="hidden" name="threeR-source-id" value="${escaping(source?.id)}">
        <label>本次处理 <select name="threeR-sneak-mode"><option value="auto">自动判断</option><option value="off">不使用偷袭</option>
        ${game.user.isGM?'<option value="gm-eligible">GM裁定：全部条件符合</option>'+ (data.item.system.actionType==="mwak"?'<option value="gm-flank">GM裁定：夹击且全部条件符合</option>':""):""}</select></label>
        <small>掷骰时重新判断。虚招、未记录的免疫、特殊触及由GM裁定；不改目标状态。</small>`;
      (form.querySelector("section")??form).prepend(panel);
      const flankBox=form.querySelector('[name="flanking"]');
      if(flankBox){flankBox.checked=result.flanking;flankBox.disabled=true;if(result.flanking)flankBox.setAttribute("checked","");else flankBox.removeAttribute("checked");flankBox.setAttribute("disabled","");}
      return root.innerHTML;
    }
    if(path==="systems/D35E/templates/chat/attack-roll.html"&&data.attacks?.some(a=>a._threeRSneak)) {
      const root=document.createElement("div");root.innerHTML=html;
      const rows=root.querySelectorAll(".chat-attack");
      data.attacks.forEach((attack,i)=> {
        if(!attack._threeRSneak||!rows[i])return;
        const note=document.createElement("p");note.className="three-r-sneak-result";
        note.textContent=attack.attack?.isFumble?"偷袭：本次攻击天然1，未加入精准伤害。":verdict(attack._threeRSneak);
        rows[i].append(note);
      });
      return root.innerHTML;
    }
    return html;
  };
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
