import { MODULE_ID } from "./catalog.js";
import { createTag } from "../../../systems/D35E/module/lib.js";

const tags={"cloistered-cleric":"cloisteredcleric",witch:"witch","dual-cursed-oracle":"dualcursedoracle",oracle:"oracle"};
export const classTag=item=>createTag(item.system.customTag||tags[item.flags?.[MODULE_ID]?.key]||item.name);
export function casterClassRepairs(item) {
  const tag=tags[item.flags?.[MODULE_ID]?.key];
  if(item.type!=="class"||!tag||item.system.customTag)return {};
  const existing=item.parent?.documentName==="Actor"?item.system.tag:null;
  return {[`flags.${MODULE_ID}.previousCustomTag`]:item.system.customTag??"","system.customTag":existing||tag};
}
export function casterBookRepairs(actor) {
  if(!actor.getFlag(MODULE_ID,"samson")&&!actor.getFlag(MODULE_ID,"characterKey"))return {};
  if(actor.getFlag(MODULE_ID,"casterBookRevision"))return {};
  const classes=actor.items.filter(i=>i.type==="class"&&tags[i.flags?.[MODULE_ID]?.key]);
  const otherCasters=actor.items.some(i=>i.type==="class"&&!classes.includes(i)&&i.system.hasSpellbook);
  const book=actor.system.attributes?.spells?.spellbooks?.primary;
  // Repair the omitted default link, never replace a player's nonempty class link.
  if(classes.length!==1||otherCasters||!book||book.class)return {};
  const cls=classes[0],prefix="system.attributes.spells.spellbooks.primary";
  const tag=cls.system.tag||classTag(cls);
  const update={[`${prefix}.class`]:tag,[`flags.${MODULE_ID}.casterBookRevision`]:1,[`flags.${MODULE_ID}.previousPrimarySetup`]:{
    class:book.class??"",ability:book.ability,spellslotAbility:book.spellslotAbility,
    spellcastingType:book.spellcastingType,spontaneous:book.spontaneous,arcaneSpellFailure:book.arcaneSpellFailure}};
  if(book.autoSetup!==false) {
    update[`${prefix}.ability`]=cls.system.spellcastingAbility;
    update[`${prefix}.spellslotAbility`]=cls.system.spellslotAbility||cls.system.spellcastingAbility;
    update[`${prefix}.spellcastingType`]=cls.system.spellcastingType;
    update[`${prefix}.spontaneous`]=Boolean(cls.system.spellcastingSpontaneus);
    update[`${prefix}.arcaneSpellFailure`]=cls.system.spellcastingType==="arcane";
  }
  return update;
}
