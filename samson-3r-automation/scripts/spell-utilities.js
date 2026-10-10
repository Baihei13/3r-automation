import { MODULE_ID } from "./catalog.js";
import { choose, timedBuff, replaceTimedBuff, casterLevel } from "./rules-bridge.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";
import { effectDeadline } from "./effect-state.js";
import { fragileState } from "./fragile.js";

export const utilityKind=item=>({"pf-spell-mending":"mending","pf-spell-create-water":"water","pf-spell-detect-magic":"detect"})[item?.getFlag(MODULE_ID,"key")];
export function pfSpellVariant(item) {
  if(item?.getFlag(MODULE_ID,"key")==="pf-spell-mending")return {
    shortDescription:"<p>PF修复术：施法10分钟，距离10尺，修复一件重量不超过每施法者等级1磅的物品，恢复1d4物品生命值。所有碎片必须齐全。修复到原最大生命值的一半或以上时解除破损。修复魔法物品要求施法者等级不低于该物品；被摧毁的魔法物品可修好实体，但无法恢复魔力。不能修复生物，包括构装体，也不能还原变形。</p>",
    activation:{type:"minute",cost:10},range:{units:"ft",value:10},spellTarget:"一件物品，至多1磅/等级",spellDuration:"立即",spellDurationData:{units:"inst",value:""}
  };
  if(item?.getFlag(MODULE_ID,"key")==="pf-spell-create-water")return {
    shortDescription:"<p>产生可饮用清水，至多每施法者等级2加仑，可以装满容器或形成降雨。未饮用的水在1天后消失。不能在生物体内造水。每加仑约重8磅。</p>",
    spellEffect:"至多2加仑清水/等级",spellDuration:"立即；未饮用的水1天后消失",spellDurationData:{units:"inst",value:""}
  };
  return null;
}
export async function prepareUtility(item,actor,cl) {
  const kind=utilityKind(item);
  if(kind==="mending") {
    const targets=[...game.user.targets].map(t=>t.actor).filter(Boolean);
    const target=targets.length===1?targets[0]:actor;
    const objects=target.items.filter(i=>["weapon","equipment","loot","consumable"].includes(i.type)
      && fragileState(i)!=="destroyed"&&Number(i.system.weight)<=cl && Number(i.system.hp?.max)>Number(i.system.hp?.value));
    const objectUuid=await choose("修复术：选择物品（每等级1磅以内）",objects.map(i=>[i.uuid,`${i.name}：${i.system.hp.value}/${i.system.hp.max} HP`]));
    if(!objectUuid)return false;
    const object=await fromUuid(objectUuid);
    if(Number(object.system.cl)>cl)throw new Error("施法者等级低于魔法物品的施法者等级，无法修复。");
    if(!await Dialog.confirm({title:"修复术：确认材料",content:"<p>确认物品在10尺内、碎片齐全，且损伤不是单纯变形。会开始10分钟施法计时；中断时停用计时增益。</p>"}))return false;
    return {objectUuid};
  }
  if(kind==="water") {
    const quantity=await Dialog.prompt({title:`造水术：至多${2*cl}加仑`,content:`<input name="gallons" type="number" min="0.1" max="${2*cl}" step="0.1" value="${2*cl}"><p>按加仑记录。请确认容器或落水位置在法术范围内。</p>`,label:"施放",rejectClose:false,callback:h=>(h[0]??h).querySelector("input").value});
    if(quantity==null)return false;
    const gallons=Number(quantity);
    if(!Number.isFinite(gallons)||gallons<=0||gallons>2*cl)throw new Error("水量超出了施法者等级允许的上限。");
    return {gallons};
  }
  return {};
}
export async function applyUtility(item,actor,{cl=casterLevel(item),seconds=null,objectUuid,gallons}={}) {
  const kind=utilityKind(item);
  if(kind==="mending") {
    if(!objectUuid)return;
    const data=timedBuff("施法中：修复术","mending-casting",600,[],{sourceActor:actor.uuid,sourceItemUuid:item.uuid,objectUuid});
    data.system.description.value="<p>持续施法10分钟，完成后修复已选物品1d4生命值。中断时停用此增益，不会修复。</p>";
    return replaceTimedBuff(actor,data);
  }
  if(kind==="water") {
    if(!gallons)return;
    return actor.createEmbeddedDocuments("Item",[{name:"造水术：清水（加仑）",type:"loot",img:"icons/svg/droplet.svg",system:{quantity:gallons,weight:8,price:0,description:{value:"<p>每份1加仑，约8磅。饮用时减少数量；剩余水1天后消失。</p>"}},flags:{[MODULE_ID]:{key:"created-water",sourceItemUuid:item.uuid,expiresAt:game.time.worldTime+86400}}}]);
  }
  if(kind==="detect") {
    const data=timedBuff(seconds===86400?"侦测魔法（持久）":"侦测魔法（专注）","detect-magic-concentration",seconds??60*cl,[],{sourceActor:actor.uuid,sourceItemUuid:item.uuid,cl});
    data.img=item.img;data.system.description.value=await item.getChatDescription();
    if(seconds===86400)data.system.description.value+="<p>持久24小时：注意到受侦测事物出现或消失无需持续专注；获取进一步信息仍需正常专注。</p>";
    return replaceTimedBuff(actor,data);
  }
}
export async function utilityTime(actor) {
  for(const item of actor.items) {
    const end=effectDeadline(item);
    if(end===null||end>game.time.worldTime)continue;
    if(item.getFlag(MODULE_ID,"key")==="created-water"&&Number(item.system.quantity)>0)await item.update({"system.quantity":0});
    if(item.getFlag(MODULE_ID,"key")!=="mending-casting"||!item.system.active)continue;
    await item.update({"system.active":false});
    const object=await fromUuid(item.getFlag(MODULE_ID,"objectUuid")).catch(()=>null);
    if(!object)continue;
    if(fragileState(object)==="destroyed") {
      ui.notifications.warn(`${object.name}已摧毁，不能按此次破损修复自动恢复；须另行处理重造与魔力。`);
      continue;
    }
    const roll=await new Roll35e("1d4").roll();
    const hp=Math.min(Number(object.system.hp.max),Number(object.system.hp.value)+roll.total);
    await object.update({"system.hp.value":hp});
    await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`修复术完成：${object.name}掷得${roll.total}点物品生命值修复；结算破损后现为${object.system.hp.value}/${object.system.hp.max}。魔法已被摧毁时不会恢复其魔力。`});
  }
}
