import { MODULE_ID } from "./catalog.js";
import { conditionState, conditionContext, conditionName, conditionActionRestriction, skillConditionFailure, limitedAction, CONDITION_NAMES } from "./condition-state.js";
import { syncConditionMarkers, editConditionContext } from "./condition-tools.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";
import { ChatAttack } from "../../../systems/D35E/module/item/chat/chatAttack.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { effectIsActive } from "./effect-state.js";
import { installConditionVitals, damageConditionHP, completeConditionRest } from "./condition-vitals.js";
import { createTransientView } from "./transient-view.js";
import { installConditionTurns, conditionAttackConsequences } from "./condition-turns.js";

const esc=text=>foundry.utils.escapeHTML(String(text??""));
const resultRoll=result=>Array.isArray(result)?result.find(value=>Number.isFinite(value?.total)):result;
const warn=reason=>{ui.notifications.warn(reason);return null;};
const report=error=>{console.error(MODULE_ID,error);ui.notifications.error(`状态结算：${error.message}`);};
const post=(actor,text)=>ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(text)}</p>`});
const kindFor=item=>item.type==="full-attack"?"full":item.system.activation?.type==="attack"?"standard":item.system.activation?.type;
export async function commitConditionAction(actor,kind,{movement=0,healed=false}={}) {
  const c=conditionState(actor),combat=game.combat;
  if(combat?.started&&["standard","move","full","round"].includes(kind)&&(c.staggered||c.disabled||c.nauseated))
    await actor.setFlag(MODULE_ID,"conditionAction",{key:`${combat.id}:${combat.round}`,kind,at:game.time.worldTime,
      distance:movement+(actor.getFlag(MODULE_ID,"conditionAction")?.key===`${combat.id}:${combat.round}`?Number(actor.getFlag(MODULE_ID,"conditionAction")?.distance)||0:0)});
  if(c.disabled&&!healed&&kind!=="move"&&![null,undefined,"free","none"].includes(kind)) {
    await actor.update({"system.attributes.conditions.stable":false});await damageConditionHP(actor,1);
  }
}
export function assertConditionAction(actor,item,options={}) {
  const reason=conditionActionRestriction(actor,item,options);
  if(reason)throw new Error(reason);
}
export async function spellConditionCheck(item,actor) {
  const c=conditionState(actor),comp=item.system.components??{},sl=Number(item.system.level)||0;
  if((c.grappled||c.pinned)&&comp.somatic)return {blocked:"擒抱或压制中不能施展带姿势成分的法术。"};
  if((c.grappled||c.pinned)&&(comp.material||comp.focus||comp.divineFocus)&&!conditionContext(actor,c.pinned?"pinned":"grappled").materialReady)return {blocked:"擒抱中施法需要事先拿好所需材料和器材；请在状态详情中记录。"};
  if(c.pinned&&conditionContext(actor,"pinned").preventSpeech&&comp.verbal)return {blocked:"压制者阻止说话，不能施展带语言成分的法术。"};
  if(c.deaf&&comp.verbal) {
    const roll=await new Roll35e("1d100").roll();
    await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`耳聋：语言成分施法失败概率20%`});
    if(roll.total<=20)return {failed:"耳聋导致语言成分施法失败。"};
  }
  if(c.entangled||c.grappled||c.pinned) {
    const glue=actor.items.some(effect=>effectIsActive(effect)&&effect.getFlag(MODULE_ID,"key")==="tanglefoot-entangled");
    const dc=c.grappled||c.pinned?20+sl:glue?15:15+sl;
    const roll=resultRoll(await actor.rollSkill("coc",{skipDialog:false,threeRConditionCheck:true}));
    if(!roll)return {cancelled:true};
    await post(actor,`受限制施法：专注${roll.total}对DC${dc}，${roll.total>=dc?"成功":"失败，失去该法术"}。`);
    if(roll.total<dc)return {failed:"未通过受限制施法的专注检定。"};
  }
  return {};
}
async function conditionAttackParts(chat,options) {
  const actor=chat.item?.actor,target=[...game.user.targets].filter(token=>token.actor);
  if(!actor||!chat.item.hasAttack)return options;
  const c=conditionState(actor);
  if(target.length>1&&(c.invisible||target.some(token=>["prone","helpless","grappled","pinned","invisible"].some(id=>conditionState(token.actor)[id]))))throw new Error("这些目标的状态修正不同，请逐目标结算。");
  const enemy=target.length===1?target[0]?.actor:null,other=enemy?conditionState(enemy):{},parts=[];
  const melee=["mwak","msak"].includes(chat.item.system.actionType);
  const add=(value,source)=>parts.push({part:String(value),value,source:`状态：${source}`});
  if(c.prone&&melee)add(-4,"俯卧近战攻击");
  if(c.grappled&&melee)add(-4,"擒抱中使用武器攻击");
  if(other.prone&&!(other.helpless&&melee))add(melee?4:-4,melee?"目标俯卧（近战防御−4）":"目标俯卧（远程防御＋4）");
  if(other.helpless&&melee)add(4,"无助目标");
  const losesDex=["blind","pinned","stunned","helpless","paralyzed","cowering","petrified"].some(id=>other[id]);
  const denied=Math.max(0,Number(enemy?.system.attributes.ac.normal.total)-Number(enemy?.system.attributes.ac.flatFooted.total))||0;
  if(other.grappled&&!losesDex&&!conditionContext(enemy,"grappled").participants?.includes(actor.uuid)) {
    const dex=denied;
    add(dex,"目标擒抱，失去对其他敌手的敏捷防御");
  }
  if(other.pinned&&!conditionContext(enemy,"pinned").participants?.includes(actor.uuid))add(4,"目标被他人压制");
  const token=canvas.tokens.placeables.find(token=>token.actor?.uuid===actor.uuid),opponent=target[0];
  const distance=token&&opponent?canvas.grid.measurePath([token.center,opponent.center]).distance/sceneFeet():Infinity;
  const seesInvisible=Boolean(actor.getFlag(MODULE_ID,"seeInvisible"))||Number(actor.system.attributes.senses?.truesight)>=distance;
  const blindsight=Number(actor.system.attributes.senses?.blindsight)>0&&Number(actor.system.attributes.senses.blindsight)>=distance;
  if(c.invisible&&enemy&&!other.invisible&&!enemy.getFlag(MODULE_ID,"seeInvisible")&&!(Number(enemy.system.attributes.senses?.truesight)>=distance)&&!(Number(enemy.system.attributes.senses?.blindsight)>0&&Number(enemy.system.attributes.senses.blindsight)>=distance)) {
    add(2,"隐形攻击者");
    const hasDexLoss=["blind","pinned","stunned","helpless","paralyzed","cowering","petrified","flatFooted"].some(id=>other[id]);
    if(!hasDexLoss&&!other.grappled)add(denied,"目标无法看见攻击者，失去敏捷与闪避防御");
  }
  const chance=(!blindsight&&c.blind||other.invisible&&!seesInvisible&&!blindsight)?50:0;
  if(!options.critical)chat._threeRConcealment=chance;
  const old=options.extraParts??[];
  // Native critical confirmation forwards the original extraParts again.
  return {...options,extraParts:old.some(part=>String(part.source??"").startsWith("状态："))?old:[...old,...parts]};
}
export function installConditionRuntime() {
  const proto=CONFIG.Actor.documentClass.prototype;
  for(const [id,name] of Object.entries(CONDITION_NAMES))if(!CONFIG.statusEffects.some(effect=>effect.id===id))CONFIG.statusEffects.push({id,name,img:"icons/svg/aura.svg"});
  const choices=foundry.applications.hud.TokenHUD.prototype._getStatusEffectChoices;
  foundry.applications.hud.TokenHUD.prototype._getStatusEffectChoices=function() {
    const result=choices.call(this),actor=this.object?.actor;if(!actor)return result;
    const c=conditionState(actor);
    for(const [id,name] of Object.entries(CONDITION_NAMES))if(!CONFIG.D35E.conditions[id])result[id]={id,title:name,src:"icons/svg/aura.svg",isActive:Boolean(c[id]),isOverlay:false,cssClass:c[id]?"active":""};
    return result;
  };
  const toggle=proto.toggleStatusEffect;
  proto.toggleStatusEffect=async function(id,options={}) {
    if(!CONDITION_NAMES[id]||options.overlay===true)return toggle.call(this,id,options);
    const active=options.active??!conditionState(this)[id];
    if(!active)return (await import("./condition-tools.js")).clearCondition(this,id);
    return (await import("./condition-tools.js")).applyCondition(this,id);
  };
  const rest=proto.rest;
  proto.rest=async function(...args) {
    const c=conditionState(this);
    if(c.dead||c.petrified){warn("当前状态不能通过休息恢复生命或能力。");return Promise.resolve({completed:false});}
    if(game.modules.get("d35e-world-timeline")?.active)return rest.apply(this,args);
    const updates=[],actor=this;
    const view=createTransientView(actor,{update:(...values)=>{const promise=actor.update(...values);updates.push(promise);return promise;}});
    const result=await rest.apply(view,args);await Promise.all(updates);
    if(result?.completed!==false)await completeConditionRest(actor,8*3600);
    return result;
  };
  const skill=proto.rollSkill;
  proto.rollSkill=function(id,options={}) {
    const reason=skillConditionFailure(this,id,options);
    if(reason){post(this,`${conditionName(conditionState(this).blind?"blind":conditionState(this).deaf?"deaf":"unconscious")}：${reason}`).catch(report);return Promise.resolve(null);}
    return skill.call(this,id,options);
  };
  const ability=proto.rollAbilityTest;
  proto.rollAbilityTest=function(id,options={}) {
    const c=conditionState(this);
    if(["dead","dying","unconscious","petrified","stunned","dazed","cowering","banished"].some(state=>c[state])||c.paralyzed&&["str","dex"].includes(id))return Promise.resolve(warn("当前状态使这项主动属性检定无法进行。"));
    return ability.call(this,id,options);
  };
  const spell=ItemUse.prototype.useSpell;
  ItemUse.prototype.useSpell=async function(event,options={},actor=this.item.actor) {
    const item=options.replacementItem??this.item,reason=conditionActionRestriction(actor,item,{kind:kindFor(item)});
    if(reason)return warn(reason);
    const before=Number(this.item.charges),hp=Number(actor.system.attributes.hp.value),result=await spell.call(this,event,options,actor);
    const rolled=result?.roll?await result.roll:result;
    if(!result?.getFlag?.(MODULE_ID,"conditionFailed")&&rolled!==false&&(result?.documentName==="ChatMessage"||result?.wasRolled||Number(this.item.charges)<before))await commitConditionAction(actor,kindFor(item),{healed:Number(actor.system.attributes.hp.value)>hp});
    return result;
  };
  const useAttack=ItemUse.prototype.useAttack;
  ItemUse.prototype.useAttack=async function(options={},actor=this.item.actor,...args) {
    const kind=options.isFullAttack||this.item.type==="full-attack"?"full":kindFor(this.item);
    const reason=conditionActionRestriction(actor,this.item,{kind});if(reason)return warn(reason);
    const result=await useAttack.call(this,options,actor,...args);
    const rolled=result?.roll?await result.roll:result;
    if(this.item.type!=="spell"&&result?.wasRolled&&rolled!==false)await commitConditionAction(actor,kind);
    return result;
  };
  const rollAttack=ItemUse.prototype.rollAttack;
  ItemUse.prototype.rollAttack=function(fullAttack,form,...args) {
    const root=form?.nodeType===1?form:form?.[0],charging=root?.querySelector('[name="charge"]')?.checked;
    const reason=conditionActionRestriction(args[1]??this.item.actor,this.item,{kind:fullAttack||charging?"full":kindFor(this.item),common:charging?"charge":null});
    if(reason){warn(reason);return Promise.resolve(false);}
    return rollAttack.call(this,fullAttack,form,...args);
  };
  const attack=ChatAttack.prototype.addAttack;
  ChatAttack.prototype.addAttack=async function(options={}) {
    const next=await conditionAttackParts(this,options);
    let concealment=null;
    if(!options.critical&&this._threeRConcealment) {
      concealment=await new Roll35e("1d100").roll();
      this._threeRConditionMiss=concealment.total<=this._threeRConcealment;
    }
    const result=await attack.call(this,next);
    if(!options.critical&&this._threeRConcealment) {
      const roll=concealment;this.rolls.push(roll);
      this.attack.conditionMiss=this._threeRConditionMiss;
      this._threeRConditionMiss=this.attack.conditionMiss;
      this.attack.tooltip+=`<p>状态隐蔽检定：${roll.total}／${this._threeRConcealment}%，${this.attack.conditionMiss?"失手":"未失手"}。</p>`;
      if(this.attack.conditionMiss){this.hasCritConfirm=false;this.attack.isCrit=false;}
    }
    if(!options.critical&&this.hasAttack&&Number.isFinite(this.attack?.total)&&this.attack.total!==-1337)await conditionAttackConsequences(this.item.actor,[...game.user.targets].length===1?[...game.user.targets][0].actor:null);
    return result;
  };
  const damage=ChatAttack.prototype.addDamage;
  ChatAttack.prototype.addDamage=function(options={}) {
    if(this._threeRConditionMiss){this.hasDamage=false;return Promise.resolve(null);}
    return damage.call(this,options);
  };
  Hooks.on("preMoveToken",(doc,movement,operation)=>{
    if(operation.isUndo||operation.threeRForcedMovement&&game.user.isGM||!doc.actor)return;
    if(movement.passed.waypoints.some(point=>CONFIG.Token.movement.actions[point.action]?.teleport))return;
    const c=conditionState(doc.actor);
    if(c.confused&&doc.actor.getFlag(MODULE_ID,"confusionTurn")?.mode!=="flee"&&doc.actor.getFlag(MODULE_ID,"confusionTurn")?.mode!=="normal") {warn("困惑：本回合只能执行已记录的行为，不能自由移动。");return false;}
    if(c.entangled&&conditionContext(doc.actor,"entangled").anchored) {warn("纠缠固定在物体上，无法主动移动。");return false;}
    const stopped=["dead","dying","unconscious","paralyzed","petrified","pinned","cowering","stunned","dazed","banished","helpless","grappled","fascinated"].find(id=>c[id]);
    if(stopped){warn(`${conditionName(stopped)}：不能主动移动。`);return false;}
    const reason=limitedAction(doc.actor,"move");
    if(reason){warn(reason);return false;}
    if(game.combat?.started&&(c.disabled||c.staggered||c.nauseated)) {
      const used=doc.actor.getFlag(MODULE_ID,"conditionAction"),previous=used?.key===`${game.combat.id}:${game.combat.round}`?Number(used.distance)||0:0;
      const action=movement.pending.waypoints.at(-1)?.action;
      const speed=Number(doc.actor.system.attributes.speed[action]?.total??doc.actor.system.attributes.speed.land.total)*sceneFeet();
      if(previous+Number(movement.pending.distance)+Number(movement.passed.distance)>speed+1e-6){warn("当前状态本轮只能移动一次移速的距离。");return false;}
    }
    if(c.prone&&Number(movement.pending.distance)+Number(movement.passed.distance)>5*sceneFeet()+1e-6){warn("俯卧时一次移动动作只能爬行五尺。");return false;}
    const confused=doc.actor.getFlag(MODULE_ID,"confusionTurn"),frightened=c.panicked?"panicked":c.frightened?"frightened":c.turned?"turned":c.confused&&confused?.mode==="flee"?"confused":null;
    if(frightened) {
      const sources=conditionContext(doc.actor,frightened).sourceActors;
      const enemies=canvas.tokens.placeables.filter(token=>sources.includes(token.actor?.uuid));
      if(!enemies.length){warn("恐惧来源尚未定位，请先在状态来源中指定。");return false;}
      const end=movement.destination??movement.pending.waypoints.at(-1);
      if(end&&enemies.some(token=>Math.hypot(end.x-token.x,end.y-token.y)<Math.hypot(doc.x-token.x,doc.y-token.y)-1)) {
        warn("当前恐惧状态须逃离来源，不能主动向它靠近。");return false;
      }
    }
  });
  Hooks.on("moveToken",(doc,movement,operation,user)=>{
    if(operation.isUndo||operation.threeRForcedMovement||user.id!==game.user.id||!doc.actor?.isOwner)return;
    if(Number(movement.passed.distance)>0)commitConditionAction(doc.actor,"move",{movement:Number(movement.passed.distance)}).catch(report);
    const mode=movement.passed.waypoints.at(-1)?.action;
    if(mode)doc.actor.setFlag(MODULE_ID,"movementMode",mode).catch(report);
  });
  Hooks.on("updateActor",(actor,change,options)=>{
    if(options.threeRConditionMarker||game.users.activeGM!==game.user)return;
    if(change.system?.attributes?.conditions||change.system?.attributes?.hp||Object.keys(change).some(key=>key.startsWith("system.attributes.conditions")||key.startsWith("system.attributes.hp")||key.startsWith(`flags.${MODULE_ID}.conditions`))||change.flags?.[MODULE_ID]?.conditions)
      syncConditionMarkers(actor).catch(report);
  });
  Hooks.on("renderActorSheet",(app,html)=>{
    const root=html?.nodeType===1?html:html?.[0];if(!app.actor?.isOwner||!root||root.querySelector('[data-3r-condition-context]'))return;
    const tab=root.querySelector('[data-tab="buffs"], [data-tab="conditions"]');if(!tab)return;
    const button=document.createElement("button");button.type="button";button.dataset.threeRConditionContext="";button.setAttribute("data-3r-condition-context","");
    button.innerHTML='<i class="fas fa-link"></i> 状态与来源';button.addEventListener("click",()=>editConditionContext(app.actor).catch(report));tab.prepend(button);
  });
  Hooks.on("renderItemSheet",(app,html)=>{
    const root=html?.nodeType===1?html:html?.[0],item=app.item;
    if(!item?.isOwner||!root||!["feat","spell","attack","buff"].includes(item.type)||root.querySelector('[data-3r-action-tags]'))return;
    const button=document.createElement("button");button.type="button";button.dataset.threeRActionTags="";button.setAttribute("data-3r-action-tags","");button.textContent="状态下的使用方式";
    button.addEventListener("click",async()=>{
      try {
        const values=await foundry.applications.api.DialogV2.wait({window:{title:`${item.name}：使用方式`},rejectClose:false,
          content:`<form>${[["purelyMental","纯粹的心理活动"],["helpsEscape","可帮助逃离恐惧来源"],["requiresConcentration","效果需要持续专注"]].map(([key,name])=>`<label><input type="checkbox" name="${key}" ${item.getFlag(MODULE_ID,key)?"checked":""}>${name}</label>`).join("")}</form>`,
          buttons:[{action:"save",label:"保存",callback:(event,button,dialog)=>Object.fromEntries(["purelyMental","helpsEscape","requiresConcentration"].map(key=>[`flags.${MODULE_ID}.${key}`,dialog.element.querySelector(`[name="${key}"]`).checked]))}]});
        if(values)await item.update(values);
      }catch(error){report(error);}
    });
    (root.querySelector('.sheet-body')??root).prepend(button);
  });
  installConditionVitals();
  installConditionTurns();
}
const sceneFeet=()=>/^(m|meter|meters|米|公尺)$/i.test(canvas.scene.grid.units)?0.3048:1;
