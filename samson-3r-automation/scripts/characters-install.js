import { MODULE_ID, SOURCES } from "./catalog.js";
import { CHARACTER_ITEMS } from "./characters-catalog.js";

const clone = value => foundry.utils.deepClone(value);
const SPELLS = [
  { key: "mending", name: "Mending", label: "修复术", level: 0 },
  { key: "create-water", name: "Create Water", label: "造水术", level: 0 },
  { key: "detect-magic", name: "Detect Magic", label: "侦测魔法", level: 0 },
  { key: "divine-favor", name: "Divine Favor", label: "神恩", level: 1 },
  { key: "shield-of-faith", name: "Shield of Faith", label: "虔诚护盾", level: 1 }
];

async function addSpellSources(packs, ensureItems, coreItem) {
  const entries = [];
  const missing = [];
  for (const spell of SPELLS) {
    try {
      const document = await coreItem("spells", [spell.name]);
      const data = clone(document.toObject());
      delete data._id;
      delete data.folder;
      delete data._stats;
      delete data.ownership;
      data.name = spell.label;
      data.system.source = SOURCES.pf.book;
      data.system.level = spell.level;
      data.system.spellbook = "primary";
      data.flags ??= {};
      data.flags[MODULE_ID] = { key: `pf-spell-${spell.key}`, source: "pf", category: "spell" };
      entries.push(data);
    } catch { missing.push(spell.name); }
  }
  await ensureItems(packs.pf, entries);
  return missing;
}

export async function installAdditionalCharacters(packs, ensureItems, coreItem) {
  for (const [source, entries] of Object.entries(CHARACTER_ITEMS)) await ensureItems(packs[source], entries);
  for(const item of await packs.pfu.getDocuments())if(item.getFlag(MODULE_ID,"key")==="weapon-finesse")await item.delete();
  const missing = await addSpellSources(packs, ensureItems, coreItem);
  const traits = new Set(Object.values(CHARACTER_ITEMS).flat()
    .filter(item => item.type === "feat" && item.system.featType === "trait")
    .map(item => item.flags[MODULE_ID].key));
  for (const actor of game.actors) {
    const updates = actor.items.filter(item => traits.has(item.getFlag(MODULE_ID, "key"))
      && item.system.featType === "classFeat")
      .map(item => ({ _id: item.id, "system.featType": "trait" }));
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
  if (missing.length) console.warn(`${MODULE_ID}: missing PF spell source entries`, missing);
  return missing;
}

