import { MODULE_ID } from "./catalog.js";
import { CARD_SPELLS } from "./current-card-data.js";

// These records track the cause and duration. The condition engine supplies
// one 3.5 calculation package; the native booleans remain the visible state.
const sickened = {
  name:"恶心", img:"systems/D35E/icons/conditions/sickened.png",
  description:"<p>恶心的生物在攻击检定、武器伤害掷骰、豁免检定、技能检定和属性检定上承受−2减值。</p>"
};
const RULES={sickened,
  blind:{name:"目盲",img:"systems/D35E/icons/conditions/blind.png",description:"<p>无法看见。AC−2，并失去AC上的敏捷加值；移动速度减半。搜索及大多数力量、敏捷相关技能检定−4；依赖视力的检定与活动自动失败。所有敌手对其具有全隐蔽，攻击时有50%失手率。</p>"},
  deaf:{name:"耳聋",img:"systems/D35E/icons/conditions/deaf.png",description:"<p>无法听见。先攻检定−4，聆听检定自动失败；施展带语言成分的法术有20%失败概率。</p>"},
  fatigued:{name:"疲乏",img:"systems/D35E/icons/conditions/fatigued.png",description:"<p>不能奔跑或冲锋，力量和敏捷−2。再次进行通常会导致疲乏的活动时变为力竭。完全休息8小时后解除。</p>"}};
export const LEGALISTIC_PENALTIES=[["-2","attack","attack","penalty"],["-2","damage","wdamage","penalty"],
  ["-2","savingThrows","allSavingThrows","penalty"],["-2","skills","skills","penalty"],["-2","abilityChecks","allChecks","penalty"]];

export function setNativeConditionPresentation(data,ids,sourceName) {
  const rules=ids.map(id=>RULES[id]);
  if(!rules.length||rules.some(rule=>!rule))throw new Error("没有对应的状态说明，未创建状态记录。");
  data.name=rules.map(rule=>rule.name).join("／");
  data.img=rules[0].img;
  data.system.description.value=rules.length===1?rules[0].description:
    rules.map(rule=>`<h4>${rule.name}</h4>${rule.description}`).join("");
  data.system.hideFromToken=true;
  Object.assign(data.flags[MODULE_ID],{nativeConditions:[...ids],conditionEffects:[...ids],
    conditionEffect:ids.length===1?ids[0]:null,conditionPresentationRevision:1,sourceName});
  return data;
}

export function setSickenedPresentation(data,sourceName) {
  return setNativeConditionPresentation(data,["sickened"],sourceName);
}

export function conditionPresentationRepairs(item) {
  const mark=item.flags?.[MODULE_ID];
  if(item.type==="buff"&&mark&&!mark.conditionPresentationRevision&&
    ["pesh-vigor-fatigue","city-concentration","legalistic-sickened"].includes(mark.key)) {
    const config={"pesh-vigor-fatigue":{name:"疲乏",ids:["fatigued"],source:"仙人掌萃的活力"},
      "city-concentration":{name:"聆听城市：专注",ids:["blind","deaf"],source:"聆听城市"},
      "legalistic-sickened":{name:"守律：违约（恶心）",ids:["sickened"],source:"守律：违约"}}[mark.key];
    const legalistic=mark.key==="legalistic-sickened";
    const body=String(item.system.description?.value??"")
      .replace(/<section\b[^>]*\bdata-3r-bonuses\b[^>]*>[\s\S]*?<\/section>/gi,"").trim();
    const rows=item.system.changes??[];
    if(item.name!==config.name||item.img!=="icons/svg/aura.svg"||body!==`<p>${config.name}</p>`
      ||(legalistic?JSON.stringify(rows)!==JSON.stringify(LEGALISTIC_PENALTIES):rows.length)
      ||(!legalistic&&JSON.stringify(mark.nativeConditions)!==JSON.stringify(config.ids)))return {};
    const data=setNativeConditionPresentation({system:{description:{value:""}},flags:{[MODULE_ID]:{}}},config.ids,config.source);
    const update={name:data.name,img:data.img,"system.description.value":data.system.description.value,
      "system.hideFromToken":true,[`flags.${MODULE_ID}.previousConditionPresentation`]:{
        name:item.name,img:item.img,description:item.system.description.value,hideFromToken:item.system.hideFromToken??false}};
    for(const [key,value] of Object.entries(data.flags[MODULE_ID]))update[`flags.${MODULE_ID}.${key}`]=value;
    if(legalistic)Object.assign(update,{"system.changes":[],
      [`flags.${MODULE_ID}.previousConditionChanges`]:rows});
    return update;
  }
  if(item.type!=="buff"||mark?.key!=="card-effect-ray-of-sickening"
    ||mark.cardEffect!=="ray-of-sickening"||mark.conditionPresentationRevision
    ||!mark.nativeConditions?.includes("sickened")||item.system.changes?.length)return {};
  // Preserve player-edited names, pictures and prose; the timeline can still label the state.
  if(!["恶心射线","Ray of Sickening"].includes(item.name))return {};
  if(!["icons/svg/book.svg",`modules/${MODULE_ID}/assets/icons/rune.png`,
    `modules/${MODULE_ID}/assets/icons/rule-skill-toxic.png`].includes(item.img))return {};
  const oldBody=String(item.system.description?.value??"")
    .replace(/<section\b[^>]*\bdata-3r-bonuses\b[^>]*>[\s\S]*?<\/section>/gi,"").trim();
  const expected=CARD_SPELLS.find(entry=>entry.flags[MODULE_ID].currentCardSpell==="ray-of-sickening")?.system.description.value;
  if(oldBody!==expected)return {};
  return {
    name:sickened.name,img:sickened.img,"system.description.value":sickened.description,
    "system.hideFromToken":true,
    [`flags.${MODULE_ID}.conditionEffect`] : "sickened",
    [`flags.${MODULE_ID}.conditionPresentationRevision`] : 1,
    [`flags.${MODULE_ID}.sourceName`] : mark.sourceName??item.name,
    [`flags.${MODULE_ID}.previousConditionPresentation`] : {
      name:item.name,img:item.img,description:item.system.description.value,hideFromToken:item.system.hideFromToken??false
    }
  };
}
