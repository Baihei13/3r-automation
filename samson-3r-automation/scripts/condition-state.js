import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { Item35E } from "../../../systems/D35E/module/item/entity.js";
import { conditionAdmin } from "./condition-policy.js";

export const CONDITION_NAMES={blind:"目盲",dazzled:"目眩",deaf:"耳聋",entangled:"纠缠",fatigued:"疲乏",exhausted:"力竭",
  grappled:"擒抱",helpless:"无助",paralyzed:"麻痹",pinned:"压制",fear:"恐惧",sickened:"恶心",stunned:"震慑",shaken:"战栗",
  polymorphed:"变形",wildshaped:"野性变形",prone:"俯卧",dead:"死亡",dying:"濒死",disabled:"失能",stable:"稳定",
  unconscious:"昏迷",staggered:"恍惚",invisible:"隐形",banished:"放逐",dazed:"晕眩",cowering:"畏缩",nauseated:"反胃",
  frightened:"惊惧",panicked:"恐慌",fascinated:"迷魂",confused:"困惑",petrified:"石化",turned:"被驱散",flatFooted:"措手不及"};
export const NUMERIC_CONDITIONS=["blind","dazzled","deaf","entangled","grappled","helpless","paralyzed","pinned",
  "fear","sickened","stunned","shaken","fatigued","exhausted"];
export const conditionName=id=>CONDITION_NAMES[id]??id;
export function conditionState(actor,system=actor?.system) {
  const c={...(system?.attributes?.conditions??{}),...(actor?.getFlag?.(MODULE_ID,"conditions")??{})};
  for(const item of actor?.items??[])if(effectIsActive(item))
    for(const id of item.getFlag?.(MODULE_ID,"nativeConditions")??[])c[id]=true;
  for(const effect of actor?.effects??[])if(!effect.disabled&&!effect.isSuppressed&&!effect.getFlag(MODULE_ID,"conditionMarker")&&effect.getFlag("D35E","show")===undefined)
    for(const id of effect.statuses??[])if(CONDITION_NAMES[id])c[id]=true;
  const hp=Number(system?.attributes?.hp?.value),nonlethal=Number(system?.attributes?.hp?.nonlethal??0);
  if(hp<=-10)c.dead=true;
  if(Number(system?.abilities?.con?.total)===0&&!['undead','construct'].includes(system?.attributes?.creatureType))c.dead=true;
  if(c.fear) {
    const degree=conditionContext(actor,"fear").severity;
    if(["frightened","panicked"].includes(degree))c[degree]=true;
  }
  if(hp<0&&!c.stable&&!c.dead)c.dying=true;
  if(c.dying||nonlethal>Math.max(0,hp))c.unconscious=true;
  if(nonlethal>0&&nonlethal===hp)c.staggered=true;
  if(hp===0||hp<0&&c.stable&&!c.unconscious)c.disabled=true;
  if(c.paralyzed||c.unconscious||c.petrified)c.helpless=true;
  if((c.panicked&&conditionContext(actor,"panicked").cornered)||(c.turned&&conditionContext(actor,"turned").cornered))c.cowering=true;
  return c;
}
export function conditionContext(actor,id) {
  const saved=actor?.getFlag?.(MODULE_ID,"conditionContext")?.[id]??{};
  const providers=[...(actor?.items??[])].filter(item=>effectIsActive(item)&&item.getFlag?.(MODULE_ID,"nativeConditions")?.includes(id));
  return {sourceItemUuid:providers[0]?.getFlag(MODULE_ID,"sourceItemUuid"),sourceName:providers[0]?.getFlag(MODULE_ID,"sourceName"),saveDC:providers[0]?.getFlag(MODULE_ID,"saveDC"),...providers[0]?.getFlag(MODULE_ID,"conditionContext"),...saved,
    sourceActors:[...new Set([...providers.map(item=>item.getFlag(MODULE_ID,"sourceActor")),saved.sourceActor].filter(Boolean))]};
}
export function conditionItems(actor,system) {
  const c=conditionState(actor,system),entries=[];
  const add=(id,rows=[],changeFlags={})=>entries.push(new Item35E({name:conditionName(id),type:"buff",
    system:{active:true,buffType:"misc",changes:rows,changeFlags},flags:{[MODULE_ID]:{key:`condition-rule-${id}`,sameEffect:`condition-${id}`}}},{parent:actor}));
  const row=(n,kind,target)=>[String(n),kind,target,"penalty"];
  if(c.blind) {
    const skills=Object.entries(system.skills??{}).flatMap(([id,skill])=>{
      const all=[[id,skill],...Object.entries(skill.subSkills??{}).map(([sub,value])=>[`${id}.subSkills.${sub}`,value])];
      return all.filter(([,value])=>["str","dex"].includes(value.ability)&&!value.threeRBlindExempt).map(([key])=>row(-4,"skill",`skill.${key}`));
    });
    add("blind",[row(-2,"ac","ac"),...skills],{loseDexToAC:true});
  }
  if(c.dazzled)add("dazzled",[row(-1,"attack","attack"),row(-1,"skill","skill.src"),row(-1,"skill","skill.spt")]);
  if(c.deaf)add("deaf",[row(-4,"misc","init")]);
  if(c.entangled)add("entangled",[row(-4,"ability","dex"),row(-2,"attack","attack")]);
  // 3.5 grappling does not impose PF's -4 Dex/-2 CMB package. Its attack
  // penalty and conditional denial of Dex are applied to each actual attack.
  if(c.helpless)add("helpless",[],{zeroDex:true,loseDexToAC:true});
  if(c.paralyzed)add("paralyzed",[],{zeroDex:true,zeroStr:true,loseDexToAC:true});
  if(c.petrified)add("petrified",[],{zeroDex:true,zeroStr:true,loseDexToAC:true});
  if(c.pinned)add("pinned",[],{loseDexToAC:true});
  if(c.cowering)add("cowering",[row(-2,"ac","ac")],{loseDexToAC:true});
  if(c.stunned)add("stunned",[row(-2,"ac","ac")],{loseDexToAC:true});
  if(c.fear||c.shaken||c.frightened||c.panicked||c.turned)add("fear",[
    row(-2,"attack","attack"),row(-2,"savingThrows","allSavingThrows"),row(-2,"skills","skills"),row(-2,"abilityChecks","allChecks")]);
  if(c.sickened)add("sickened",[row(-2,"attack","attack"),row(-2,"damage","wdamage"),
    row(-2,"savingThrows","allSavingThrows"),row(-2,"skills","skills"),row(-2,"abilityChecks","allChecks")]);
  if(c.exhausted)add("exhausted",[row(-6,"ability","str"),row(-6,"ability","dex")]);
  else if(c.fatigued)add("fatigued",[row(-2,"ability","str"),row(-2,"ability","dex")]);
  if(c.fascinated)add("fascinated",[row(-4,"skill","skill.lis"),row(-4,"skill","skill.spt")]);
  const uncanny=actor.items.some(item=>effectIsActive(item)&&item.system.changeFlags?.uncannyDodge);
  if(c.flatFooted&&!uncanny)add("flatFooted",[],{loseDexToAC:true});
  return {c,entries};
}
export function skillConditionFailure(actor,id,options={}) {
  if(conditionAdmin(options))return null;
  const c=conditionState(actor);
  if(["dead","dying","unconscious","petrified","stunned","dazed","cowering","banished"].some(state=>c[state]))return "当前状态不能主动进行技能检定。";
  if(c.fascinated&&!["lis","spt"].includes(id))return "迷魂期间无法主动从事其他活动。";
  if(c.paralyzed&&["str","dex"].includes(actor.system.skills?.[id]?.ability))return "麻痹时无法进行这项身体活动。";
  if(!options.threeRAlternateSense&&c.blind&&(["src","spt"].includes(id)||options.requiresSight))return "目盲，依赖视力的检定自动失败。";
  if(!options.threeRAlternateSense&&c.deaf&&(id==="lis"||options.requiresHearing))return "耳聋，依赖听觉的检定自动失败。";
  if(c.nauseated&&(id==="coc"||options.requiresAttention))return "反胃时无法专注或进行需要注意力的活动。";
  if(c.dead||c.dying||c.unconscious||c.petrified)return "无法主动进行技能检定。";
  return null;
}
export function limitedAction(actor,kind,options={}) {
  if(conditionAdmin(options))return null;
  const c=conditionState(actor);
  if(!["standard","move","full","round"].includes(kind))return null;
  if(!(c.staggered||c.disabled||c.nauseated))return null;
  if(["full","round"].includes(kind))return "当前状态不允许整轮动作。";
  if(c.nauseated&&kind!=="move")return "反胃时每轮只能进行一个移动动作。";
  // The martial command committed this action before generating native dice.
  // Do not reject its own continuation as a second action this round.
  if(options.threeRConditionCommitted)return null;
  const combat=game.combat;
  if(!combat?.started)return null;
  const used=actor.getFlag(MODULE_ID,"conditionAction");
  const key=`${combat.id}:${combat.round}`;
  return used?.key===key&&!(kind==="move"&&used.kind==="move")?"本轮已经使用过当前状态允许的一个动作。":null;
}
export function conditionActionRestriction(actor,item,options={}) {
  if(conditionAdmin(options))return null;
  const {kind=item?.system?.activation?.type,common=null}=options;
  const c=conditionState(actor),components=item?.system?.components??{},mental=item?.getFlag?.(MODULE_ID,"purelyMental")===true||item?.type==="spell"&&!Object.values(components).some(value=>value===true)&&!Number(components.divineFocus);
  const unable=["dead","dying","unconscious","stunned","dazed","cowering","petrified","banished"].find(id=>c[id]);
  if(unable)return `处于${conditionName(unable)}状态，不能执行这项动作。`;
  if(c.paralyzed&&!mental)return "麻痹时只能进行纯粹的心理活动。";
  if(c.helpless&&!c.paralyzed&&!(mental&&conditionContext(actor,"helpless").allowMental))return "处于无助状态，不能执行这项动作。";
  if(c.fascinated)return "迷魂期间只能专注于产生迷魂的效果。";
  if((c.fatigued||c.exhausted||c.entangled||c.prone)&&["run","charge"].includes(common))return "当前状态不能奔跑或冲锋。";
  if(c.prone&&item?.system?.actionType==="rwak") {
    const weapon=actor.items.get(item.system.originalWeaponId)??item;
    if(!/crossbow|弩/i.test(`${weapon.system.baseWeaponType??""} ${weapon.name}`))return "俯卧时不能使用弩以外的远程武器。";
  }
  if(c.pinned&&common!=="escape-grapple"&&!mental&&!(item?.type==="spell"&&!item.system.components?.somatic))return "压制期间只能尝试挣脱、纯粹的心理活动或规则允许的施法。";
  if(c.grappled&&item?.hasAttack&&item.type!=="spell") {
    const weapon=actor.items.get(item.system.originalWeaponId)??item;
    if(item.system.actionType!=="mwak"||weapon.system.weaponType!=="natural"&&["2h","1h"].includes(weapon.system.weaponSubtype))
      return "擒抱中只能用徒手、天生武器或轻型近战武器攻击擒抱中的对手。";
    const target=[...game.user.targets][0]?.actor;
    const context=conditionContext(actor,"grappled"),partners=context.participants?.length?context.participants:context.sourceActors;
    if(!target||!partners?.includes(target.uuid))return "请指定与你擒抱的对手；尚未记录对手时请先补齐状态来源。";
  }
  if((c.panicked||c.turned||c.frightened&&!conditionContext(actor,"frightened").cornered)&&kind!=="move"&&!['run','escape'].includes(common)&&!item?.getFlag?.(MODULE_ID,"helpsEscape"))return "当前恐惧状态须逃离；只能移动或使用明确帮助逃离的动作。";
  if(common==="aao"&&(c.grappled||c.pinned||c.flatFooted&&!actor.items.some(entry=>/combat reflexes|战斗反射/i.test(entry.name))))return "当前状态不能进行借机攻击。";
  if(c.grappled&&!item&&!["escape-grapple","grapple"].includes(common))return "擒抱中只能采取擒抱规则允许的动作，请从状态详情处理。";
  if(c.nauseated&&["step","stand"].includes(common)&&kind!=="move")return "反胃期间只能进行一个移动动作。";
  if(c.confused) {
    const turn=actor.getFlag(MODULE_ID,"confusionTurn"),key=game.combat?.started?`${game.combat.id}:${game.combat.round}:${game.combat.turn}`:null;
    if(!turn||turn.combat!==game.combat?.id||(game.combat?.combatant?.actor?.uuid===actor.uuid&&turn.key!==key))return "请先结算本回合的困惑行为。";
    if(turn.mode==="babble")return "困惑：本回合语无伦次，不能采取其他动作。";
    if(turn.mode==="flee"&&kind!=="move"&&common!=="run"&&!item?.getFlag?.(MODULE_ID,"helpsEscape"))return "困惑：本回合须逃离施法者。";
    if(turn.mode==="attack"&&(!item?.hasAttack||![...game.user.targets].some(token=>token.actor?.uuid===turn.target)))return "困惑：本回合只能攻击记录的目标；无法攻击时语无伦次。";
  }
  return limitedAction(actor,kind,options);
}
export function conditionSpeedFactor(c) {
  if(["dead","dying","unconscious","paralyzed","petrified","pinned","cowering","stunned","dazed","banished"].some(id=>c[id]))return 0;
  return (c.blind?0.5:1)*(c.entangled?0.5:1)*(c.exhausted?0.5:1)*(c.disabled?0.5:1);
}
