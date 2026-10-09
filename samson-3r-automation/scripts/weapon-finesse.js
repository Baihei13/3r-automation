import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { weaponFor } from "./fragile.js";

const key=item=>item?.flags?.[MODULE_ID]?.key;
const usable=(item,actor)=>effectIsActive(item)&&!item.getFlag(MODULE_ID,"unselected")
  &&!item.flags?.[MODULE_ID]?.pfClassFeature?.retainedInactive
  &&!item.hasUnmetRequirements?.(foundry.utils.deepClone(actor.getRollData()))?.length;

// Apply at ItemRolls, where D35E actually selects the attack ability. Do not
// persist a Dexterity attack or change level-1 Strength-based weapon damage.
export function applyWeaponFinesse(item,data,options) {
  const actor=item.actor,weapon=weaponFor(item);
  if(!actor||data.item?.actionType!=="mwak"||!["str","dex"].includes(data.item.ability?.attack))return;
  const feat=actor.items.some(i=>i.type==="feat"&&usable(i,actor)&&(["weapon-finesse","rogue-bonus-weapon-finesse"].includes(key(i))
    ||i.system.customTag==="weaponFinesse"||["Weapon Finesse","武器娴熟"].includes(i.originalName)
    ||["Weapon Finesse","武器娴熟"].includes(i.name)));
  const training=actor.items.some(i=>key(i)==="finesse-training"&&usable(i,actor))
    &&actor.items.some(i=>i.type==="class"&&key(i)==="unchained-rogue"&&Number(i.system.levels)>=1);
  if(!feat&&!training)return;
  const eligible=data.item.finesseable||weapon?.system.properties?.fin||weapon?.system.weaponSubtype==="light"
    ||key(weapon)==="sleeve-blade"||data.item.attackType==="natural"
    ||/^(rapier|whip|spiked\s*chain|细剑|长鞭|刺链)$/i.test(String(weapon?.system.baseWeaponType||data.item.baseWeaponType||weapon?.name||item.name).trim());
  if(!eligible||Number(data.abilities?.dex?.mod)<=Number(data.abilities?.str?.mod))return;
  data.item.ability.attack="dex";
  const penalty=actor.items.filter(i=>i.type==="equipment"&&i.system.equipped&&!i.system.melded
    &&(i.system.equipmentType==="shield"||/shield/i.test(i.system.equipmentSubtype??"")))
    .reduce((sum,i)=>sum-Math.abs(Number(i.system.armor?.acp)||0),0);
  if(penalty)options.extraParts=[...(options.extraParts??[]),{part:String(penalty),value:penalty,source:"盾牌检定减值"}];
}
