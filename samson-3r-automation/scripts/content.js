import { MODULE_ID, SOURCES, ITEMS } from "./catalog.js";
import { CHARACTER_ITEMS } from "./characters-catalog.js";
import { PF_EXTRA_SPELLS } from "./pf-spells.js";
import { COMMON_GEAR } from "./common-gear.js";
import { applySeedIcon } from "./content-icons.js";
import { CARD_SPELLS, CARD_GEAR, WING_FAMILIAR } from "./current-card-data.js";

let ruleSections = {};
const html = text => String(text).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))
  .split(/\n+/).map(line => `<p>${line}</p>`).join("");
const ruleText = key => ruleSections[key] ?? "";
const generatedSeeds=new Map();
export const registerSeeds=entries=>entries.forEach(item=>generatedSeeds.set(`${item.flags[MODULE_ID].source}:${item.flags[MODULE_ID].key}`,applySeedIcon(item)));
export const allSeeds = () => [...new Map([...Object.values(ITEMS).flat(), ...Object.values(CHARACTER_ITEMS).flat(),...COMMON_GEAR,...generatedSeeds.values()]
  .map(item=>[`${item.flags[MODULE_ID].source}:${item.flags[MODULE_ID].key}`,item])).values()].map(applySeedIcon);
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
  registerSeeds([...CARD_SPELLS,...CARD_GEAR,WING_FAMILIAR]);
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
    ["human-ability","人类：单项属性 +2","1级时选择一项属性，该属性获得＋2种族加值。"],
    ["human-size","人类：中等体型","中型，不因体型得到加值或减值。"],
    ["human-speed","人类：标准速度","基本陆地速度30尺。负重和护甲可能降低实际速度。"],
    ["human-feat","人类：奖励专长","1级时额外获得一个专长。"],
    ["human-skills","人类：奖励技能","1级时额外获得4点技能点，以后每级额外获得1点技能点。"],
    ["human-language","人类：起始语言","通用语；智力足够高时可选任意额外语言，秘密语言（如德鲁伊语）除外。"]]) add("pf",key,name,text,"racial");
  add("arg","samsaran-low-light","轮回者：昏暗视觉","昏暗光照下能够看到人类两倍远的距离。","racial");
  add("arg","samsaran-body","轮回者：属性、类型与速度",ruleText("samsaran-body"),"racial");
  add("arg","samsaran-starting-languages","轮回者：起始语言",ruleText("samsaran-starting-languages"),"racial");
  add("pfu","rogue-proficiencies","游荡者：武器与防具擅长",ruleText("rogue-proficiencies"));
  add("apg","witch-familiar","女巫魔宠",ruleText("witch-familiar"));
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
  const racialText={
    languages:"<p>理解听到的口语和读到的文字，必须接触说话者或文字。只了解字面意思，不获得说写能力，不能解读密码或魔法文字；每分钟阅读一页。持续每施法者等级10分钟。</p>",
    deathwatch:"<p>观察30尺锥形范围，判断生物处于死亡、脆弱（生命值3或以下）、存活但受伤、健康、不死生物或无生命构造状态。可穿透伪装死亡的法术和能力。持续每施法者等级10分钟。</p>",
    stabilize:"<p>近距内一名生命值为负、尚未死亡的活物立即稳定伤势。不会恢复生命值。意志成功无效（无害），允许法术抗力（无害）。</p>"
  };
  for(const [id,body]of Object.entries(racialText)) {
    const seed=allSeeds().find(item=>item.flags[MODULE_ID].key===`samsaran-${id}`);
    seed.system.description.value=`<p>魅力至少11时每日1次。施法者等级等于总生命骰，以魅力施法；类法术能力不需要法术成分。</p>${body}`;
  }
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
      item.system.changes=["blf","int","slt"].map(skill=>["-2","skill",`skill.${skill}`,"penalty"]);
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
  // Player-facing rules do not contain a character's selections or build notes.
  const generic = {
    "修道牧师：知识领域奖励": ITEMS.ua.find(i=>i.name==="修道牧师：知识领域奖励").system.description.value,
    "修道牧师：扩展法术列表": ITEMS.ua.find(i=>i.name==="修道牧师：扩展法术列表").system.description.value,
    "extra-hex":"<p>前提：巫术职业能力。获得一项符合前提的额外巫术；可以多次选择本专长，每次获得不同的巫术。</p>",
    "witch":"<p>女巫擅长简单武器，不擅长盔甲或盾牌。以智力准备并施放奥术，法术豁免DC为10＋法术环级＋智力修正值。智力至少达到10＋法术环级才能学习、准备和施放法术。每天睡眠8小时后，与魔宠交流1小时准备储存在魔宠中的法术。戏法准备后可反复使用；占用更高环法术位的戏法仍会耗用该法术位。</p>",
    "mystic-past-life":html(ruleText("mystic-past-life")),
    "samsaran":html(ruleText("samsaran"))
  };
  for(const item of allSeeds()) {
    const k=item.flags[MODULE_ID].key;
    if(generic[k])item.system.description.value=generic[k];
  }
  const finesse=CHARACTER_ITEMS.pfu.find(item=>item.flags[MODULE_ID].key==="weapon-finesse");
  if(finesse) {
    CHARACTER_ITEMS.pfu=CHARACTER_ITEMS.pfu.filter(item=>item!==finesse);
    finesse.flags[MODULE_ID].source="pf";finesse.flags[MODULE_ID].rulebook=SOURCES.pf.book;
    finesse.system.description.value=finesse.system.description.value.replace(/<p data-3r-rulebook>[\s\S]*?<\/p>/g,"");
    CHARACTER_ITEMS.pf.push(finesse);
  }
}


