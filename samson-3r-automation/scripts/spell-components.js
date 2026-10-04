import { MODULE_ID } from "./catalog.js";

const physical=new Set(["loot","equipment","consumable","weapon"]);
const text=value=>String(value??"").normalize("NFKC").toLowerCase().replace(/[\s（）()：:,，。.-]+/g,"");
const pouchNames=["施法材料包","法术材料包","法術材料包","通用材料包","通用施法材料包","法术材料袋","施法材料袋","spell component pouch","spell components pouch","component pouch"];
const componentNames={
  "mage-armor":[["鞣制皮革","鞣制革","tanned leather","cured leather"]],
  "enlarge-person":[["铁粉","鐵粉","powdered iron","iron powder"]],
  "ray-of-sickening":[["汗液","sweat"]],
  "pesh-vigor":[["仙人掌萃","仙人掌萃取物","pesh"]],
  "comprehend-languages":[["煤灰","煤烟","soot"],["盐","鹽","salt"]],
  "ears-of-the-city":[["砖头","磚頭","砖块","brick"]]
};
function carried(item,actor,seen=new Set()) {
  const quantity=Number(item.system.quantity??1);
  if(!physical.has(item.type)||item.system.carried===false||item.system.melded||!Number.isFinite(quantity)||quantity<=0||seen.has(item.id))return false;
  seen.add(item.id);
  const container=actor.items.get(item.system.containerId);
  return !container||carried(container,actor,seen);
}
function matches(item,names) {
  const candidates=[item.name,item.system.uniqueId,item.getFlag(MODULE_ID,"key")].filter(Boolean)
    .map(value=>text(String(value).replace(/\s*[(（].*[)）]\s*$/, "")));
  return candidates.some(name=>names.some(alias=>name===text(alias)||name.startsWith(text(alias))&&name.length>text(alias).length&&/^\d/.test(name.slice(text(alias).length))));
}

function fitsPouch(item,kind,description) {
  if(item.getFlag(MODULE_ID,"componentPouchExcluded")===true)return false;
  if(kind!=="focus")return true;
  // Only exclude explicit large-focus descriptions, never infer size from a spell's name.
  const label=String(description).replace(/<[^>]*>/g," ");
  return !/放不进|放不進|无法放入|無法放入|天然水池|天然水塘|水池|池塘|大型镜|大型鏡|大镜子|大鏡子|\b(?:natural |outdoor )?(?:pool of water|pond)\b|\blarge mirror\b|won['’]t fit|wouldn['’]t fit|does not fit/i.test(label);
}
export function prepareSpellComponents(item,actor) {
  const components=item.system.components??{},id=item.getFlag(MODULE_ID,"currentCardSpell");
  if(!components.material&&!components.focus&&!components.divineFocus)return null;
  const inventory=actor.items.filter(entry=>carried(entry,actor));
  const pouch=inventory.find(entry=>matches(entry,pouchNames));
  const symbol=inventory.find(entry=>matches(entry,["圣徽","聖徽","木质圣徽","银质圣徽","holy symbol","wooden holy symbol","silver holy symbol","神圣法器"]));
  const eschew=actor.items.some(entry=>entry.type==="feat"&&["免材施法","施法免材","Eschew Materials","eschew-materials"].some(name=>text(entry.name)===text(name)||text(entry.getFlag(MODULE_ID,"key"))===text(name)));
  const requirements=[];
  for(const kind of ["material","focus"]) {
    if(!components[kind])continue;
    const description=components[`${kind}Description`]||item.system.materials?.[kind==="material"?"value":"focus"]||"";
    const cost=id==="pesh-vigor"&&kind==="material"?15:Number(String(description).match(/(\d+(?:\.\d+)?)\s*(?:金币|金幣|gp|gold pieces)/i)?.[1]??0);
    if(!cost&&symbol&&Number(components.divineFocus)===(kind==="material"?2:3)){requirements.push({kind:"divineFocus",label:symbol.name});continue;}
    const supplied=Boolean(!cost&&pouch&&fitsPouch(item,kind,description));
    if(supplied||!cost&&kind==="material"&&eschew){requirements.push({kind,label:supplied?pouch.name:"免材施法"});continue;}
    const named=String(description).replace(/<[^>]*>/g,"").replace(/(?:价值|價值)(?:至少)?\s*\d+(?:\.\d+)?\s*(?:金币|金幣)(?:的)?/g,"")
      .replace(/\b(?:worth|costing|valued at)(?: at least)?\s*\d+(?:\.\d+)?\s*(?:gp|gold pieces)\b/gi,"")
      .replace(/^(?:一小撮|一撮|一滴|一小块|一块|一剂|a pinch of |a piece of |a dose of |a |an )/i,"").trim();
    const groups=componentNames[id]??[[named]];
    const found=groups.map(names=>inventory.find(entry=>matches(entry,names.filter(Boolean))&&(id!=="pesh-vigor"||kind!=="material"||Number(entry.system.quantity)>=1)));
    const label=description||`${cost?`价值${cost}金币的`:""}施法材料或器材`;
    if(found.some(entry=>!entry))throw new Error(`${item.name}缺少${label}${cost?"，普通施法材料包不能替代":"；请携带对应物品或施法材料包"}。`);
    requirements.push(...found.map(entry=>({kind,label:entry.name,item:entry.id,consume:id==="pesh-vigor"&&kind==="material"})));
  }
  // Pure DF is not provided by an ordinary component pouch; M/DF and F/DF use the material branch above.
  if(Number(components.divineFocus)===1) {
    if(!symbol)throw new Error(`${item.name}需要携带圣徽或神圣法器。`);
    requirements.push({kind:"divineFocus",label:symbol.name});
  }
  return {key:foundry.utils.randomID(16),requirements};
}

const queues=new Map();
export async function consumeSpellComponents(actor,plan) {
  if(!plan)return;
  const previous=queues.get(actor.uuid)??Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    for(const requirement of plan.requirements.filter(entry=>entry.consume)) {
      const material=actor.items.get(requirement.item);
      if(!material)throw new Error(`施法材料${requirement.label}已不存在，未应用法术。`);
      const receipts=material.getFlag(MODULE_ID,"componentCasts")??[];
      if(receipts.includes(plan.key))continue;
      const quantity=Number(material.system.quantity);
      if(!Number.isFinite(quantity)||quantity<1||!carried(material,actor))throw new Error(`施法材料${material.name}已经耗尽或未携带，未应用法术。`);
      await material.update({"system.quantity":quantity-1,[`flags.${MODULE_ID}.componentCasts`]:[...receipts,plan.key].slice(-64)});
    }
  });
  queues.set(actor.uuid,task);
  try{await task;}finally{if(queues.get(actor.uuid)===task)queues.delete(actor.uuid);}
}

export function charmThreatContext(actor,target) {
  const tokens=canvas?.tokens?.placeables??[];
  const targetToken=[...game.user.targets].find(token=>token.actor?.uuid===target.uuid)
    ??tokens.find(token=>token.actor?.uuid===target.uuid);
  const candidates=tokens.filter(token=>token.actor?.uuid===actor.uuid);
  const caster=canvas?.tokens?.controlled?.find(token=>token.actor?.uuid===actor.uuid)??(candidates.length===1?candidates[0]:null);
  if(!caster||!targetToken)return {threatened:false,known:false,combat:false,hostile:false,armed:false};
  const participants=game.combat?.scene?.id===canvas?.scene?.id?(game.combat?.combatants?.contents??[]):[];
  const participating=token=>participants.some(entry=>entry.tokenId===token.id);
  const combat=Boolean(game.combat?.started&&participating(targetToken));
  const side=Number(caster.document.disposition),other=Number(targetToken.document.disposition);
  const known=[-1,1].includes(side)&&[-1,1].includes(other);
  const allies=tokens.filter(token=>token.id===caster.id||Number(token.document.disposition)===side&&participating(token));
  let hostile=false,armed=false,threatened=false;
  for(const source of allies) {
    const enemy=known&&Number(source.document.disposition)===-other;
    const conditions=source.actor?.system.attributes?.conditions??{};
    if(["dead","unconscious","paralyzed","stunned","dazed"].some(key=>conditions[key]))continue;
    const weapon=source.actor?.items.some(entry=>entry.type==="weapon"&&entry.system.equipped&&!entry.system.melded&&!entry.broken&&Number(entry.system.quantity??1)>0);
    hostile ||=enemy;armed ||=Boolean(enemy&&weapon);
    threatened ||=Boolean(enemy&&(combat&&participating(source)||weapon));
  }
  return {threatened,known,combat,hostile,armed};
}
