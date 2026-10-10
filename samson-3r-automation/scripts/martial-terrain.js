import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";

const wind=actor=>actor?.items.some(i=>i.type==="buff"&&effectIsActive(i)&&i.flags?.[MODULE_ID]?.martialEffect?.stance&&i.flags[MODULE_ID].martialEffect.definition==="step-of-the-wind");
let readingRaw=0;
// Only the core finite difficulty multiplier is ignored. Infinite cost, walls,
// blocked space, crawling and other movement costs keep their native behavior.
export function installMartialTerrain() {
  const prototype=foundry.data.regionBehaviors.ModifyMovementCostRegionBehaviorType?.prototype;
  const original=prototype?._getTerrainEffects;
  if(typeof original!=="function")return;
  prototype._getTerrainEffects=function(token,...args) {
    const values=original.call(this,token,...args);
    if(readingRaw||!wind((token.document??token).actor)||!Array.isArray(values))return values;
    return values.map(value=>Number.isFinite(value.difficulty)&&value.difficulty>1?{...value,difficulty:1}:value);
  };
}
export function difficultPath(token,point,{raw=false}={}) {
  if(typeof token?.createTerrainMovementPath!=="function")return null;
  if(raw)readingRaw++;
  try {
    const origin={x:token.document.x,y:token.document.y,elevation:token.document.elevation,level:token.document.level};
    const path=token.createTerrainMovementPath([origin,{...origin,...point}]);
    return path.some(p=>Number.isFinite(p.terrain?.difficulty)&&p.terrain.difficulty>1);
  }finally{if(raw)readingRaw--;}
}
export function windAttackBonus(actor,enemy) {
  if(!wind(actor))return 0;
  const tokens=(canvas.tokens?.placeables??[]).filter(t=>t.actor?.uuid===enemy?.uuid);
  if(tokens.length!==1)return 0;
  const token=tokens[0];
  return difficultPath(token,{x:token.document.x+1,y:token.document.y},{raw:true})===true?2:0;
}
