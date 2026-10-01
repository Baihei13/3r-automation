import { BONUS_TYPES, normalizeBonusType } from "./bonus-types.js";
import { displayBonusType } from "./stacking.js";
import { localizeKnownName, localizeSpellElement } from "./spell-text.js";

const labels={Precision:"精准伤害","Precision Damage":"精准伤害",precision:"精准伤害","Attack Roll":"攻击骰","Attack details":"攻击明细","Damage details":"伤害明细",
  "Alternative Damage details":"替代伤害明细","Sub-Attack Damage details":"后续攻击伤害明细",
  "Special actions":"特殊动作","Saving throw":"豁免检定","Description":"描述",Magic:"法术",Inventory:"物品",SPELLS:"法术",PRIMARY:"主要法术书",
  "Ability Modifier":"属性修正","Item Bonus":"物品加值","Base Attack Bonus":"基本攻击加值",
  "Masterwork Bonus":"精制武器（增强加值）", "General Bonus":"攻击修正（来源未记录）",
  "General Melee Bonus":"近战攻击修正（来源未记录）","General Ranged Bonus":"远程攻击修正（来源未记录）",
  "通用加值":"攻击修正（来源未记录）","通用近战加值":"近战攻击修正（来源未记录）","通用远程加值":"远程攻击修正（来源未记录）"};
const sourceLabels={"Temporary Buffs":"临时增益","Permanent Buffs":"永久增益","Item Buffs":"物品增益",Buffs:"增益",Size:"体型",Equipment:"装备",Weapons:"武器",Feats:"专长","Class Features":"职业特性","Racial Traits":"种族特性",Race:"种族",Traits:"特质"};
function sourcePart(source) {
  const value=Number(source.value);
  const bracket=String(source.name??"").match(/\[([\s\S]*)\]$/)?.[1];
  const raw=(bracket??String(source.name??"")).split(" → ").at(-1).trim();
  const name=localizeKnownName(sourceLabels[raw]??raw);
  const type=normalizeBonusType(displayBonusType(source.bonusType));
  const label=BONUS_TYPES[type];
  // An absent bonus type is unnamed; do not infer one from the item's class.
  return {name:label?`${label}${value<0?"减值":"加值"}`:"类型未识别",value,source:name,bonusType:type};
}

export function describeAttackSources(roll,actor) {
  if(!roll?.descriptionParts||!actor)return roll;
  const targets={AttackGeneralBonus:["general","攻击修正"],AttackGeneralMeleeBonus:["melee","近战攻击修正"],AttackGeneralRangedBonus:["ranged","远程攻击修正"]};
  roll.descriptionParts=roll.descriptionParts.flatMap(part=> {
    const entry=Object.entries(targets).find(([key])=>part.name===game.i18n.localize("D35E."+key));
    if(!entry)return [{...part,name:labels[part.name]??part.name}];
    const [field,fallback]=entry[1];
    const sources=(actor.sourceDetails?.["system.attributes.attack."+field]??[])
      .filter(source=>Number.isFinite(Number(source.value))&&Number(source.value)!==0).map(sourcePart);
    const sum=sources.reduce((value,source)=>value+source.value,0);
    if(sources.length&&Number.isFinite(Number(part.value))&&Math.abs(sum-Number(part.value))<1e-8) {
      const byType=new Map();
      for(const source of sources) {
        const identity=source.bonusType+":"+Math.sign(source.value);
        const group=byType.get(identity)??{name:source.name,value:0,sources:[]};
        group.value+=source.value;group.sources.push(source);byType.set(identity,group);
      }
      return [...byType.values()];
    }
    return [{...part,name:fallback+"（来源未记录）"}];
  });
  return roll;
}

// Translate visible labels only; keep listeners, action commands, UUIDs and data intact.
export function localizeChatElement(root) {
  root=root?.[0]??root;
  if(!root?.querySelectorAll)return;
  for(const section of root.querySelectorAll("[data-3r-bonuses]"))section.remove();
  localizeSpellElement(root);
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes) {
    if(node.parentElement?.closest("script,style,textarea,pre,code"))continue;
    const raw=node.textContent,trimmed=raw.trim();
    let translated=labels[trimmed]??localizeKnownName(trimmed);
    // Old attack tooltips retain their original values; simplify only labels.
    if(node.parentElement?.closest(".table-container")) {
      const suffix=translated.match(/（([^（）]+(?:加值|减值))）$/)?.[1];
      if(suffix&&Object.values(BONUS_TYPES).some(type=>suffix===type+"加值"||suffix===type+"减值"))translated=suffix;
    }
    translated=translated.replace(/^Target:\s*(you|self)$/i,"目标：自身")
      .replace(/^Target:\s*/i,"目标：").replace(/^Range:\s*/i,"距离：");
    if(translated!==trimmed)node.textContent=raw.replace(trimmed,translated);
  }
}
export function localizeChatHtml(html) {
  const root=document.createElement("div");root.innerHTML=html??"";
  localizeChatElement(root);return root.innerHTML;
}
export function installPresentation() {
  Hooks.on("renderChatMessageHTML",(message,html)=> {
    if(message.flags?.D35E)localizeChatElement(html);
  });
  Hooks.on("renderCoreHud",(app,html)=>localizeChatElement(html));
  // Argon's tooltip is a component rather than a Foundry Application. Its
  // installed public render method returns the DOM element; no private call.
  const patched=new WeakSet();
  const patchTooltip=()=> {
    const Tooltip=CONFIG.ARGON?.CORE?.Tooltip;
    if(!Tooltip?.prototype?.render||patched.has(Tooltip))return;
    const render=Tooltip.prototype.render;
    Tooltip.prototype.render=async function(...args) {
      const result=await render.apply(this,args);
      localizeChatElement(result??this.element);return result;
    };
    patched.add(Tooltip);
  };
  patchTooltip();Hooks.on("argonInit",patchTooltip);
}
