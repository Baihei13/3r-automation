import { MODULE_ID } from "./catalog.js";
import { allSeeds } from "./content.js";
import { isDivineFavor } from "./spell-text.js";

// Compare executable commands with the installed core spell seed. A translated
// label alone is not sufficient evidence to remove a player's custom action.
export function automatedSpellActionRepairs(item) {
  const favor=isDivineFavor(item);
  const weapon=item.type==="spell"&&(item.flags?.[MODULE_ID]?.key==="spell-Magic Weapon"
    || /^(magic weapon|魔化武器)$/i.test(String(item.name??"")));
  if(!favor&&!weapon)return {};
  if(!item.flags?.[MODULE_ID]?.key&&item.parent?.documentName!=="Actor")return {};
  const seedKey=favor?"spell-Divine Favor":"spell-Magic Weapon";
  const seed=allSeeds().find(entry=>entry.flags?.[MODULE_ID]?.key===seedKey);
  const commands=new Set((seed?.system.specialActions??[]).map(action=>action.action).filter(Boolean));
  if(!commands.size)return {};
  const actions=item.system?.specialActions??[];
  const remaining=actions.filter(action=>!commands.has(action.action));
  if(remaining.length===actions.length)return {};
  const update={"system.specialActions":remaining};
  const backup=favor?"originalDivineFavorActions":"originalMagicWeaponActions";
  if(!item.flags?.[MODULE_ID]?.[backup])
    update[`flags.${MODULE_ID}.${backup}`]=foundry.utils.deepClone(actions);
  // A native 'special' action type would still produce an empty action card.
  // Keep any custom attack/damage/effect/template and its normal action path.
  const template=item.system.measureTemplate;
  const hasTemplate=typeof template?.type==="string"&&template.type!==""
    &&(typeof template.size==="string"?template.size.length>0:Number(template.size)>0);
  if(!remaining.length&&item.system.actionType==="special"
    &&!item.system.damage?.parts?.length&&!item.system.rollTableDraw?.id
    &&!item.system.effectNotes&&!hasTemplate)
    update["system.actionType"]="other";
  return update;
}
