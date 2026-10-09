import { MODULE_ID, ITEMS, SOURCES } from "./catalog.js";
import { CHARACTER_ITEMS } from "./characters-catalog.js";
import { allSeeds, registerSeeds } from "./content.js";
import { CACHE } from "../../../systems/D35E/module/cache.js";
import { conditionActorLive, reconcileConditionJob, reportConditionError } from "./condition-jobs.js";

const clone=value=>foundry.utils.deepClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const mark=item=>item?.flags?.[MODULE_ID]??{};
const key=item=>mark(item).key;
const esc=value=>foundry.utils.escapeHTML(String(value??""));
const html=text=>String(text).split(/\n+/).map(line=>`<p>${esc(line)}</p>`).join("");
const feature=item=>mark(item).pfClassFeature;
const klasses=(actor,id)=>actor.items.filter(item=>item.type==="class"&&key(item)===id);
const disabled=(klass,meta)=>(klass.system.disabledAbilities??[]).some(row=>row.uid===meta.uid&&Number(row.level)===meta.level);
const ABILITIES={str:"力量",dex:"敏捷",con:"体质",int:"智力",wis:"感知",cha:"魅力"};
const SLOT_LABELS={"oracle.curse":"先知诅咒","mystery.classSkills":"秘示域奖励本职技能","mystery.bonusSpells":"秘示域奖励法术","oracle.revelations":"启示","witch.spellcasting":"女巫施法"};
const FIELDS=["source","featType","uniqueId","associations","description","activation","actionType","changes","classSource","counterName","uses","abilityType","damage","specialActions"];
const eligible=(actor,klass,meta)=>Boolean(klass?.type==="class"&&key(klass)===meta.class&&Number(klass.system.levels)>=meta.level&&!disabled(klass,meta)
  &&(!meta.requiresArchetype||actor.items.some(item=>key(item)===meta.requiresArchetype&&archetypeAvailable(item)&&(!mark(item).archetype?.classId||mark(item).archetype.classId===klass.id))));
const snapshot=item=>({name:item.name,img:item.img,system:Object.fromEntries(FIELDS.map(field=>[field,clone(item.system[field])]))});
let rules;
export let PF_FEATURES=[];

function annotate(seed,klass,level=1) {
  const meta={class:klass,level,uid:`samson.pf.${klass}.${key(seed)}`};
  seed.flags[MODULE_ID].pfClassFeature=meta;
  const classSeed=allSeeds().find(item=>item.type==="class"&&key(item)===klass);
  seed.system.associations={...seed.system.associations,classes:[[classSeed.name,level]]};
  seed.system.uniqueId=meta.uid;
  PF_FEATURES.push(seed);
}

export async function loadPFCharacterFoundation() {
  const response=await fetch(`modules/${MODULE_ID}/data/pf-character-foundation.json`);
  if(!response.ok)throw new Error("无法读取PF种族与职业完整规则。");
  rules=await response.json();
  const human=ITEMS.pf.find(item=>key(item)==="human-pf");
  human.flags[MODULE_ID].legacyPFDescription=human.system.description.value;
  human.system.description.value=html(rules.human.text);
  human.flags[MODULE_ID].pfFoundationRevision=1;
  human.flags[MODULE_ID].ruleSource={library:rules.library,page:rules.human.page};
  for(const alias of CHARACTER_ITEMS.pf.filter(item=>["human-dex","human-cha"].includes(key(item)))) {
    alias.flags[MODULE_ID].catalogAlias="human-pf";
    alias.flags[MODULE_ID].abilityChoice=key(alias)==="human-dex"?"dex":"cha";
    alias.flags[MODULE_ID].humanChoicePending=false;
  }
  const skill=allSeeds().find(item=>key(item)==="human-skills");
  if(skill){skill.flags[MODULE_ID].legacyPFDescription=skill.system.description.value;skill.system.description.value=html("人类在1级以及以后每次升级时获得1点额外技能点。");skill.flags[MODULE_ID].pfFoundationRevision=1;}
  const dual=CHARACTER_ITEMS.um.find(item=>key(item)==="dual-cursed-oracle");
  dual.flags[MODULE_ID].archetype={baseClass:"oracle",touches:["oracle.curse","mystery.classSkills","mystery.bonusSpells","oracle.revelations"],replaces:[]};
  dual.flags[MODULE_ID].pfFoundationRevision=1;
  dual.flags[MODULE_ID].ruleSource={library:rules.library,page:rules.dual.page};
  dual.system.description.value=html(rules.dual.text)+`<details><summary>职业变体组合规则</summary>${html(rules.archetypeRules.text)}</details>`;
  // The existing watcher is already an add-on feat; mark the base and all altered features.
  const watcher=CHARACTER_ITEMS.hhc.find(item=>key(item)==="witch-watcher");
  watcher.flags[MODULE_ID].category="archetype";
  watcher.flags[MODULE_ID].archetype={baseClass:"witch",touches:["witch.spellcasting"],replaces:[]};
  watcher.flags[MODULE_ID].legacyPFDescription=watcher.system.description.value;
  watcher.flags[MODULE_ID].pfFoundationRevision=1;
  watcher.flags[MODULE_ID].ruleSource={library:rules.library,page:rules.watcher.page};
  watcher.system.description.value=html(rules.watcher.text);
  for(const id of ["covenant-ally","covenant-health","covenant-safeguard","covenant-solace","covenant-sr"]) {
    const seed=allSeeds().find(item=>key(item)===id);
    seed.flags[MODULE_ID].legacyPFDescription=seed.system.description.value;
    seed.flags[MODULE_ID].pfFoundationRevision=1;
    seed.system.description.value=html(rules.watcher.text.slice(rules.watcher.text.indexOf("守望誓约（")));
    annotate(seed,"witch");seed.flags[MODULE_ID].pfClassFeature.requiresArchetype="witch-watcher";
  }
  const oracle=CHARACTER_ITEMS.apg.find(item=>key(item)==="oracle");
  oracle.flags[MODULE_ID].legacyPFDescription=oracle.system.description.value;
  oracle.flags[MODULE_ID].pfFoundationRevision=1;
  oracle.system.description.value=html(rules.oracle.text);
  const rogueClass=CHARACTER_ITEMS.pfu.find(item=>key(item)==="unchained-rogue");
  rogueClass.flags[MODULE_ID].legacyPFDescription=rogueClass.system.description.value;
  rogueClass.flags[MODULE_ID].pfFoundationRevision=1;
  rogueClass.system.description.value=html(rules.rogue.text);
  const rogueSections=[
    ["rogue-proficiencies","游荡者：武器与防具擅长","武器与防具擅长（","偷袭（",1],
    ["sneak-attack","偷袭","偷袭（","寻找陷阱（",1],
    ["trapfinding","寻找陷阱","寻找陷阱（","巧技训练（",1],
    ["finesse-training","巧技训练","巧技训练（","反射闪避（",1],
    ["rogue-evasion","反射闪避","反射闪避（","盗贼天赋（",2],
    ["rogue-talents","盗贼天赋","盗贼天赋（","感知危险（",2],
    ["rogue-danger-sense","感知危险","感知危险（","衰弱之创（",3],
    ["rogue-debilitating-injury","衰弱之创","衰弱之创（","直觉闪避（",4],
    ["rogue-uncanny-dodge","直觉闪避","直觉闪避（","盗贼绝艺（",4],
    ["rogue-edge","盗贼绝艺","盗贼绝艺（","精通直觉闪避（",5],
    ["rogue-improved-uncanny-dodge","精通直觉闪避","精通直觉闪避（","高等天赋（",8],
    ["rogue-advanced-talents","高等天赋","高等天赋（","大师之击（",10],
    ["rogue-master-strike","大师之击","大师之击（",null,20]
  ];
  for(const [id,name,start,end,level] of rogueSections) {
    const begin=rules.rogue.text.indexOf(start),finish=end?rules.rogue.text.indexOf(end,begin+start.length):rules.rogue.text.length;
    if(begin<0||finish<0)throw new Error(`游荡者全文缺少章节：${name}`);
    let seed=allSeeds().find(item=>key(item)===id);
    if(!seed){seed={name,type:"feat",img:"icons/svg/book.svg",system:{featType:"classFeat",source:"",activation:{type:"passive",cost:0},actionType:"",changes:[]},flags:{[MODULE_ID]:{key:id,source:"pfu",category:"feature",rulebook:SOURCES.pfu.book}}};CHARACTER_ITEMS.pfu.push(seed);}
    seed.flags[MODULE_ID].legacyPFDescription=seed.system.description?.value??"";
    seed.flags[MODULE_ID].legacyPFName=seed.name;
    seed.flags[MODULE_ID].pfFoundationRevision=1;
    seed.flags[MODULE_ID].ruleSource={library:rules.library,page:rules.rogue.page};
    seed.system.description={value:html(rules.rogue.text.slice(begin,finish).trim())};
    seed.name=name;
    annotate(seed,"unchained-rogue",level);
  }
  const finesse=clone(allSeeds().find(item=>key(item)==="weapon-finesse"));
  finesse.flags[MODULE_ID].key="rogue-bonus-weapon-finesse";
  finesse.flags[MODULE_ID].category="feature";
  finesse.flags[MODULE_ID].grants=["weapon-finesse"];
  annotate(finesse,"unchained-rogue");
  finesse.flags[MODULE_ID].pfClassFeature.adoptKey="weapon-finesse";
  finesse.system.classSource="职业奖励";
  CHARACTER_ITEMS.pf.push(finesse);
  const training=PF_FEATURES.find(item=>key(item)==="finesse-training");
  training.system.counterName=[...new Set([...(training.system.counterName??"").split(";").filter(Boolean),"feat.职业奖励"])].join(";");
  // Each section is the complete CHM paragraph, not a class-summary replacement.
  const boundaries=[
    ["oracle-proficiencies","先知：武器和防具擅长","武器和防具擅长：","法术：",1,"proficiencies"],
    ["oracle-spellcasting","先知：法术","法术：","秘示域（Mystery）",1,"spellcasting"],
    ["oracle-mystery","先知：秘示域","秘示域（Mystery）","先知诅咒（",1,"mystery"],
    ["oracle-curse","先知：诅咒","先知诅咒（","祷念（",1,"curse"],
    ["oracle-orisons","先知：祷念","祷念（","启示（",1,"orisons"],
    ["oracle-revelation-progression","先知：启示","启示（","最终启示（",1,"revelations"],
    ["oracle-final-revelation","先知：最终启示","最终启示（",null,20,"finalRevelation"]
  ];
  for(const [id,name,start,end,level,slot] of boundaries) {
    const begin=rules.oracle.text.indexOf(start),finish=end?rules.oracle.text.indexOf(end,begin+start.length):rules.oracle.text.length;
    if(begin<0||finish<0)throw new Error(`先知全文缺少章节：${name}`);
    const old=allSeeds().find(item=>key(item)===id);
    const seed={name,type:"feat",img:old?.img??"icons/svg/book.svg",system:{featType:"classFeat",source:"",activation:{type:"passive",cost:0},actionType:"",changes:[],description:{value:html(rules.oracle.text.slice(begin,finish).trim())}},
      flags:{[MODULE_ID]:{key:id,source:"apg",category:"feature",rulebook:SOURCES.apg.book,pfFoundationRevision:1,ruleSlot:`oracle.${slot}`,ruleSource:{library:rules.library,page:rules.oracle.page},...(old?{legacyPFDescription:old.system.description.value}:{})}}};
    annotate(seed,"oracle",level);
    if(old)Object.assign(old,seed);else CHARACTER_ITEMS.apg.push(seed);
  }
  registerSeeds([...PF_FEATURES,human,dual,watcher]);
}

// Shared Item repair preserves class linkage and every already chosen ability.
export function pfFoundationRepairs(item,seed) {
  if(!seed)return {};
  const update={},meta=mark(item),desired=mark(seed);
  if(feature(seed)&&["class","uid","level","requiresArchetype"].some(field=>feature(item)?.[field]!==feature(seed)[field]))
    update[`flags.${MODULE_ID}.pfClassFeature`]={...(feature(item)??{}),...feature(seed)};
  if(desired.archetype&&!meta.archetype&&item.type==="feat") {
    update[`flags.${MODULE_ID}.archetype`]=clone(desired.archetype);
    update[`flags.${MODULE_ID}.category`]="archetype";
  }
  if(desired.catalogAlias&&meta.catalogAlias!==desired.catalogAlias)update[`flags.${MODULE_ID}.catalogAlias`]=desired.catalogAlias;
  if(desired.ruleSource&&!meta.ruleSource)update[`flags.${MODULE_ID}.ruleSource`]=clone(desired.ruleSource);
  if(item.pack&&feature(seed)) {
    if(!same(item.system.associations,seed.system.associations))update["system.associations"]=clone(seed.system.associations);
    if(item.system.uniqueId!==seed.system.uniqueId)update["system.uniqueId"]=seed.system.uniqueId;
  }
  if(key(item)==="finesse-training"&&!feature(item)?.retainedInactive&&!String(item.system.counterName??"").split(";").includes("feat.职业奖励"))
    update["system.counterName"]=[...(item.system.counterName??"").split(";").filter(Boolean),"feat.职业奖励"].join(";");
  if(desired.pfFoundationRevision&&!meta.pfFoundationRevision) {
    const current=item.system.description?.value??"";
    const withoutBook=value=>String(value??"").replace(/<p data-3r-rulebook>[\s\S]*?<\/p>/g,"");
    if(!item.actor||withoutBook(current)===withoutBook(desired.legacyPFDescription)||!current) {
      update[`flags.${MODULE_ID}.previousPFDescription`]=current;
      const footer=seed.system.description.value.includes("data-3r-rulebook")?"":(current.match(/<p data-3r-rulebook>[\s\S]*?<\/p>/g)??[]).join("");
      update["system.description.value"]=seed.system.description.value+footer;
    }
    update[`flags.${MODULE_ID}.pfFoundationRevision`]=1;
    if(desired.legacyPFName&&item.name===desired.legacyPFName&&item.name!==seed.name) {
      update[`flags.${MODULE_ID}.previousPFName`]=item.name;update.name=seed.name;
    }
  }
  if(key(item)==="human-pf"&&item.pack) {
    // Only the library template loses its historical Strength default.
    if(same(item.system.changes,[["2","ability","str","racial"]]))update["system.changes"]=[];
    if(meta.abilityChoice)update[`flags.${MODULE_ID}.-=abilityChoice`]=null;
    if(meta.humanChoicePending!==true)update[`flags.${MODULE_ID}.humanChoicePending`]=true;
  }
  return update;
}

export function archetypeAvailable(item) {
  const meta=mark(item).archetype;
  return !meta||!item.actor||klasses(item.actor,meta.baseClass).some(klass=>(!meta.classId||klass.id===meta.classId)&&Number(klass.system.levels)>0);
}

function conflicts(actor,seed,klass) {
  const meta=mark(seed).archetype;
  if(!meta?.baseClass||!Array.isArray(meta.touches))throw new Error("此变体缺少原书的替换关系，不能自动确认组合。");
  const selected=actor.items.filter(item=>mark(item).archetype?.baseClass===meta.baseClass&&(!mark(item).archetype.classId||mark(item).archetype.classId===klass.id));
  if(selected.some(item=>key(item)===key(seed)))throw new Error("已经选取这个职业变体。");
  for(const item of selected) {
    const other=mark(item).archetype;
    if(!Array.isArray(other.touches))throw new Error(`${item.name}没有完整替换关系，无法确认组合。`);
    const shared=meta.touches.filter(slot=>other.touches.includes(slot));
    if(shared.length)throw new Error(`${seed.name}与${item.name}同时修改${[...new Set(shared.map(slot=>SLOT_LABELS[slot]??"同一项职业能力"))].join("、")}，不能并用。`);
  }
}

async function chooseAbility(current=null) {
  const result=await foundry.applications.api.DialogV2.wait({window:{title:"PF人类：选择属性 +2"},rejectClose:false,
    content:`<form><p>选择一项属性获得 +2 种族加值。</p><select name="ability"><option value="">请选择属性</option>${Object.entries(ABILITIES).map(([id,label])=>`<option value="${id}" ${id===current?"selected":""}>${label} +2</option>`).join("")}</select></form>`,
    buttons:[{action:"choose",label:"选用这项属性",callback:(_event,_button,dialog)=>dialog.element.querySelector('[name="ability"]').value},{action:"cancel",label:"取消",callback:()=>null}]});
  if(result&&!Object.hasOwn(ABILITIES,result))throw new Error("请选择六项属性中的一项。");
  return result||null;
}

export async function preparePFImport(actor,data) {
  if(!actor.isOwner)throw new Error("你没有这个角色的编辑权限。");
  if(data.type==="race"&&["human-pf","human-dex","human-cha"].includes(key(data))) {
    const choice=await chooseAbility();if(!choice)return null;
    data.flags[MODULE_ID]={...mark(data),key:"human-pf",abilityChoice:choice,humanChoicePending:false};
    delete data.flags[MODULE_ID].catalogAlias;
    data.name="PF 人类";
    data.system.changes=[["2","ability",choice,"racial"]];
    data.system.description.value=html(rules.human.text);
  }
  const meta=mark(data).archetype;
  if(meta) {
    let classes=klasses(actor,meta.baseClass);
    if(!classes.length) {
      const base=allSeeds().find(item=>item.type==="class"&&key(item)===meta.baseClass);
      if(!base)throw new Error("缺少此变体的基础职业资料。");
      const add=await foundry.applications.api.DialogV2.confirm({window:{title:"先加入基础职业"},content:`<p>${esc(data.name)}是${esc(base.name)}的变体。加入${esc(base.name)}1级后再选用此变体？</p>`,rejectClose:false});
      if(!add)return null;
      classes=klasses(actor,meta.baseClass);
      if(!classes.length)classes=await actor.createEmbeddedDocuments("Item",[clone(base)]);
    }
    let klass=classes[0];
    if(classes.length>1) {
      const id=await foundry.applications.api.DialogV2.wait({window:{title:"选择变体对应的职业"},rejectClose:false,buttons:classes.map((item,index)=>({action:`class-${index}`,label:esc(`${item.name} ${item.system.levels}级`),callback:()=>item.id}))});
      if(!id)return null;klass=actor.items.get(id);
    }
    if(!klass||!conditionActorLive(actor))return null;
    conflicts(actor,data,klass);
    data.flags[MODULE_ID].archetype={...meta,classId:klass.id};
    data.system.source=`${klass.name} 1`;data.system.uniqueId="";
  }
  return data;
}

async function syncFeatures(actor) {
  if(!conditionActorLive(actor)||!actor.isOwner)return;
  const updates=[],missing=[],remove=[];
  for(const item of actor.items.filter(item=>feature(item)?.classId)) {
    const meta=feature(item),klass=actor.items.get(meta.classId);
    const valid=eligible(actor,klass,meta);
    if(!valid) {
      if(meta.generated&&same(snapshot(item),meta.generated))remove.push(item.id);
      else if(!meta.retainedInactive)updates.push({_id:item.id,[`flags.${MODULE_ID}.pfClassFeature.retainedInactive`]:true,
        [`flags.${MODULE_ID}.pfClassFeature.inactiveChanges`]:clone(item.system.changes??[]),[`flags.${MODULE_ID}.pfClassFeature.inactiveCounters`]:item.system.counterName??"",
        "system.changes":[],"system.counterName":""});
    } else if(meta.retainedInactive)updates.push({_id:item.id,[`flags.${MODULE_ID}.pfClassFeature.retainedInactive`]:false,
      ...(!item.system.changes?.length?{"system.changes":clone(meta.inactiveChanges??[])}:{}),
      ...(!item.system.counterName?{"system.counterName":meta.inactiveCounters??""}:{})});
  }
  for(const seed of PF_FEATURES)for(const klass of klasses(actor,feature(seed).class)) {
    const meta=feature(seed);if(!eligible(actor,klass,meta))continue;
    const existing=actor.items.find(item=>item.type==="feat"&&[key(seed),meta.adoptKey].filter(Boolean).includes(key(item))&&(!feature(item)?.classId||feature(item).classId===klass.id));
    const source=`${klass.name} ${meta.level}`;
    if(existing) {
      const old=feature(existing),patch={_id:existing.id};
      if(!old?.classId) {
        patch[`flags.${MODULE_ID}.pfClassFeature`]={...meta,classId:klass.id,adopted:true,linkedSource:source,previousSource:existing.system.source??"",previousUniqueId:existing.system.uniqueId??""};
        patch["system.source"]=source;patch["system.uniqueId"]="";
      } else if(existing.system.source===(old.generated?.system.source??old.linkedSource)&&existing.system.source!==source) {
        patch["system.source"]=source;
        if(old.generated){const next=clone(old.generated);next.system.source=source;patch[`flags.${MODULE_ID}.pfClassFeature.generated`]=next;}
        else patch[`flags.${MODULE_ID}.pfClassFeature.linkedSource`]=source;
      }
      if(Object.keys(patch).length>1)updates.push(patch);
    } else {
      const data=clone(seed);data.system.source=source;data.system.uniqueId="";
      data.flags[MODULE_ID].pfClassFeature={...meta,classId:klass.id};missing.push(data);
    }
  }
  if(remove.length&&conditionActorLive(actor))await actor.deleteEmbeddedDocuments("Item",remove,{pfFeatureSync:true});
  if(updates.length&&conditionActorLive(actor)) {
    const merged=new Map();for(const row of updates)merged.set(row._id,{...merged.get(row._id),...row});
    await actor.updateEmbeddedDocuments("Item",[...merged.values()].filter(row=>actor.items.has(row._id)),{pfFeatureSync:true});
  }
  if(missing.length&&conditionActorLive(actor)) {
    const created=await actor.createEmbeddedDocuments("Item",missing,{pfFeatureSync:true});
    if(conditionActorLive(actor))await actor.updateEmbeddedDocuments("Item",created.filter(item=>actor.items.has(item.id)).map(item=>({_id:item.id,[`flags.${MODULE_ID}.pfClassFeature.generated`]:snapshot(item)})),{pfFeatureSync:true});
  }
}
export function syncPFFeatures(actor) {
  if(game.users.activeGM!==game.user)return Promise.resolve();
  return reconcileConditionJob(actor,"pf-class-features",async()=>{await repairLegacyOracle(actor);await syncFeatures(actor);});
}

// Keep the old class document as the base class: no type/HD/level/resource/tag change.
async function repairLegacyOracle(actor) {
  for(const klass of actor.items.filter(item=>item.type==="class"&&key(item)==="dual-cursed-oracle"&&mark(item).source==="um")) {
    if(klasses(actor,"oracle").length) {
      ui.notifications.warn(`${actor.name}同时存在旧双重诅咒职业和先知职业，保留原等级；请DM核对后删除重复职业。`);continue;
    }
    const seed=allSeeds().find(item=>item.type==="feat"&&key(item)==="dual-cursed-oracle"),data=clone(seed);
    data.flags[MODULE_ID].archetype={...mark(seed).archetype,classId:klass.id};
    data.system.source=`${klass.name==="双重诅咒先知"?"先知":klass.name} 1`;data.system.uniqueId="";
    if(!actor.items.some(item=>item.type==="feat"&&key(item)==="dual-cursed-oracle"))await actor.createEmbeddedDocuments("Item",[data],{pfFeatureSync:true,pfLegacyMigration:true});
    if(!conditionActorLive(actor)||!actor.items.has(klass.id))return;
    await klass.update({...(klass.name==="双重诅咒先知"?{name:"先知"}:{}),
      [`flags.${MODULE_ID}.legacyDualClass`]:{name:klass.name,source:klass.system.source,key:key(klass),customTag:klass.system.customTag},
      [`flags.${MODULE_ID}.key`] : "oracle",[`flags.${MODULE_ID}.source`] : "apg",[`flags.${MODULE_ID}.rulebook`]:SOURCES.apg.book,
      [`flags.${MODULE_ID}.category`] : "class"},{pfFeatureSync:true});
  }
  // Attach existing add-ons to the one unambiguous class without replacing choices.
  const updates=[];
  for(const item of actor.items.filter(item=>item.type==="feat"&&mark(item).archetype)) {
    const meta=mark(item).archetype,classes=klasses(actor,meta.baseClass);
    const klass=classes.find(klass=>klass.id===meta.classId)??(!meta.classId&&classes.length===1?classes[0]:null);
    if(!klass)continue;
    const source=`${klass.name} 1`,patch={_id:item.id};
    if(!meta.classId)patch[`flags.${MODULE_ID}.archetype.classId`]=klass.id;
    if(!meta.linkedSource) {
      if(!item.system.source||item.system.source===source||item.system.source===SOURCES[mark(item).source]?.book) {
        patch["system.source"]=source;patch[`flags.${MODULE_ID}.archetype.linkedSource`]=source;
        patch[`flags.${MODULE_ID}.archetype.previousSource`]=item.system.source??"";
      }
    } else if(item.system.source===meta.linkedSource&&source!==meta.linkedSource) {
      patch["system.source"]=source;patch[`flags.${MODULE_ID}.archetype.linkedSource`]=source;
    }
    if(item.system.uniqueId)patch["system.uniqueId"]="";
    if(Object.keys(patch).length>1)updates.push(patch);
  }
  if(updates.length&&conditionActorLive(actor))await actor.updateEmbeddedDocuments("Item",updates,{pfFeatureSync:true});
  for(const klass of klasses(actor,"witch")) {
    const watcher=actor.items.some(item=>key(item)==="witch-watcher"&&archetypeAvailable(item)&&(!mark(item).archetype?.classId||mark(item).archetype.classId===klass.id));
    const saved=mark(klass).pfArchetypeSlots,table=klass.system.spellsPerLevel;
    if(watcher&&!saved) {
      const base=allSeeds().find(item=>item.type==="class"&&key(item)==="witch").system.spellsPerLevel;
      const diminished=base.map(([level,...slots])=>[level,...slots.map(value=>String(Number(value)<0?-1:Number(value)-1))]);
      if(!same(table,base)&&!same(table,diminished))continue; // custom table needs the GM's decision
      if(!conditionActorLive(actor)||!actor.items.has(klass.id))return;
      await klass.update({...(same(table,diminished)?{}:{"system.spellsPerLevel":diminished}),
        [`flags.${MODULE_ID}.pfArchetypeSlots`]:{previous:clone(base),applied:diminished},[`flags.${MODULE_ID}.watcherSlotsRepaired`]:true},{pfFeatureSync:true});
    } else if(!watcher&&saved&&conditionActorLive(actor)&&actor.items.has(klass.id)) {
      await klass.update({...(same(table,saved.applied)?{"system.spellsPerLevel":saved.previous}:{}),
        [`flags.${MODULE_ID}.-=pfArchetypeSlots`]:null,[`flags.${MODULE_ID}.-=watcherSlotsRepaired`]:null},{pfFeatureSync:true});
    }
  }
}
export async function syncWorldPFFeatures() {
  if(game.users.activeGM!==game.user)return;
  const actors=new Map(game.actors.contents.map(actor=>[actor.uuid,actor]));
  for(const scene of game.scenes.contents)for(const token of scene.tokens)if(!token.actorLink&&token.actor)actors.set(token.actor.uuid,token.actor);
  for(const actor of actors.values()) {
    if(!actor.items.some(item=>["oracle","dual-cursed-oracle","unchained-rogue","witch-watcher","witch"].includes(key(item))||feature(item)))continue;
    await syncPFFeatures(actor);
  }
}

export async function registerPFFeatureCache() {
  const own=item=>Boolean(feature(item));
  for(const [name,entries] of CACHE.ClassFeatures)CACHE.ClassFeatures.set(name,entries.filter(item=>!own(item)));
  CACHE.AllClassFeatures=CACHE.AllClassFeatures.filter(item=>!own(item));
  for(const [uid,item] of CACHE.AllAbilities)if(own(item))CACHE.AllAbilities.delete(uid);
  for(const source of ["pf","pfu","apg","hhc"]) {
    const pack=game.packs.get(`world.samson-${source}`);if(!pack)continue;
    for(const item of (await pack.getDocuments()).filter(own)) {
      for(const [name] of item.system.associations.classes??[]) {
        const entries=CACHE.ClassFeatures.get(name)??[];entries.push(item);CACHE.ClassFeatures.set(name,entries);
      }
      CACHE.AllClassFeatures.push(item);CACHE.AllAbilities.set(item.system.uniqueId,item);
    }
  }
}

async function finishHumanChoice(item) {
  if(!item.actor?.isOwner||!conditionActorLive(item.actor))return;
  const current=mark(item).abilityChoice;
  const choice=await chooseAbility(Object.hasOwn(ABILITIES,current)?current:null);
  if(!choice||!conditionActorLive(item.actor)||!item.actor.items.has(item.id))return;
  // Remove only the exact previous human +2 row, retaining custom race changes.
  const old=item.system.changes??[],rows=old.filter(row=>!(row[0]==="2"&&row[1]==="ability"&&row[2]===current&&row[3]==="racial"));
  rows.push(["2","ability",choice,"racial"]);
  await item.update({"system.changes":rows,[`flags.${MODULE_ID}.abilityChoice`]:choice,[`flags.${MODULE_ID}.humanChoicePending`]:false});
}

async function selectArchetypes(actor,klass) {
  const seeds=allSeeds().filter(seed=>mark(seed).archetype?.baseClass===key(klass));
  if(!seeds.length)return;
  const selected=actor.items.filter(item=>mark(item).archetype?.classId===klass.id);
  const candidates=seeds.filter(seed=>!selected.some(item=>key(item)===key(seed)));
  const answer=await foundry.applications.api.DialogV2.wait({window:{title:`${klass.name}：职业变体`},rejectClose:false,
    content:`<form><p>已选：${esc(selected.map(item=>item.name).join("、")||"无")}</p><p>可以选多个；修改同一项职业能力的变体不能并用。查看完整规则后再选取，已选变体可从角色卡移除。</p>${candidates.map(seed=>{let reason="";try{conflicts(actor,seed,klass);}catch(error){reason=error.message;}return `<label><input type="checkbox" name="variant" value="${esc(key(seed))}" ${reason?"disabled":""}>${esc(seed.name)} ${reason?esc(reason):""}</label>`;}).join("")||"<p>当前资料没有其他可选变体。</p>"}</form>`,
    buttons:[{action:"add",label:"加入所选变体",callback:(_event,_button,dialog)=>[...dialog.element.querySelectorAll('[name="variant"]:checked')].map(input=>input.value)},{action:"cancel",label:"取消",callback:()=>null}]});
  if(!answer?.length||!conditionActorLive(actor)||!actor.items.has(klass.id))return;
  const data=answer.map(id=>clone(candidates.find(seed=>key(seed)===id)));
  for(let i=0;i<data.length;i++) {
    conflicts(actor,data[i],klass);
    for(let j=0;j<i;j++)if(mark(data[i]).archetype.touches.some(slot=>mark(data[j]).archetype.touches.includes(slot)))throw new Error(`${data[i].name}与${data[j].name}修改同一能力，未加入任何变体。`);
    data[i].system.source=`${klass.name} 1`;data[i].system.uniqueId="";data[i].flags[MODULE_ID].archetype.classId=klass.id;
  }
  await actor.createEmbeddedDocuments("Item",data);
}

export function installPFCharacterFoundation() {
  const report=error=>reportConditionError("PF职业与种族处理",error);
  const pendingHumans=new WeakSet();
  Hooks.on("preCreateItem",(item,_data,options)=>{
    if(!item.actor)return;
    const meta=feature(item);
    if(meta) {
      if(!conditionActorLive(item.actor)){item.updateSource({"system.uniqueId":""});return;}
      const klass=klasses(item.actor,meta.class).find(klass=>!meta.classId||klass.id===meta.classId);
      if(!eligible(item.actor,klass,meta))return false;
      if(item.actor.items.some(existing=>key(existing)===key(item)&&(!feature(existing)?.classId||feature(existing).classId===klass.id)))return false;
      item.updateSource({"system.uniqueId":"","system.source":`${klass.name} ${meta.level}`,[`flags.${MODULE_ID}.pfClassFeature.classId`]:klass.id});
    }
    const variant=mark(item).archetype;
    if(variant&&!options.pfLegacyMigration) {
      if(!conditionActorLive(item.actor)){item.updateSource({"system.uniqueId":""});return;}
      const classes=klasses(item.actor,variant.baseClass),klass=classes.find(klass=>klass.id===variant.classId)??(classes.length===1?classes[0]:null);
      if(!klass){ui.notifications.warn("请先加入此变体的基础职业，再从该职业的变体按钮选取。");return false;}
      try{conflicts(item.actor,item,klass);}catch(error){ui.notifications.warn(error.message);return false;}
      item.updateSource({[`flags.${MODULE_ID}.archetype.classId`]:klass.id,"system.source":`${klass.name} 1`,"system.uniqueId":""});
    }
  });
  Hooks.on("createActor",actor=>syncPFFeatures(actor).catch(report));
  Hooks.on("createItem",(item,_options,userId)=>{
    if(item.actor&&item.type==="race"&&key(item)==="human-pf"&&mark(item).humanChoicePending&&game.user.id===userId&&!pendingHumans.has(item)) {
      pendingHumans.add(item);finishHumanChoice(item).catch(report).finally(()=>pendingHumans.delete(item));
    }
  });
  for(const event of ["createItem","deleteItem"])Hooks.on(event,(item,options)=>{
    if(options?.pfFeatureSync||!item.actor)return;
    if((item.type==="class"&&["unchained-rogue","oracle","witch"].includes(key(item)))||mark(item).archetype)syncPFFeatures(item.actor).catch(report);
  });
  Hooks.on("updateItem",(item,change,options)=>{
    if(options?.pfFeatureSync||item.type!=="class"||!item.actor||!["unchained-rogue","oracle","witch"].includes(key(item)))return;
    const flat=foundry.utils.flattenObject(change);
    if(Object.keys(flat).some(path=>path==="name"||path==="system.levels"||path.startsWith("system.disabledAbilities")))syncPFFeatures(item.actor).catch(report);
  });
  Hooks.on("deleteItem",async(item,options)=>{
    const meta=feature(item),klass=item.actor?.items.get(meta?.classId);
    if(options?.pfFeatureSync||game.users.activeGM!==game.user||!klass||!conditionActorLive(item.actor)||disabled(klass,meta))return;
    try{await klass.update({"system.disabledAbilities":[...(klass.system.disabledAbilities??[]),{uid:meta.uid,level:meta.level}]});}catch(error){report(error);}
  });
  Hooks.on("renderItemSheet",(app,element)=>{
    const root=element?.nodeType===1?element:element?.[0],item=app.item,actor=item?.actor;
    if(!root||!actor?.isOwner)return;
    let label,run;
    if(item.type==="race"&&key(item)==="human-pf") {label=`人类属性：${ABILITIES[mark(item).abilityChoice]??"尚未选择"} · 选择属性`;run=()=>finishHumanChoice(item);}
    if(item.type==="class"&&allSeeds().some(seed=>mark(seed).archetype?.baseClass===key(item))) {label="选择职业变体（可多选）";run=()=>selectArchetypes(actor,item);}
    if(!run||root.querySelector(".three-r-pf-character-choice"))return;
    const host=root.querySelector(".sheet-header");if(!host)return;
    const button=document.createElement("button");button.type="button";button.className="three-r-pf-character-choice";button.textContent=label;
    button.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();run().catch(report);});host.after(button);
  });
}
