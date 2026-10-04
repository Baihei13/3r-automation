import { MODULE_ID } from "./catalog.js";
import { conditionState, conditionContext, conditionName } from "./condition-state.js";
import { clearCondition, syncConditionMarkers } from "./condition-tools.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { effectIsActive } from "./effect-state.js";
import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";
import { syncNativeConditions } from "./native-conditions.js";

const gm=()=>game.users.activeGM===game.user;
const esc=text=>foundry.utils.escapeHTML(String(text??""));
const report=error=>{console.error(MODULE_ID,error);ui.notifications.error(`状态结算：${error.message}`);};
const post=(actor,text)=>ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(text)}</p>`});
const queues=new Map();
const queue=(actor,work)=>{const next=(queues.get(actor.uuid)??Promise.resolve()).catch(report).then(work);queues.set(actor.uuid,next);return next.finally(()=>{if(queues.get(actor.uuid)===next)queues.delete(actor.uuid);});};
export async function resolveConfusionTurn(actor) {
  if(!actor?.isOwner||!conditionState(actor).confused)return;
  const combat=game.combat;
  if(!combat?.started)throw new Error("困惑行为按战斗回合结算，请先开始战斗。");
  const key=`${combat.id}:${combat.round}:${combat.turn}`;
  if(actor.getFlag(MODULE_ID,"confusionTurn")?.key===key)return actor.getFlag(MODULE_ID,"confusionTurn");
  let mode,target,die=null;
  const attacked=actor.getFlag(MODULE_ID,"confusionAttacker");
  if(attacked?.combat===combat.id&&attacked.round>=combat.round-1) {mode="attack";target=attacked.actor;}
  else {
    const roll=await new Roll35e("1d100").roll();die=roll.total;
    await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:"困惑：本回合行为"});
    mode=die<=10?"attack":die<=20?"normal":die<=50?"babble":die<=70?"flee":"attack";
    if(die<=10||mode==="flee")target=conditionContext(actor,"confused").sourceActors[0];
    if(die>=71) {
      const own=canvas.tokens.placeables.find(token=>token.actor?.uuid===actor.uuid);
      const near=own?canvas.tokens.placeables.filter(token=>token.actor&&token.actor.uuid!==actor.uuid&&token.visible)
        .sort((a,b)=>canvas.grid.measurePath([own.center,a.center]).distance-canvas.grid.measurePath([own.center,b.center]).distance)[0]:null;
      target=near?.actor.uuid;
    }
  }
  if(["attack","flee"].includes(mode)&&!target)mode="babble";
  const record={key,combat:combat.id,mode,target:target??null,die};await actor.setFlag(MODULE_ID,"confusionTurn",record);
  const targetActor=target?await fromUuid(target).catch(()=>null):null;
  await post(actor,`困惑：${{normal:"正常行动",babble:"语无伦次",attack:`攻击${targetActor?.name??"指定目标"}`,flee:`逃离${targetActor?.name??"施法者"}`}[mode]}。`);
  return record;
}
export async function conditionAttackConsequences(actor,target) {
  if(!actor?.isOwner)return;
  // Only a known ordinary invisibility effect is broken. Greater invisibility
  // and unclassified abilities must keep their explicit source behavior.
  const breakItems=actor.items.filter(item=>effectIsActive(item)&&item.getFlag(MODULE_ID,"nativeConditions")?.includes("invisible")&&item.getFlag(MODULE_ID,"conditionContext")?.breakOnAttack===true);
  if(breakItems.length)await actor.updateEmbeddedDocuments("Item",breakItems.map(item=>({_id:item.id,"system.active":false})));
  if(conditionContext(actor,"invisible").breakOnAttack&&conditionState(actor).invisible)await clearCondition(actor,"invisible");
  if(!gm()||!target)return;
  if(conditionState(target).fascinated)await clearCondition(target,"fascinated");
  if(conditionState(target).confused)await target.setFlag(MODULE_ID,"confusionAttacker",{actor:actor.uuid,combat:game.combat?.id,round:game.combat?.round??0});
}
export async function dropHeldItems(actor) {
  const explicit=actor.getFlag(MODULE_ID,"heldItems"),held=[...new Set([...(explicit??[]),...actor.items.filter(item=>item.type==="weapon"&&item.system.equipped&&item.system.weaponType!=="natural"&&!item.system.melded).map(item=>item.id)])];
  const items=held.map(id=>actor.items.get(id)).filter(item=>item&&["weapon","equipment","loot","consumable"].includes(item.type)&&item.system.carried!==false&&!item.system.melded);
  if(!items.length)return;
  const token=actor.getActiveTokens()[0];
  await actor.updateEmbeddedDocuments("Item",items.map(item=>({_id:item.id,"system.equipped":false,"system.carried":false,
    [`flags.${MODULE_ID}.dropped`]:{scene:token?.scene?.id??canvas.scene?.id,x:token?.x,y:token?.y,at:game.time.worldTime}})));
  await actor.setFlag(MODULE_ID,"heldItems",[]);
  await post(actor,`${actor.name}掉落了${items.map(item=>item.name).join("、")}。`);
}
async function observe(actor) {
  if(!gm()||!actor.isOwner)return;
  const c=conditionState(actor),old=actor.getFlag(MODULE_ID,"conditionObserved")??{};
  for(const id of ["stunned","panicked"])if(c[id]&&!old[id])await dropHeldItems(actor);
  if(["dead","dying","unconscious","stunned","dazed","nauseated","petrified"].some(id=>c[id]&&!old[id])) {
    const concentration=actor.items.filter(item=>effectIsActive(item)&&(item.getFlag(MODULE_ID,"requiresConcentration")||["city-concentration","card-effect-ears-of-the-city"].includes(item.getFlag(MODULE_ID,"key"))));
    if(concentration.length)await actor.updateEmbeddedDocuments("Item",concentration.map(item=>({_id:item.id,"system.active":false})));
  }
  const active=Object.fromEntries(Object.keys(c).filter(id=>c[id]).map(id=>[id,true]));
  // Capture current targets for a manually applied condition as well as spells.
  const defaults=Object.keys(active).filter(id=>!old[id]&&["grappled","pinned","fear","frightened","panicked","turned","confused","fascinated"].includes(id));
  const selected=[...game.user.targets].filter(token=>token.actor&&token.actor.uuid!==actor.uuid);
  if(selected.length===1&&defaults.some(id=>!conditionContext(actor,id).sourceActors.length)) {
    const context={...actor.getFlag(MODULE_ID,"conditionContext")};
    for(const id of defaults)if(!conditionContext(actor,id).sourceActors.length)context[id]={...context[id],sourceActor:selected[0].actor.uuid,
      ...(["grappled","pinned"].includes(id)?{participants:[selected[0].actor.uuid]}:{})};
    await actor.setFlag(MODULE_ID,"conditionContext",context);
  }
  if(JSON.stringify(active)!==JSON.stringify(old))await actor.setFlag(MODULE_ID,"conditionObserved",active);
  if(c.paralyzed&&!old.paralyzed) {
    const context=conditionContext(actor,"paralyzed"),token=actor.getActiveTokens()[0];
    if(token&&(context.wingFlight||actor.getFlag(MODULE_ID,"movementMode")==="fly")&&Number.isFinite(context.groundElevation)&&token.document.elevation>context.groundElevation) {
      const feet=/^(m|meter|meters|米|公尺)$/i.test(canvas.scene.grid.units)?(token.document.elevation-context.groundElevation)/0.3048:token.document.elevation-context.groundElevation;
      const dice=Math.min(20,Math.floor(feet/10));
      await token.document.update({elevation:context.groundElevation},{threeRForcedMovement:true});
      if(dice>0) {
        const damage=await new Roll35e(`${dice}d6`).roll();await damage.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:"麻痹：坠落伤害"});
        await ActorDamageHelper.applyDamage(null,0,0,false,false,false,false,damage.total,[],null,{},0,false,true,actor);
      }
      await actor.update({"system.attributes.conditions.prone":true});
    }
  }
  await syncConditionMarkers(actor);
  if(c.confused&&game.combat?.started&&game.combat.combatant?.actor?.uuid===actor.uuid)await resolveConfusionTurn(actor);
  if(game.combat?.started&&game.combat.combatant?.actor?.uuid===actor.uuid) {
    const turn=`${game.combat.id}:${game.combat.round}:${game.combat.turn}`;
    for(const item of actor.items.filter(effectIsActive)) {
      const context=item.getFlag(MODULE_ID,"conditionContext");
      if(!context?.repeatSaveAtTurn||context.createdTurn===turn||item.getFlag(MODULE_ID,"repeatSaveTurn")===turn)continue;
      const dc=Number(context.saveDC);if(!Number.isFinite(dc)||dc<=0)continue;
      const bonus=Number(context.repeatSavePenalty)||0;
      let temporary=null;
      try {
        // Record the attempt before the dialog: cancellation must not reopen it
        // in response to the temporary buff's creation/deletion hooks.
        await item.setFlag(MODULE_ID,"repeatSaveTurn",turn);
        if(bonus)[temporary]=await actor.createEmbeddedDocuments("Item",[{name:"严加斥责：信奉同一神祇",type:"buff",system:{active:true,buffType:"misc",changes:[[String(bonus),"savingThrows",context.save??"will","penalty"]]},flags:{[MODULE_ID]:{key:"castigate-same-god"}}}]);
        const value=await actor.rollSavingThrow(context.save??"will",null,dc),result=Array.isArray(value)?value.find(row=>Number.isFinite(row?.total)):value;
        if(!result)continue;
        const natural=result.dice?.find(term=>term.faces===20)?.results?.find(row=>row.active!==false)?.result;
        if(natural===20||natural!==1&&result.total>=dc) {await item.update({"system.active":false});await syncNativeConditions(actor);}
      }finally{if(temporary&&actor.items.has(temporary.id))await temporary.delete();}
    }
  }
}
export function installConditionTurns() {
  const actors=new Map([...game.actors,...game.scenes.contents.flatMap(scene=>scene.tokens.contents.filter(token=>!token.actorLink).map(token=>token.actor).filter(Boolean))].map(actor=>[actor.uuid,actor]));
  if(gm())for(const actor of actors.values())if(!actor.getFlag(MODULE_ID,"conditionObserved")) {
    const c=conditionState(actor);actor.setFlag(MODULE_ID,"conditionObserved",Object.fromEntries(Object.keys(c).filter(id=>c[id]).map(id=>[id,true]))).catch(report);
  }
  Hooks.on("updateCombat",combat=>{
    if(gm()&&combat.started&&combat.combatant?.actor)queue(combat.combatant.actor,()=>observe(combat.combatant.actor)).catch(report);
  });
  Hooks.on("createChatMessage",message=>{
    if(!gm()||message.flags?.D35E?.template!=="systems/D35E/templates/chat/attack-roll.html")return;
    const data=message.flags.D35E.chatTemplateData;
    if(!data?.attacks?.some(attack=>attack.hasAttack))return;
    const scene=game.scenes.get(message.speaker.scene??canvas.scene?.id),actor=scene?.tokens.get(message.speaker.token)?.actor??game.actors.get(message.speaker.actor);
    if(!actor)return;
    for(const ref of data.targets??[]) {
      const target=scene?.tokens.get(ref.id)?.actor;
      if(target)conditionAttackConsequences(actor,target).catch(report);
    }
  });
  const affected=(actor,change)=>{
    if(!gm()||!actor)return;
    if(change&&Object.keys(change).length&&Object.keys(change).every(key=>key.includes("conditionObserved")||key.includes("conditionMarker")||key.includes("confusionTurn")))return;
    queue(actor,()=>observe(actor)).catch(report);
  };
  Hooks.on("updateActor",(actor,change)=>affected(actor,change));
  for(const event of ["createItem","updateItem","deleteItem"])Hooks.on(event,item=>{if(item.actor&&(item.type==="buff"||item.type==="aura"))affected(item.actor);});
  for(const event of ["createActiveEffect","updateActiveEffect","deleteActiveEffect"])Hooks.on(event,(effect,change,options)=>{
    if(!effect.getFlag(MODULE_ID,"conditionMarker")&&effect.parent?.documentName==="Actor")affected(effect.parent);
  });
}
