import { MODULE_ID } from "./catalog.js";
import { Spell35E } from "../../../systems/D35E/module/item/spell.js";
import { withBonusDetails } from "./bonus-types.js";

let texts = {},loading;
const normalize = text => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const chinese = text => /[\u3400-\u9fff]/.test(withBonusDetails({},text??"")
  .replace(/<section data-3r-progress>[\s\S]*?<\/section>/g,"")
  .replace(/<p data-3r-rulebook>[\s\S]*?<\/p>/g,"").replace(/<[^>]*>/g,""));
const aliases = { "死亡侦测": "Deathwatch", "卜筮术": "Augury", "锐耳术／鹰眼术": "Clairaudience/Clairvoyance" };
const equipment = {Greatsword:"巨剑",Longsword:"长剑","Chain Shirt":"链甲衫"};
function chineseBody(html) {
  const root=document.createElement("div");root.innerHTML=withBonusDetails({},html??"");
  // Chinese parameter labels do not mean the rule prose is translated.
  for(const header of root.querySelectorAll(".spell-description > p:first-child"))header.remove();
  return chinese(root.innerHTML);
}

export function loadSpellTexts() {
  loading ??= fetch("modules/"+MODULE_ID+"/data/spell-descriptions.zh.json")
    .then(response => {
      if (!response.ok) throw new Error("无法读取中文法术说明（"+response.status+"）");
      return response.json();
    }).then(data => { texts = data.entries; });
  return loading;
}
function englishName(item) {
  if (!["spell","buff"].includes(item.type)) return null;
  const key = item.flags?.[MODULE_ID]?.key;
  if(key==="spell-effect-favor")return "Divine Favor";
  const candidate = key?.startsWith("spell-") ? key.slice(6) : key?.startsWith("pf-spell-") ? key.slice(9) : key;
  return Object.keys(texts).find(name => [candidate,item.name,item.system?.identifiedName].some(value=>
    normalize(value)&&normalize(name)===normalize(value))
    || texts[name].name === item.name || aliases[item.name] === name) ?? null;
}
export function localizeKnownName(value) {
  const name=String(value??"");
  for(const [english,entry]of Object.entries(texts))
    if(normalize(name)&&normalize(name)===normalize(english))return entry.name;
  for(const [english,translated]of Object.entries(equipment))
    if(normalize(name)===normalize(english))return translated;
  return name;
}
export function isDivineFavor(item) {
  return item?.type === "spell" && englishName(item) === "Divine Favor";
}
export function spellTextRepairs(item) {
  // Source packs stay untouched. Translate local identified copies and our packs.
  if (!item.flags?.[MODULE_ID]?.key && item.parent?.documentName !== "Actor") return {};
  const update={},saved={};
  const english=englishName(item),text=texts[english],system=item.system??{};
  const name=text&&!chinese(item.name)?text.name:localizeKnownName(item.name);
  if(name!==item.name){update.name=name;saved.name=item.name;}
  if(system.identifiedName) {
    const identified=localizeKnownName(system.identifiedName);
    if(identified!==system.identifiedName){update["system.identifiedName"]=identified;saved.identifiedName=system.identifiedName;}
  }
  if(system.specialActions?.length) {
    const actions=system.specialActions.map(action=>({...action,name:localizeKnownName(action.name)}));
    if(actions.some((action,index)=>action.name!==system.specialActions[index].name)) {
      update["system.specialActions"]=actions;saved.specialActionNames=system.specialActions.map(action=>action.name);
    }
  }
  if(text) {
    for(const [field,value]of Object.entries({shortDescription:text.shortDescription,...text.text}))
      if(!(field==="shortDescription"?chineseBody(system[field]):chinese(system[field]))&&system[field]!==value){saved[field]=system[field]??"";update["system."+field]=value;}
    if(!chineseBody(system.description?.value)) {
      saved.description=system.description?.value??"";
      update["system.description.value"]=text.shortDescription;
    }
  }
  for(const field of ["description.value","shortDescription"]) {
    const current=field==="description.value"?system.description?.value:system.shortDescription;
    const before=update["system."+field]??current;
    if(before==null)continue;
    const clean=withBonusDetails(item,before);
    if(clean!==before){saved[field]=current;update["system."+field]=clean;}
  }
  if(Object.keys(saved).length) {
    update["flags."+MODULE_ID+".originalSpellText"]={...saved,...item.flags?.[MODULE_ID]?.originalSpellText};
    if(text)update["flags."+MODULE_ID+".translationSource"]=text.source;
  }
  if(english==="Divine Favor"&&item.type==="spell") {
    if(!system.spellTarget||/^(you|self)$/i.test(system.spellTarget))update["system.spellTarget"]="自身";
    if(!system.target?.value||/^(you|self)$/i.test(system.target.value))update["system.target.value"]="自身";
    if(!system.spellDurationData?.units||["spec","special"].includes(system.spellDurationData.units))
      update["system.spellDurationData"]={units:"minute",value:"1"};
    if(!system.spellDuration||/^(1 minute|special|see text|特殊|见正文|特別)$/i.test(system.spellDuration.trim()))
      update["system.spellDuration"]="1 分钟";
  }
  return update;
}
const headerWords={
  "Casting Time":"施法时间","Manifesting Time":"展能时间","Saving Throw":"豁免检定","Spell Resistance":"法术抗力","Power Resistance":"灵能抗力",
  "Elemental School":"元素学派",Subdomain:"子领域","Sub-domain":"子领域","Power Points Cost":"灵能点消耗",
  School:"学派",Level:"等级",Domain:"领域",Bloodline:"血脉",Components:"成分",Range:"距离",Area:"区域",Target:"目标",Effect:"效果",Duration:"持续时间",
  Cleric:"牧师",Paladin:"圣武士",Wizard:"法师",Sorcerer:"术士",Bard:"吟游诗人",Druid:"德鲁伊",Ranger:"巡林客",Oracle:"先知",Witch:"女巫",Adept:"专家施法者",Inquisitor:"审判者",Mesmerist:"催眠师",
  Nobility:"贵族",War:"战争",Planning:"计划",Knowledge:"知识",Strength:"力量",Protection:"保护",Healing:"治疗",Luck:"幸运",Good:"善良",Evil:"邪恶",Law:"守序",Chaos:"混乱",
  evocation:"塑能系",abjuration:"防护系",conjuration:"咒法系",divination:"预言系",enchantment:"惑控系",illusion:"幻术系",necromancy:"死灵系",transmutation:"变化系",universal:"共通",
  "standard action":"标准动作","swift action":"迅捷动作","immediate action":"直觉动作","full-round action":"整轮动作","free action":"自由动作",
  "See text":"见正文",Special:"见正文",personal:"自身",you:"自身",self:"自身",minutes:"分钟",minute:"分钟",rounds:"轮",round:"轮",hours:"小时",hour:"小时",days:"天",day:"天",feet:"尺",Yes:"可",No:"不可",None:"无",
  V:"言语",S:"姿势",M:"材料",F:"器材",DF:"神圣器材",XP:"经验值"
};
const headerPattern=new RegExp("\\b("+Object.keys(headerWords).sort((a,b)=>b.length-a.length).join("|")+")\\b","gi");
const headerLookup=new Map(Object.entries(headerWords).map(([key,value])=>[key.toLowerCase(),value]));
export function localizeSpellElement(root) {
  for(const heading of root.querySelectorAll(".spell-description > p:first-child")) {
    const walker=document.createTreeWalker(heading,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())walker.currentNode.textContent=walker.currentNode.textContent.replace(headerPattern,word=>headerLookup.get(word.toLowerCase()));
  }
}
export function localizeSpellHeaders() {
  const original=Spell35E.prototype.getChatDescription;
  Spell35E.prototype.getChatDescription=async function(...args) {
    const html=await original.apply(this,args);
    if(!englishName(this)&&!this.getFlag(MODULE_ID,"key"))return html;
    const root=document.createElement("div");root.innerHTML=withBonusDetails(this,html);
    localizeSpellElement(root);
    return root.innerHTML;
  };
}
