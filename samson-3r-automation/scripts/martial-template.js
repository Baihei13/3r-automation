import { MODULE_ID } from "./catalog.js";
import { ItemCharges } from "../../../systems/D35E/module/item/extensions/charges.js";
import { ItemSheetPF } from "../../../systems/D35E/module/item/sheets/base.js";
import { martial,stateView } from "./martial-state.js";

// Native spell storage and sheet; martial flags remain the only resource authority.
// An empty book keeps these entries out of every daily spellbook. atWill is an
// internal bypass of native charges, not a claim that maneuvers are unlimited.
export function martialSpellRepairs(item) {
  const m=martial(item);
  if(!m?.definition||!["feat","spell"].includes(item.type))return {};
  const update={};
  if(item.type!=="spell") {
    const old=foundry.utils.deepClone(item.toObject?.().system??item.system);
    const model=game.model.Item,system=foundry.utils.deepClone(model.spell??{});
    for(const name of system.templates??[])foundry.utils.mergeObject(system,foundry.utils.deepClone(model.templates?.[name]??{}));
    delete system.templates;
    foundry.utils.mergeObject(system,old);
    update.type="spell";
    if(!item.flags?.[MODULE_ID]?.martialTemplateBackup)
      update[`flags.${MODULE_ID}.martialTemplateBackup`]={type:item.type,system:old};
    Object.assign(system,{
      level:m.level,learnedAt:{class:[["贤者之剑",m.level]],domain:[],subDomain:[],elementalSchool:[],bloodline:[]},
      components:{value:"",verbal:false,somatic:false,material:false,focus:false,divineFocus:0},
      sr:false,pr:false,school:"",spellbook:"",atWill:true,
      spellDuration:m.fields?.["持续时间"]??"",spellTarget:m.fields?.["目标"]??"",
      spellArea:m.fields?.["范围"]??m.fields?.["区域"]??"",
      preparation:{preparedAmount:0,maxAmount:0,autoDeductCharges:false}
    });
    // v14 requires a forced replacement when changing Document type. Never
    // mix ordinary system.* patches with this replacement in the same update.
    update["==system"]=system;
  } else {
    if(item.system.spellbook!=="")update["system.spellbook"]="";
    if(item.system.atWill!==true)update["system.atWill"]=true;
    if(item.system.preparation?.autoDeductCharges!==false)update["system.preparation.autoDeductCharges"]=false;
  }
  if(m.templateRevision!==2)update[`flags.${MODULE_ID}.martial.templateRevision`]=2;
  return update;
}

export async function applyMartialRepair(item,update) {
  if(update.type&&Object.hasOwn(update,"==system")) {
    // Item35E.update appends system.index.*. Use the native batch API so the
    // forced replacement stays intact; IDs, other flags and permissions remain.
    const context={};if(item.pack)context.pack=item.pack;if(item.parent)context.parent=item.parent;
    return item.constructor.updateDocuments([{_id:item.id,...update}],context);
  }
  return item.update(update);
}

export function martialUses(item) {
  const m=martial(item),actor=item.actor;
  if(!m||!actor||m.retired||!m.profile)return 0;
  const saved=stateView(actor),profile=saved.profiles?.[m.profile];
  if(!profile||!actor.items.get(m.profile))return 0;
  if(m.kind==="stance")return Infinity;
  return profile.readied?.includes(item.id)&&!profile.expended?.includes(item.id)?1:0;
}

export function installMartialTemplate() {
  const getData=ItemSheetPF.prototype.getData;
  ItemSheetPF.prototype.getData=async function(...args) {
    const data=await getData.apply(this,args);
    if(this.item.type==="spell"&&martial(this.item)) {
      // The complete, natively enriched rule is already description.value.
      // A spell-only parameter block adds false PP/save/SR claims and pushes
      // the actual maneuver below the fold. Keep the native template/body.
      data.enriched.spellProperties="";
    }
    return data;
  };
  const sizedSheets=new WeakSet();
  const charges=ItemCharges.prototype.getCharges,maxCharges=ItemCharges.prototype.getMaxCharges;
  ItemCharges.prototype.getCharges=function(...args){return martial(this.item)?martialUses(this.item):charges.apply(this,args);};
  ItemCharges.prototype.getMaxCharges=function(...args){return martial(this.item)?martial(this.item).kind==="stance"?Infinity:1:maxCharges.apply(this,args);};
  // Prevent edits through the shared sheet from moving martial entries into
  // a daily spellbook or enabling daily charge deduction. No choices are reset.
  Hooks.on("preUpdateItem",(item,change)=>{
    if(!martial(item))return;
    if(Object.hasOwn(change,"==system"))return;
    const flat=foundry.utils.flattenObject(change);
    for(const [path,value] of [["system.spellbook",""],["system.atWill",true],["system.preparation.autoDeductCharges",false]])
      if(Object.hasOwn(flat,path)){
        if(Object.hasOwn(change,path))change[path]=value;
        else foundry.utils.setProperty(change,path,value);
      }
  });
  Hooks.on("renderItemSheet",(app,html)=>{
    const item=app.item,m=martial(item);if(!m||item.type!=="spell")return;
    const root=html instanceof HTMLElement?html:html?.[0];if(!root)return;
    root.classList.add("three-r-martial-item-sheet");
    root.closest(".app")?.classList.add("three-r-martial-item-sheet");
    if(!sizedSheets.has(app)) {
      sizedSheets.add(app);
      const width=Math.min(Math.max(Number(app.position.width)||560,640),Math.max(320,window.innerWidth-30));
      const height=Math.min(Math.max(Number(app.position.height)||650,720),Math.max(300,window.innerHeight-60));
      // One layout adjustment per window, no document writes or render loop.
      app.setPosition({width,height,top:Math.max(0,Math.min(Number(app.position.top)||0,window.innerHeight-height-20)),
        left:Math.max(0,Math.min(Number(app.position.left)||0,window.innerWidth-width-20))});
    }
    const kind=m.kind==="stance"?"架势":"武技",active=stateView(item.actor??{}).activeStance===item.id;
    const type=root.querySelector(".item-type"),status=root.querySelector(".item-status");
    if(type)type.textContent=`${m.disciplineName} · ${kind}`;
    if(status)status.textContent=m.kind==="stance"?active?"当前架势 · 持续":"未进入架势":`剩余 ${martialUses(item)} / 1 · 准备与恢复在武术页`;
    const summary=root.querySelector(".summary");if(summary)summary.textContent=`${m.level}级${kind} · ${m.abilityType==="su"?"超自然能力":"特异能力"}`;
    const description=root.querySelector('.tab[data-tab="description"]');
    const title=description?.querySelector("h2");if(title)title.textContent="完整规则";
    const level=root.querySelector('[name="system.level"]');if(level){
      level.disabled=true;const label=level.closest(".form-group")?.querySelector("label");if(label)label.textContent="武术等级";
      for(const option of level.options)option.textContent=`${option.value}级`;
    }
    for(const name of ["system.spellbook","system.atWill","system.preparation.autoDeductCharges"]){
      const input=root.querySelector(`[name="${name}"]`);if(!input)continue;
      input.disabled=true;const group=input.closest(".form-group");if(group)group.hidden=true;
    }
    const details=root.querySelector('.tab[data-tab="details"]');if(details){
      const heading=details.querySelector(".form-header");if(heading)heading.textContent="武术条目详情";
      if(!details.querySelector(".three-r-martial-template-note")) {
        const note=document.createElement("p");note.className="three-r-martial-template-note";
        note.textContent="学习、准备、恢复与架势切换在角色卡的武术页管理。";details.prepend(note);
      }
    }
  });
}
