import { MODULE_ID, SOURCES, ITEMS } from "./catalog.js";
import { CHARACTER_ITEMS } from "./characters-catalog.js";
import { PF_EXTRA_SPELLS } from "./pf-spells.js";

let ruleSections = {};
const html = text => String(text).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))
  .split(/\n+/).map(line => `<p>${line}</p>`).join("");
const ruleText = key => ruleSections[key] ?? "";
const generatedSeeds=new Map();
export const registerSeeds=entries=>entries.forEach(item=>generatedSeeds.set(`${item.flags[MODULE_ID].source}:${item.flags[MODULE_ID].key}`,item));
export const allSeeds = () => [...new Map([...Object.values(ITEMS).flat(), ...Object.values(CHARACTER_ITEMS).flat(),...generatedSeeds.values()]
  .map(item=>[`${item.flags[MODULE_ID].source}:${item.flags[MODULE_ID].key}`,item])).values()];
export const ruleSection=key=>html(ruleText(key));
const add = (source, key, name, description, featType = "classFeat", extra = {}) => {
  const item = { name, type: "feat", img: "icons/svg/book.svg", system: {source:"", featType,
    description:{value:html(description)}, ...extra}, flags:{[MODULE_ID]:{key,source,
      category:featType === "racial" ? "racial" : "feature", rulebook:SOURCES[source].book}}};
  (CHARACTER_ITEMS[source] ??= []).push(item);
};
export async function loadCharacterContent() {
  const response = await fetch(`modules/${MODULE_ID}/data/rules-content.zh.json`);
  if (!response.ok) throw new Error("无法读取规则正文");
  ruleSections = (await response.json()).sections;
  CHARACTER_ITEMS.apg.push(...PF_EXTRA_SPELLS);
  for (const item of allSeeds()) {
    const k = item.flags[MODULE_ID].key;
    if (ruleSections[k]) item.system.description.value = html(ruleText(k));
    if (["lifebound","samsaran-magic","mystic-past-life"].includes(k)) {
      item.system.featType = "racial";
      item.flags[MODULE_ID].category = "racial";
    }
  }
  for (const [key,name,text] of [
    ["human-ability","人类：单项属性 +2","1级选择一项属性 +2，加值由种族条目计算。"],
    ["human-size","人类：中等体型","中型，不因体型得到加值或减值。"],
    ["human-speed","人类：标准速度","基本陆地速度30尺。负重和护甲可能降低实际速度。"],
    ["human-feat","人类：奖励专长","1级额外获得一个专长；名额由种族条目计算。"],
    ["human-skills","人类：奖励技能","1级与以后每级额外1点技能。本模组转换使用3R首级四倍与本职/跨职规则；PF合并技能拆分奖励须由DM决定并记录。"],
    ["human-language","人类：起始语言","通用语；智力足够高时可选任意额外语言，秘密语言（如德鲁伊语）除外。"]]) add("pf",key,name,text,"racial");
  add("arg","samsaran-low-light","轮回者：昏暗视觉","昏暗光照下能够看到人类两倍远的距离。","racial");
  add("arg","samsaran-body","轮回者：属性、类型与速度",ruleText("samsaran-body"),"racial");
  add("arg","samsaran-starting-languages","轮回者：起始语言",ruleText("samsaran-starting-languages"),"racial");
  add("pfu","rogue-proficiencies","游荡者：武器与防具擅长",ruleText("rogue-proficiencies"));
  add("apg","witch-familiar","女巫魔宠（待选择）",ruleText("witch-familiar"));
  add("apg","witch-hexes","女巫：巫术与进阶",ruleText("witch-hexes")+ruleText("witch-major-hexes"));
  add("apg","witch-cantrips","女巫：戏法",ruleText("witch-cantrips"));
  add("apg","oracle-orisons","先知：祷念",ruleText("oracle-orisons"));
  add("um","oracle-revelations","双重诅咒：启示与奖励法术",ruleText("oracle-revelations"));
  add("um","fortune","幸运启示（5级可选）",ruleText("fortune"),"classFeat",{activation:{type:"immediate",cost:1},uses:{value:1,max:1,per:"day"}});
  for (const action of ["health","safeguard","solace","sr"]) {
    const label = {health:"健康",safeguard:"防护",solace:"慰藉",sr:"抗法"}[action];
    add("hhc",`covenant-${action}`,`守望誓约：${label}`,ruleText("covenant-ally"),"classFeat",{activation:{type:"standard",cost:1}});
  }
  for (const [k,n] of [["languages","通晓语言"],["deathwatch","观命术"],["stabilize","稳定伤势"]])
    add("arg",`samsaran-${k}`,`轮回者魔法：${n}`,ruleText("samsaran-magic"),"racial",{activation:{type:"standard",cost:1},uses:{value:1,max:1,per:"day"},abilityType:"sp"});
  const nativeSkills = keys => Object.fromEntries(keys.split(",").map(key=>[key,true]));
  for (const item of allSeeds()) {
    const k = item.flags[MODULE_ID].key;
    if (k === "unchained-rogue") item.system.classSkills = nativeSkills("tmb,blc,jmp,apr,blf,clm,crf,dip,dev,opl,dis,esc,int,kdu,klo,dsc,fog,spk,spt,lis,src,prf,pro,sen,slt,hid,mos,swm,umd");
    if (["oracle","dual-cursed-oracle"].includes(k)) item.system.classSkills = nativeSkills("crf,dip,hea,khi,kpl,kre,pro,sen,spl");
    if (k === "witch") {
      item.system.classSkills = nativeSkills("crf,int,kar,khi,kna,kpl,pro,spl,umd");
      // The ordinary class table must not inherit the watcher's diminished slots.
      item.system.spellsPerLevel = item.system.spellsPerLevel.map(([l,...slots])=>[l,...slots.map(s=>String(Number(s)<0?-1:Number(s)+1))]);
    }
    if (k === "samsaran") Object.assign(item.system,{senses:{lowLight:true,lowLightMultiplier:2},creatureType:"humanoid",description:{value:html(ruleText("samsaran"))}});
    if (k === "banded-mail") Object.assign(item.system,{equipmentSubtype:"heavyArmor",price:250,weight:35});
    if (k === "banded-mail") item.name = "混织铁甲";
    if (k === "bec-de-corbin") Object.assign(item.system,{price:7.5,weight:9,properties:{brc:true,rch:true,trp:true,frg:true},weaponData:{...item.system.weaponData,damageType:"Bludgeoning or Piercing"}});
    if (k === "adventurer-kit") { item.name="先知工具包"; Object.assign(item.system,{price:9,weight:29,description:{value:html("背包、铺盖卷、腰包、蜡烛10根、打火石、铁壶、餐具、麻绳、肥皂、火把10根、口粮5天、水袋。9金币，29磅。")}}); }
    if (k === "sleeve-blade") Object.assign(item.system,{price:4,weight:1});
    if (k === "leather") Object.assign(item.system,{price:10,weight:15});
    if (k === "masterwork-tools") Object.assign(item.system,{price:100,weight:1});
    if (k === "tanglefoot") Object.assign(item.system,{price:50,weight:4,actionType:"rwak",range:{units:"ft",value:10},activation:{type:"standard",cost:1},ability:{attack:"dex"},save:{type:"reflexnegates",dc:"15"},description:{value:html("远程接触攻击。命中纠缠2d4轮：攻击−2，敏捷−4，速度减半。DC15反射失败时粘在地面无法移动（依靠翅膀飞行的生物无法飞行），成功仍纠缠。DC17力量挣脱或15点挥砍伤害清除。超大型及以上生物完全不受影响；非依靠翅膀飞行者不受粘附限制；水下无效。纠缠施法需要DC15专注。")}});
    if (k === "ward") item.system.activation={type:"standard",cost:1};
    if (k === "trapfinding") item.system.changes=[["max(1,floor(@classes.unchainedrogue.level/2))","skill","skill.dev","untyped"],["max(1,floor(@classes.unchainedrogue.level/2))","skill","skill.opl","untyped"]];
    if (k === "two-weapon-fighting") item.system.requirements=[["敏捷至少15","@abilities.dex.total >= 15","generic"]];
    if (k === "shadow-blade") item.system.requirements=[["掌握影手派步法","@shadowStanceKnown","generic"]];
    if (k === "celestial-agenda") {
      item.system.changes=[];
      item.system.requirements=[["必须为善良阵营","@celestialGood","generic"]];
    }
    if (k === "protective-luck") item.system.activation={type:"standard",cost:1};
    if (k === "cackle") item.system.activation={type:"move",cost:1};
    if (k === "enhanced-diplomacy") Object.assign(item.system,{school:"trs",activation:{type:"standard",cost:1},actionType:"special",range:{units:"touch"},spellTarget:"一个生物",spellDuration:"1分钟或使用一次",spellDurationData:{units:"minute",value:"1"},save:{type:"willnegates",dc:"0",description:"无害"},sr:true,components:{verbal:true,somatic:true},learnedAt:{class:[["Cleric",0],["Druid",0],["Oracle",0]]},shortDescription:"<p>目标可在一次交涉或威吓检定上获得+2表现加值，掷骰前决定使用。持续1分钟或使用后结束。</p>"});
    if (k === "noble-scion") {
      item.system.requirements=[["魅力至少13，且在1级选取","@abilities.cha.total >= 13 && @nobleSelectedAtLevel == 1","generic"]];
      item.system.changes=[["(@abilities.cha.total >= 13 && @nobleSelectedAtLevel == 1 ? @abilities.cha.mod - @abilities.dex.mod : 0)","misc","init","untyped"],["(@abilities.cha.total >= 13 && @nobleSelectedAtLevel == 1 ? 2 : 0)","skill","skill.kno","untyped"]];
    }
    if (k === "witch-watcher") item.flags[MODULE_ID].diminished=true;
    item.flags[MODULE_ID].contentRevision=4;
    if (item.type === "feat" && !item.system.description.value.includes("data-3r-rulebook"))
      item.system.description.value += `<p data-3r-rulebook><small>来源：${SOURCES[item.flags[MODULE_ID].source].book}</small></p>`;
  }
  const finesse=CHARACTER_ITEMS.pfu.find(item=>item.flags[MODULE_ID].key==="weapon-finesse");
  if(finesse) {
    CHARACTER_ITEMS.pfu=CHARACTER_ITEMS.pfu.filter(item=>item!==finesse);
    finesse.flags[MODULE_ID].source="pf";finesse.flags[MODULE_ID].rulebook=SOURCES.pf.book;
    finesse.system.description.value=finesse.system.description.value.replace(/<p data-3r-rulebook>[\s\S]*?<\/p>/g,"");
    CHARACTER_ITEMS.pf.push(finesse);
  }
}


