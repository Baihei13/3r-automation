import { MODULE_ID } from "./catalog.js";
import { conditionName, CONDITION_NAMES, conditionState, conditionContext } from "./condition-state.js";
import { syncNativeConditions } from "./native-conditions.js";
import { conditionRule } from "./condition-rules.js";

const esc=text=>foundry.utils.escapeHTML(String(text??""));
const queues=new Map();
export class ConditionMenu extends foundry.applications.api.ApplicationV2 {
  async render() {try{await editConditionContext();}catch(error){ui.notifications.error(error.message);}return this;}
}
export function registerConditionTools() {
  game.settings.registerMenu(MODULE_ID,"conditionTools",{name:"状态与来源",label:"打开状态与来源",hint:"施加、解除状态，记录恐惧来源、擒抱对手和原生形态。",icon:"fas fa-link",type:ConditionMenu,restricted:false});
}
export const actorQueue=(actor,work)=>{
  const task=(queues.get(actor.uuid)??Promise.resolve()).catch(()=>{}).then(work);
  queues.set(actor.uuid,task);
  return task.finally(()=>{if(queues.get(actor.uuid)===task)queues.delete(actor.uuid);});
};
const selectedSource=actor=>{
  const choices=[...game.user.targets].filter(token=>token.actor&&token.actor.uuid!==actor.uuid);
  return choices.length===1?choices[0].actor.uuid:null;
};
export async function applyCondition(actor,id,{seconds=null,sourceActor=selectedSource(actor),sourceItemUuid=null,sourceName=null,context={},start=game.time.worldTime,receipt=null}={}) {
  if(!actor?.isOwner||!CONDITION_NAMES[id])throw new Error("状态或角色编辑权限无效。");
  if(seconds!==null&&(!Number.isFinite(seconds)||seconds<=0))throw new Error("状态持续时间必须为正数，或留空表示没有记录结束时间。");
  if(!Number.isFinite(start))throw new Error("状态的开始时间无效。");
  if(seconds!==null&&start+seconds<=game.time.worldTime)return null;
  if(sourceItemUuid) {
    const source=await fromUuid(sourceItemUuid).catch(()=>null);
    if(!source)throw new Error("找不到状态的法术或能力来源。");
    sourceActor=source.actor?.uuid??sourceActor;sourceName??=source.name;
  }
  const immunity=actor.system.traits.ci?.value??[],alias={blind:"blind",dazzled:"dazzle",deaf:"deaf",fatigued:"fatigue",exhausted:"fatigue",sickened:"sicken",paralyzed:"paralyze",petrified:"petrify",stunned:"stun",confused:"confuse",dazed:"daze"};
  if(immunity.includes(alias[id])||["fear","shaken","frightened","panicked","cowering"].includes(id)&&immunity.includes("fear")||context.mindAffecting&&immunity.includes("mindAffecting"))throw new Error(`${actor.name}免疫这项状态来源。`);
  if(id==="fear")id=["shaken","frightened","panicked"].includes(context.severity)?context.severity:"shaken";
  if(id==="turned"&&seconds===null)seconds=60;
  if(id==="fatigued"&&context.fatiguingActivity&&conditionState(actor).fatigued)id="exhausted";
  if(["polymorphed","wildshaped"].includes(id)&&!context.formUuid)throw new Error("请先选择原生变形条目，并在状态来源中记录其UUID；状态图标不能替代形态。");
  if(context.formUuid) {
    const form=await fromUuid(context.formUuid).catch(()=>null);
    if(form?.type!=="buff"||form.actor?.uuid!==actor.uuid||form.system.buffType!=="shapechange")throw new Error("请使用这个角色自身的原生变形增益条目UUID。");
    if(!form.system.active)await form.update({"system.active":true});
    if(["polymorphed","wildshaped"].includes(id)) {
      await form.update({[`flags.${MODULE_ID}.nativeConditions`]:[...new Set([...(form.getFlag(MODULE_ID,"nativeConditions")??[]),id])],
        [`flags.${MODULE_ID}.conditionContext`]:context,[`flags.${MODULE_ID}.sourceActor`]:sourceActor,[`flags.${MODULE_ID}.sourceItemUuid`]:sourceItemUuid,
        ...(seconds===null?{}:{[`flags.${MODULE_ID}.expiresAt`]:start+seconds,[`flags.${MODULE_ID}.nativeTimerVersion`]:1,
          "system.timeline.enabled":true,"system.timeline.total":(start+seconds-game.time.worldTime)/6,"system.timeline.elapsed":0,
          "system.timeline.deleteOnExpiry":false,["flags.d35e-world-timeline.timer"]:{start,seconds,end:start+seconds}})});
      await syncNativeConditions(actor);return form;
    }
  }
  const end=seconds===null?null:start+seconds;
  if(end!==null&&end<=game.time.worldTime)return null;
  const rule=conditionRule(id),duration=end===null?null:(end-game.time.worldTime)/6;
  const data={name:conditionName(id),type:"buff",img:rule?.img??"icons/svg/aura.svg",
    system:{active:true,buffType:"temp",changes:[],hideFromToken:true,description:{value:rule?.description??`<p>${conditionName(id)}</p>`},
      timeline:{enabled:duration!==null,total:duration??0,elapsed:0,formula:duration===null?"":String(duration),deleteOnExpiry:duration!==null}},
    flags:{[MODULE_ID]:{key:`condition-${id}`,nativeConditions:[id],conditionEffect:id,conditionEffects:[id],conditionPresentationRevision:1,
      sourceActor,sourceItemUuid,conditionReceipt:receipt,sourceName:sourceName??conditionName(id),conditionContext:{...context,
        ...(id==="grappled"||id==="pinned"?{participants:context.participants??[sourceActor].filter(Boolean)}:{})},nativeTimerVersion:1,
      ...(end===null?{}:{expiresAt:end})},...(end===null?{}:{"d35e-world-timeline":{timer:{start,seconds,end}}})}};
  return actorQueue(actor,async()=>{
    if(receipt){const previous=actor.items.find(item=>item.getFlag(MODULE_ID,"conditionReceipt")===receipt);if(previous)return previous;}
    const [item]=await actor.createEmbeddedDocuments("Item",[data]);
    await syncNativeConditions(actor);await syncConditionMarkers(actor);await actor.refresh();
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(actor.name)}进入<strong>${esc(conditionName(id))}</strong>状态${sourceName?`，来源：${esc(sourceName)}`:""}。</p>`});
    return item;
  });
}
export async function clearCondition(actor,id) {
  if(!actor?.isOwner)throw new Error("没有角色编辑权限。");
  return actorQueue(actor,async()=>{
    const updates=actor.items.filter(item=>item.getFlag(MODULE_ID,"nativeConditions")?.includes(id)).map(item=>{
      const remaining=item.getFlag(MODULE_ID,"nativeConditions").filter(value=>value!==id);
      return {_id:item.id,[`flags.${MODULE_ID}.nativeConditions`]:remaining,
        ...(!remaining.length&&(!item.system.changes?.length||["polymorphed","wildshaped"].includes(id)&&item.system.buffType==="shapechange")?{"system.active":false}:{})};
    });
    if(updates.length)await actor.updateEmbeddedDocuments("Item",updates);
    const effects=actor.effects.filter(effect=>effect.statuses?.has(id));
    if(effects.length)await actor.deleteEmbeddedDocuments("ActiveEffect",effects.map(effect=>effect.id));
    const native=Object.hasOwn(actor.system.attributes.conditions,id);
    await actor.update({[native?`system.attributes.conditions.${id}`:`flags.${MODULE_ID}.conditions.${id}`]:false});
    await syncNativeConditions(actor);await syncConditionMarkers(actor);await actor.refresh();
  });
}
export async function syncConditionMarkers(actor) {
  if(game.users.activeGM!==game.user||!actor?.isOwner)return;
  const c=conditionState(actor),existing=actor.effects.filter(effect=>effect.getFlag(MODULE_ID,"conditionMarker"));
  const active=Object.keys(CONDITION_NAMES).filter(id=>c[id]&&!CONFIG.D35E.conditions[id]);
  const old=existing.filter(effect=>!active.includes(effect.getFlag(MODULE_ID,"conditionMarker")));
  if(old.length)await actor.deleteEmbeddedDocuments("ActiveEffect",old.map(effect=>effect.id),{threeRConditionMarker:true});
  const needed=active.filter(id=>!actor.effects.some(effect=>!effect.disabled&&effect.statuses?.has(id)));
  if(needed.length)await actor.createEmbeddedDocuments("ActiveEffect",needed.map(id=>({name:conditionName(id),img:conditionRule(id)?.img??"icons/svg/aura.svg",
    statuses:[id],changes:[],flags:{[MODULE_ID]:{conditionMarker:id}}})),{threeRConditionMarker:true});
}
export async function editConditionContext(actor,id=null) {
  actor??=canvas.tokens.controlled[0]?.actor??game.user.character;
  if(!actor?.isOwner)throw new Error("请选中可以编辑的角色。");
  const c=conditionState(actor),saved=id?conditionContext(actor,id):{};
  if(!id) {
    const selected=await foundry.applications.api.DialogV2.wait({window:{title:`${actor.name}：选择状态`},rejectClose:false,
      content:`<form><select name="state">${Object.entries(CONDITION_NAMES).map(([key,name])=>`<option value="${key}">${esc(name)}${c[key]?"（已激活）":""}</option>`).join("")}</select></form>`,
      buttons:[{action:"select",label:"查看",callback:(event,button,dialog)=>dialog.element.querySelector('[name="state"]').value}]});
    if(selected)return editConditionContext(actor,selected);return;
  }
  const candidates=canvas.tokens.placeables.filter(token=>token.actor&&token.actor.uuid!==actor.uuid&&token.actor.testUserPermission(game.user,"OBSERVER"));
  const defaults=[...game.user.targets].filter(token=>candidates.includes(token));
  const source=saved.sourceActors?.[0]??(defaults.length===1?defaults[0].actor.uuid:"");
  const options=Object.entries(CONDITION_NAMES).map(([key,name])=>`<option value="${key}" ${key===id?"selected":""}>${esc(name)}${c[key]?"（已激活）":""}</option>`).join("");
  const sources=candidates.map(token=>`<option value="${esc(token.actor.uuid)}" ${token.actor.uuid===source?"selected":""}>${esc(token.name)}</option>`).join("");
  const answer=await foundry.applications.api.DialogV2.wait({window:{title:`${actor.name}：状态与来源`},rejectClose:false,
    content:`<form><label>状态<select name="condition" disabled>${options}</select></label><label>来源／擒抱对手<select name="source"><option value="">未指定</option>${sources}</select></label>
      <label>持续秒数（留空为未记录）<input name="seconds" type="number" min="1"></label>
      <label>法术／能力来源UUID<input name="sourceItemUuid" value="${esc(saved.sourceItemUuid??"")}"></label>
      <label>恐惧程度<select name="fear">${["shaken","frightened","panicked"].map(degree=>`<option value="${degree}" ${degree===(saved.severity??id)?"selected":""}>${conditionName(degree)}</option>`).join("")}</select></label>
      <label><input name="pinnedSpeech" type="checkbox" ${saved.preventSpeech?"checked":""}>压制者阻止说话</label>
      <label><input name="aided" type="checkbox" ${saved.aided?"checked":""}>已接受急救／照护</label>
      <label><input name="mental" type="checkbox" ${saved.allowMental?"checked":""}>此次无助来源允许纯粹的心理活动</label>
      <label><input name="cornered" type="checkbox" ${saved.cornered?"checked":""}>无法逃离／被逼至绝路</label>
      <label><input name="materialReady" type="checkbox" ${saved.materialReady?"checked":""}>擒抱前已拿好施法材料／器材</label>
      <label><input name="breakOnAttack" type="checkbox" ${saved.breakOnAttack?"checked":""}>此隐形效果在攻击后结束</label>
      <label>原生形态条目UUID<input name="formUuid" value="${esc(saved.formUuid??"")}"></label>
      <label>来源豁免DC<input name="saveDC" type="number" min="1" value="${esc(saved.saveDC??"")}"></label>
      <label>来源豁免<select name="save"><option value="will">意志</option><option value="fort" ${saved.save==="fort"?"selected":""}>强韧</option><option value="ref" ${saved.save==="ref"?"selected":""}>反射</option></select></label>
      <label><input name="criticalImmune" type="checkbox" ${saved.criticalImmune?"checked":""}>无助目标免疫重击</label>
      <label><input name="anchored" type="checkbox" ${saved.anchored?"checked":""}>纠缠固定在物体上</label>
      <label><input name="wingFlight" type="checkbox" ${saved.wingFlight?"checked":""}>正在依靠翅膀飞行</label>
      <label>地面高度（麻痹坠落时使用）<input name="groundElevation" type="number" value="${esc(saved.groundElevation??"")}"></label>
      <p>在能力详情的“状态下的使用方式”中，可标明纯粹的心理活动、帮助逃离或需要持续专注。</p></form>`,
    buttons:[{action:"apply",label:"施加",callback:(event,button,dialog)=>read(dialog,"apply")},
      {action:"context",label:"保存来源",callback:(event,button,dialog)=>read(dialog,"context")},
      {action:"clear",label:"解除",callback:(event,button,dialog)=>read(dialog,"clear")},
      ...(["grappled","pinned"].includes(id)?[{action:"escape",label:"擒抱检定挣脱",callback:()=>({action:"operation",operation:"escape"})},
        {action:"escapeSkill",label:"脱逃术挣脱",callback:()=>({action:"operation",operation:"escape",skill:true})}]:[]),
      ...(id==="confused"?[{action:"confusion",label:"结算本回合",callback:()=>({action:"operation",operation:"confusion"})}]:[]),
      ...(id==="dead"?[{action:"resurrection",label:"记录复活结果",callback:()=>({action:"operation",operation:"resurrection"})}]:[]),
      ...(saved.repeatSaveAtTurn?[{action:"retrySave",label:"继续本回合豁免",callback:()=>({action:"retrySave"})}]:[]),
      ...(id==="exhausted"?[{action:"rest",label:"完全休息一小时",callback:()=>({action:"operation",operation:"short-rest"})}]:[])]
  });
  if(!answer)return;
  if(answer.action==="retrySave"){for(const item of actor.items.filter(item=>item.system.active&&item.getFlag(MODULE_ID,"nativeConditions")?.includes(id)&&item.getFlag(MODULE_ID,"conditionContext")?.repeatSaveAtTurn))await item.unsetFlag(MODULE_ID,"repeatSaveTurn");return;}
  if(answer.action==="operation")return (await import("./condition-actions.js")).conditionOperation(actor,answer.operation,{skill:answer.skill});
  const state=answer.id=== "fear"?answer.fear:answer.id;
  if(answer.action==="clear")return clearCondition(actor,answer.id);
  let sourceActor=answer.source||null;
  if(answer.sourceItemUuid){const item=await fromUuid(answer.sourceItemUuid).catch(()=>null);if(!item)throw new Error("找不到法术或能力来源。");sourceActor=item.actor?.uuid??sourceActor;}
  const context={...saved,sourceItemUuid:answer.sourceItemUuid||null,sourceActor,participants:sourceActor?[sourceActor]:[],
    preventSpeech:answer.pinnedSpeech,aided:answer.aided,allowMental:answer.mental,severity:answer.fear,
    cornered:answer.cornered,materialReady:answer.materialReady,breakOnAttack:answer.breakOnAttack,formUuid:answer.formUuid||null,
    saveDC:answer.saveDC,save:answer.save,criticalImmune:answer.criticalImmune,anchored:answer.anchored,wingFlight:answer.wingFlight,groundElevation:answer.groundElevation};
  if(answer.action==="context")return actor.setFlag(MODULE_ID,"conditionContext",{...actor.getFlag(MODULE_ID,"conditionContext"),[answer.id]:context});
  return applyCondition(actor,state,{sourceActor,sourceItemUuid:answer.sourceItemUuid||null,seconds:answer.seconds,context});
}
function read(dialog,action) {
  const form=dialog.element.querySelector("form"),value=name=>form.elements[name].value;
  return {action,id:value("condition"),source:value("source"),sourceItemUuid:value("sourceItemUuid").trim(),seconds:value("seconds")===""?null:Number(value("seconds")),fear:value("fear"),
    pinnedSpeech:form.elements.pinnedSpeech.checked,aided:form.elements.aided.checked,mental:form.elements.mental.checked,
    cornered:form.elements.cornered.checked,materialReady:form.elements.materialReady.checked,breakOnAttack:form.elements.breakOnAttack.checked,formUuid:value("formUuid").trim(),
    saveDC:value("saveDC")===""?null:Number(value("saveDC")),save:value("save"),criticalImmune:form.elements.criticalImmune.checked,
    anchored:form.elements.anchored.checked,wingFlight:form.elements.wingFlight.checked,groundElevation:value("groundElevation")===""?null:Number(value("groundElevation"))};
}
