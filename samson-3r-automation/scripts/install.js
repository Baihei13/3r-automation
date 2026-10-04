import { MODULE_ID, SOURCES, ITEMS, DOMAIN_SPELLS } from "./catalog.js";
import { installAdditionalCharacters } from "./characters-install.js";
import { itemRepairs, repairOwnedItems } from "./item-data.js";
import { registerSeeds, ruleSection } from "./content.js";
import { COMMON_GEAR } from "./common-gear.js";
import { CARD_SPELLS, CARD_GEAR, WING_FAMILIAR } from "./current-card-data.js";


const clone = value => foundry.utils.deepClone(value);
const marked = item => item.flags?.[MODULE_ID]?.key;
const LIBRARY_FOLDER = "3r自动化";
const CATEGORIES = {
  race: "种族", racial:"种族特性", class: "职业", feat: "专长", feature: "职业能力",
  spell: "法术", weapon: "武器", equipment: "防具", consumable: "消耗品",
  hex: "巫术", curse: "诅咒", revelation: "启示", trait: "背景特性",
  mystery: "秘示域", patron: "庇护主", item: "物品"
};

function category(item) {
  const explicit = item.flags?.[MODULE_ID]?.category;
  if (explicit) return CATEGORIES[explicit] ?? explicit;
  if (item.type === "feat" && item.system?.featType !== "feat") return CATEGORIES.feature;
  return CATEGORIES[item.type] ?? CATEGORIES.item;
}

async function categoryFolder(pack, name) {
  const existing = pack.folders.find(folder => folder.name === name && folder.type === "Item");
  return existing ?? Folder.create({ name, type: "Item" }, { pack: pack.collection });
}

async function sourcePack(source, folder) {
  const name = `samson-${source}`;
  const collection = `world.${name}`;
  const existing = game.packs.get(collection);
  if (existing) {
    if (existing.title !== SOURCES[source].label) await existing.configure({ label: SOURCES[source].label });
    if (existing.folder?.id !== folder.id) await existing.setFolder(folder);
    return existing;
  }
  const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
    name, label: SOURCES[source].label, type: "Item", packageType: "world"
  });
  await pack.setFolder(folder);
  return pack;
}

async function ensureItems(pack, entries) {
  registerSeeds(entries);
  const existing = await pack.getDocuments();
  const seen = new Set(existing.map(marked).filter(Boolean));
  const missing = entries.filter(entry => !seen.has(marked(entry))&&!entry.flags?.[MODULE_ID]?.legacyOnly);
  const managed = existing.filter(item => marked(item));
  const expected = item => entries.find(seed => marked(seed)===marked(item)) ?? item;
  const names = new Set([...managed, ...missing].map(item=>category(expected(item))));
  const folders = new Map();
  for (const name of names) folders.set(name, await categoryFolder(pack, name));
  if (missing.length) await Item.createDocuments(missing.map(entry =>
    ({ ...entry, folder: folders.get(category(entry)).id })), { pack: pack.collection });
  for (const item of managed) {
    const folder = folders.get(category(expected(item)));
    const seed = entries.find(entry => marked(entry) === marked(item));
    const update = itemRepairs(item);
    if (item.folder?.id !== folder.id) update.folder = folder.id;
    // Only migrate names that still equal the old English source or one of its aliases.
    const translated = seed?.type === "spell" ? translatedSpellName(item) : null;
    if (translated && seed.name === translated) update.name = translated;
    if (seed?.type === "feat" && !["计划领域", "战争领域"].includes(marked(item))
      && item.system.featType !== seed.system.featType)
      update["system.featType"] = seed.system.featType;
    if (Object.keys(update).length) await item.update(update);
  }
}

async function coreItem(packName, names) {
  const pack = game.packs.get(`D35E.${packName}`);
  if (!pack) throw new Error(`找不到 D35E.${packName} 系统合集。`);
  const index = await pack.getIndex();
  const desired = names.map(name => name.toLowerCase());
  const match = index.find(entry => desired.includes(entry.name.toLowerCase()));
  if (!match) throw new Error(`系统合集 ${packName} 中没有 ${names.join(" / ")}。`);
  return pack.getDocument(match._id);
}

function asSeed(document, key, source, displayName = null) {
  const data = clone(document.toObject());
  delete data._id;
  delete data.folder;
  delete data._stats;
  delete data.ownership;
  data.name = displayName ?? data.name;
  data.flags ??= {};
  data.flags[MODULE_ID] = { key, source };
  return data;
}

// Class skill eligibility is independent of any character's starting ranks.
// Native D35E knowledge IDs, including nobility and psionics.
const CLOISTERED_KNOWLEDGE_SKILLS = [
  "kar", "kdu", "ken", "kge", "khi", "klo", "kna", "kno", "kpl", "kre", "kps"
];

const CLOISTERED_LEVELS = {
  Message: 0, Erase: 1, Identify: 1, "Unseen Servant": 1,
  "Fox's Cunning": 2, "Illusory Script": 3, "Secret Page": 3, Tongues: 3,
  "Detect Scrying": 4, "Analyze Dweomer": 6, Sequester: 7, Vision: 9
};

async function cloisteredClass(spellPack) {
  const base = await coreItem("classes", ["Cleric"]);
  const data = asSeed(base, "cloistered-cleric", "ua", "修道牧师");
  Object.assign(data.system, {
    source: SOURCES.ua.book, hd: 6, hp: 6, bab: "low", skillsPerLevel: 6,
    customTag: data.system.customTag || "cloisteredcleric",
    turnUndeadLevelFormula: "@level", automaticFeatures: false,
    spellcastingAbility: "wis", spellslotAbility: "wis",
    classSkills: { ...data.system.classSkills, ...Object.fromEntries(CLOISTERED_KNOWLEDGE_SKILLS.map(skill => [skill, true])), dsc: true, spk: true },
    savingThrows: { fort: { value: "high" }, ref: { value: "low" }, will: { value: "high" } },
    description: { value: ruleSection("cloistered-cleric") }
  });
  const books = Array.from({ length: 10 }, (_, level) => clone(data.system.spellbook?.[level] ?? { level, spells: [] }));
  const spells = await spellPack.getDocuments();
  for (const [name, level] of Object.entries(CLOISTERED_LEVELS)) {
    const spell = spells.find(item => item.getFlag(MODULE_ID, "key") === `spell-${name}`);
    if (!spell) continue;
    books[level].spells ??= [];
    if (!books[level].spells.some(entry => entry.pack === spellPack.collection && entry.id === spell.id)) {
      books[level].spells.push({ name: spell.name, img: spell.img, pack: spellPack.collection, id: spell.id });
    }
  }
  data.system.spellbook = books;
  return data;
}

async function coreEquipment() {
  const sword = asSeed(await coreItem("weapons-and-ammo", ["Greatsword"]), "greatsword", "phb", "巨剑");
  sword.system.source = SOURCES.phb.book;
  sword.system.proficient = true;
  sword.system.equipped = true;
  sword.system.description.value = "<p>巨剑：双手军用近战武器，中型伤害2d6，19–20/×2重击，挥砍。武器专攻的前提独立检查；神恩加值只在法术生效期间加入。</p>";
  const armor = asSeed(await coreItem("armors-and-shields", ["Chain Shirt"]), "chain-shirt", "phb", "链甲衫");
  armor.system.source = SOURCES.phb.book;
  armor.system.equipped = true;
  armor.system.description.value = "<p>链甲衫：轻甲，护甲+4，敏捷上限+4，防具检定减值−2，奥术失败率20%，25磅，100金币。</p>";
  return [sword, armor];
}

const SPELL_ALIASES = {
  "Clairaudience/Clairvoyance": ["Clairaudience/Clairvoyance", "Clairaudience-Clairvoyance"],
  "Heroes' Feast": ["Heroes' Feast", "Heroes Feast", "Hero's Feast"],
  "Greater Scrying": ["Greater Scrying", "Scrying, Greater"],
  "Power Word Blind": ["Power Word Blind", "Power Word: Blind"],
  "Power Word Stun": ["Power Word Stun", "Power Word: Stun"],
  "Power Word Kill": ["Power Word Kill", "Power Word: Kill"]
};

const SPELL_NAMES = {
  "Divine Favor": "神恩", Deathwatch: "死亡侦测", Augury: "卜筮术",
  "Cure Light Wounds":"治疗轻伤", "Inflict Light Wounds":"造成轻伤",
  "Clairaudience/Clairvoyance": "锐耳术／鹰眼术", Status: "状态术",
  "Detect Scrying": "侦测探知", "Heroes' Feast": "英雄宴",
  "Greater Scrying": "高等探知", "Discern Location": "辨明位置", "Time Stop": "时间停止",
  "Magic Weapon": "魔化武器", "Spiritual Weapon": "灵能武器", "Magic Vestment": "魔化防具",
  "Divine Power": "神能", "Flame Strike": "焰击术", "Blade Barrier": "剑刃障壁",
  "Power Word Blind": "律令目盲", "Power Word Stun": "律令震慑", "Power Word Kill": "律令死亡",
  "Read Magic":"阅读魔法", Message: "传讯术", Erase: "抹消术", Identify: "鉴定术",
  "Unseen Servant": "隐形仆役", "Fox's Cunning": "狐之狡黠",
  "Illusory Script": "幻影文字", "Secret Page": "秘密书页", Tongues: "巧言术",
  "Analyze Dweomer": "解析魔法", Sequester: "隐匿术", Vision: "异象术"
};

function translatedSpellName(item) {
  const key = marked(item);
  if (!key?.startsWith("spell-")) return null;
  const english = key.slice(6);
  const oldNames = SPELL_ALIASES[english] ?? [english];
  return oldNames.includes(item.name) ? SPELL_NAMES[english] ?? null : null;
}

async function coreSpells() {
  const names = [...new Set(["Read Magic","Divine Favor","Cure Light Wounds","Inflict Light Wounds", ...Object.values(DOMAIN_SPELLS).flat()])];
  const entries = [];
  const missing = [];
  for (const name of names) {
    try {
      const document = await coreItem("spells", SPELL_ALIASES[name] ?? [name]);
      const data = asSeed(document, `spell-${name}`, "phb", SPELL_NAMES[name] ?? name);
      data.system.source = data.system.source || SOURCES.phb.book;
      data.flags[MODULE_ID].lists = Object.entries(DOMAIN_SPELLS)
        .filter(([, spells]) => spells.includes(name)).map(([list]) => list);
      entries.push(data);
    } catch { missing.push(name); }
  }
  return { entries, missing };
}

async function linkDomains(packs) {
  const spells = await packs.phb.getDocuments();
  for (const [list, source, key] of [["planning", "cw", "计划领域"], ["war", "phb", "战争领域"]]) {
    const domain = (await packs[source].getDocuments()).find(item => item.getFlag(MODULE_ID, "key") === key);
    if (!domain) throw new Error(`来源合集缺少 ${key}。`);
    const linked = {};
    for (const [index, name] of DOMAIN_SPELLS[list].entries()) {
      const spell = spells.find(item => item.getFlag(MODULE_ID, "key") === `spell-${name}`);
      linked[`level${index + 1}`] = {
        level: index + 1, name: spell?.name ?? name, img: spell?.img ?? "icons/svg/book.svg",
        pack: spell ? packs.phb.collection : null, id: spell?.id ?? null
      };
    }
    await domain.update({ "system.featType": "spellSpecialization",
      "system.spellSpecialization": { isDomain: true, spells: linked } });
  }
}

export async function installSamson() {
  if (!game.user.isGM || game.system.id !== "D35E") return null;
  await repairOwnedItems();
  const folder = game.folders.find(entry => entry.name === LIBRARY_FOLDER && entry.type === "Compendium")
    ?? await Folder.create({ name: LIBRARY_FOLDER, type: "Compendium" });
  const packs = {};
  for (const source of Object.keys(SOURCES)) {
    packs[source] = await sourcePack(source, folder);
    await ensureItems(packs[source], [...(ITEMS[source]??[]),...COMMON_GEAR.filter(item=>item.flags[MODULE_ID].source===source)]);
  }
  await ensureItems(packs.phb, await coreEquipment());
  const { entries, missing } = await coreSpells();
  await ensureItems(packs.phb, entries);
  for(const [id,name] of [["guidance","Guidance"],["detect-poison","Detect Poison"],["mage-armor","Mage Armor"],["enlarge-person","Enlarge Person"],["command","Command"],["charm-person","Charm Person"],["comprehend-languages","Comprehend Languages"]]) {
    const seed=CARD_SPELLS.find(item=>item.flags[MODULE_ID].currentCardSpell===id);
    try {
      const native=await coreItem("spells",[name]);
      seed.flags[MODULE_ID].nativeActionCommands=(native.system.specialActions??[]).map(action=>action.action).filter(Boolean);
    }catch(error){console.warn(`${MODULE_ID}: original spell commands unavailable`,name,error);}
  }
  for(const source of Object.keys(SOURCES)) {
    const selected=[...CARD_SPELLS,...CARD_GEAR,WING_FAMILIAR].filter(item=>item.flags[MODULE_ID].source===source);
    if(selected.length)await ensureItems(packs[source],selected);
  }
  await ensureItems(packs.ua, [await cloisteredClass(packs.phb)]);
  await linkDomains(packs);
  if (missing.length) console.warn(`${MODULE_ID}: system spells not found`, missing);
  await installAdditionalCharacters(packs, ensureItems, coreItem);
  await repairOwnedItems();
  const macro = game.macros.find(entry => entry.getFlag(MODULE_ID, "samsonPanel") === true);
  if (macro?.name === "参孙自动化") await macro.update({ name: "3r自动化" });
  if (!macro) {
    await Macro.create({ name: "3r自动化", type: "script", img: "icons/svg/book.svg",
      command: `game.modules.get("${MODULE_ID}").api.open();`,
      ownership: { default: 3 }, flags: { [MODULE_ID]: { samsonPanel: true } } });
  }
  if (missing.length) ui.notifications.warn(`系统法术合集中缺少 ${missing.length} 个条目；详见控制台。`);
  return packs;
}

