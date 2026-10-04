import { MODULE_ID } from "./catalog.js";
import { ActorUpdater } from "../../../systems/D35E/module/actor/update/actorUpdater.js";
import { ActorChangesHelper } from "../../../systems/D35E/module/actor/helpers/actorChangesHelper.js";
import { ItemEnhancementHelper } from "../../../systems/D35E/module/item/helpers/itemEnhancementHelper.js";
import { normalizeBonusType } from "./bonus-types.js";
import { createTransientView } from "./transient-view.js";
import { effectIsActive } from "./effect-state.js";
import { conditionItems, conditionSpeedFactor, NUMERIC_CONDITIONS } from "./condition-state.js";
const groups=new Map();
const nativeTypes=new Map();
export function displayBonusType(type) {
  if(nativeTypes.has(type))return nativeTypes.get(type);
  if(String(type).startsWith("3r-effect-"))return "untyped";
  if(String(type).startsWith("3r-penalty-effect-"))return "penalty";
  if(String(type).startsWith("3r-penalty-"))
    return [...groups].find(([,value])=>value===type)?.[0].slice("penalty:".length)??"penalty";
  return type;
}
function groupType(kind,identity,label,nativeType=null) {
  const group=`${kind}:${identity}`;
  if(!groups.has(group)) {
    const type=`3r-${kind}-${groups.size}`;groups.set(group,type);
    CONFIG.D35E.bonusModifiers[type]=label;
    if(nativeType)nativeTypes.set(type,nativeType);
  }
  return groups.get(group);
}
const normal=value=>String(value??"").trim().toLowerCase().replace(/[\s\p{P}\p{S}]/gu,"");
function splitTargets(row,actor) {
  const target=row[2];
  if(["replace","base-replace"].includes(row[3]))return [row];
  if(target==="ac") {
    const type=nativeTypes.get(row[3])??row[3];
    const targets=type==="dodge"?["pac","tch","cmd"]:type==="deflection"?["pac","tch","ffac","cmd"]:["pac","tch","ffac"];
    return targets.map(t=>[row[0],t==="cmd"?"misc":"ac",t,...row.slice(3)]);
  }
  if(target==="attack")return ["mattack","rattack"].map(t=>[row[0],"attack",t,...row.slice(3)]);
  if(target==="damage")return ["wdamage","sdamage"].map(t=>[row[0],"damage",t,...row.slice(3)]);
  if(target==="allSavingThrows")return ["fort","ref","will"].map(t=>[row[0],"savingThrows",t,...row.slice(3)]);
  if(target==="allChecks")return ["str","dex","con","int","wis","cha"].map(t=>[row[0],"abilityChecks",`${t}Checks`,...row.slice(3)]);
  if(target==="skills"||/^(str|dex|con|int|wis|cha|perf|prof|craft|know)Skills$/.test(target)) {
    const paths=ActorChangesHelper.getChangeFlat(target,row[3],actor.system)??[];
    return (Array.isArray(paths)?paths:[paths]).map(path=>[row[0],"skill",path.replace(/^system\.skills\./,"skill.").replace(/\.changeBonus$/,""),...row.slice(3)]);
  }
  return [row];
}
function circumstance(item) {
  const override=item.getFlag(MODULE_ID,"circumstanceGroup");
  if(override)return String(override);
  if(item.getFlag(MODULE_ID,"key")==="masterwork-tools"||/masterwork.*thieves|精制.*小偷|精制.*盗贼|精制.*开锁/.test(item.name.toLowerCase()))return "masterwork-thieves-tools";
  return item.getFlag(MODULE_ID,"key")||item.system.uniqueId||normal(item.name);
}
function projectedRows(rows,item,actor,mark=item.flags?.[MODULE_ID]) {
  return (rows??[]).flatMap((row,index)=> {
    const copy=[...row],type=normalizeBonusType(row[3]);copy[3]=type;
    // Native equipment AC is already a highest-only base at these targets.
    // Put explicitly typed armor/shield/natural armor into that same group,
    // otherwise e.g. mage armor would be added to worn armor.
    const armorTarget={armor:"aac",shield:"sac",naturalArmor:"nac"}[type];
    if(armorTarget&&["ac","aac","sac","nac"].includes(row[2])){copy[2]=armorTarget;copy[3]="base";}
    if(type==="inherent"&&row[1]==="ability")copy[0]=`min(5,(${row[0]}))`;
    // Each circumstance is a separate native highest-only group. Equivalent
    // circumstances share a group; different circumstances are then additive.
    if(type==="circumstance") {
      const positive=[...copy],negative=[...copy];
      positive[0]=`max(0,(${row[0]}))`;
      positive[3]=groupType("environment",circumstance(item),`环境：${item.name}`,"circumstance");
      negative[0]=`min(0,(${row[0]}))`;
      negative[3]=groupType("typed-negative","circumstance","环境减值（取最严重）","circumstance");
      return [positive,negative];
    }
    if(type==="dodge") {
      if(actor.loseDexToAC)return [];
      const positive=[...copy],negative=[...copy];
      // Distinct dodge effects add; repeated instances of one effect do not.
      positive[0]=`max(0,(${row[0]}))`;
      positive[3]=groupType("dodge",mark?.sameEffect||mark?.key||item.system.uniqueId||normal(item.name),`闪避：${item.name}`,"dodge");
      negative[0]=`min(0,(${row[0]}))`;
      negative[3]=groupType("typed-negative","dodge","闪避减值（取最严重）","dodge");
      return [positive,negative];
    }
    // Only explicit penalty types are highest-only. Unspecified penalties from
    // different effects remain additive, matching the user's supplied rule.
    const penaltyType=mark?.penaltyTypes?.[index];
    if(type==="penalty"&&penaltyType)copy[3]=groupType("penalty",penaltyType,`减值：${penaltyType}`);
    else if(type==="penalty"&&mark?.key&&row[2]!=="speedMult")copy[3]=groupType("penalty-effect",mark.sameEffect??mark.key,`未注明类型的减值（同一效果取最严重）：${item.name}`);
    // Native untyped values normally add. Repeated copies of the same module
    // effect must contribute once, regardless of caster or duplicate import.
    if(type==="untyped"&&mark?.key&&row[2]!=="spellResistance")copy[3]=groupType("effect",mark.sameEffect??mark.key,`无名加值（同一效果取最高）：${item.name}`);
    return [copy];
  }).flatMap(row=>splitTargets(row,actor));
}
function projectedItem(item,actor) {
  const system=foundry.utils.deepClone(item.system),mark=item.flags?.[MODULE_ID];
  if(["buff","aura"].includes(item.type)&&!effectIsActive(item))system.active=false;
  system.changes=projectedRows(system.changes,item,actor);
  for(const enhancement of system.enhancements?.items??[]) {
    const data=ItemEnhancementHelper.getEnhancementData(enhancement);
    data.changes=projectedRows(data.changes,item,actor,enhancement.flags?.[MODULE_ID]);
  }
  if(mark?.key==="legalistic-sickened"&&actor.system.attributes.conditions.sickened)system.changes=[];
  if(mark?.key==="tanglefoot-entangled")system.changes=system.changes.filter(row=>row[2]!=="speedMult");
  return createTransientView(item,{system});
}
function projectedCollection(collection,actor,additional=[]) {
  const entries=[...collection.contents,...additional].map(item=>projectedItem(item,actor));
  return createTransientView(collection,{
    contents:entries,
    [Symbol.iterator]:entries[Symbol.iterator].bind(entries),
    get:id=>entries.find(item=>item.id===id),
    values:()=>entries.values(),
    ...Object.fromEntries(["filter","find","some","every","map","reduce","forEach"].map(method=>[method,entries[method].bind(entries)]))
  });
}
export function installStackingRules() {
  for(const [type,label]of Object.entries({armor:"盔甲",shield:"盾牌",naturalArmor:"天生防御"}))CONFIG.D35E.bonusModifiers[type]??=label;
  const flat=ActorChangesHelper.getChangeFlat;
  ActorChangesHelper.getChangeFlat=function(target,type,data) {
    if(target==="ac"&&["armor","shield","naturalArmor"].includes(type))target={armor:"aac",shield:"sac",naturalArmor:"nac"}[type];
    type=nativeTypes.get(type)??type;
    if(target==="cmd"&&type==="dodge")return "system.attributes.cmd.total";
    if(String(type).startsWith("3r-penalty-"))type="penalty";
    return flat.call(this,target,type,data);
  };
  const update=ActorUpdater.prototype.updateChanges;
  const reduceSpeed=ActorUpdater.prototype.getReducedMovementSpeed;
  ActorUpdater.prototype.getReducedMovementSpeed=function(source,value,...args) {
    const c={...(this._threeRConditions??source.system.attributes.conditions)};
    if(source.items.some(item=>item.flags?.[MODULE_ID]?.key==="tanglefoot-entangled"&&effectIsActive(item)))c.entangled=true;
    return reduceSpeed.call(this,source,Math.floor(value*conditionSpeedFactor(c)),...args);
  };
  ActorUpdater.prototype.updateChanges=async function(...args) {
    const actor=this.actor;
    const effective=foundry.utils.mergeObject(foundry.utils.deepClone(actor.system),foundry.utils.expandObject(args[0]?.updated??{}).system??{});
    const active=actor.items.filter(item=> {
      if(["buff","aura"].includes(item.type))return effectIsActive(item);
      if(["weapon","equipment"].includes(item.type))return item.system.equipped&&!item.system.melded&&!item.broken;
      return true;
    });
    const plan=conditionItems(actor,effective),conditions=plan.c;
    const uncanny=active.some(item=>item.system.changeFlags?.uncannyDodge);
    const loseDexToAC=active.some(item=>item.system.changeFlags?.loseDexToAC)||["blind","pinned","stunned","helpless","paralyzed","cowering","petrified"].some(state=>conditions[state])||(conditions.flatFooted&&!uncanny);
    const items=projectedCollection(actor.items,{system:effective,loseDexToAC},plan.entries);
    // Calculate one 3.5 package per condition, with penalties grouped by cause.
    // Native state booleans remain real; only this calculation's input is masked
    // to avoid the second, incomplete (and partly PF) default package.
    const calc=foundry.utils.deepClone(effective);
    // D35E's schema/HUD uses polymorphed, but its calculation checks polymorph.
    // Supply the alias only inside this calculation, never persist a new field.
    calc.attributes.conditions.polymorph=Boolean(conditions.polymorphed);
    for(const id of NUMERIC_CONDITIONS)calc.attributes.conditions[id]=false;
    const snapshot=actor.toObject(false);snapshot.system=calc;
    this.actor=createTransientView(actor,{items,system:calc,toObject:()=>foundry.utils.deepClone(snapshot)});
    const previousConditions=this._threeRConditions;this._threeRConditions=conditions;
    const nextArgs=[...args];
    const originalUpdate=args[0]?.updated??null;
    if(originalUpdate) {
      const updated=foundry.utils.expandObject(foundry.utils.deepClone(originalUpdate));
      updated.system??={};updated.system.attributes??={};
      updated.system.attributes.conditions={...calc.attributes.conditions};
      nextArgs[0]={...args[0],updated};
    }
    try {
      const result=await update.apply(this,nextArgs);
      // The updater returns its calculation source as diff. Never let callers
      // receive projected items as a candidate for a persisted Actor update.
      if(result?.diff?.items===items)result.diff.items=actor.items;
      if(result?.data?.items===items)result.data.items=actor.items;
      if(result?.diff?.system?.attributes)result.diff.system.attributes.conditions=foundry.utils.deepClone(effective.attributes.conditions);
      if(result?.data)for(const key of Object.keys(result.data))if(key.startsWith("system.attributes.conditions."))
        result.data[key]=effective.attributes.conditions[key.slice("system.attributes.conditions.".length)]??false;
      // The core's zero-ability flags clear drain as a side effect. A condition
      // must not erase real ability drain while presenting an effective score 0.
      for(const [id,ability] of Object.entries(effective.abilities??{})) {
        if(result?.diff?.system?.abilities?.[id])result.diff.system.abilities[id].drain=ability.drain;
        if(result?.data&&Object.hasOwn(result.data,`system.abilities.${id}.drain`))result.data[`system.abilities.${id}.drain`]=ability.drain;
      }
      return result;
    }finally{this.actor=actor;this._threeRConditions=previousConditions;}
  };
}
