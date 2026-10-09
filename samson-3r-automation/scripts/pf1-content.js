import { MODULE_ID, SOURCES } from "./catalog.js";
import { registerSeeds } from "./content.js";

export let PF1_SPELLS=[];
export let PF1_CLASSES={};
let previousTexts={};
export async function loadPF1Content() {
  const response=await fetch(`modules/${MODULE_ID}/data/pf1-cleric-spells.json`);
  if(!response.ok)throw new Error("无法读取PF1牧师法术资料。");
  const data=await response.json();
  PF1_SPELLS=data.spells;PF1_CLASSES=data.classes;
  previousTexts=data.previousTexts??{};
  Object.assign(SOURCES,data.sources);
  registerSeeds(PF1_SPELLS);
}

const clone=value=>foundry.utils.deepClone(value);
const slug=value=>String(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const textFields=["description.value","shortDescription","spellTarget","target.value","spellDuration","save.description","components.materialDescription","components.focusDescription"];
let libraryTextPreserved=0;
async function definitionTextRepairs(item,seed) {
  const owned=item.flags?.[MODULE_ID],definition=seed.flags[MODULE_ID];
  if(owned?.pfTextRevision>=definition.pfTextRevision)return null;
  const update={},previous={},preserved=[];
  for(const field of textFields) {
    const before=foundry.utils.getProperty(item.system,field),after=foundry.utils.getProperty(seed.system,field);
    if(typeof after!=="string"||before===after)continue;
    const expected=definition.previousPFTextHashes?.[field];
    if(!expected||typeof previousTexts[expected]!=="string"||before!==previousTexts[expected]){preserved.push(field);continue;}
    previous[field]=before;update[`system.${field}`]=after;
  }
  // These rule corrections contain no preparation, level, inventory or actor resources.
  for(const [field,before] of Object.entries(definition.previousPFRuleValues??{})) {
    const current=foundry.utils.getProperty(item.system,field),after=foundry.utils.getProperty(seed.system,field);
    if(current===after)continue;
    if(current!==before){preserved.push(field);continue;}
    previous[field]=current;update[`system.${field}`]=after;
  }
  if(Object.keys(previous).length)update[`flags.${MODULE_ID}.previousPFText`]={revision:owned.pfRevision??1,fields:previous};
  update[`flags.${MODULE_ID}.pfTextRevision`]=definition.pfTextRevision;
  update[`flags.${MODULE_ID}.pfTextReview`]=preserved;
  update[`flags.${MODULE_ID}.provenance.fullRuleTranslation`]=clone(definition.provenance.fullRuleTranslation);
  if(owned.clericAdjudication===definition.previousPFAdjudication)update[`flags.${MODULE_ID}.clericAdjudication`]=definition.clericAdjudication;
  return {update,preserved};
}
async function libraryPack(key,label,folder) {
  const name=`samson-pf1-${key}`;
  let pack=game.packs.get(`world.${name}`);
  if(!pack)pack=await foundry.documents.collections.CompendiumCollection.createCompendium({name,label,type:"Item",packageType:"world"});
  if(pack.folder?.id!==folder.id)await pack.setFolder(folder);
  return pack;
}
async function installEntries(pack,entries) {
  const existing=await pack.getDocuments(),folders=new Map();
  for(const level of new Set(entries.map(entry=>entry.system.level))) {
    const name=`${level}环`;
    folders.set(level,pack.folders.find(folder=>folder.type==="Item"&&folder.name===name)
      ??await Folder.create({name,type:"Item"},{pack:pack.collection}));
  }
  const missing=entries.filter(seed=>!existing.some(item=>item.getFlag(MODULE_ID,"key")===seed.flags[MODULE_ID].key));
  if(missing.length)await Item.createDocuments(missing.map(seed=>({...clone(seed),folder:folders.get(seed.system.level).id})),{pack:pack.collection});
  // Only module-created compendium definitions. Actor choices and resources are separate.
  for(const item of existing) {
    const seed=entries.find(entry=>entry.flags[MODULE_ID].key===item.getFlag(MODULE_ID,"key"));
    if(!seed||Number(item.getFlag(MODULE_ID,"pfRevision"))>=seed.flags[MODULE_ID].pfRevision)continue;
    const patch=await definitionTextRepairs(item,seed);
    if(patch?.preserved.length)libraryTextPreserved++;
    await item.update({...patch?.update,[`flags.${MODULE_ID}.pfRevision`]:2});
  }
}
async function repairOwnedPF1Text() {
  const definitions=new Map(PF1_SPELLS.map(seed=>[seed.flags[MODULE_ID].canonicalKey,seed]));
  const actors=new Map(game.actors.contents.map(actor=>[actor.uuid,actor]));
  for(const scene of game.scenes.contents)for(const token of scene.tokens.contents) {
    if(!token.actorLink&&token.actor?.isOwner)actors.set(token.actor.uuid,token.actor);
  }
  let preserved=0;
  const repair=async item=>{
    const owned=item.flags?.[MODULE_ID];
    if(!owned?.pfLibrarySpell||!item.isOwner)return null;
    const seed=definitions.get(owned.canonicalKey);
    if(!seed)return null;
    const patch=await definitionTextRepairs(item,seed);
    if(!patch)return null;
    if(patch.preserved.length)preserved++;
    return patch.update;
  };
  for(const item of game.items.contents){const update=await repair(item);if(update)await item.update(update);}
  for(const actor of actors.values()) {
    if(!actor.isOwner)continue;
    const updates=[];
    for(const item of actor.items.contents){const update=await repair(item);if(update)updates.push({_id:item.id,...update});}
    if(updates.length)await actor.updateEmbeddedDocuments("Item",updates);
  }
  if(preserved)ui.notifications.info(`PF1全文已更新；${preserved}个条目保留了自定义文字或参数，请按需要对照新合集。`);
  if(libraryTextPreserved)ui.notifications.info(`PF1合集更新保留了${libraryTextPreserved}个条目的自定义文字或参数，请按需要对照新全文。`);
}
export async function installPF1Library(parent) {
  if(game.users.activeGM!==game.user||!PF1_SPELLS.length)return;
  libraryTextPreserved=0;
  const folder=game.folders.find(entry=>entry.type==="Compendium"&&entry.name==="PF1法术"&&entry.folder?.id===parent.id)
    ??await Folder.create({name:"PF1法术",type:"Compendium",folder:parent.id});
  await installEntries(await libraryPack("all","PF1 · 本批全部法术",folder),PF1_SPELLS);
  for(const [className,label] of Object.entries(PF1_CLASSES)) {
    const entries=[];
    for(const seed of PF1_SPELLS)for(const [name,level] of seed.system.learnedAt.class) {
      if(name!==className)continue;
      const entry=clone(seed);
      entry.system.level=level;
      Object.assign(entry.flags[MODULE_ID],{key:`${seed.flags[MODULE_ID].canonicalKey}:${slug(className)}:${level}`,libraryClass:className,libraryClassLabel:label,libraryLevel:level});
      entries.push(entry);
    }
    if(!entries.length)continue;
    registerSeeds(entries);
    await installEntries(await libraryPack(slug(className),`PF1 · ${label}`,folder),entries);
  }
  await repairOwnedPF1Text();
}
