import { MODULE_ID } from "./catalog.js";
import { timedBuff, replaceTimedBuff, spellResistanceValue, choose } from "./rules-bridge.js";
import { applyCondition, actorQueue } from "./condition-tools.js";
import { effectIsActive } from "./effect-state.js";
import { consumeSpellComponents } from "./spell-components.js";
import { sameDeity } from "./condition-spells.js";
import { conditionState, conditionName } from "./condition-state.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { ActorDamageHelper } from "../../../systems/D35E/module/actor/helpers/actorDamageHelper.js";
import { nativeHitCheck } from "./native-hit.js";
import { conditionActorLive } from "./condition-jobs.js";

const mark=item=>item?.flags?.[MODULE_ID]??{};
// Repair only our exact old execution hint; rules and custom notes stay intact.
const executionNote=(id,note)=>id==="nightshield"&&note==="自身全部豁免＋1至＋3抗力；魔法飞弹免疫由DM确认"
  ?"自身全部豁免＋1至＋3抗力；自动阻止有可靠来源的原生魔法飞弹伤害。第三方直接扣HP尚未覆盖。":note;
const esc=value=>foundry.utils.escapeHTML(String(value??""));
const rollOf=value=>Array.isArray(value)?value.find(row=>Number.isFinite(row?.total)):value;
const passed=(value,dc,skill=false)=>{
  const roll=rollOf(value),die=roll?.dice?.find(term=>term.faces===20)?.results?.find(row=>row.active!==false)?.result;
  return roll&&(skill?roll.total>=dc:die===20||die!==1&&roll.total>=dc);
};
const many=new Set(["bane","bless","blessed-aim"]);
export const clericOwns=item=>Boolean(mark(item).clericSpell&&mark(item).clericPlan!=="legacy");
const buffRows=(id,cl)=>({
  resistance:[["1","savingThrows","allSavingThrows","resist"]],
  "deadeye-s-lore":[["4","skill","skill.sur","sacred"]],
  bane:[["-1","attack","attack","penalty"]],
  bless:[["1","attack","attack","morale"]],
  "blessed-aim":[["2","attack","rattack","morale"]],
  conviction:[[String(Math.min(5,2+Math.floor(cl/6))),"savingThrows","allSavingThrows","morale"]],
  "eyes-of-the-avoral":[["8","skill","skill.spt","racial"]],
  "ray-of-hope":[["2","attack","attack","morale"],["2","savingThrows","allSavingThrows","morale"],["2","skills","skills","morale"],["2","abilityChecks","allChecks","morale"]],
  nightshield:[[String(cl>=9?3:cl>=6?2:1),"savingThrows","allSavingThrows","resist"]],
  "divine-favor":[[String(Math.min(3,Math.max(1,Math.floor(cl/3)))),"attack","attack","luck"],[String(Math.min(3,Math.max(1,Math.floor(cl/3)))),"damage","wdamage","luck"]],
  "shield-of-faith":[[String(Math.min(5,2+Math.floor(cl/6))),"ac","ac","deflection"]]
})[id]??[];
const secondsFor=(id,cl)=>({resistance:60,"divine-favor":60,bane:60*cl,bless:60*cl,"blessed-aim":60*cl,conviction:600*cl,
  "eyes-of-the-avoral":600*cl,"ray-of-hope":6*cl,nightshield:60*cl,"vision-of-glory":60,"ease-of-breath":3600*cl,"shield-of-faith":60*cl,"magic-weapon":60*cl,"deadeye-s-lore":3600*cl})[id];

function areaTargets(item,actor,targets) {
  const id=mark(item).clericSpell;
  if(!many.has(id))return [...new Map(targets.map(target=>[target.uuid,target])).values()];
  const caster=canvas.tokens.controlled.find(token=>token.actor?.uuid===actor.uuid)
    ??(actor.getActiveTokens().length===1?actor.getActiveTokens()[0]:null);
  if(!caster)throw new Error("范围法术需要场景中的施法者；请选择施法者指示物。");
  const radius=50*(/^(m|meter|meters|米|公尺)$/i.test(canvas.scene.grid.units)?0.3048:1);
  for(const target of targets) {
    const token=[...game.user.targets].find(entry=>entry.actor?.uuid===target.uuid);
    if(!token||canvas.grid.measurePath([caster.center,token.center]).distance>radius+1e-6)throw new Error(`${target.name}不在50尺范围内。`);
    const friend=token.document.disposition===caster.document.disposition&&caster.document.disposition!==0;
    if(id==="bane"&&(friend||target.uuid===actor.uuid))throw new Error("绝望术不能选择施法者或同阵营盟友。");
    if(id!=="bane"&&!friend&&target.uuid!==actor.uuid)throw new Error("请只指定盟友；中立关系请由DM先确认。");
  }
  if(id==="bless")targets=[actor,...targets];
  return [...new Map(targets.map(target=>[target.uuid,target])).values()];
}

export async function prepareClericCast(item,actor,targets,cl) {
  if(!clericOwns(item))return {};
  const definition=mark(item),id=definition.clericSpell;
  if(definition.clericPlan==="manual")return {clericSpell:id,clericTargets:[]};
  targets=areaTargets(item,actor,targets);
  if(!targets.length)throw new Error("请先指定法术目标；个人法术会自动选择施法者。");
  if(!many.has(id)&&targets.length!==1)throw new Error("这个法术每次请只指定一个目标。");
  let weaponId;
  if(id==="magic-weapon") {
    weaponId=await choose("魔化武器：选择制造武器",targets[0].items.filter(entry=>entry.type==="weapon"&&entry.system.weaponType!=="natural").map(entry=>[entry.id,entry.name]));
    if(!weaponId)return false;
  }
  return {clericSpell:id,clericTargets:targets.map(target=>target.uuid),clericWeapon:weaponId};
}

function eligibility(item,target) {
  const id=mark(item).clericSpell,kind=target.system.attributes.creatureType,immune=target.system.traits.ci?.value??[];
  if(["cause-fear","doom","moon-lust","ray-of-hope","faith-healing"].includes(id)&&conditionState(target).dead)return "目标已经死亡";
  const mind=["bane","bless","cause-fear","doom","ray-of-hope","moon-lust","vision-of-heaven"].includes(id);
  if(mind&&immune.includes("mindAffecting"))return "目标免疫影响心灵效果";
  if(["bane","cause-fear","doom"].includes(id)&&immune.includes("fear"))return "目标免疫恐惧";
  if(["cause-fear","doom","moon-lust","ray-of-hope","faith-healing"].includes(id)&&["undead","construct"].includes(kind))return "目标不是活物";
  if(id==="cause-fear") {
    const hd=Number(target.system.attributes.hd?.total);
    if(!Number.isFinite(hd)||hd<1)return "无法确认目标生命骰，请由DM检查";
    if(hd>5)return "目标生命骰超过5，免疫惊恐术";
  }
  if(id==="vision-of-heaven"&&!/^(le|ne|ce)$|evil|邪恶/i.test(String(target.system.details.alignment)))return "目标未标明邪恶阵营，请由DM确认";
  if(id==="vision-of-heaven"&&immune.includes("daze"))return "目标免疫晕眩";
  if(id==="shivering-touch-lesser") {
    const traits=target.system.traits;
    const subtypes=target.items.filter(entry=>entry.type==="race").flatMap(entry=>entry.system.subTypes??[]);
    if(/cold|寒冷|寒系/.test(JSON.stringify([traits.creatureType,traits.creatureSubtype,traits.subtype,traits.custom,...subtypes])))return "寒系亚种免疫";
    if(immune.some(value=>/abilityDamage|ability-damage/.test(value)))return "目标免疫属性伤害";
  }
  if(mark(item).clericPlan==="energy"&&kind==="construct")return "构装体不受此治疗或造成伤害法术影响";
  if(mark(item).clericPlan==="energy"&&kind==="undead"&&Number(target.system.attributes.hp.value)<=0)return "不死生物已经被摧毁，不能用此法术复原";
  if(mark(item).clericPlan==="energy"&&conditionState(target).dead)return "目标已经死亡，不能用此法术复活";
  return null;
}
async function cachedRoll(message,pending,key,formula,actor,flavor) {
  if(pending.rolls[key]!==undefined)return pending.rolls[key];
  const roll=await new Roll35e(formula).roll();
  pending.rolls[key]=roll.total;
  await message.setFlag(MODULE_ID,"clericResolution",pending);
  await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor});
  return roll.total;
}
async function healthChange(target,amount,heal,receipt) {
  return actorQueue(target,async()=>{
    const receipts=target.getFlag(MODULE_ID,"clericReceipts")??{};
    if(receipts[receipt])return;
    const hp=target.system.attributes.hp,temp=Number(hp.temp)||0,absorbed=heal?0:Math.min(temp,amount);
    await target.update({"system.attributes.hp.value":Math.clamp(Number(hp.value)+(heal?amount:-(amount-absorbed)),-100,Number(hp.max)),
      ...(heal?{"system.attributes.hp.nonlethal":Math.max(0,Number(hp.nonlethal??0)-amount)}:{"system.attributes.hp.temp":temp-absorbed}),
      [`flags.${MODULE_ID}.clericReceipts`]:{...receipts,[receipt]:true}},{threeRRuleOperation:true});
  });
}
async function applyResult(message,pending,item,actor,target,row) {
  const cast=message.getFlag(MODULE_ID,"cast"),id=cast.clericSpell,cl=Number(cast.cl),definition=mark(item),receipt=`${message.uuid}:${target.uuid}`;
  const start=pending.start,source={sourceActor:actor.uuid,sourceItemUuid:item.uuid,sourceName:item.name,start,receipt};
  if(definition.clericPlan==="condition") {
    let condition,seconds;
    if(id==="doom"){if(row.saved)return "豁免成功，无效";condition="shaken";seconds=60*cl;}
    if(id==="cause-fear"){condition=row.saved?"shaken":"frightened";seconds=row.saved?6:6*await cachedRoll(message,pending,"fearDuration","1d4",actor,`${item.name}：持续轮数`);}
    if(id==="moon-lust"){condition=row.saved?"dazzled":"fascinated";seconds=6*cl;}
    if(id==="vision-of-heaven"){if(row.saved)return "豁免成功，无效";condition="dazed";seconds=6;}
    if(cast.extendSelf&&target.uuid===actor.uuid)seconds*=2;
    if(start+seconds<=game.time.worldTime)return "原施法持续时间已经结束";
    await applyCondition(target,condition,{...source,seconds,context:{mindAffecting:true,saveDC:row.dc,save:"will"}});
    return `${item.name}已激活${conditionName(condition)}状态；持续${seconds/6}轮`;
  }
  if(definition.clericPlan==="energy") {
    if(id==="faith-healing"&&!sameDeity(actor,target))return "目标与施法者没有相同且非空的信仰，无效";
    const negative=id.startsWith("inflict"),undead=target.system.attributes.creatureType==="undead",heal=negative?undead:!undead;
    const formula=id.includes("minor")?"1":id==="faith-healing"?String(8+Math.min(cl,5)):`1d8+${Math.min(cl,5)}`;
    let amount=await cachedRoll(message,pending,"energy",formula,actor,`${item.name}：能量数值`);
    if(!heal&&row.critical)amount+=await cachedRoll(message,pending,"criticalEnergy",formula,actor,`${item.name}：重击额外数值`);
    if(row.saved)amount=id==="inflict-minor-wounds"?0:Math.floor(amount/2);
    // The source-specific energy is not treated as physical weapon damage.
    const resistance=ActorDamageHelper.getERForActor(target).find(entry=>entry.uid===(negative?"energy-negative":"energy-positive"));
    if(!heal&&resistance) {
      amount=resistance.immunity?0:Math.max(0,amount-(Number(resistance.value)||0));
      if(!resistance.immunity&&resistance.vulnerable)amount=Math.floor(amount*1.5);
      else if(!resistance.immunity&&resistance.half)amount=Math.ceil(amount/2);
    }
    await healthChange(target,amount,heal,receipt);
    return `${heal?"治疗":"伤害"}${amount}点${row.saved?"（已结算豁免）":""}`;
  }
  if(definition.clericPlan==="ability-damage") {
    const amount=await cachedRoll(message,pending,"dexDamage",row.critical?"2d6":"1d6",actor,`${item.name}：敏捷伤害`);
    await actorQueue(target,async()=>{
      const receipts=target.getFlag(MODULE_ID,"clericReceipts")??{};
      if(receipts[receipt])return;
      const current=Number(target.system.abilities.dex.damage)||0;
      await target.update({"system.abilities.dex.damage":current+amount,[`flags.${MODULE_ID}.clericReceipts`]:{...receipts,[receipt]:true}});
    });
    return `敏捷伤害${amount}点；恢复按属性伤害规则处理`;
  }
  if(row.saved)return "豁免成功，无效";
  let seconds=cast.persistentSeconds??secondsFor(id,cl);
  if(cast.extendSelf&&target.uuid===actor.uuid)seconds*=2;
  const left=start+seconds-game.time.worldTime;
  if(!(left>0))return "原施法持续时间已经结束";
  const prior=target.items.find(effect=>effect.getFlag(MODULE_ID,"clericReceipt")===receipt);
  if(prior)return "已经应用";
  const key={"divine-favor":"spell-effect-favor","shield-of-faith":"spell-effect-shield","magic-weapon":"spell-effect-weapon"}[id]??`cleric-effect-${id}`;
  const data=timedBuff(item.name,key,left,buffRows(id,cl),{sourceActor:actor.uuid,sourceItemUuid:item.uuid,cl,clericEffect:id,clericReceipt:receipt});
  if(definition.ruleset)data.flags[MODULE_ID].ruleset=definition.ruleset;
  if(definition.rulebook)data.flags[MODULE_ID].rulebook=definition.rulebook;
  data.img=item.img;data.system.description.value=await item.getChatDescription();
  if(["bane","bless"].includes(id))data.flags[MODULE_ID].clericCheck={kind:"fear",value:id==="bane"?-1:1,type:id==="bane"?"penalty":"morale",label:"对抗恐惧"};
  if(id==="ease-of-breath")data.flags[MODULE_ID].clericCheck={kind:"altitude",value:20,type:"inherent",label:"对抗高原病或稀薄空气疲劳"};
  if(id==="vision-of-glory")data.flags[MODULE_ID].clericCheck={kind:"oneSave",value:Number(actor.system.abilities.cha.mod)||0,type:"morale",label:"本次使用光荣之视",consume:true};
  if(id==="magic-weapon") {
    const weapon=target.items.get(cast.clericWeapon);
    if(!weapon||weapon.type!=="weapon"||weapon.system.weaponType==="natural")throw new Error("选中的制造武器已不存在或已变为天然武器。");
    data.flags[MODULE_ID].weaponId=weapon.id;
  }
  if(id==="bless"||id==="bane") {
    const opposite=id==="bless"?"bane":"bless";
    const effects=target.items.filter(effect=>effect.getFlag(MODULE_ID,"clericEffect")===opposite&&effectIsActive(effect));
    if(effects.length)await target.deleteEmbeddedDocuments("Item",effects.map(effect=>effect.id));
  }
  await replaceTimedBuff(target,data);
  return executionNote(id,definition.clericAdjudication);
}

const busy=new Set(),targetsBusy=new Set();
async function resolve(message,targetUuid,mode,{hasSight=true}={}) {
  if(game.users.activeGM!==game.user)throw new Error("请由当前主GM结算。");
  if(busy.has(message.id)||targetsBusy.has(targetUuid))return;
  busy.add(message.id);targetsBusy.add(targetUuid);
  try {
    const pending=foundry.utils.deepClone(message.getFlag(MODULE_ID,"clericResolution")),cast=message.getFlag(MODULE_ID,"cast"),row=pending?.targets?.[targetUuid];
    if(!row||row.done)return;
    if(!["apply","save","accept"].includes(mode))throw new Error("无效的结算选项。");
    if(row.mode&&row.mode!==mode)throw new Error("这次结算已经开始，请继续原选项，避免重掷。");
    const item=await fromUuid(pending.item),actor=item?.actor,target=await fromUuid(targetUuid);
    if(!item||!actor?.isOwner||!target?.isOwner)throw new Error("来源、目标或编辑权限已失效。");
    const data=message.flags.D35E.chatTemplateData,id=cast.clericSpell,cl=Number(cast.cl);
    if(!Number.isFinite(cl)||cl<1)throw new Error("施法者等级无效，未应用法术。");
    if(mode==="accept"&&actor.uuid!==target.uuid&&game.combat?.started&&target.items.some(entry=>entry.getFlag(MODULE_ID,"key")==="reclusive"))throw new Error("隐居诅咒：战斗中不能自愿接受其他施法者法术，请进行豁免。");
    row.mode=mode;row.hasSight??=hasSight;
    await message.setFlag(MODULE_ID,"clericResolution",pending);
    let outcome=eligibility(item,target);
    if(id==="moon-lust"&&!row.hasSight)outcome="目标没有视觉，无效";
    const negative=id.startsWith("inflict"),undead=target.system.attributes.creatureType==="undead";
    const healing=mark(item).clericPlan==="energy"&&(negative?undead:!undead);
    if(!outcome&&item.system.actionType==="msak"&&!healing) {
      if(!row.nativeAttack) {
        const index=data.attacks?.findIndex(entry=>entry.hasAttack)??-1;
        const result=await nativeHitCheck(message,actor,target,{touch:true,index});
        if(!result)return;
        row.nativeAttack=result;row.critical=result.crit;
        await message.setFlag(MODULE_ID,"clericResolution",pending);
      }
      if(!row.nativeAttack.hit)outcome="近战接触未命中";
      row.critical=row.nativeAttack.crit;
    }
    const sr=spellResistanceValue(target,actor.uuid),lowered=mode==="accept"&&!target.items.some(effect=>effect.getFlag(MODULE_ID,"key")==="covenant-sr"&&effectIsActive(effect));
    if(!outcome&&item.system.sr&&sr>0&&!lowered) {
      const native=Number(data.spellPenetration?.total??data.attacks?.find(entry=>entry.spellPenetration)?.spellPenetration?.total);
      let total=row.srTotal;
      if(!Number.isFinite(total)) {
        if(Number.isFinite(native))total=native;
        else {
          const bonus=new Roll35e(actor.getRollData().featSpellPenetrationBonus||"0",actor.getRollData()).evaluateSync().total||0;
          total=await cachedRoll(message,pending,`sr:${target.uuid}`,`1d20+${cl}+${bonus}`,actor,`${item.name}：克服${target.name}法术抗力${sr}`);
        }
        row.srTotal=total;await message.setFlag(MODULE_ID,"clericResolution",pending);
      }
      if(total<sr)outcome="被法术抗力抵挡";
    }
    if(!outcome&&mode==="save"&&item.system.save.type&&row.saved===undefined) {
      const book=actor.system.attributes.spells.spellbooks[item.system.spellbook??"primary"];
      const native=Number(data.dc?.dc??data.dc),dc=Number.isFinite(native)&&native>0?native:10+Number(item.system.level)+(Number(actor.system.abilities[book.ability]?.mod)||0);
      const type=item.system.save.type.startsWith("fortitude")?"fort":item.system.save.type.startsWith("reflex")?"ref":"will";
      const result=await target.rollSavingThrow(type,null,dc,{threeRSourceMessage:message.id});
      if(!rollOf(result))return;
      const counter=message.flags?.[MODULE_ID]?.counterSaves?.[encodeURIComponent(target.uuid).replaceAll(".","%2E")];
      row.saved=passed(result,dc,Boolean(counter?.skill&&counter.save===type));row.dc=dc;await message.setFlag(MODULE_ID,"clericResolution",pending);
    }
    if(!conditionActorLive(actor)||!conditionActorLive(target))return;
    if(!outcome)outcome=await applyResult(message,pending,item,actor,target,row);
    row.done=true;row.outcome=outcome;
    await message.setFlag(MODULE_ID,"clericResolution",pending);
  } finally {busy.delete(message.id);targetsBusy.delete(targetUuid);}
}

export function installClericSpells() {
  const report=error=>{console.error(MODULE_ID,error);ui.notifications.error(error.message);};
  Hooks.on("createChatMessage",async message=>{
    if(game.users.activeGM!==game.user)return;
    const cast=message.getFlag(MODULE_ID,"cast"),data=message.flags?.D35E?.chatTemplateData;
    if(!cast?.actual||!cast.clericSpell||!data?.isSpell||cast.derivedTarget)return;
    if(data.spellFailureSuccess===false&&game.settings.get("D35E","fizzleSpellOnArcaneFailure"))return;
    try {
      const item=await fromUuid(data.item?.uuid??"").catch(()=>null);
      const actor=item?.actor??(message.speaker.scene&&message.speaker.token?game.scenes.get(message.speaker.scene)?.tokens.get(message.speaker.token)?.actor:game.actors.get(message.speaker.actor));
      const source=actor?.items.get(data.item?.id);
      if(!clericOwns(source)||source.hasAction&&message.flags.D35E.template!=="systems/D35E/templates/chat/attack-roll.html")return;
      await consumeSpellComponents(actor,cast.materials);
      const targets={};
      for(const uuid of cast.clericTargets??[]) {
        const target=await fromUuid(uuid);
        if(target)targets[uuid]={name:target.name,done:false};
      }
      await message.setFlag(MODULE_ID,"clericResolution",{item:source.uuid,start:game.time.worldTime,targets,rolls:{},plan:mark(source).clericPlan,note:mark(source).clericAdjudication,save:source.system.save.type,sr:source.system.sr,touch:source.system.actionType==="msak",id:cast.clericSpell});
    } catch(error){report(error);}
  });
  Hooks.on("renderChatMessageHTML",(message,root)=>{
    const pending=message.getFlag(MODULE_ID,"clericResolution");
    if(!pending||root.querySelector("[data-cleric-resolution]"))return;
    if(pending.plan!=="manual")for(const button of root.querySelectorAll('[data-action="rollSave"],[data-action="rollSR"],[data-action="applyDamage"],[data-action="applyDamageHalf"]'))button.remove();
    const section=document.createElement("section");section.className="three-r-spell-resolution";section.dataset.clericResolution=message.id;
    section.innerHTML=`<strong>${pending.plan==="manual"?(pending.id==="create-water"?"仅计算产水量，场景效果未实现":"仅规则资料，独有效果尚未实现"):"法术结算"}</strong><p>${esc(executionNote(pending.id,pending.note))}</p>`;
    if(pending.id==="create-water")section.insertAdjacentHTML("beforeend",`<p>本次最多${2*Number(message.getFlag(MODULE_ID,"cast")?.cl)}加仑清水。</p>`);
    if(many.has(pending.id))section.insertAdjacentHTML("beforeend","<p>结算指定目标；范围内遗漏的单位、遮挡与实际盟敌关系由DM核对。</p>");
    if(pending.id==="shivering-touch-lesser")section.insertAdjacentHTML("beforeend","<p>寒系亚种、属性伤害免疫，以及是否应有法术抗力，请按本桌规则核对；这里按指定CHM的“不可”处理。</p>");
    for(const [uuid,row] of Object.entries(pending.targets)) {
      const line=document.createElement("div"),label=document.createElement("p");
      label.textContent=`${row.name}${row.done?`：${row.outcome}`:""}`;line.append(label);
      if(!row.done&&pending.plan!=="manual") {
        if(pending.id==="moon-lust")line.insertAdjacentHTML("beforeend",`<label><input type="checkbox" name="has-sight" ${row.hasSight!==false?"checked":""} ${row.mode?"disabled":""}>目标具有视觉</label>`);
        const options=document.createElement("div");options.className="three-r-spell-options";
        for(const [mode,text] of [["apply","直接应用"],...(pending.save?[["save","进行豁免"]]:[]),...(pending.save||pending.sr?[["accept","自愿接受"]]:[])]) {
          const button=document.createElement("button");button.type="button";button.textContent=text;
          button.disabled=game.users.activeGM!==game.user||Boolean(row.mode&&row.mode!==mode);
          button.title=mode==="apply"?"跳过豁免，仍检查命中、免疫与法术抗力":mode==="save"?"原生豁免；按正文处理无效、减半或部分有效":"放弃豁免，降低可以主动降低的法术抗力";
          button.onclick=()=>resolve(message,uuid,mode,{hasSight:line.querySelector('[name="has-sight"]')?.checked??true}).catch(report);
          options.append(button);
        }
        line.append(options);
      }
      section.append(line);
    }
    root.append(section);
  });
}
