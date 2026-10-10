import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { ItemUse } from "../../../systems/D35E/module/item/extensions/use.js";
import { ItemCharges } from "../../../systems/D35E/module/item/extensions/charges.js";
import { carried } from "./spell-components.js";

const busy=new WeakSet();
const esc=value=>foundry.utils.escapeHTML(String(value??""));
const has=(actor,key)=>actor.items.some(i=>i.flags?.[MODULE_ID]?.key===key&&effectIsActive(i));
export function divinePersistentAction(actor,focus=null) {
  let reason=null;
  if(!actor)reason="请先将物品加入角色库存";
  else if(focus&&(!actor.items.has(focus.id)||!carried(focus,actor)))reason="需要随身携带这个圣徽";
  else if(!["神圣超魔：法术持久","法术持久","法术延时"].every(key=>has(actor,key))||(Number(actor.system.attributes.turnUndeadHdTotal)||0)<1)
    reason="需要法术延时、法术持久、神圣超魔及驱散／斥喝不死生物能力";
  else if((Number(actor.system.attributes.turnUndeadUses)||0)<7)reason="驱散／斥喝剩余不足7次";
  return {mode:"action",kind:null,available:!reason,label:reason??"选择神术并持久施放",
    resource:actor?{value:actor.system.attributes.turnUndeadUses,max:actor.system.attributes.turnUndeadUsesTotal,cost:7,label:"驱散／斥喝"}:null};
}

let symbolRollInstalled=false;
export function installHolySymbolUse() {
  if(symbolRollInstalled)return;
  symbolRollInstalled=true;
  const original=CONFIG.Item.documentClass.prototype.roll;
  // D35E inventory icons call roll(), whereas the HUD calls use(). Both enter
  // the same native preUseItem hook. Unowned compendium items keep description rolls.
  CONFIG.Item.documentClass.prototype.roll=function(...args) {
    if(this.actor&&this.flags?.[MODULE_ID]?.key==="holy-symbol")return this.use({});
    return original.apply(this,args);
  };
}
function qualification(item,actor) {
  if(item.type!=="spell"||item.flags?.[MODULE_ID]?.martial)return "不是神术";
  const book=actor.system.attributes?.spells?.spellbooks?.[item.system.spellbook??"primary"];
  const source=book?.class?actor.items.find(i=>i.type==="class"&&(i.id===book.class||i.system.customTag===book.class)):null;
  const type=book?.spellcastingType&&book.spellcastingType!=="none"?book.spellcastingType:source?.system.spellcastingType;
  if(type!=="divine")return "法术书尚未关联神术施法职业";
  if(!(Number(new ItemCharges(item).getCharges())>0))return "没有剩余法术次数";
  const range=item.system.range??{},personal=["personal","self"].includes(range.units);
  const fixed=["ft","mi","m"].includes(range.units)&&Number.isFinite(Number(range.value))&&String(range.value??"").trim()!=="";
  if(!personal&&!fixed)return "法术持久只允许个人或固定距离，不包括接触、近距、中距或远距";
  const duration=item.system.spellDurationData??{};
  if(!["turn","round","roundPerLevel","minute","minutePerLevel","hour","hourPerLevel","day"].includes(duration.units))return "不是可持久化的非瞬间持续法术（特殊持续时间尚无可靠字段）";
  if(/discharg|释放|放电|能量散发/i.test(String(item.system.spellDuration??"")))return "释放型法术不能持久化";
  // Vision of Glory's numeric duration does not capture its discharge clause.
  if(item.flags?.[MODULE_ID]?.clericSpell==="vision-of-glory")return "荣光会在豁免时释放，不能持久化";
  return null;
}

export async function useDivinePersistent(actor,focus=null) {
  if(!actor?.isOwner)throw new Error("没有这个角色的操纵权限。");
  if(busy.has(actor))throw new Error("这个角色正在选择或施放持久法术。");
  busy.add(actor);
  let reserved=false,attempted=false,receiptId;
  try {
    const action=divinePersistentAction(actor,focus);
    if(!action.available)throw new Error(action.label);
    const uses=Number(actor.system.attributes.turnUndeadUses)||0;
    if(uses<7)throw new Error(`持久化需要7次驱散／斥喝，目前剩余${uses}次。`);
    const spells=actor.items.filter(i=>i.type==="spell"&&!i.flags?.[MODULE_ID]?.martial);
    const eligible=spells.filter(i=>!qualification(i,actor));
    if(!eligible.length)throw new Error("没有已准备且符合个人／固定距离等持久条件的神术。请检查法术次数、距离和法术书的神术职业关联。");
    const rejected=spells.filter(i=>!eligible.includes(i));
    const id=await foundry.applications.api.DialogV2.wait({window:{title:"神圣超魔：法术持久"},rejectClose:false,
      content:`<p>选择本次神术：原法术位不提高，消耗7次驱散／斥喝，持续24小时。剩余${uses}次。</p><label>法术<select name="spell">${eligible.map(i=>`<option value="${i.id}">${esc(i.name)}（${new ItemCharges(i).getCharges()}次）</option>`).join("")}</select></label>${rejected.length?`<details><summary>其他法术为什么不能选择</summary>${rejected.map(i=>`<p>${esc(i.name)}：${esc(qualification(i,actor))}</p>`).join("")}</details>`:""}`,
      buttons:[{action:"cast",label:"持久施放",callback:(_e,_b,d)=>d.element.querySelector('[name="spell"]').value},{action:"cancel",label:"取消",callback:()=>null}]});
    if(!id)return {state:"cancelled"};
    const current=divinePersistentAction(actor,focus&&actor.items.get(focus.id));
    if(focus&&!actor.items.has(focus.id))throw new Error("这个圣徽已经移除。");
    if(!current.available)throw new Error(current.label);
    const spell=actor.items.get(id),reason=spell?qualification(spell,actor):"法术已经移除";
    if(reason)throw new Error(reason);
    const available=Number(actor.system.attributes.turnUndeadUses)||0;
    if(available<7)throw new Error("驱散／斥喝次数已改变，现在不足7次。");
    const seed=spell.toObject();
    seed.name=`${spell.name}（神圣超魔：法术持久）`;
    seed.system.spellDuration="24小时（神圣超魔：法术持久）";
    seed.system.spellDurationData={...seed.system.spellDurationData,units:"hour",value:"24"};
    seed.flags??={};seed.flags[MODULE_ID]={...seed.flags[MODULE_ID],divinePersistent:{seconds:86400}};
    const temporary=new CONFIG.Item.documentClass(seed,{parent:actor});
    receiptId=foundry.utils.randomID();
    // Reserve this resource while the native dialog is open. The original
    // spell consumes its own slot, exactly once, through useSpell's native
    // replacementItem support; the temporary view never replaces the item.
    await actor.update({"system.attributes.turnUndeadUses":available-7,[`flags.${MODULE_ID}.divinePersistentUses.${receiptId}`]:{spell:spell.id,state:"reserved"}});
    reserved=true;
    const before=new ItemCharges(spell).getCharges();
    const hook=Hooks.on("createChatMessage",message=>{
      const data=message.flags?.D35E?.chatTemplateData;
      if(message.speaker.actor===actor.id&&data?.item?.id===spell.id&&data.isSpell&&(!temporary.hasAction||message.flags.D35E.template==="systems/D35E/templates/chat/attack-roll.html"))attempted=true;
    });
    let result;
    try{result=await new ItemUse(spell).useSpell(null,{replacementItem:temporary},actor);}
    finally {
      Hooks.off("createChatMessage",hook);
      attempted=attempted||new ItemCharges(actor.items.get(id)??spell).getCharges()<before||Boolean(result?.flags?.[MODULE_ID]?.conditionFailed);
    }
    if(!attempted)return {state:"cancelled"};
    await actor.update({[`flags.${MODULE_ID}.divinePersistentUses.${receiptId}.state`] :"cast"},{updateChanges:false,skipMinions:true,skipToken:true});
    return {state:"performed",kind:spell.system.activation?.type,label:`${spell.name}（神圣超魔：法术持久）`};
  } finally {
    try {
      if(reserved&&!attempted)await actor.update({"system.attributes.turnUndeadUses":(Number(actor.system.attributes.turnUndeadUses)||0)+7,[`flags.${MODULE_ID}.divinePersistentUses.${receiptId}.state`]:"cancelled"});
    } finally {busy.delete(actor);}
  }
}
