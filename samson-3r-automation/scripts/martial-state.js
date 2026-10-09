import { MODULE_ID } from "./catalog.js";
import { PLANS } from "./martial-plans.js";

export const clone=value=>foundry.utils.deepClone(value);
export const martial=item=>item?.flags?.[MODULE_ID]?.martial;
export const READIED=[4,4,5,5,6,6,6,7,7,8,8,8,9,9,10,10,10,11,11,12];
export const STANCES=[1,2,2,2,3,3,3,3,4,4,4,4,4,5,5,5,5,5,5,6];
export const DISCIPLINES={"desert-wind":"漠风","diamond-mind":"钢魂","setting-sun":"暮日","shadow-hand":"影手","stone-dragon":"石龙","tiger-claw":"虎爪"};
// Read paths do not copy the growing history of attack receipts. Commands still
// use state() to obtain a detached record before changing anything.
export const stateView=actor=>actor.flags?.[MODULE_ID]?.martial??{version:1,profiles:{},encounter:null,activeStance:null,receipts:{},turn:0};
export const state=actor=>clone(stateView(actor));
export const classLevel=actor=>actor.items.filter(i=>i.type==="class"&&i.flags?.[MODULE_ID]?.martialClass==="swordsage").reduce((n,i)=>n+Number(i.system.levels||0),0);
export const profileId=actor=>actor.items.find(i=>i.type==="class"&&i.flags?.[MODULE_ID]?.martialClass==="swordsage")?.id;
export const martialCombat=actor=>game.combat?.started&&game.combat.combatants.some(c=>c.actor?.uuid===actor.uuid)?game.combat:null;
export function currentAcquisition(actor) {
  const level=classLevel(actor),totalHD=Number(actor.system.attributes?.hd?.total);
  if(!Number.isInteger(level)||level<1||level>20)throw new Error("先确认角色卡里的贤者之剑等级（1至20级）。");
  if(!Number.isInteger(totalHD)||totalHD<level)throw new Error("角色卡的生命骰尚未算好，请重新打开角色卡后再学习。");
  const otherLevels=totalHD-level,initiatorLevel=level+Math.floor(otherLevels/2);
  return {level,otherLevels,initiatorLevel,maxLevel:Math.min(9,Math.floor((initiatorLevel+1)/2))};
}
export function getState(actor,{readOnly=false}={}) {
  const saved=readOnly?stateView(actor):state(actor),level=classLevel(actor),hd=Number(actor.system.attributes?.hd?.total)||0;
  const id=profileId(actor),p=saved.profiles[id]??{known:[],readied:[],expended:[],recovered:{},choices:{},replacements:{}};
  // With no martial class, undefined profile IDs must not match ordinary items.
  const known=id?actor.items.filter(i=>martial(i)?.profile===id&&!martial(i)?.retired):[];
  const stances=known.filter(i=>martial(i).kind==="stance"),moves=known.filter(i=>martial(i).kind!=="stance");
  const il=level+Math.floor(Math.max(0,hd-level)/2),row=Math.min(20,Math.max(1,level))-1;
  return {saved,id,profile:p,level,initiatorLevel:il,maxLevel:Math.min(9,Math.floor((il+1)/2)),known,moves,stances,
    quotas:{known:level?level+5:0,readied:level?READIED[row]:0,stances:level?STANCES[row]:0},
    pending:{known:Math.max(0,(level?level+5:0)-moves.length),stances:Math.max(0,(level?STANCES[row]:0)-stances.length)},
    activeStance:actor.items.get(saved.activeStance),encounter:saved.encounter};
}
export async function save(actor,data) {
  await actor.update({[`flags.${MODULE_ID}.martial`]:data},{updateChanges:false,skipMinions:true,skipToken:true});
}
export function ensureProfile(actor,data) {
  const id=profileId(actor);
  if(!id)throw new Error("先在职业页加入贤者之剑，再配置武术。不会自动更改角色等级。");
  data.profiles[id]??={known:[],readied:[],expended:[],recovered:{},choices:{},replacements:{}};
  return [id,data.profiles[id]];
}
export function check(actor,item,context={},snapshot=null) {
  const m=martial(item),s=snapshot??getState(actor,{readOnly:true}),reasons=[];
  if(!m)return {available:false,reasons:["不是武术条目"]};
  if(!actor.isOwner)reasons.push("没有角色操纵权限");
  if(m.retired||!m.profile||m.profile!==s.id||!s.level||!s.saved.profiles[m.profile])reasons.push("尚未从武术页正式学习、来源职业已移除，或已被替换");
  const c=actor.system.attributes?.conditions??{};
  if(["dead","dying","unconscious","helpless","paralyzed","pinned","stunned","dazed"].some(k=>c[k]))reasons.push("当前无法发动武术");
  if(m.action==="immediate"&&c.flatFooted)reasons.push("措手不及时不能使用反应动作");
  if(m.abilityType==="su"&&context.antimagic)reasons.push("反魔法环境中超自然能力无效");
  if(m.discipline==="stone-dragon"&&context.grounded===false)reasons.push("石龙流要求接触地面");
  const combat=martialCombat(actor),tracked=Boolean(combat),own=combat?combat.combatant?.actor?.uuid===actor.uuid:true;
  if(!own&&["standard","move","full","swift"].includes(m.action))reasons.push("战斗中这招只能在自己的行动中发动");
  const restrictions=actor.items.filter(i=>i.system.active&&i.flags?.[MODULE_ID]?.martialEffect).map(i=>i.flags[MODULE_ID].martialEffect.restriction);
  if(restrictions.includes("no-actions")||restrictions.includes("no-standard")&&["standard","full"].includes(m.action)||restrictions.includes("no-move")&&["move","full"].includes(m.action)||restrictions.includes("no-full-attack")&&PLANS[m.definition]?.full)reasons.push("当前武术效果限制了这次动作");
  if(m.kind!=="stance") {
    const p=s.saved.profiles[m.profile];
    if(!p?.readied?.includes(item.id))reasons.push("没有准备这招");
    if(p?.expended?.includes(item.id))reasons.push("这招已经消耗");
    if(tracked&&Number(p?.recovered?.[item.id])>=Number(s.saved.turn||0))reasons.push("冥想恢复的招式在下一次行动才可使用");
  }
  if(tracked&&!context.freeCounter&&(s.saved.swiftDebt||own&&s.saved.swiftUsed)&&["swift","immediate"].includes(m.action))reasons.push("迅捷/反应额度尚未恢复");
  return {available:!reasons.length,reasons,kind:m.action};
}
export function acquisitionCheck(actor,definition,{level=classLevel(actor),otherLevels=Math.max(0,(Number(actor.system.attributes?.hd?.total)||0)-classLevel(actor)),replaceId=null}={},snapshot=null) {
  const s=snapshot??getState(actor,{readOnly:true}),m=martial(definition),at=Number(level),reasons=[];
  if(!m||!s.id||!Number.isInteger(at)||at<1||at>s.level)return ["学习来源或取得职业等级无效"];
  if(s.known.some(i=>martial(i).definition===m.definition&&i.id!==replaceId))reasons.push("该来源已经学习这招");
  const hd=Number(actor.system.attributes?.hd?.total)||0;
  if(!Number.isInteger(otherLevels)||otherLevels<0||otherLevels>Math.max(0,hd-s.level))reasons.push("取得时其他职业/种族生命骰记录无效");
  const il=at+Math.floor(Math.max(0,otherLevels)/2);
  if(m.level>Math.min(9,Math.floor((il+1)/2)))reasons.push("取得等级的武道等级不足");
  const same=s.known.filter(i=>i.id!==replaceId&&martial(i).discipline===m.discipline&&Number(martial(i).learnedLevel)<=at).length;
  if(same<m.prerequisiteCount)reasons.push(`需要先掌握${m.prerequisiteCount}种${m.disciplineName}流招式（含架势）`);
  if(m.kind==="stance") {
    const occupied=s.stances.filter(i=>Number(martial(i).learnedLevel)<=at).length;
    if(!occupied&&m.level!==1)reasons.push("第一个架势只能为一级");
    if(occupied>=STANCES[at-1])reasons.push("这个取得等级没有剩余架势名额");
    if(replaceId)reasons.push("贤者之剑不能用升级替换架势");
  } else if(!replaceId&&s.moves.filter(i=>Number(martial(i).learnedLevel)<=at).length>=at+5)reasons.push("这个取得等级没有剩余武技名额");
  if(replaceId) {
    const old=actor.items.get(replaceId);
    if(!old||martial(old)?.profile!==s.id||martial(old).kind==="stance"||martial(old).retired)reasons.push("替换来源无效");
    else if(Number(martial(old).learnedLevel)>at)reasons.push("不能替换在此取得等级之后才学会的武技");
    if(at<4||at%2||s.profile.replacements?.[at])reasons.push("此等级没有可用替换机会");
  }
  return reasons;
}
