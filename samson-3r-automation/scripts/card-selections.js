import { MODULE_ID } from "./catalog.js";
import { allSeeds } from "./content.js";
import { choose } from "./rules-bridge.js";
import { syncPatronSpells } from "./progression.js";

const classes=[["Wizard","法师"],["Sorcerer","术士"],["Arcanist","奥能师"],["Magus","魔战士"],["Summoner","召唤师"],["Bloodrager","血怒者"]];
const learned=(spell,name)=>spell.system.learnedAt?.class?.find(([source])=>source.toLowerCase()===name.toLowerCase());
const identity=value=>String(value??"").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,"");
const esc=text=>String(text??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const busy=new Set();
async function selectPastLife(actor) {
  if(busy.has(actor.uuid))return;
  busy.add(actor.uuid);
  try {
    const selections=actor.getFlag(MODULE_ID,"pastLifeSelections")??[];
    let maximum=Number(actor.getFlag(MODULE_ID,"pastLifeCapacity"));
    if(!Number.isInteger(maximum)||maximum<1) {
      if(Number(actor.system.attributes.hd.total)!==1)throw new Error("前世秘术的名额按1级时的施法属性确定，请先记录当时的名额。");
      const ability=actor.system.attributes.spells.spellbooks.primary.ability;
      maximum=Math.max(0,1+Number(actor.system.abilities[ability].mod));
      await actor.setFlag(MODULE_ID,"pastLifeCapacity",maximum);
    }
    if(selections.length>=maximum)throw new Error("前世秘术的法术已全部选定。");
    let source=actor.getFlag(MODULE_ID,"pastLifeClass");
    if(!source) {
      source=await choose("前世秘术：来源职业",classes);
      if(!source)return;
    }
    const pack=game.packs.get("D35E.spells");
    const native=await pack?.getDocuments()??[];
    const candidates=[...allSeeds(),...native].filter(spell=>spell.type==="spell"&&learned(spell,source));
    const unique=new Map();
    for(const spell of candidates) {
      const id=spell.flags?.[MODULE_ID]?.currentCardSpell??spell.name.toLowerCase();
      if(selections.some(entry=>identity(entry.id)===identity(id)||entry.uuid&&entry.uuid===spell.uuid||entry.name&&identity(entry.name)===identity(spell.name)))continue;
      unique.set(id,spell);
    }
    const selected=await choose(`前世秘术：选择法术（还可选${maximum-selections.length}个）`,[...unique].map(([id,spell])=>[id,`${spell.name} · ${learned(spell,source)[1]}环`]).sort((a,b)=>a[1].localeCompare(b[1],"zh")));
    if(!selected)return;
    const sourceSpell=unique.get(selected),level=Number(learned(sourceSpell,source)[1]);
    if(!Number.isInteger(level)||level<0||level>9)throw new Error("来源法术没有有效的环级。");
    let document=sourceSpell;
    if(!document.uuid)document=(await game.packs.get(`world.samson-${sourceSpell.flags[MODULE_ID].source}`)?.getDocuments()??[]).find(item=>item.getFlag(MODULE_ID,"key")===sourceSpell.flags[MODULE_ID].key);
    if(!document?.pack||!document.id)throw new Error("法术来源合集缺失，未保存无效的法术选择。");
    const witch=actor.items.find(item=>item.getFlag(MODULE_ID,"key")==="witch");
    if(!witch)throw new Error("没有关联女巫职业的法术表。");
    const list=foundry.utils.deepClone(witch.system.spellbook??[]);
    list[level]??={level,spells:[]};list[level].spells??=[];
    if(!list[level].spells.some(entry=>entry.pack===document.pack&&entry.id===document.id))list[level].spells.push({name:document.name,img:document.img,pack:document.pack,id:document.id});
    await witch.update({"system.spellbook":list});
    await actor.update({[`flags.${MODULE_ID}.pastLifeSelections`]:[...selections,{id:selected,name:sourceSpell.name,uuid:document.uuid,class:source,type:"arcane",level}],
      [`flags.${MODULE_ID}.pastLifeClass`]:source,[`flags.${MODULE_ID}.mysticPastLifePending`]:maximum-selections.length-1});
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>前世秘术：将${esc(sourceSpell.name)}（${level}环）加入女巫法术表。学习与准备该法术仍遵循女巫的规则。</p>`});
  }finally{busy.delete(actor.uuid);}
}
export function installCardSelections() {
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    if(!hook.customUse&&item.getFlag(MODULE_ID,"key")==="celestial-agenda") {
      hook.customUse=true;
      (async()=>{
        if(actor.getFlag(MODULE_ID,"patronTheme"))return item.roll();
        const theme=await choose("庇护主主旨",[["endurance","耐久"],["healing","治疗"],["light","光耀"],["portents","征兆"]]);
        if(theme){await actor.setFlag(MODULE_ID,"patronTheme",theme);await syncPatronSpells(actor,Number(actor.items.find(row=>row.getFlag(MODULE_ID,"key")==="witch")?.system.levels)||0);}
      })().catch(error=>ui.notifications.error(error.message));
      return;
    }
    if(hook.customUse||item.getFlag(MODULE_ID,"key")!=="mystic-past-life")return;
    hook.customUse=true;
    selectPastLife(actor).catch(error=>{console.error(MODULE_ID,error);ui.notifications.error(error.message);});
  });
}
