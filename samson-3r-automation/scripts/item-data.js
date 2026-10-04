import { MODULE_ID, SOURCES, ITEMS } from "./catalog.js";
import { CHARACTER_ITEMS } from "./characters-catalog.js";
import { allSeeds } from "./content.js";
import { spellTextRepairs } from "./spell-text.js";
import { pfSpellVariant } from "./spell-utilities.js";
import { automatedSpellActionRepairs } from "./spell-actions.js";
import { casterClassRepairs, casterBookRepairs } from "./caster-setup.js";
import { contentIconRepairs } from "./content-icons.js";

const seeds = new Map([...Object.values(ITEMS).flat(), ...Object.values(CHARACTER_ITEMS).flat()]
  .map(item => [`${item.flags[MODULE_ID].source}:${item.flags[MODULE_ID].key}`, item]));
const books = new Set(Object.values(SOURCES).map(source => source.book));
const skillTargets = new Set(["dev", "opl", "blf", "int", "slt", "kno"]);
const humans = new Set(["human-pf", "human-dex", "human-cha"]);

function finishTextRepairs(item,update) {
  Object.assign(update, contentIconRepairs(item));
  // Repair text after content migrations, so a seed cannot restore English.
  if(update["system.description"]&&update["system.description.value"]!==undefined) {
    update["system.description"].value=update["system.description.value"];
    delete update["system.description.value"];
  }
  const patched=foundry.utils.deepClone(item.toObject?item.toObject():item);
  foundry.utils.mergeObject(patched,foundry.utils.expandObject(update));
  const candidate={...patched,parent:item.parent};
  const actionUpdate=automatedSpellActionRepairs(candidate);
  foundry.utils.mergeObject(candidate,foundry.utils.expandObject(actionUpdate));
  const textUpdate={...actionUpdate,...spellTextRepairs(candidate)};
  Object.assign(update,textUpdate);
  if(update["system.description"]&&update["system.description.value"]!==undefined) {
    update["system.description"].value=update["system.description.value"];
    delete update["system.description.value"];
  }
  return update;
}

function addCounters(value, additions) {
  return [...new Set([...(value ?? "").split(";").map(part => part.trim()).filter(Boolean), ...additions])].join(";");
}

// Repair only module-owned fields and known old formulas; retain user edits.
export function itemRepairs(item) {
  const mark = item.flags?.[MODULE_ID];
  const source = SOURCES[mark?.key==="weapon-finesse"?"pf":mark?.source];
  if (!mark?.key || !source) {
    const update={};
    if(mark?.key==="stone-fist-slam"&&item.type==="attack"&&item.img==="icons/svg/fist.svg") {
      update[`flags.${MODULE_ID}.previousIcon`]=item.img;
      update.img="systems/D35E/icons/attack/monster/slam.png";
    }
    if(mark?.key==="stone-fist"&&item.type==="buff"&&!mark.bonusRevision) {
      update[`flags.${MODULE_ID}.previousChanges`]=item.system.changes;
      update["system.changes"]=[["@stoneFistAttackGain","misc","cmb","untyped"]];
      update[`flags.${MODULE_ID}.bonusRevision`]=1;
    }
    if(mark?.key==="legalistic-nauseated"&&item.type==="buff") {
      update.name="守律：违约（恶心）";update[`flags.${MODULE_ID}.key`]="legalistic-sickened";
      update[`flags.${MODULE_ID}.previousChanges`]=item.system.changes;
      update["system.changes"]=[["-2","attack","attack","penalty"],["-2","damage","wdamage","penalty"],["-2","savingThrows","allSavingThrows","penalty"],["-2","skills","skills","penalty"],["-2","abilityChecks","allChecks","penalty"]];
    }
    return finishTextRepairs(item,update);
  }
  const system = item.system ?? {};
  const seed = allSeeds().find(entry => entry.flags[MODULE_ID].source === (mark.key==="weapon-finesse"?"pf":mark.source) && entry.flags[MODULE_ID].key === mark.key)
    ?? seeds.get(`${mark.source}:${mark.key}`);
  const update = casterClassRepairs(item);
  if(seed&&!mark.playerTextRevision) {
    const old=system.description?.value??"";
    // Remove only evidence of our generated notes, leaving unrelated prose intact.
    const generated=/参孙选择|参孙由|参孙文档|参孙角色设定|角色设定特许|青金石选择|青金石可|角色文档未列|待选择|本模组说明|本模组按玩家要求|不能自动代选|魔宠种类、7个|原卡没有|由种族条目计算|名额由种族条目计算/.test(old)
      ||/参孙(?:：|，|。)|青金石(?:：|，|。)|原卡|角色文档|本模组|等待选择|待确认|待补/.test(old)
      || (["human-ability","human-skills","witch","witch-familiar"].includes(mark.key)&&!mark.contentRevision);
    if(generated) {
      update[`flags.${MODULE_ID}.previousPlayerText`]={name:item.name,description:old};
      update["system.description.value"]=seed.system.description.value;
    }
    if(["石拳术药水（参孙角色设定）","女巫魔宠（待选择）"].includes(item.name))update.name=seed.name;
    update[`flags.${MODULE_ID}.playerTextRevision`]=1;
  }
  if(seed?.flags[MODULE_ID].currentCardSpell&&!mark.cardRulesRevision) {
    update[`flags.${MODULE_ID}.previousCardRules`]=foundry.utils.deepClone(system);
    for(const field of ["level","school","subschool","learnedAt","range","spellTarget","target","save","sr","components","activation","ability","spellDurationData","description","shortDescription","actionType"])
      if(seed.system[field]!==undefined)update[`system.${field}`]=foundry.utils.deepClone(seed.system[field]);
    if(mark.pastLife&&item.parent?.items.some(entry=>entry.getFlag(MODULE_ID,"key")==="witch"))update["system.learnedAt"]={...seed.system.learnedAt,class:[...(seed.system.learnedAt?.class??[]),["Witch",Number(seed.system.level)]]};
    update[`flags.${MODULE_ID}.cardRulesRevision`]=1;
  }
  if(seed&&/^samsaran-(languages|deathwatch|stabilize)$/.test(mark.key)&&!mark.racialSpellTextRevision) {
    const old=system.description?.value??"";
    if(old.includes("轮回者魔法（")||old.includes("魅力至少")||!old) {
      update[`flags.${MODULE_ID}.previousRacialSpellText`]=old;
      update["system.description.value"]=seed.system.description.value;
    }
    update[`flags.${MODULE_ID}.racialSpellTextRevision`]=1;
  }
  if(seed&&mark.key==="celestial-agenda"&&!mark.celestialSkillRevision) {
    const old=system.changes??[];
    if(!old.length||old.every(row=>row[0]==="-2"&&row[1]==="skill"&&["skill.blf","skill.int","skill.slt"].includes(row[2]))) {
      update[`flags.${MODULE_ID}.previousCelestialSkills`]=old;
      update["system.changes"]=foundry.utils.deepClone(seed.system.changes);
    }
    update[`flags.${MODULE_ID}.celestialSkillRevision`]=1;
  }
  if(seed?.flags[MODULE_ID].currentCardSpell&&seed.flags[MODULE_ID].currentCardSpell!=="command"&&!mark.cardActionsRevision&&Array.isArray(seed.flags[MODULE_ID].nativeActionCommands)) {
    // Match installed source commands exactly; preserve custom actions.
    const commands=new Set(seed.flags[MODULE_ID].nativeActionCommands);
    const actions=system.specialActions??[];
    const remaining=actions.filter(action=>!commands.has(action.action));
    if(remaining.length!==actions.length) {
      update[`flags.${MODULE_ID}.previousCardActions`]=foundry.utils.deepClone(actions);
      update["system.specialActions"]=remaining;
    }
    update[`flags.${MODULE_ID}.cardActionsRevision`]=1;
  }
  if(mark.key==="unchained-rogue"&&item.type==="class"&&!mark.sneakClassRevision) {
    // Earlier installs kept the native defaults none/0. Custom groups and
    // formulas are not evidence of this omission and must be retained.
    const defaultGroup=[undefined,null,"","none"].includes(system.sneakAttackGroup);
    const defaultFormula=[undefined,null,"","0"].includes(system.sneakAttackFormula);
    if((defaultGroup||system.sneakAttackGroup==="unchainedRogue")
      &&(defaultFormula||system.sneakAttackFormula==="ceil(@level/2)")) {
      update[`flags.${MODULE_ID}.previousSneakClass`]={group:system.sneakAttackGroup??null,formula:system.sneakAttackFormula??null};
      if(defaultGroup)update["system.sneakAttackGroup"]="unchainedRogue";
      if(defaultFormula)update["system.sneakAttackFormula"]="ceil(@level/2)";
    }
    update[`flags.${MODULE_ID}.sneakClassRevision`]=1;
  }
  if(mark.key==="sleeve-blade"&&item.type==="weapon"&&!mark.finesseWeaponRevision) {
    update[`flags.${MODULE_ID}.previousFinesseWeapon`]={fin:system.properties?.fin??null,baseWeaponType:system.baseWeaponType??""};
    update["system.properties.fin"]=true;
    if(!system.baseWeaponType)update["system.baseWeaponType"]="dagger";
    update[`flags.${MODULE_ID}.finesseWeaponRevision`]=1;
  }
  if(mark.key==="bec-de-corbin"&&!mark.fragileRevision&&seed) {
    update[`flags.${MODULE_ID}.previousFragileDescription`]=system.description?.value??"";
    if(system.description?.value?.includes("易碎特性须由 GM 判定"))update["system.description.value"]=seed.system.description.value;
    update[`flags.${MODULE_ID}.fragileRuleSources`]=[
      {book:"Pathfinder RPG Ultimate Equipment",library:"pathfinder-sc-2.20",page:"page_209.html",entry:"武器的易碎特性"},
      {book:"Pathfinder RPG Core Rulebook",library:"pathfinder-sc-2.20",page:"page_9.html",entry:"破损（Broken）"}];
    update[`flags.${MODULE_ID}.fragileRevision`]=1;
  }
  if(mark.key==="bec-de-corbin"&&!mark.obsidianRevision) {
    update[`flags.${MODULE_ID}.obsidianRevision`]=1;
    if(!mark.primitiveMaterial)update[`flags.${MODULE_ID}.primitiveMaterial`]={kind:"obsidian",strengthened:false,
      basePrice:15,baseWeight:12,baseHardness:5,rulebook:"Pathfinder RPG Ultimate Equipment",
      page:"page_209.html",entry:"黑曜石 (Obsidian)",body:{book:"Advanced Player's Guide",entry:"Bec de corbin"},
      materialException:"双手黑曜石武器需DM明确允许，不推广为通常制作规则"};
    if(Number(system.hardness)===0) {
      update[`flags.${MODULE_ID}.previousHardness`]=system.hardness;
      update["system.hardness"]=2;
    }
  }
  if(mark.key==="tanglefoot"&&!mark.tanglefootTextRevision&&seed) {
    update[`flags.${MODULE_ID}.previousTanglefootText`]=system.description?.value??"";
    update["system.description.value"]=seed.system.description.value;
    update[`flags.${MODULE_ID}.tanglefootTextRevision`]=1;
  }
  if(mark.key==="weapon-finesse"&&mark.source!=="pf") {
    update[`flags.${MODULE_ID}.source`]="pf";
    update[`flags.${MODULE_ID}.rulebook`]=source.book;
    update["system.description.value"]=(system.description?.value??"").replace(/<p data-3r-rulebook>[\s\S]*?<\/p>/g,"");
  }
  const variant=pfSpellVariant(item);
  if (seed && Number(mark.contentRevision ?? 0) < 4) {
    update[`flags.${MODULE_ID}.previousContent`] = { description:system.description?.value ?? "", classSkills:system.classSkills };
    update[`flags.${MODULE_ID}.contentRevision`] = 4;
    update[`flags.${MODULE_ID}.category`] = seed.flags[MODULE_ID].category;
    for (const field of ["description","classSkills","senses","creatureType","equipmentSubtype","price","weight","properties","activation","abilityType","range","spellDuration","spellDurationData","spellTarget","school","learnedAt","save","sr","components","requirements"])
      if (seed.system[field] !== undefined) update[`system.${field}`] = field==="properties"&&mark.key==="sleeve-blade"
        ? {...system.properties,fin:true}:foundry.utils.deepClone(seed.system[field]);
    if (["adventurer-kit","banded-mail"].includes(mark.key)) update.name=seed.name;
    if (mark.key === "bec-de-corbin") update["system.weaponData.damageType"] = "Bludgeoning or Piercing";
    if (mark.key === "witch") update["system.spellsPerLevel"] = foundry.utils.deepClone(seed.system.spellsPerLevel);
    if (["trapfinding","noble-scion","celestial-agenda"].includes(mark.key)) update["system.changes"]=foundry.utils.deepClone(seed.system.changes);
  }
  if(variant&&!mark.pfRuleRevision) {
    update[`flags.${MODULE_ID}.previousPfSpell`]=foundry.utils.deepClone(system);
    for(const [field,value]of Object.entries(variant))update[`system.${field}`]=value;
    update["system.description.value"]=variant.shortDescription;
    update[`flags.${MODULE_ID}.pfRuleRevision`]=1;
  }
  if (!mark.rulebook) update[`flags.${MODULE_ID}.rulebook`] = source.book;
  if (item.type === "feat") {
    // D35E reserves source for "class name level"; a book name hides feats.
    if (books.has(system.source)) update["system.source"] = "";
    const subtype = ["计划领域", "战争领域"].includes(mark.key)
      ? "spellSpecialization" : seed?.system.featType;
    if (subtype && system.featType !== subtype) update["system.featType"] = subtype;
    const description = update["system.description.value"] ?? update["system.description"]?.value ?? system.description?.value ?? "";
    if (!description.includes("data-3r-rulebook")) {
      update["system.description.value"] = `${description}<p data-3r-rulebook><small>来源：${source.label}（${source.book}）</small></p>`;
    }
  }
  let changed = false;
  const changes = (system.changes ?? []).map(row => {
    const result = [...row];
    if (result[1] === "skill" && skillTargets.has(result[2])) {
      result[2] = `skill.${result[2]}`;
      changed = true;
    }
    if (mark.key === "noble-scion") {
      const replacement = result[2] === "init" && result[0] === "@abilities.cha.mod - @abilities.dex.mod"
        ? seed.system.changes[0][0]
        : result[2] === "skill.kno" && result[0] === "2" ? seed.system.changes[1][0] : null;
      if (replacement) { result[0] = replacement; changed = true; }
    }
    return result;
  });
  if (mark.key === "masterwork-tools" && changes.some(row => row[2] === "skill.dev" && row[0] === "2")
    && !changes.some(row => row[2] === "skill.opl")) {
    changes.push(["2", "skill", "skill.opl", "circumstance"]);
    changed = true;
  }
  if (changed && !update["system.changes"]) update["system.changes"] = changes;
  if (humans.has(mark.key) && item.type === "race") {
    const counters = addCounters(system.counterName, ["feat.base", "bonusSkillPoints"]);
    if (system.counterName !== counters) update["system.counterName"] = counters;
  }
  if (seed?.system.requirements?.length && !system.requirements?.length)
    update["system.requirements"] = seed.system.requirements;
  if(mark.key==="shadow-blade"&&system.requirements?.some(row=>row[1]==="0"))update["system.requirements"]=seed.system.requirements;
  return finishTextRepairs(item,update);
}

export async function repairOwnedItems() {
  if (game.users.activeGM !== game.user || game.system.id !== "D35E") return;
  const actors = new Map(game.actors.map(actor => [actor.uuid, actor]));
  for (const scene of game.scenes) for (const token of scene.tokens) {
    if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
  }
  let repaired = 0;
  for (const actor of actors.values()) {
    const updates = actor.items.map(item => ({ _id: item.id, ...itemRepairs(item) }))
      .filter(update => Object.keys(update).length > 1);
    const actorUpdate = casterBookRepairs(actor);
    if (!updates.length && !Object.keys(actorUpdate).length) continue;
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates, { stopUpdates: true });
    // Recompute D35E's derived stats, including the old erroneous INT penalty.
    await actor.refreshWithData(actorUpdate);
    repaired += updates.length;
  }
  if (repaired) ui.notifications.info(`3r自动化：已修正 ${repaired} 个旧条目的分类、计数或加值数据。`);
}
