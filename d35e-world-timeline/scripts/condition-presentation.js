import { conditionRule } from "./condition-rules.js";

// Optional automation metadata; no required dependency on that module.
export function nativeConditionPresentation(id) { return conditionRule(id); }

function combined(ids) {
  const rules=[...new Set(ids)].map(conditionRule).filter(Boolean);
  if(!rules.length)return null;
  return {...rules[0],ids:rules.map(rule=>rule.id),name:rules.map(rule=>rule.name).join("／"),
    description:rules.length===1?rules[0].description:rules.map(rule=>`<h4>${rule.name}</h4>${rule.description}`).join("")};
}

export function conditionPresentation(doc) {
  const mark=doc?.flags?.["samson-3r-automation"];
  // Native status icon effects have no rule prose of their own. Do not replace
  // third-party effects or effects with additional numeric changes.
  if(doc?.documentName==="ActiveEffect"&&(doc.getFlag("D35E","show")!==undefined||mark?.conditionMarker)&&!doc.changes?.length) {
    const ids=[...(doc.statuses??[])];
    if(!ids.length&&doc.getFlag("core","statusId"))ids.push(doc.getFlag("core","statusId"));
    if(ids.length&&ids.every(id=>conditionRule(id)))return combined(ids);
  }
  const known={"card-effect-ray-of-sickening":["sickened"],"pesh-vigor-fatigue":["fatigued"],
    "city-concentration":["blind","deaf"],"legalistic-sickened":["sickened"]};
  let ids=mark?.conditionEffects??(mark?.conditionEffect?[mark.conditionEffect]:known[mark?.key]??[]);
  if(Array.isArray(mark?.nativeConditions))ids=ids.filter(id=>mark.nativeConditions.includes(id));
  // Unmigrated legalistic records still implement penalties without a native state.
  if(mark?.key==="legalistic-sickened"&&!mark.nativeConditions?.includes("sickened"))return null;
  const rule=combined(ids);
  if(!rule)return null;
  const originalIds=mark.conditionEffects??(mark.conditionEffect?[mark.conditionEffect]:ids);
  const complete=originalIds.length===ids.length&&originalIds.every(id=>ids.includes(id));
  return {...rule,description:mark.conditionPresentationRevision&&complete?doc.system?.description?.value??rule.description:rule.description,
    sourceName:mark.sourceName??({"card-effect-ray-of-sickening":"恶心射线",
      "pesh-vigor-fatigue":"仙人掌萃的活力","city-concentration":"聆听城市","legalistic-sickened":"守律：违约"})[mark.key]??""};
}
