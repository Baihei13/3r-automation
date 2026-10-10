import { MODULE_ID } from "./catalog.js";
import { clone,martial,state,save,getState,ensureProfile,check,acquisitionCheck,currentAcquisition,DISCIPLINES,classLevel,martialCombat } from "./martial-state.js";
import { MARTIAL_ITEMS } from "./martial-content.js";
import { assertConditionAction,commitConditionAction } from "./condition-runtime.js";
import { PLANS } from "./martial-plans.js";
import { recordAction } from "./rules-bridge.js";
import { executeMartial,enterMartialStance,leaveMartialStance,expireMartial,configureSwordsage,senseMagic,martialEvent,installMartialEffects } from "./martial-effects.js";
import { installMartialSheet,openMartial } from "./martial-sheet.js";
import { installSwordsageFeatures,swordsageFeatureAvailable } from "./martial-class-features.js";
import { installMartialTemplate } from "./martial-template.js";
import { resolveMartialContext } from "./martial-events.js";
import { sceneToken,feetDistance } from "./martial-context.js";
import { validateMapManeuver,validateMapSource,chargeEndpoint } from "./martial-map.js";
import { useScent } from "./martial-scent.js";
import { conditionAdmin } from "./condition-policy.js";

const esc=value=>foundry.utils.escapeHTML(String(value??""));
const channel=`module.${MODULE_ID}`,waiting=new Map();
const queues=new Map(),dualQueues=new Map();
const previousCombatTurns=new WeakMap();
const knownCombatTurns=new WeakMap();
const combatPosition=combat=>`${combat.round}:${combat.turn}:${combat.combatant?.id}`;
// Commands and native condition writes have separate queues; never recursively
// wait for the same actor queue while applying a condition or HP consequence.
const actorQueue=(actor,work)=>{const next=(queues.get(actor.uuid)??Promise.resolve()).catch(()=>{}).then(work);queues.set(actor.uuid,next);return next.finally(()=>{if(queues.get(actor.uuid)===next)queues.delete(actor.uuid);});};
const selectable=actor=>actor.items.filter(i=>i.type==="attack"&&i.system.actionType==="mwak"&&i.hasAttack);
const trackedTurn=actor=>Boolean(martialCombat(actor));
const ownTurn=actor=>{const combat=martialCombat(actor);return combat?combat.combatant?.actor?.uuid===actor.uuid:true;};
export function recoveryCheck(actor,profile=null,user=game.user) {
  const s=getState(actor,{readOnly:true}),reasons=[];
  const expended=new Set(s.profile.expended??[]),readied=new Set(s.profile.readied??[]);
  const items=s.moves.filter(item=>expended.has(item.id)&&readied.has(item.id));
  if(!actor.isOwner)reasons.push("没有角色操纵权限");
  if(!s.id||!s.level||(profile&&profile!==s.id)||!swordsageFeatureAvailable(actor,"readied"))reasons.push("贤者之剑恢复特性尚未获得、来源已移除或已停用");
  if(!items.length)reasons.push("没有需要恢复的已消耗准备武技");
  if(!conditionAdmin({user})&&!ownTurn(actor))reasons.push("只能在自己的行动中整轮冥想");
  try{assertConditionAction(actor,null,{kind:"full",user});}catch(error){reasons.push(error.message);}
  return {available:!reasons.length,reasons,items,kind:"full"};
}
function validateContext(actor,item,context={}) {
  const p=PLANS[martial(item)?.definition];if(!p)return;
  const targets=[...new Set(context.targets??[])];
  const single=p.mode==="attack"&&!p.full&&p.sequence!=="path"||["throw","opposed"].includes(p.mode)&&p.sequence!=="path-throws";
  if(single&&targets.length!==1)throw new Error("这招需要且只能选择一个主要目标；次级范围由DM另行处理。");
  if(p.sequence==="dual") {
    const weapons=selectable(actor),first=weapons.find(i=>i.id===context.weaponId),second=weapons.find(i=>i.id===context.secondWeaponId);
    if(!first||!second||first.id===second.id)throw new Error("请选择两条不同的原生攻击：主手武器与副手武器（或副手徒手）。");
  }
}
const message=(actor,text)=>ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(text)}</p>`});
async function dialog(title,content) {
  return foundry.applications.api.DialogV2.wait({window:{title},rejectClose:false,content:`<form>${content}</form>`,buttons:[{action:"ok",label:"确认",callback:(_e,_b,d)=>Object.fromEntries(new FormData(d.element.querySelector("form")))}]});
}

async function prepareRequest(actor,r) {
  if(r.op==="target-turn")return {...r,context:{targets:[...new Set([...game.user.targets].filter(t=>t.actor).map(t=>t.actor.uuid))]}};
  if(r.op==="dual") {
    const s=getState(actor),boosts=s.moves.filter(i=>martial(i).kind==="boost"&&s.profile.readied.includes(i.id)&&!s.profile.expended.includes(i.id));
    if(!swordsageFeatureAvailable(actor,"dual"))throw new Error("双重强化需要贤者之剑20级且未停用。");
    const answer=await dialog("双重强化：每天三次",["first","second"].map(k=>`<label>${k==="first"?"第一招":"同时发动的第二招"}<select name="${k}">${boosts.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select></label>`).join(""));
    if(!answer)return null;if(answer.first===answer.second)throw new Error("双重强化必须是不同的两招。");
    const a=await prepareRequest(actor,{op:"initiate",itemId:answer.first}),b=a&&await prepareRequest(actor,{op:"initiate",itemId:answer.second});
    return b?{...r,first:a,second:b}:null;
  }
  if(r.op==="focus") {
    const s=getState(actor),known=new Set(s.known.map(i=>martial(i).discipline));
    const choices=[["weapon",1],["strike4",4],["defense8",8],["strike12",12],["defense16",16]].filter(([_k,l])=>s.level>=l);
    const answer=await dialog("流派专攻",choices.map(([k,l])=>`<label>${l}级 ${k==="weapon"?"武器专攻":k.startsWith("strike")?"洞察打击":"防御架势"}<select name="${k}"><option value="">暂不选择</option>${[...known].map(d=>`<option value="${d}" ${s.profile.choices[k]===d?"selected":""}>${DISCIPLINES[d]}</option>`).join("")}</select></label>`).join("")+`<label>感知AC适用范围<select name="unarmored"><option value="no">按汇编：仅轻甲</option><option value="yes" ${s.profile.choices.unarmored==="yes"?"selected":""}>DM裁定：轻甲或无甲</option></select></label>`);
    return answer?{...r,choices:answer}:null;
  }
  if(r.op==="recover") {
    const eligibility=recoveryCheck(actor,r.profileId),choices=eligibility.items;
    if(!eligibility.available)throw new Error(eligibility.reasons.join("；"));
    const answer=await dialog("整轮冥想：只恢复一招",`<select name="itemId">${choices.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select><p>${trackedTurn(actor)?"请在自己的行动中完成整轮冥想；下次开始行动后可用。":"战斗外完成整轮冥想后可用，无需先开始遭遇。"}</p>`);
    return answer?{...r,...answer}:null;
  }
  if(["initiate","stance"].includes(r.op)) {
    const item=actor.items.get(r.itemId),m=martial(item),p=PLANS[m?.definition];
    if(!m||!p)throw new Error("未登记这招的武术规则。");
    if(r.op==="stance"&&state(actor).activeStance===item.id)return r;
    const context={targets:[...new Set([...game.user.targets].filter(t=>t.actor).map(t=>t.actor.uuid))],targetTokens:[...game.user.targets].filter(t=>t.actor).map(t=>t.document.uuid),sourceToken:sceneToken(actor)?.document.uuid,offTurn:!ownTurn(actor)};
    if(r.context?.eventKey)context.eventKey=r.context.eventKey;
    if(r.context?.sourceMessage)context.sourceMessage=r.context.sourceMessage;
    if(["str","dex"].includes(r.context?.opposedAbility))context.opposedAbility=r.context.opposedAbility;
    const weapons=selectable(actor),attack=p.mode==="attack"&&!p.pure||p.opposedAttack||p.extraAttacksPerWeapon||p.rend;
    if(attack&&!weapons.length)throw new Error("先在原生攻击页生成近战武器/徒手攻击，再发动这招。");
    const fields=[];
    if(r.op==="stance"&&m.definition==="stance-of-clarity") {
      const choices=(canvas.tokens?.placeables??[]).filter(t=>t.actor&&t.actor.uuid!==actor.uuid&&(game.user.isGM||t.isVisible));
      if(!choices.length)throw new Error("明净体需要场景中可见的专注目标，架势尚未切换。");
      const selected=context.targets.length===1?context.targets[0]:null;
      fields.push(`<label>明净体专注目标<select name="focusTarget">${choices.map(t=>`<option value="${t.actor.uuid}" ${selected===t.actor.uuid?"selected":""}>${esc(t.name)}</option>`).join("")}</select></label>`);
    }
    if(attack) {
      if(weapons.length===1)context.weaponId=weapons[0].id;
      else fields.push(`<label>使用武器<select name="weaponId">${weapons.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select></label>`);
    }
    if(p.extraAttacksPerWeapon||p.rend||p.sequence==="dual")fields.push(`<label>副手武器或徒手<select name="secondWeaponId"><option value="">不使用第二把</option>${weapons.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select></label>`);
    if(p.opposedAbility&&!context.opposedAbility)fields.push('<label>反制冲锋：选择对抗属性<select name="opposedAbility"><option value="dex">敏捷</option><option value="str">力量</option></select></label>');
    if(fields.length){const answer=await dialog(item.name,fields.join(""));if(!answer)return null;Object.assign(context,answer);}
    return {...r,context};
  }
  return r;
}

async function performDual(actor,r,user) {
  const pair=await actorQueue(actor,async()=>{
    if(!swordsageFeatureAvailable(actor,"dual"))throw new Error("双重强化需要20级且未停用。");
    const d=state(actor),old=d.dualPairs?.[r.commandId];
    if(old)return old;
    if(Number(d.dualUsed||0)>=3)throw new Error("今日双重强化已用完；由DM在休息后重置。");
    if(!r.first||!r.second||r.first.itemId===r.second.itemId)throw new Error("双重强化必须选择两招不同的强化技。");
    for(const row of [r.first,r.second]){const i=actor.items.get(row.itemId);if(martial(i)?.kind!=="boost"||!check(actor,i,{...row.context,conditionUser:user}).available)throw new Error("两招必须都是已准备、未消耗、当前可用的强化技。");validateContext(actor,i,row.context);}
    d.dualUsed=Number(d.dualUsed||0)+1;d.dualPairs??={};d.dualPairs[r.commandId]={first:clone(r.first),secondRequest:clone(r.second),second:r.second.itemId,turn:d.turn||0};await save(actor,d);return d.dualPairs[r.commandId];
  });
  await localCommand({...pair.first,op:"initiate",actorUuid:actor.uuid,commandId:`${r.commandId}-a`},user);
  return localCommand({...pair.secondRequest,op:"initiate",actorUuid:actor.uuid,commandId:`${r.commandId}-b`,dualPair:r.commandId},user);
}
async function localCommand(r,user) {
  if(!/^[A-Za-z0-9:_~-]{1,240}$/.test(r.commandId??""))throw new Error("武术操作编号无效，请重新发起操作。");
  const actor=await fromUuid(r.actorUuid);
  if(!actor||!actor.testUserPermission(user,"OWNER"))throw new Error("武术来源或角色编辑权限无效。");
  if(r.op==="dual") {
    const prior=dualQueues.get(actor.uuid)??Promise.resolve();
    const next=prior.catch(()=>{}).then(()=>performDual(actor,r,user));dualQueues.set(actor.uuid,next);
    return next.finally(()=>{if(dualQueues.get(actor.uuid)===next)dualQueues.delete(actor.uuid);});
  }
  if(r.op==="configure")return configureSwordsage(actor);
  if(r.op==="sense")return senseMagic(actor,r.context);
  if(r.op==="scent")return actorQueue(actor,()=>useScent(actor,user));
  if(r.op==="event"){if(!user.isGM)throw new Error("架势事件由DM确认。");return martialEvent(actor);}
  if(r.op==="target-turn"){if(!user.isGM)throw new Error("目标行动时点由DM确认。");for(const uuid of r.context.targets){const target=await fromUuid(uuid);if(target)await expireMartial(target,"start");}return {state:"performed"};}
  return actorQueue(actor,async()=>{
    const data=state(actor),[id,p]=ensureProfile(actor,data),s=getState(actor);
    const previous=data.receipts[r.commandId];
    if(previous?.status==="done")return previous.result;
    if(previous?.status==="initiated")return executeMartial(actor,actor.items.get(previous.itemId),previous,r.commandId,data);
    let result={state:"performed"};
    if(r.op==="learn") {
      if(r.acquisitionMode!==undefined&&!["current","historical"].includes(r.acquisitionMode))throw new Error("学习记录方式无效。");
      const historical=r.acquisitionMode==="historical";
      if(historical&&!user.isGM)throw new Error("过去等级的学习记录由DM补录；普通学习会自动读取当前角色卡。");
      const acquired=historical?{level:Number(r.level),otherLevels:Number(r.otherLevels)}:currentAcquisition(actor);
      if(!historical&&r.acquisitionPreview&&(Number(r.acquisitionPreview.level)!==acquired.level||Number(r.acquisitionPreview.otherLevels)!==acquired.otherLevels))
        throw new Error("学习窗口打开后角色等级已改变，请重新选择招式。");
      const definition=MARTIAL_ITEMS.find(i=>martial(i).definition===r.definition);
      const reasons=acquisitionCheck(actor,definition,{...acquired,replaceId:r.replaceId});
      if(reasons.length)throw new Error(reasons.join("；"));
      const item=clone(definition);item.flags[MODULE_ID].martial={...martial(item),profile:id,learnedLevel:acquired.level,otherLevels:acquired.otherLevels,acquisitionMode:historical?"historical":"current",learnedOrder:Date.now(),acquiredBy:r.commandId};
      const found=actor.items.find(i=>martial(i)?.acquiredBy===r.commandId);
      const created=found??(await actor.createEmbeddedDocuments("Item",[item]))[0];
      p.known=[...new Set([...p.known,created.id])];
      if(r.replaceId) {
        await actor.items.get(r.replaceId).update({[`flags.${MODULE_ID}.martial.retired`]:true});
        p.known=p.known.filter(i=>i!==r.replaceId);p.readied=p.readied.filter(i=>i!==r.replaceId);p.expended=p.expended.filter(i=>i!==r.replaceId);p.replacements[acquired.level]=r.commandId;
      }
      result={state:"learned",itemId:created.id};
    } else if(r.op==="prepare") {
      if(data.encounter||martialCombat(actor))throw new Error("战斗或遭遇内不能用普通五分钟准备；请先结束遭遇。");
      const selected=[...new Set(r.readied??[])];
      if(selected.length!==s.quotas.readied||selected.some(id=>!s.moves.some(i=>i.id===id)))throw new Error(`必须从已学武技中准备${s.quotas.readied}招。`);
      p.readied=selected;p.expended=[];p.recovered={};
      await message(actor,"完成五分钟冥想与练习，更新武技准备；世界时间由DM推进。");
    } else if(r.op==="start") {
      if(!user.isGM)throw new Error("由DM开始战斗外遭遇；战斗开始会自动开启已完整准备的角色。");
      if(data.encounter)throw new Error("遭遇已开始，不会再次恢复招式。");
      if(p.readied.length!==s.quotas.readied||s.pending.known||s.pending.stances)throw new Error("先补齐学习与准备名额，再开始遭遇。");
      data.encounter={id:foundry.utils.randomID(),combat:martialCombat(actor)?.id??null,start:game.time.worldTime};p.expended=[];p.recovered={};data.swiftDebt=false;data.swiftUsed=false;data.manualActing=true;
    } else if(r.op==="end") {
      if(!user.isGM)throw new Error("遭遇结束由DM确认。");
      await expireMartial(actor,"end");
      data.encounter=null;p.expended=[];p.recovered={};data.swiftDebt=false;data.swiftUsed=false;
    } else if(r.op==="turn") {
      if(!user.isGM||martialCombat(actor))throw new Error("战斗外下一次行动由DM确认；战斗内随回合推进。");
      data.turn=(data.turn||0)+1;data.manualActing=true;data.swiftUsed=Boolean(data.swiftDebt);data.clearDebtAtEnd=Boolean(data.swiftDebt);data.freeCounterUsed=false;data.counterUsed=[];
      await expireMartial(actor,"start");
    } else if(r.op==="reset-dual") {
      if(!user.isGM)throw new Error("每日次数须由DM在休息完成后重置。");data.dualUsed=0;
    } else if(r.op==="end-turn") {
      if(!user.isGM||martialCombat(actor))throw new Error("战斗外结束行动由DM确认。");
      await expireMartial(actor,"end");data.manualActing=false;data.swiftUsed=false;if(data.clearDebtAtEnd){data.swiftDebt=false;data.clearDebtAtEnd=false;}
    } else if(r.op==="recover") {
      const eligibility=recoveryCheck(actor,r.profileId,user);
      if(!eligibility.available)throw new Error(eligibility.reasons.join("；"));
      if(!eligibility.items.some(item=>item.id===r.itemId))throw new Error("请选择本来源仍存在、未被替换且已消耗的准备武技。");
      p.expended=p.expended.filter(i=>i!==r.itemId);p.recovered[r.itemId]=data.turn||0;
      await commitConditionAction(actor,"full",{user});
      await recordAction(actor,"standard");await recordAction(actor,"move");
      await message(actor,`整轮冥想恢复${actor.items.get(r.itemId).name}，${trackedTurn(actor)?"下次行动可用":"战斗外完成冥想后可用"}。`);result.kind="full";result.label="冥想恢复武技";result.hasChat=true;
    } else if(r.op==="focus") {
      const choices=r.choices??{},known=new Set(s.known.map(i=>martial(i).discipline));
      for(const [key,min] of [["weapon",1],["strike4",4],["defense8",8],["strike12",12],["defense16",16]]) {
        const featureId={weapon:"focus-weapon",strike4:"focus-strike-4",defense8:"focus-defense-8",strike12:"focus-strike-12",defense16:"focus-defense-16"}[key];
        if(choices[key]&&choices[key]!==p.choices[key]&&(!known.has(choices[key])||s.level<min))throw new Error("流派专攻的等级或已知流派条件不符。");
        if(choices[key]&&choices[key]!==p.choices[key]&&!swordsageFeatureAvailable(actor,featureId))throw new Error("此流派专攻特性已停用。");
        if(!user.isGM&&p.choices[key]&&choices[key]!==p.choices[key])throw new Error("已选流派不能自由重选；请由DM处理角色重训。");
      }
      if(choices.strike4&&choices.strike4===choices.strike12||choices.defense8&&choices.defense8===choices.defense16)throw new Error("第二次洞察打击/防御架势须选择另一个流派。");
      if(!user.isGM&&choices.unarmored!== (p.choices.unarmored??"no"))throw new Error("无甲是否适用感知AC须由DM裁定。");
      p.choices={...p.choices,...choices};
    } else if(["initiate","stance"].includes(r.op)) {
      const item=actor.items.get(r.itemId),m=martial(item);
      if(!m||m.profile!==id)throw new Error("这招未关联当前来源。");
      if(r.op==="stance"&&data.activeStance===item.id) {
        if(!conditionAdmin({user})&&!ownTurn(actor))throw new Error("结束架势需要自己行动中的迅捷动作。");
        if(!conditionAdmin({user})&&trackedTurn(actor)&&(data.swiftUsed||data.swiftDebt))throw new Error("本次行动的迅捷/反应已用完。");
        assertConditionAction(actor,item,{kind:"swift",user});await leaveMartialStance(actor);data.activeStance=null;data.swiftUsed=true;result.kind="swift";await recordAction(actor,"swift");
      } else {
        r.context=await resolveMartialContext(actor,item,r.context??{});
        if(!r.context)return {state:"cancelled"};
        validateContext(actor,item,r.context);
        if(m.definition==="blistering-flourish") {
          const source=sceneToken(actor,r.context.sourceToken);if(!source)throw new Error("焰星需要场景中的发动者，招式尚未消耗。");
          const tokens=canvas.tokens.placeables.filter(t=>t.actor&&t.actor.uuid!==actor.uuid&&t.document.level===source.document.level
            &&feetDistance(source.center,t.center)<=30+1e-6&&!source.checkCollision(t.center,{type:"sight",mode:"any"}));
          r.context.targets=[...new Set(tokens.map(t=>t.actor.uuid))];r.context.targetTokens=tokens.map(t=>t.document.uuid);
        }
        if(["mighty-throw","charging-minotaur"].includes(m.definition)) {
          const target=await fromUuid(r.context.targets[0]);validateMapManeuver(actor,target,r.context,m.definition==="mighty-throw"?"trip":"bullrush");
          if(m.definition==="charging-minotaur")chargeEndpoint(sceneToken(actor,r.context.sourceToken),sceneToken(target,r.context.targetTokens[0]));
        }
        if(["sudden-leap","distracting-ember"].includes(m.definition))validateMapSource(actor,r.context);
        const freeCounter=PLANS[martial(actor.items.get(data.activeStance))?.definition]?.freeCounter&&m.kind==="counter"&&m.action==="immediate"&&!data.freeCounterUsed;
        const pair=data.dualPairs?.[r.dualPair],freeBoost=pair?.second===item.id&&pair.turn===(data.turn||0)&&m.kind==="boost"&&data.receipts[`${r.dualPair}-a`]?.status==="done";
        const freeAction=freeCounter||freeBoost;
        const availability=check(actor,item,{...r.context,freeCounter:freeAction,conditionUser:user});if(!availability.available)throw new Error(availability.reasons.join("；"));
        if(!conditionAdmin({user})&&trackedTurn(actor)&&["swift","immediate"].includes(m.action)&&data.swiftUsed&&ownTurn(actor)&&!freeAction)throw new Error("本次行动的迅捷/反应已用完。");
        if(!conditionAdmin({user})&&trackedTurn(actor)&&m.kind==="counter"&&data.counterUsed?.includes(item.id))throw new Error("本次行动周期已发动过这个应对技。");
        assertConditionAction(actor,item,{kind:freeAction?"free":m.action,user});
        if(m.kind!=="stance")p.expended=[...new Set([...p.expended,item.id])];
        if(m.kind==="counter"){data.counterUsed=[...(data.counterUsed??[]),item.id];if(freeCounter)data.freeCounterUsed=true;}
        if(["swift","immediate"].includes(m.action)&&!freeAction){data.swiftUsed=true;if(m.action==="immediate"&&!ownTurn(actor))data.swiftDebt=true;}
        data.receipts[r.commandId]={status:"initiated",itemId:item.id,context:clone(r.context??{}),started:game.time.worldTime,turn:data.turn||0,userId:user.id,kind:freeAction?"free":m.action,steps:{}};
        await save(actor,data);
        await commitConditionAction(actor,freeAction?"free":m.action,{user});
        if(!freeAction){if(m.action==="full"){await recordAction(actor,"standard");await recordAction(actor,"move");}else await recordAction(actor,m.action);}
        if(m.kind==="stance") {
          await enterMartialStance(actor,item,r.context,r.commandId);data.activeStance=item.id;
        } else return executeMartial(actor,item,data.receipts[r.commandId],r.commandId,data);
        result.kind=freeCounter?"free":m.action;
      }
    } else throw new Error("无效武术操作。");
    data.receipts[r.commandId]={status:"done",result};
    await save(actor,data);if(r.op==="focus"||r.op==="stance")await actor.refresh();
    return result;
  });
}

export async function command(request) {
  const actor=await fromUuid(request.actorUuid);if(!actor?.isOwner)throw new Error("没有角色操纵权限。");
  const r=await prepareRequest(actor,{...request,commandId:request.commandId??foundry.utils.randomID()});
  if(!r)return {state:"cancelled"};
  if(game.users.activeGM===game.user)return localCommand(r,game.user);
  if(!game.users.activeGM)return {state:"pending",reason:"当前没有在线主GM，武术尚未发动或消耗。"};
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{waiting.delete(r.commandId);resolve({state:"pending",reason:"尚未收到主GM回执，请用同一操作编号继续，避免重复发动。",commandId:r.commandId});},45000);
    waiting.set(r.commandId,{resolve,reject,timer});
    ChatMessage.create({content:"<p>武术操作等待主GM处理。</p>",whisper:[game.users.activeGM.id],flags:{[MODULE_ID]:{martialRequest:r}}}).catch(error=>{clearTimeout(timer);waiting.delete(r.commandId);reject(error);});
  });
}
export function installMartialRuntime() {
  // A player may advance a turn: its pre-update hook does not run on the GM.
  // Retain the ready-time position in memory without writing a combat flag.
  for(const combat of game.combats)if(combat.started)knownCombatTurns.set(combat,combatPosition(combat));
  installMartialTemplate();
  installMartialSheet(command);installMartialEffects();installSwordsageFeatures(command,openMartial);
  game.socket.on(channel,async payload=>{
    if(payload.martialResponse&&payload.userId===game.user.id) {
      const row=waiting.get(payload.id);if(!row)return;clearTimeout(row.timer);waiting.delete(payload.id);
      if(payload.error)row.reject(new Error(payload.error));else row.resolve(payload.martialResponse);return;
    }
  });
  // The server-owned message author is the permission identity. A socket field
  // supplied by another client is never accepted as proof of GM/owner status.
  Hooks.on("createChatMessage",async message=>{
    if(game.users.activeGM!==game.user)return;
    const request=message.getFlag(MODULE_ID,"martialRequest");if(!request)return;
    const user=message.author??message.user;if(!user?.id)return;
    try{const result=await localCommand(request,user);game.socket.emit(channel,{martialResponse:result,id:request.commandId,userId:user.id});}
    catch(error){game.socket.emit(channel,{martialResponse:{state:"failed"},error:error.message,id:request.commandId,userId:user.id});}
  });
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    if(!martial(item)||hook.customUse)return;
    hook.customUse=true;hook.threeRCompletion=command({actorUuid:actor.uuid,itemId:item.id,op:martial(item).kind==="stance"?"stance":"initiate"});
    hook.threeRCompletion.catch(error=>ui.notifications.error(error.message));
  });
  Hooks.on("preUpdateCombat",(combat,change)=>{
    if(game.users.activeGM!==game.user||(!Object.hasOwn(change,"turn")&&!Object.hasOwn(change,"round")))return;
    // Capture the actual outgoing combatant before Foundry applies the update.
    // This covers existing combats with no saved martialTurn after reloading.
    previousCombatTurns.set(combat,combat.started?combatPosition(combat):null);
  });
  Hooks.on("updateCombat",async(combat,change)=>{
    const old=previousCombatTurns.has(combat)?previousCombatTurns.get(combat):knownCombatTurns.get(combat)??combat.flags?.[MODULE_ID]?.martialTurn;
    previousCombatTurns.delete(combat);
    const now=combatPosition(combat);
    if(Object.hasOwn(change,"turn")||Object.hasOwn(change,"round")) {
      if(combat.started)knownCombatTurns.set(combat,now);
      else knownCombatTurns.delete(combat);
    }
    // Every client keeps a read-only snapshot for a later GM handoff; only the
    // current primary GM performs expiration and document changes.
    if(game.users.activeGM!==game.user)return;
    const incomingActor=combat.combatant?.actor;
    if(change.round===0&&!combat.started){
      knownCombatTurns.delete(combat);
      for(const actor of new Map(combat.combatants.filter(c=>c.actor).map(c=>[c.actor.uuid,c.actor])).values()) {
        if(getState(actor).encounter?.combat===combat.id)await localCommand({actorUuid:actor.uuid,op:"end",commandId:`combat:${combat.id}:stop:${actor.uuid.replaceAll(".","~")}`},game.user);
        else await actorQueue(actor,()=>expireMartial(actor,"end"));
      }
      return;
    }
    if(!combat.started)return;
    if(change.started===true||change.round===1&&combat.started) {
      for(const actor of new Map(combat.combatants.filter(c=>c.actor).map(c=>[c.actor.uuid,c.actor])).values()) {
        const s=getState(actor);if(s.id&&!s.encounter&&!s.pending.known&&!s.pending.stances&&s.profile.readied.length===s.quotas.readied)
          await localCommand({op:"start",actorUuid:actor.uuid,commandId:`combat:${combat.id}:start:${actor.uuid.replaceAll(".","~")}`},game.user);
      }
    }
    if(!Object.hasOwn(change,"turn")&&!Object.hasOwn(change,"round"))return;
    // Only actual turn/round advancement triggers clocks. Initiative edits do not.
    if(old===now)return;
    if(old) {
      const oldId=old.split(":").at(-1),actor=combat.combatants.get(oldId)?.actor;
      if(actor)await actorQueue(actor,async()=>{const d=state(actor);await expireMartial(actor,"end");if(getState(actor).id){if(d.clearDebtAtEnd){d.swiftDebt=false;d.clearDebtAtEnd=false;}await save(actor,d);}});
    }
    await combat.setFlag(MODULE_ID,"martialTurn",now);
    const actor=incomingActor;
    if(actor)await actorQueue(actor,async()=>{const d=state(actor);if(getState(actor).id){d.turn=(d.turn||0)+1;d.swiftUsed=Boolean(d.swiftDebt);d.clearDebtAtEnd=Boolean(d.swiftDebt);d.freeCounterUsed=false;d.counterUsed=[];await save(actor,d);}await expireMartial(actor,"start");});
  });
  Hooks.on("deleteCombat",async combat=>{
    if(game.users.activeGM!==game.user)return;
    previousCombatTurns.delete(combat);
    knownCombatTurns.delete(combat);
    for(const actor of new Map(combat.combatants.filter(c=>c.actor).map(c=>[c.actor.uuid,c.actor])).values()) {
      if(getState(actor).encounter?.combat===combat.id)await localCommand({actorUuid:actor.uuid,op:"end",commandId:`combat:${combat.id}:end:${actor.uuid.replaceAll(".","~")}`},game.user);
      else await actorQueue(actor,()=>expireMartial(actor,"end"));
    }
  });
}
export const martialAPI={getState,check,recoveryCheck,command,open:openMartial};
