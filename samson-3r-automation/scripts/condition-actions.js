import { MODULE_ID } from "./catalog.js";
import { conditionState, conditionContext, conditionActionRestriction } from "./condition-state.js";
import { clearCondition, applyCondition } from "./condition-tools.js";
import { stabilizeCondition, completeConditionRest } from "./condition-vitals.js";
import { resolveConfusionTurn } from "./condition-turns.js";
import { commitConditionAction } from "./condition-runtime.js";
import { ItemRolls } from "../../../systems/D35E/module/item/extensions/rolls.js";
import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";

const esc=text=>foundry.utils.escapeHTML(String(text??""));
const roll=value=>Array.isArray(value)?value.find(row=>Number.isFinite(row?.total)):value;
const passed=(result,dc)=>{const die=result?.dice?.find(term=>term.faces===20)?.results?.find(row=>row.active!==false)?.result;return die===20||die!==1&&result.total>=dc;};
const targetActor=async(actor,uuid)=>{if(uuid)return fromUuid(uuid);const targets=[...game.user.targets].filter(token=>token.actor&&token.actor.uuid!==actor.uuid);return targets.length===1?targets[0].actor:null;};
export async function conditionOperation(actor,operation,{targetUuid=null,skill=false,itemId=null}={}) {
  if(!actor?.isOwner)throw new Error("请选择有操纵权限的角色。");
  if(operation==="resurrection"){
    if(game.users.activeGM!==game.user)throw new Error("请由在线DM记录实际复活效果。");
    if(!conditionState(actor).dead)throw new Error("角色没有处于死亡状态。");
    if(Number(actor.system.abilities.con.total)===0&&!['undead','construct'].includes(actor.system.attributes.creatureType))throw new Error("请先按实际复活效果恢复体质，体质仍为0时无法复活。");
    const hp=await foundry.applications.api.DialogV2.wait({window:{title:"复活后的生命"},rejectClose:false,
      content:'<p>先结算实际复活法术的资格、材料、等级损失等效果，再填写它恢复的生命值。</p><form><input name="hp" type="number" min="1" required></form>',
      buttons:[{action:"record",label:"记录",callback:(event,button,dialog)=>Number(dialog.element.querySelector('[name="hp"]').value)}]});
    if(hp===null)return false;
    if(!Number.isFinite(hp)||hp<=0||hp>Number(actor.system.attributes.hp.max))throw new Error("请填写不超过生命上限的实际复活生命值。");
    await clearCondition(actor,"dead");
    await actor.update({"system.attributes.hp.value":hp,"system.attributes.conditions.dead":false,
      "system.attributes.conditions.dying":false,"system.attributes.conditions.stable":false,"system.attributes.conditions.disabled":false,
      ...(!actor.items.some(item=>item.system.active&&item.getFlag(MODULE_ID,"nativeConditions")?.includes("unconscious"))?{"system.attributes.conditions.unconscious":false}:{})},
      {threeRResurrection:true});
    return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(actor.name)}复活后恢复${hp}点生命。</p>`});
  }
  if(operation==="confusion")return resolveConfusionTurn(actor);
  if(operation==="short-rest") {
    if(game.users.activeGM!==game.user)throw new Error("休息与世界时间由在线DM处理。");
    const reason=conditionActionRestriction(actor,null,{kind:"none"});if(reason)throw new Error(reason);
    const accepted=await foundry.applications.api.DialogV2.confirm({window:{title:"完全休息一小时"},content:"<p>推进世界时间一小时并结算力竭恢复？期间伤势和其他计时效果仍会结算。</p>"});
    if(!accepted)return false;
    await game.time.advance(3600);await completeConditionRest(actor,3600);return true;
  }
  if(operation==="escape") {
    const c=conditionState(actor),id=c.pinned?"pinned":"grappled";
    if(!c[id])throw new Error("角色没有受到擒抱或压制。");
    const kind=skill?"full":"standard",reason=conditionActionRestriction(actor,null,{kind,common:"escape-grapple"});if(reason)throw new Error(reason);
    const context=conditionContext(actor,id),partners=context.participants?.length?context.participants:context.sourceActors;
    if(!partners.length)throw new Error("请先记录擒抱对手。");
    const enemies=await Promise.all(partners.map(uuid=>fromUuid(uuid)));
    if(enemies.some(enemy=>!enemy?.isOwner))throw new Error("请由能操纵全部擒抱参与者的DM结算对抗。");
    const check=()=>skill?actor.rollSkill("esc"):actor.rollGrapple();
    let result=roll(await check());if(!result)return false;
    let success=true;
    for(const enemy of enemies) {
      let defense=roll(await enemy.rollGrapple());if(!defense)return false;
      const mine=skill?Number(actor.system.skills.esc?.mod)||0:Number(actor.system.attributes.cmb.total)||0;
      const theirs=Number(enemy.system.attributes.cmb.total)||0;
      while(result.total===defense.total&&mine===theirs){result=roll(await check());defense=roll(await enemy.rollGrapple());if(!result||!defense)return false;}
      if(result.total<defense.total||result.total===defense.total&&mine<theirs)success=false;
    }
    await commitConditionAction(actor,kind);
    if(success) {
      await clearCondition(actor,id);
      if(id==="grappled")for(const enemy of enemies) {
        const partner=conditionContext(enemy,"grappled"),remaining=(partner.participants?.length?partner.participants:partner.sourceActors).filter(uuid=>uuid!==actor.uuid);
        if(!remaining.length)await clearCondition(enemy,"grappled");
        else await enemy.setFlag(MODULE_ID,"conditionContext",{...enemy.getFlag(MODULE_ID,"conditionContext"),grappled:{...conditionContext(enemy,"grappled"),participants:remaining}});
      }
    }
    return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>挣脱${id==="pinned"?"压制":"擒抱"}：${success?"成功":"失败"}。</p>`});
  }
  const target=await targetActor(actor,targetUuid);
  if(!target?.isOwner)throw new Error("请指定一个可编辑的目标；其他人的单位由DM结算。");
  const kind=operation==="coup"?"full":"standard",reason=conditionActionRestriction(actor,null,{kind});if(reason)throw new Error(reason);
  if(["aid","wake"].includes(operation)){
    const source=actor.getActiveTokens()[0],dest=target.getActiveTokens()[0],scale=/^(m|meter|meters|米|公尺)$/i.test(canvas.scene.grid.units)?0.3048:1;
    if(!source||!dest||source.scene?.id!==dest.scene?.id||canvas.grid.measurePath([source.center,dest.center]).distance>5*scale+1e-6)throw new Error("请先贴近目标。");
  }
  if(operation==="aid") {
    const result=roll(await actor.rollSkill("hea",{target:15}));if(!result)return false;
    await commitConditionAction(actor,kind);
    return result.total>=15?stabilizeCondition(target,{aided:true}):false;
  }
  if(operation==="wake") {
    if(!conditionState(target).fascinated)throw new Error("目标没有受到迷魂。");
    await clearCondition(target,"fascinated");await commitConditionAction(actor,kind);return true;
  }
  if(operation==="threat") {
    const context=conditionContext(target,"fascinated");
    if(!conditionState(target).fascinated||!Number.isFinite(Number(context.saveDC))||Number(context.saveDC)<=0)throw new Error("迷魂的来源没有记录豁免DC，请在来源中补齐。");
    const result=roll(await target.rollSavingThrow(context.save??"will",null,Number(context.saveDC)));if(!result)return false;
    if(passed(result,Number(context.saveDC)))await clearCondition(target,"fascinated");return true;
  }
  if(operation==="coup") {
    if(!conditionState(target).helpless)throw new Error("致命一击只能针对无助目标。");
    let attack=actor.items.get(itemId);
    if(!attack) {
      const attacks=actor.items.filter(item=>item.type==="attack"&&item.hasDamage&&["mwak","rwak"].includes(item.system.actionType));
      const id=await foundry.applications.api.DialogV2.wait({window:{title:"致命一击：选择武器"},rejectClose:false,
        content:"<p>近战武器可用；弓或弩须贴近目标。这个动作引发借机攻击。</p>",buttons:attacks.map(item=>({action:item.id,label:esc(item.name),callback:()=>item.id}))});
      attack=actor.items.get(id);
    }
    if(!attack)return false;
    const weapon=actor.items.get(attack.system.originalWeaponId)??attack;
    if(attack.system.actionType==="rwak"&&!/bow|crossbow|弓|弩/i.test(`${weapon.system.baseWeaponType??""} ${weapon.name}`))throw new Error("远程致命一击只能使用贴近目标的弓或弩。");
    const source=actor.getActiveTokens()[0],dest=target.getActiveTokens()[0];
    if(!source||!dest||source.scene?.id!==dest.scene?.id)throw new Error("请先将双方放到当前场景，确认致命一击距离。");
    const scale=/^(m|meter|meters|米|公尺)$/i.test(canvas.scene.grid.units)?0.3048:1;
    if(canvas.grid.measurePath([source.center,dest.center]).distance>5*scale+1e-6)throw new Error("请先贴近无助目标。");
    const immune=conditionContext(target,"helpless").criticalImmune===true||Number(target.system.attributes.fortification?.total)>=100||/^(construct|undead|ooze|plant|elemental)$/i.test(target.system.attributes.creatureType??"");
    const rows=await new ItemRolls(attack).rollDamage({critical:!immune});
    for(const row of rows)await row.roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`致命一击：${attack.name}`});
    const damage=ActorDamageHelper.calculateDamageToActor(target,rows,attack.system.material,attack.system.alignment,Number(attack.system.enh)||0,false,immune,false,false);
    const dc=10+Math.max(0,Number(damage.damage)||0);
    let save=null;if(!immune) {save=roll(await target.rollSavingThrow("fort",null,dc));if(!save)return false;}
    if(damage.damagePoolPossibleReductionsUpdate)await target.updateDamageReductionPoolItems(damage.damagePoolPossibleReductionsUpdate);
    const hp=target.system.attributes.hp,temp=Number(hp.temp)||0,amount=Math.max(0,Number(damage.damage)||0),dies=!immune&&!passed(save,dc);
    await target.update({"system.attributes.hp.temp":Math.max(0,temp-amount),"system.attributes.hp.value":Number(hp.value)-Math.max(0,amount-temp),
      "system.attributes.hp.nonlethal":(Number(hp.nonlethal)||0)+(Number(damage.nonLethalDamage)||0),...(dies?{"system.attributes.conditions.dead":true}:{} )});
    await commitConditionAction(actor,"full");
    return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>致命一击 → ${esc(target.name)}：伤害${amount}；${immune?"免疫重击，无需此次免死豁免":`强韧DC${dc}，${dies?"失败，死亡":"成功"}`}。此动作引发借机攻击。</p>`});
  }
  throw new Error("未知的状态操作。");
}
