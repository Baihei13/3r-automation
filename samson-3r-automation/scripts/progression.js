import { MODULE_ID } from "./catalog.js";
import { allSeeds } from "./content.js";
import { key, has, curseLevel, choose, timedBuff, replaceTimedBuff, syncSpellResistance } from "./rules-bridge.js";
const pending=new Set();
const oracleLevel = actor => actor.items.filter(i=>["oracle","dual-cursed-oracle"].includes(key(i))).reduce((n,i)=>n+Number(i.system.levels),0);

export async function syncProgression(actor) {
  if(!actor?.isOwner || pending.has(actor.uuid))return;
  pending.add(actor.uuid);
  try {
    const noble=actor.items.find(i=>key(i)==="noble-scion");
    const eligible=Boolean(noble&&Number(noble.getFlag(MODULE_ID,"selectedAtLevel"))===1&&Number(actor.system.abilities.cha.total)>=13);
    const classes=actor.items.filter(i=>i.type==="class");
    for(const item of classes) {
      const old=item.getFlag(MODULE_ID,"nobleClassSkill");
      if(eligible&&!item.system.classSkills?.kno)await item.update({"system.classSkills.kno":true,[`flags.${MODULE_ID}.nobleClassSkill`]:{previous:false}});
      else if(!eligible&&old)await item.update({"system.classSkills.kno":old.previous,[`flags.${MODULE_ID}.-=nobleClassSkill`]:null});
    }
    const witch=Number(actor.items.find(i=>key(i)==="witch")?.system.levels)||0;
    const rogue=Number(actor.items.find(i=>key(i)==="unchained-rogue")?.system.levels)||0;
    const oracle=oracleLevel(actor);
    if(!witch&&!rogue&&!oracle)return;
    const record={witch,rogue,oracle,
      hexes:witch?1+Math.floor(witch/2)+actor.items.filter(i=>key(i)==="extra-hex").length:0,
      majorHex:witch>=10,grandHex:witch>=18,
      familiarNewSpells:2*Math.max(0,witch-1),familiarPending:actor.getFlag(MODULE_ID,"familiarPending")??false,
      finesseChoices:rogue>=19?3:rogue>=11?2:rogue>=3?1:0,
      revelations:oracle?1+(oracle>=3?1+Math.floor((oracle-3)/4):0)+(has(actor,"dual-cursed-oracle")?(oracle>=5?1:0)+(oracle>=13?1:0):0):0,
      fixedCurse:actor.getFlag(MODULE_ID,"fixedCurse")??null};
    if(JSON.stringify(actor.getFlag(MODULE_ID,"progression"))!==JSON.stringify(record)) {
      await actor.setFlag(MODULE_ID,"progression",record);
      const classItems=actor.items.filter(i=>["witch","unchained-rogue","dual-cursed-oracle"].includes(key(i)));
      for(const item of classItems) {
        const summary=key(item)==="witch"?`女巫${witch}级：巫术名额${record.hexes}（庇护主奖励守护不占名额）；${record.majorHex?"强力巫术已开放":"强力巫术10级开放"}；${record.grandHex?"高等巫术已开放":"高等巫术18级开放"}。魔宠种类与法术选择保持待选。`
          :key(item)==="unchained-rogue"?`游荡者${rogue}级：巧技训练可选择${record.finesseChoices}种武器；选择后固定。影之刃仍须真实掌握且正在使用影手步法。`
          :`先知${oracle}级：启示名额${record.revelations}。不成长诅咒：${record.fixedCurse??"尚未选择；暂不启用5级以上成长能力"}。`;
        const value=item.system.description.value.replace(/<section data-3r-progress>[\s\S]*?<\/section>/g,"");
        await item.update({"system.description.value":`${value}<section data-3r-progress><p>${summary}</p></section>`});
      }
    }
    const reclusive=actor.items.find(i=>key(i)==="reclusive");
    if(reclusive) {
      const level=curseLevel(actor,"reclusive");
      const resistance=level>=15?10+oracle:0;
      if(Number(reclusive.getFlag(MODULE_ID,"spellResistance"))!==resistance)await reclusive.setFlag(MODULE_ID,"spellResistance",resistance);
      await syncSpellResistance(actor);
      const marker="魅惑法术及类法术能力（隐居诅咒）";
      const before=actor.system.traits.ci.custom??"";
      const parts=before.split(";").map(s=>s.trim()).filter(s=>s&&s!==marker);
      if(level>=10)parts.push(marker);
      if(parts.join(";")!==before)await actor.update({"system.traits.ci.custom":parts.join(";")});
    }
    const fortune=actor.items.find(i=>key(i)==="fortune");
    if(fortune) {
      const max=oracle<5?0:1+Math.floor((oracle-5)/6);
      if(Number(fortune.system.uses.max)!==max)await fortune.update({"system.uses.max":max,"system.uses.value":Math.min(Number(fortune.system.uses.value)||0,max)});
    }
    if(oracle)await bonusSpells(actor,oracle);
    if(witch&&has(actor,"celestial-agenda")) {
      const additions=[];
      for(const [required,k]of [[4,"pf-spell-castigate"],[10,"pf-spell-rebuke"]])if(witch>=required&&!actor.items.some(i=>key(i)===k)) {
        const seed=allSeeds().find(i=>key(i)===k);if(seed)additions.push(foundry.utils.deepClone(seed));
      }
      if(additions.length)await actor.createEmbeddedDocuments("Item",additions);
      if(witch>=16&&!actor.items.some(i=>key(i)==="celestial-planar-ally")) {
        const pack=game.packs.get("D35E.spells"),index=await pack?.getIndex();
        const entry=index?.find(i=>i.name==="Greater Planar Ally");
        if(entry){const data=(await pack.getDocument(entry._id)).toObject();for(const field of ["_id","folder","ownership","_stats"])delete data[field];data.name="高等异界盟友（仅善良）";data.system.level=8;data.system.spellbook="primary";data.flags??={};data.flags[MODULE_ID]={key:"celestial-planar-ally",source:"pf",category:"spell"};data.system.description.value+="<p>神圣之路庇护主限制：只呼唤善良异界生物；所呼唤对象和酬劳由GM选择确认。</p>";await actor.createEmbeddedDocuments("Item",[data]);}
      }
    }
  } finally {pending.delete(actor.uuid);}
}
const bonuses=[
  [2,"Ill Omen","凶兆","apg"],[4,"Oracle's Burden","先知负担","apg"],[6,"Bestow Curse","降咒","pf"],
  [8,"Wall of Fire","火墙术","pf"],[10,"Righteous Might","正气如虹","pf"],[12,"Mass Bull's Strength","群体公牛之力","pf"],
  [14,"Control Weather","控制天气","pf"],[16,"Earthquake","地震术","pf"],[18,"Storm of Vengeance","复仇风暴","pf"]];
async function bonusSpells(actor,level) {
  if(!has(actor,"dual-cursed-oracle")||!has(actor,"battle-mystery"))return;
  const unresolved=[];
  for(const [required,english,chinese,source] of bonuses) {
    if(level<required || actor.items.some(i=>i.type==="spell"&&(i.name===chinese||i.name===english||key(i)===`oracle-bonus-${required}`)))continue;
    const localKey=required===2?"pf-spell-ill-omen":required===4?"pf-spell-oracles-burden":null;
    const local=localKey&&allSeeds().find(i=>key(i)===localKey);
    if(local){const data=foundry.utils.deepClone(local);data.system.level=required/2;data.system.components.divineFocus=0;data.flags[MODULE_ID].bonusSpell=true;await actor.createEmbeddedDocuments("Item",[data]);continue;}
    let doc;
    for(const collection of ["zzzzz_3r_chn.spells","D35E.spells"]) {
      const pack=game.packs.get(collection);if(!pack)continue;
      const index=await pack.getIndex();
      const entry=index.find(i=>[english,chinese].includes(i.name) || i.name.includes(english));
      if(entry){doc=await pack.getDocument(entry._id);break;}
    }
    if(!doc){unresolved.push(chinese);continue;}
    const data=doc.toObject();for(const field of ["_id","folder","ownership","_stats"])delete data[field];
    data.name=chinese;
    data.system.level=required/2;data.system.spellbook="primary";data.system.components.divineFocus=0;
    data.flags??={};data.flags[MODULE_ID]={key:`oracle-bonus-${required}`,source,category:"spell",bonusSpell:true,grantedBy:"双重诅咒/战斗秘示域"};
    await actor.createEmbeddedDocuments("Item",[data]);
  }
  if(JSON.stringify(actor.getFlag(MODULE_ID,"missingBonusSpells"))!==JSON.stringify(unresolved))await actor.setFlag(MODULE_ID,"missingBonusSpells",unresolved);
}

export function weaponKind(item) {
  if(!item)return "";
  if(key(item)==="sleeve-blade")return "dagger";
  return String(item.system.baseWeaponType||key(item)||item.name).trim().toLowerCase();
}
export async function chooseFinesseWeapons(actor) {
  const level=Number(actor.items.find(i=>key(i)==="unchained-rogue")?.system.levels)||0;
  const count=level>=19?3:level>=11?2:level>=3?1:0;
  const selected=actor.getFlag(MODULE_ID,"finesseWeapons")??[];
  if(selected.length>=count)throw new Error(count?"当前等级的巧技武器选择已完成，不能重选。":"巧技伤害武器选择3级开放。");
  const weapons=actor.items.filter(i=>i.type==="weapon"&&(i.system.weaponSubtype==="light"||i.system.properties.fin||/rapier|whip|spiked.?chain|细剑|长鞭|刺链/i.test(i.name)));
  const kinds=new Map(weapons.map(i=>[weaponKind(i),i.name]));
  const value=await choose("巧技训练：固定选择武器种类（同类所有武器均适用）",[...kinds].filter(([kind])=>!selected.includes(kind)));
  if(value)await actor.setFlag(MODULE_ID,"finesseWeapons",[...selected,value]);
}
export async function chooseShadowStance(actor) {
  const uuid=await choose("影之刃：关联已掌握的影手派步法增益",actor.items.filter(i=>i.type==="buff").map(i=>[i.uuid,i.name]));
  if(!uuid)return;
  if(!await Dialog.confirm({title:"确认步法来源",content:"<p>确认这是你实际掌握的影手派步法。此关联不授予新步法；步法增益激活时才启用影之刃。</p>"}))return;
  await actor.setFlag(MODULE_ID,"shadowStance",uuid);
  await actor.refresh();
}

export async function legalisticConversation(actor) {
  if(curseLevel(actor,"legalistic")<5)throw new Error("成长中的守律诅咒达到5级后才有此能力。");
  const skill=await choose("一对一谈话：选择本次检定",[["dip","交涉"],["int","威吓"],["sen","察言观色"]]);
  if(!skill)return;
  const effect=await replaceTimedBuff(actor,timedBuff("守律：一对一交谈","legalistic-conversation",null,[["3","skill",`skill.${skill}`,"competence"]]));
  try{return await actor.rollSkill(skill);}finally{await effect.delete();}
}

export async function trackMentalEffect(actor) {
  if(curseLevel(actor,"legalistic")<10)throw new Error("成长中的守律诅咒达到10级后才可每分钟重新豁免。");
  const effects=[...actor.items.filter(i=>i.type==="buff"&&i.system.active),...actor.effects.filter(i=>!i.disabled)];
  const uuid=await choose("守律：确认一个影响心灵效果",effects.map(i=>[i.uuid,i.name]));
  if(!uuid)return;
  const save=await choose("原效果的豁免类型",[["will","意志"],["fort","强韧"],["ref","反射"]]);
  const dc=Number(await Dialog.prompt({title:"原效果豁免难度",content:'<input type="number" min="1" name="dc" value="15">',label:"开始每分钟重作豁免",rejectClose:false,callback:h=>(h[0]??h).querySelector("input").value}));
  if(!dc||!save)return;
  await actor.setFlag(MODULE_ID,"mentalSaves",[...(actor.getFlag(MODULE_ID,"mentalSaves")??[]).filter(e=>e.uuid!==uuid),{uuid,save,dc,nextAt:game.time.worldTime+60}]);
}
