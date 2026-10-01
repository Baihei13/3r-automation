import { MODULE_ID } from "./catalog.js";
import { createTransientView } from "./transient-view.js";

// PF1: CHM page_209.html (fragile), page_9.html (broken).
export const weaponFor=item=>item.actor?.items.get(item.system.originalWeaponId)??(item.type==="weapon"?item:null);
const obsidian=weapon=>weapon?.getFlag(MODULE_ID,"primitiveMaterial")?.kind==="obsidian";
// UE's material-strengthening treatment is distinct from an enhancement bonus.
export const isFragile=weapon=>Boolean(weapon?.system.properties?.frg)
  &&!(obsidian(weapon)&&weapon.getFlag(MODULE_ID,"primitiveMaterial")?.strengthened);
export function fragileState(weapon) {
  if(!weapon||(!weapon.system.properties?.frg&&!obsidian(weapon)&&!weapon.getFlag(MODULE_ID,"fragile")))return null;
  const saved=weapon.getFlag(MODULE_ID,"fragile")?.state;
  const hp=Number(weapon.system.hp?.value),max=Number(weapon.system.hp?.max);
  if(saved==="destroyed"||(max>0&&hp<=0))return "destroyed";
  return saved==="broken"||(max>0&&(hp<max/2||(hp===max/2&&saved!=="intact")))?"broken":"intact";
}
const report=error=>{console.error(MODULE_ID,error);ui.notifications.error(`易碎武器：${error.message}`);};
const pending=new Map();
async function naturalOne(weapon) {
  if(!isFragile(weapon))return;
  if(!weapon.isOwner)throw new Error("没有武器的修改权限，请由所有者或GM结算。");
  const state=fragileState(weapon);if(state==="destroyed")return;
  const max=Number(weapon.system.hp?.max),hp=Number(weapon.system.hp?.value);
  if(!Number.isFinite(max)||max<=0||!Number.isFinite(hp))throw new Error("请先在武器详情填写有效的最大HP和当前HP。");
  const old=weapon.getFlag(MODULE_ID,"fragile")??{};
  const loss=state==="broken"?0:Math.min(hp,Math.floor(max/2)+1);
  const next=state==="broken"||hp-loss<=0?"destroyed":"broken";
  const update={"system.hp.value":next==="destroyed"?0:hp-loss,
    [`flags.${MODULE_ID}.fragile`]:{...old,state:next,brokenHpLoss:state==="broken"?old.brokenHpLoss??0:loss,
      lastNaturalOneAt:game.time.worldTime}};
  if(next==="destroyed")update["system.equipped"]=false;
  await weapon.update(update,{threeRFragile:true});
  ui.notifications.warn(next==="destroyed"?`${weapon.name}：天然1，武器已摧毁，不能继续使用。`:
    `${weapon.name}：天然1，武器破损，损失${loss} HP；后续攻击和伤害−2，重击20／×2。`);
}
function queueNaturalOne(weapon) {
  const task=(pending.get(weapon.uuid)??Promise.resolve()).catch(report).then(()=>naturalOne(weapon));
  pending.set(weapon.uuid,task);
  return task.finally(()=>{if(pending.get(weapon.uuid)===task)pending.delete(weapon.uuid);});
}
export function prepareFragileAttack(chat,options) {
  if(!options.critical) {
    const weapon=weaponFor(chat.item),state=fragileState(weapon);
    chat._threeRFragile={weapon,state};
    if(state==="destroyed") {
      chat._threeRFragileUnavailable=true;chat.hasAttack=false;
      chat.effectNotes="武器已摧毁，本次后续攻击未进行。";
      return null;
    }
    if(state==="broken") {
      chat.rollData.item.ability={...chat.rollData.item.ability,critRange:20,critMult:2};
      const system={...chat.item.system,ability:{...chat.item.system.ability,critRange:20,critMult:2}};
      chat.item=createTransientView(chat.item,{system});
    }
  }
  if(chat._threeRFragile?.state==="broken"&&!(options.extraParts??[]).some(part=>part.threeRFragile))
    return {...options,extraParts:[...(options.extraParts??[]),
      {part:"-2",value:-2,source:"无名减值",threeRFragile:true}]};
  return options;
}
export async function finishFragileAttack(chat,options) {
  if(options.critical||chat._threeRFragileUnavailable)return;
  if(chat.attack.isFumble&&isFragile(chat._threeRFragile?.weapon))await queueNaturalOne(chat._threeRFragile.weapon);
}
export function fragileDamageOptions(chat,options) {
  if(chat._threeRFragile?.state!=="broken")return options;
  return {...options,extraParts:[...(options.extraParts??[]),["-2 * @critMult","无名减值","base"]]};
}
export async function repairFragile(weapon) {
  if(!weapon?.isOwner||fragileState(weapon)===null)throw new Error("请选择有修改权限且记录了破损的武器。");
  const state=fragileState(weapon);if(state==="intact")return;
  if(state==="destroyed")throw new Error("武器已摧毁，修复破损不能恢复它；重造或恢复须另行处理。");
  const record=weapon.getFlag(MODULE_ID,"fragile")??{},max=Number(weapon.system.hp.max),hp=Number(weapon.system.hp.value);
  const restored=Math.min(Math.max(0,Number(record.brokenHpLoss)||0),max-hp);
  await weapon.update({"system.hp.value":hp+restored,[`flags.${MODULE_ID}.fragile`]:{...record,state:"intact",brokenHpLoss:0}},
    {threeRFragile:true});
  ui.notifications.info(`${weapon.name}：恢复破损损失的${restored} HP，现为${hp+restored}/${max}；${fragileState(weapon)==="broken"?"其他伤害仍令武器破损。":"破损已解除。"}`);
}
export function installFragileRules() {
  // Healing reduces the fragile loss ledger first. Crossing the repair threshold
  // restores only that remainder; sunder damage is never included in the ledger.
  Hooks.on("preUpdateItem",(item,change,options)=> {
    if(options?.threeRFragile||fragileState(item)===null)return;
    const value=change["system.hp.value"]??change.system?.hp?.value;
    const hp=Number(item.system.hp.value),max=Number(item.system.hp.max),next=Number(value);
    if(value==null||!Number.isFinite(next))return;
    const record=item.getFlag(MODULE_ID,"fragile")??{};
    if(next<hp&&next<=max/2) {
      change[`flags.${MODULE_ID}.fragile`]={...record,state:next<=0?"destroyed":"broken",brokenHpLoss:record.brokenHpLoss??0};
      return;
    }
    if(fragileState(item)!=="broken"||next<=hp)return;
    const loss=Math.max(0,(Number(record.brokenHpLoss)||0)-(next-hp));
    change[`flags.${MODULE_ID}.fragile`]={...record,state:next>=max/2?"intact":"broken",brokenHpLoss:next>=max/2?0:loss};
    if(next>=max/2) {
      const total=Math.min(max,next+loss);
      if(change.system?.hp)change.system.hp.value=total;
      else change["system.hp.value"]=total;
    }
  });
  Hooks.on("renderItemSheet",(app,html)=> {
    const item=app.item??app.document;if(item?.type!=="weapon"||fragileState(item)===null)return;
    const root=html instanceof HTMLElement?html:html?.[0];if(!root)return;
    root.querySelectorAll(".three-r-fragile").forEach(node=>node.remove());
    const panel=document.createElement("section");panel.className="three-r-fragile";
    const state=fragileState(item),loss=Number(item.getFlag(MODULE_ID,"fragile")?.brokenHpLoss)||0;
    const trait=isFragile(item)?"易碎":obsidian(item)&&item.getFlag(MODULE_ID,"primitiveMaterial")?.strengthened?"易碎已由材料强化移除":"易碎已停用";
    const text=document.createElement("p");text.textContent=`${trait}：${{intact:"完好",broken:"破损",destroyed:"已摧毁"}[state]} · HP ${item.system.hp.value}/${item.system.hp.max} · 破损待恢复 ${loss} HP`;
    panel.append(text);
    if(obsidian(item)) {
      const material=item.getFlag(MODULE_ID,"primitiveMaterial"),cost=100*Number(item.system.weight);
      const line=document.createElement("label"),check=document.createElement("input");check.type="checkbox";
      check.checked=Boolean(material.strengthened);check.disabled=!item.isOwner;
      line.append(check,document.createTextNode(` 已完成黑曜石材料魔法强化（100金币／磅，当前重量对应${cost}金币；与临时增强加值分开）`));
      check.addEventListener("change",async()=> {
        const enabled=check.checked;
        if(!await Dialog.confirm({title:"记录材料魔法强化",content:enabled?
          `<p>确认已完成并支付${cost}金币的材料强化。将移除易碎并把强化费用计入物品价格；付款自行结算，不扣角色金币，也不修复现有损伤。</p>`:
          "<p>确认撤销材料强化记录，重新启用易碎；不会返还角色金币。若物品价格仍等于此前记录值，会恢复处理前价格。</p>"})) {check.checked=!enabled;return;}
        try {
          const price=Number(item.system.price),update={"system.properties.frg":!enabled};
          const next={...material,strengthened:enabled};
          if(enabled) {next.strengtheningCost=cost;next.priceBefore=price;next.priceAfter=price+cost;update["system.price"]=price+cost;}
          else if(price===material.priceAfter)update["system.price"]=material.priceBefore;
          update[`flags.${MODULE_ID}.primitiveMaterial`]=next;
          await item.update(update);
        }catch(error){check.checked=!enabled;report(error);}
      });panel.append(line);
    }
    if(item.isOwner&&state==="broken") {
      const button=document.createElement("button");button.type="button";button.textContent="结算已完成的破损修复";
      button.addEventListener("click",async()=> {
        if(await Dialog.confirm({title:"修复破损",content:"<p>请确认已经使用允许的修复能力，并完成所需动作与资源消耗。这里仅恢复破损所损失的HP，不恢复破武等其他伤害；不会自动授予快速清膛或战地维修。</p>"}))repairFragile(item).catch(report);
      });panel.append(button);
    }
    (root.querySelector('.tab[data-tab="description"]')??root.querySelector("form")??root).append(panel);
  });
}
