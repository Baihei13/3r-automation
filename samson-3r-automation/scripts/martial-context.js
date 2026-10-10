import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { windAttackBonus } from "./martial-terrain.js";

const sizes=["fine","dim","tiny","sm","med","lg","huge","grg","col"];
export const sizeIndex=actor=>sizes.indexOf(actor?.system.traits?.actualSize??actor?.system.traits?.size);
export const stanceEffect=(actor,definition)=>actor?.items.find(i=>i.type==="buff"&&effectIsActive(i)&&i.flags?.[MODULE_ID]?.martialEffect?.stance&&i.flags[MODULE_ID].martialEffect.definition===definition);
export const feetScale=(scene=canvas.scene)=>/^(ft|feet|foot|尺|英尺)$/i.test(String(scene?.grid.units??"").trim())?1:/^(m|米|公尺|met(er|re)s?)$/i.test(String(scene?.grid.units??"").trim())?0.3048:null;
export function sceneToken(actor,uuid=null) {
  if(!actor)return null;
  const tokens=(canvas.tokens?.placeables??[]).filter(t=>t.actor?.uuid===actor.uuid);
  if(uuid)return tokens.find(t=>t.document.uuid===uuid)??null;
  if(actor.token)return tokens.find(t=>t.id===actor.token.id)??null;
  return tokens.length===1?tokens[0]:tokens.filter(t=>t.controlled).length===1?tokens.find(t=>t.controlled):null;
}
export function feetDistance(a,b) {
  const scale=feetScale();if(!scale)throw new Error("地图单位需为尺或米，才能判断距离。");
  return Number(canvas.grid.measurePath([a,b]).distance)/scale;
}
export async function chooseClarityTarget(actor,focus=null) {
  const stance=stanceEffect(actor,"stance-of-clarity");if(!stance)return;
  if(focus&&canvas.tokens?.placeables.some(t=>t.actor?.uuid===focus&&t.actor.uuid!==actor.uuid)){
    await stance.update({[`flags.${MODULE_ID}.martialEffect.focusTarget`]:focus},{updateChanges:false,skipMinions:true,skipToken:true});return;
  }
  const source=sceneToken(actor),old=stance.flags[MODULE_ID].martialEffect.focusTarget;
  const targets=(canvas.tokens?.placeables??[]).filter(t=>t.actor&&t.actor.uuid!==actor.uuid&&(game.user.isGM||t.isVisible)&&(!source||t.document.level===source.document.level));
  if(!targets.length){ui.notifications.warn("明净体：场景中没有可选目标；对其他攻击者仍承受AC−2。");return;}
  const esc=v=>foundry.utils.escapeHTML(String(v));
  const selected=await foundry.applications.api.DialogV2.wait({window:{title:`${actor.name}：明净体专注目标`},rejectClose:false,
    content:`<select name="focus">${targets.map(t=>`<option value="${t.actor.uuid}" ${old===t.actor.uuid?"selected":""}>${esc(t.name)}</option>`).join("")}</select>`,
    buttons:[{action:"choose",label:"选定目标",callback:(_e,_b,d)=>d.element.querySelector('[name="focus"]').value}]});
  if(!selected)return;const current=stanceEffect(actor,"stance-of-clarity");
  if(current?.id===stance.id&&targets.some(t=>t.actor.uuid===selected))await current.update({[`flags.${MODULE_ID}.martialEffect.focusTarget`]:selected},{updateChanges:false,skipMinions:true,skipToken:true});
}
export async function requestClarityTarget(actor) {
  const stance=stanceEffect(actor,"stance-of-clarity");if(!stance)return;
  const owner=game.users.find(u=>u.active&&!u.isGM&&actor.testUserPermission(u,"OWNER"));
  if(!owner)return chooseClarityTarget(actor);
  await ChatMessage.create({content:"<p>明净体：本次行动可重新选定专注目标；关闭窗口保留原目标。</p>",whisper:[owner.id],flags:{[MODULE_ID]:{clarityChoice:{actor:actor.uuid,stance:stance.id,user:owner.id}}}});
}
export function installClarityChoices() {
  Hooks.on("createChatMessage",async message=>{
    const request=message.flags?.[MODULE_ID]?.clarityChoice;
    if(!request||request.user!==game.user.id||(message.author??message.user)?.id!==game.users.activeGM?.id)return;
    try{const actor=await fromUuid(request.actor);if(actor?.isOwner&&stanceEffect(actor,"stance-of-clarity")?.id===request.stance)await chooseClarityTarget(actor);}
    catch(error){console.error(MODULE_ID,"明净体选目标",error);ui.notifications.error(error.message);}
  });
}
export function applyMartialDefense(target,attacker,values,{touch=false}={}) {
  if(!attacker||!Number.isFinite(values.finalAc?.ac)||values.finalAc.noCheck)return;
  const modifiers=values.finalAc.rollModifiers??=[];
  const acModifiers=values.finalAc.acModifiers??=[];
  const wind=windAttackBonus(attacker,target);
  if(wind){values.roll+=wind;modifiers.push("风行势：目标处于困难地形，攻击＋2");}
  const clarity=stanceEffect(target,"stance-of-clarity");
  if(clarity) {
    const focused=clarity.flags[MODULE_ID].martialEffect.focusTarget===attacker.uuid;
    const field=touch?"touch":target.system.attributes.conditions?.flatFooted?"flatFooted":"normal";
    const insight=Math.max(0,...(target.sourceDetails?.[`system.attributes.ac.${field}.total`]??[]).filter(row=>row.bonusType==="insight").map(row=>Number(row.value)||0));
    const delta=focused?Math.max(0,2-insight):-2;
    values.finalAc.ac+=delta;modifiers.push(`明净体：AC${delta>=0?"＋":""}${delta}${focused?"（洞察，同类取高）":""}`);
    acModifiers.push({value:delta,sourceName:focused?"明净体（洞察，同类取高）":"明净体（其他攻击者）"});
  }
  if(stanceEffect(target,"stonefoot-stance")&&sizeIndex(attacker)>sizeIndex(target)&&sizeIndex(target)>=0){values.finalAc.ac+=2;modifiers.push("坚如磐石：更大体型攻击者，AC＋2");acModifiers.push({value:2,sourceName:"坚如磐石（更大攻击者）"});}
}
export function opposedStanceBonus(actor,enemy,ability) {
  let bonus=0;
  if(ability==="str"&&stanceEffect(actor,"stonefoot-stance")&&sizeIndex(enemy)>sizeIndex(actor)&&sizeIndex(actor)>=0)bonus+=2;
  if(windAttackBonus(actor,enemy))bonus+=4;
  return bonus;
}
