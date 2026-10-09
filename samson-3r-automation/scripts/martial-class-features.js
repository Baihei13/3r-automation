import { CACHE } from "../../../systems/D35E/module/cache.js";
import { MODULE_ID } from "./catalog.js";
import { SWORDSAGE_FEATURES } from "./martial-content.js";
import { clone } from "./martial-state.js";

const feature=item=>item?.flags?.[MODULE_ID]?.martialClassFeature;
const isClass=item=>item?.type==="class"&&item.flags?.[MODULE_ID]?.martialClass==="swordsage";
const key=item=>item?.flags?.[MODULE_ID]?.key;
const queues=new Map();
const systemFields=["featType","source","uniqueId","associations","description","shortDescription","activation","actionType","abilityType","changes","uses","showInQuickbar"];
const snapshot=item=>({name:item.name,img:item.img,system:Object.fromEntries(systemFields.map(field=>[field,clone(item.system[field])]))});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const disabled=(klass,meta)=>(klass.system.disabledAbilities??[]).some(row=>row.uid===meta.uid&&Number(row.level)===meta.level);
const classes=actor=>actor?.items?.filter(isClass)??[];

// Compendium UIDs enable the native progression table. Actor copies use our
// stable flag: native automaticFeatures=false otherwise removes their UIDs.
// Never enable native auto on existing classes or rebuild unrelated caches.
export async function registerSwordsageFeatureCache() {
  const pack=game.packs.get("world.samson-tob");if(!pack)return;
  const docs=(await pack.getDocuments()).filter(item=>feature(item)?.class==="swordsage");
  if(!docs.length)return;
  const own=item=>feature(item)?.class==="swordsage"&&item.flags?.[MODULE_ID]?.source==="tob";
  for(const [name,entries] of CACHE.ClassFeatures)CACHE.ClassFeatures.set(name,entries.filter(item=>!own(item)));
  CACHE.AllClassFeatures=CACHE.AllClassFeatures.filter(item=>!own(item));
  for(const [uid,item] of CACHE.AllAbilities)if(own(item))CACHE.AllAbilities.delete(uid);
  for(const item of docs) {
    for(const [name] of item.system.associations.classes??[]) {
      const entries=CACHE.ClassFeatures.get(name)??[];entries.push(item);CACHE.ClassFeatures.set(name,entries);
    }
    CACHE.AllAbilities.set(item.system.uniqueId,item);CACHE.AllClassFeatures.push(item);
  }
}

export function swordsageFeatureAvailable(actor,id) {
  const seed=SWORDSAGE_FEATURES.find(item=>key(item)===`swordsage-feature-${id}`),meta=feature(seed);
  return Boolean(meta&&classes(actor).some(klass=>Number(klass.system.levels)>=meta.level&&!disabled(klass,meta)));
}

export function swordsageFeatureAction(item) {
  const meta=feature(item);if(!meta)return null;
  const available=item.actor&&classes(item.actor).some(klass=>(!meta.classId||klass.id===meta.classId)&&Number(klass.system.levels)>=meta.level&&!disabled(klass,meta));
  const mode=["sense","dual"].includes(meta.op)?"action":["focus","open"].includes(meta.op)?"configure":"reference";
  return {mode,kind:mode==="action"?meta.op==="sense"?"standard":"swift":null,available:Boolean(available),label:available?meta.op==="focus"?"选择流派专攻":meta.op==="sense"?"感知魔法":meta.op==="dual"?"双重强化":meta.op==="open"?"打开武术页":"被动能力 · 查看完整规则":"职业等级不足、来源已移除或此特性已停用"};
}

async function sync(actor) {
  if(!actor?.items||!actor.isOwner)return;
  const existingClasses=classes(actor),remove=[],updates=[];
  // Remove only untouched copies we created. Preserve player-edited abilities
  // as reference entries; availability checks still block invalid actions.
  for(const item of actor.items.filter(item=>feature(item)?.classId)) {
    const meta=feature(item),klass=existingClasses.find(klass=>klass.id===meta.classId);
    if(!klass||Number(klass.system.levels)<meta.level||disabled(klass,meta)) {
      if(meta.generated&&same(snapshot(item),meta.generated))remove.push(item.id);
      else if(!meta.retainedInactive)updates.push({_id:item.id,[`flags.${MODULE_ID}.martialClassFeature.retainedInactive`]:true});
    } else {
      const source=`${klass.name} ${meta.level}`;
      if(meta.generated&&item.system.source===meta.generated.system.source&&item.system.source!==source) {
        const next=clone(meta.generated);next.system.source=source;
        updates.push({_id:item.id,"system.source":source,[`flags.${MODULE_ID}.martialClassFeature.generated`]:next});
      }
      if(meta.retainedInactive)updates.push({_id:item.id,[`flags.${MODULE_ID}.martialClassFeature.retainedInactive`]:false});
    }
  }
  if(remove.length)await actor.deleteEmbeddedDocuments("Item",remove,{swordsageFeatureSync:true});
  if(updates.length)await actor.updateEmbeddedDocuments("Item",updates,{swordsageFeatureSync:true});
  const missing=[];
  for(const klass of existingClasses)for(const seed of SWORDSAGE_FEATURES) {
    const meta=feature(seed);if(Number(klass.system.levels)<meta.level||disabled(klass,meta))continue;
    const found=actor.items.some(item=>(key(item)===key(seed)&&(!feature(item)?.classId||feature(item).classId===klass.id))||item.system.uniqueId===meta.uid);
    if(found)continue;
    const data=clone(seed);data.system.uniqueId="";data.system.source=`${klass.name} ${meta.level}`;
    data.flags[MODULE_ID].martialClassFeature={...meta,classId:klass.id};missing.push(data);
  }
  if(missing.length) {
    const created=await actor.createEmbeddedDocuments("Item",missing,{swordsageFeatureSync:true});
    await actor.updateEmbeddedDocuments("Item",created.map(item=>({_id:item.id,[`flags.${MODULE_ID}.martialClassFeature.generated`]:snapshot(item)})),{swordsageFeatureSync:true});
  }
}

export function syncSwordsageFeatures(actor) {
  if(game.users.activeGM!==game.user||!actor)return Promise.resolve();
  const next=(queues.get(actor.uuid)??Promise.resolve()).catch(()=>{}).then(()=>sync(actor));queues.set(actor.uuid,next);
  return next.finally(()=>{if(queues.get(actor.uuid)===next)queues.delete(actor.uuid);});
}

export async function syncWorldSwordsageFeatures() {
  if(game.users.activeGM!==game.user)return;
  const actors=new Map(game.actors.contents.map(actor=>[actor.uuid,actor]));
  for(const scene of game.scenes.contents)for(const token of scene.tokens)if(!token.actorLink&&token.actor)actors.set(token.actor.uuid,token.actor);
  for(const actor of actors.values())if(classes(actor).length||actor.items.some(item=>feature(item)?.classId))await syncSwordsageFeatures(actor);
}

export function installSwordsageFeatures(command,open) {
  const report=error=>{console.error(`${MODULE_ID}: swordsage features`,error);ui.notifications.error(`贤者之剑职业特性未补齐：${error.message}`);};
  let cachePending=null;
  const refreshCache=()=>{
    if(cachePending)return;
    cachePending=Promise.resolve().then(registerSwordsageFeatureCache).catch(report).finally(()=>{cachePending=null;});
  };
  for(const event of ["createItem","updateItem","deleteItem"])Hooks.on(event,item=>{
    if(item.pack==="world.samson-tob"&&feature(item))refreshCache();
  });
  Hooks.on("preCreateItem",item=>{
    const meta=feature(item),actor=item.actor;if(!meta||!actor)return;
    const klass=classes(actor).find(klass=>klass.id===meta.classId)??classes(actor).find(klass=>item.system.source===`${klass.name} ${meta.level}`);
    if(!klass||Number(klass.system.levels)<meta.level||disabled(klass,meta))return false;
    if(actor.items.some(existing=>key(existing)===key(item)&&(!feature(existing)?.classId||feature(existing).classId===klass.id)))return false;
    const nativeGenerated=item.system.uniqueId===meta.uid&&item.system.userNonRemovable;
    item.updateSource({"system.uniqueId":"",[`flags.${MODULE_ID}.martialClassFeature.classId`]:klass.id,
      ...(nativeGenerated?{[`flags.${MODULE_ID}.martialClassFeature.nativeGenerated`]:true}:{})});
  });
  Hooks.on("createItem",item=>{
    if(item.actor&&feature(item)?.nativeGenerated&&!feature(item).generated)
      item.update({[`flags.${MODULE_ID}.martialClassFeature.generated`]:snapshot(item)},{swordsageFeatureSync:true}).catch(report);
  });
  for(const event of ["createItem","deleteItem"])Hooks.on(event,item=>{
    if(isClass(item)&&item.actor)syncSwordsageFeatures(item.actor).catch(report);
  });
  Hooks.on("updateItem",(item,change)=>{
    if(!isClass(item)||!item.actor)return;
    const relevant=["name","system.levels","system.disabledAbilities"];
    if(relevant.some(path=>foundry.utils.getProperty(change,path)!==undefined||Object.hasOwn(change,path)))syncSwordsageFeatures(item.actor).catch(report);
  });
  Hooks.on("createActor",actor=>syncSwordsageFeatures(actor).catch(report));
  Hooks.on("deleteItem",async(item,options)=>{
    const meta=feature(item),actor=item.actor;
    if(game.users.activeGM!==game.user||!actor||!meta?.classId||options?.swordsageFeatureSync)return;
    const klass=actor.items.get(meta.classId);
    if(!klass||Number(klass.system.levels)<meta.level||disabled(klass,meta))return;
    // Explicit removal is a user decision, preserved across reloads. Enable
    // the ability again through the native class ability table when desired.
    try{await klass.update({"system.disabledAbilities":[...(klass.system.disabledAbilities??[]),{uid:meta.uid,level:meta.level}]});}catch(error){report(error);}
  });
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    const meta=feature(item);if(!meta?.op||hook.customUse)return;
    hook.customUse=true;
    hook.threeRCompletion=Promise.resolve().then(async()=>{
      if(!actor.isOwner||!swordsageFeatureAction(item).available)throw new Error("此职业特性尚未获得或已停用。");
      if(meta.op==="open"){await open(actor);return {state:"opened"};}
      return command({actorUuid:actor.uuid,op:meta.op});
    });
    hook.threeRCompletion.catch(error=>ui.notifications.error(error.message));
  });
}
