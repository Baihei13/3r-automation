import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";
import { choose } from "./rules-bridge.js";
import { findNativeFamiliarClass } from "./native-familiar.js";
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function familiarBonusApplies(master) {
  const familiar=game.actors.find(actor=>actor.system.master?.id===master.id&&actor.getFlag(MODULE_ID,"familiarSpecies")==="rhamphorhynchus");
  if(!familiar||familiar.system.attributes.conditions.dead||Number(familiar.system.attributes.hp.value)<=0)return 0;
  if(master.getFlag(MODULE_ID,"familiarNearby")===false)return 0;
  const origin=master.getActiveTokens()[0],target=familiar.getActiveTokens()[0];
  if(origin&&target&&canvas?.grid) {
    const distance=typeof canvas.grid.measurePath==="function"?canvas.grid.measurePath([origin.center,target.center]).distance:canvas.grid.measureDistance(origin,target);
    const feet=/^(m|米|公尺|meters?)$/i.test(canvas.scene.grid.units)?distance/0.3:distance;
    return feet<=5280?1:0;
  }
  return 1;
}

// Use D35E's actual Familiar class for progression, saves, AC and master links.
export async function syncCardFamiliar(master) {
  if(game.users.activeGM!==game.user)throw new Error("请由当前主GM建立魔宠联结。");
  const feature=master.items.find(item=>item.getFlag(MODULE_ID,"key")==="rhamphorhynchus-familiar");
  if(!feature)return;
  const existing=game.actors.find(actor=>actor.system.master?.id===master.id&&actor.items.some(item=>item.type==="class"&&item.system.classType==="minion"));
  if(existing) {
    if(!existing.getFlag(MODULE_ID,"familiarSpecies")&&!master.getFlag(MODULE_ID,"currentFamiliarCreated")) {
      // An existing companion is not evidence of its species; preserve it.
      await master.setFlag(MODULE_ID,"familiarLinkPending",existing.uuid);
    }
    return;
  }
  if(master.getFlag(MODULE_ID,"currentFamiliarCreated"))return;
  const native=await findNativeFamiliarClass(),familiarClass=native.toObject();
  for(const field of ["_id","folder","ownership","_stats"])delete familiarClass[field];
  if(familiarClass.system.classType!=="minion"||!familiarClass.system.minionGroup||familiarClass.system.minionGroup==="none")throw new Error("原生魔宠职业缺少随从类别，未建立错误的主人联结。");
  const witch=master.items.find(item=>item.getFlag(MODULE_ID,"key")==="witch");
  if(!witch)return;
  if(![null,undefined,"","none",familiarClass.system.minionGroup].includes(witch.system.minionGroup))throw new Error("女巫已关联其他随从类别，请先确认已有魔宠联结。");
  familiarClass.system.levels=Number(witch.system.levels);
  familiarClass.name="魔宠";
  const description="<p>喙嘴翼龙，超小型动物魔宠。陆地速度10尺，飞行速度40尺（一般）；昏暗视觉、灵敏嗅觉。主人在1英里内时获得＋4先攻。飞行冲锋可进入敌人空间而不因进入空间引发借机攻击，该次啮咬伤害＋2。拥有警觉、精通反射躲闪、共享法术、情感联结；其他魔宠能力随主人等级增长。</p>";
  // D35E registers a base document in CONFIG.Item.documentClass; attack templates belong to Item35E.
  const conditional=game.D35E?.Item35E?.defaultConditional,modifier=game.D35E?.Item35E?.defaultConditionalModifier;
  if(!conditional||!modifier)throw new Error("D35E攻击条件模板不可用，未创建魔宠；请确认系统已完整加载。");
  const swoop=foundry.utils.deepClone(conditional),swoopBonus=foundry.utils.deepClone(modifier);
  swoop.name="迅猛俯冲（飞行冲锋）";swoop.default=false;
  swoopBonus.formula="2";swoopBonus.target="damage";swoopBonus.subTarget="allDamage";swoopBonus.type="";
  swoop.modifiers=[swoopBonus];
  const [animalClass]=[{
    name:"动物",type:"class",system:{classType:"racial",levels:1,hd:8,hp:4,bab:"med",savingThrows:{fort:{value:"high"},ref:{value:"high"},will:{value:"low"}},skillsPerLevel:2,customClassSkills:{},classSkills:{spt:true,lis:true,hid:true}},
    flags:{[MODULE_ID]:{key:"rhamphorhynchus-animal",source:"uw"}}
  }];
  const familiarData={name:"喙嘴翼龙",type:"npc",img:"icons/svg/wing.svg",ownership:foundry.utils.deepClone(master.ownership),
    flags:{[MODULE_ID]:{familiarSpecies:"rhamphorhynchus",familiarMaster:master.uuid}},
    system:{abilities:Object.fromEntries(Object.entries({str:6,dex:17,con:11,int:2,wis:14,cha:11}).map(([key,value])=>[key,{value}])),
      master:{id:master.id,name:master.name,img:master.img,data:master.getRollData(),distance:0},
      attributes:{hp:{value:Math.max(1,Math.floor(Number(master.system.attributes.hp.max)/2)),base:0},creatureType:"animal",speed:{land:{base:10},fly:{base:40,maneuverability:"average"}}},
      traits:{size:"tiny",senses:{lowLight:true,lowLightMultiplier:2}},details:{alignment:master.system.details.alignment,cr:1/3,biography:{value:description}},
      skills:{spt:{points:4},lis:{points:4},hid:{points:0}}},
    items:[animalClass,familiarClass,
      {name:"灵敏嗅觉",type:"feat",system:{featType:"misc",description:{value:"<p>可凭气味侦测附近生物，通常30尺，逆风15尺、顺风60尺；以移动动作辨认方向，在5尺内定位。可追踪气味。</p>"}}},
      {name:"闪电反射",type:"feat",system:{featType:"feat",changes:[["2","savingThrows","ref","untyped"]],description:{value:"<p>反射豁免获得＋2。</p>"}}},
      {name:"啮咬",type:"attack",system:{attackType:"natural",actionType:"mwak",activation:{type:"standard",cost:1},ability:{attack:"str",damage:"str",damageMult:1,critRange:20,critMult:2},proficient:true,damage:{parts:[["sizeRoll(1,3,@sizeDifference,@critMult)","Piercing",""]]},conditionals:[swoop],description:{value:"<p>啮咬造成1d3穿刺伤害，加力量修正。迅猛俯冲时勾选飞行冲锋条件，额外造成2点傷害；冲锋仍照常影响攻击与AC。</p>"}},flags:{[MODULE_ID]:{key:"rhamphorhynchus-bite",source:"uw"}}}]
  };
  if([null,undefined,"","none"].includes(witch.system.minionGroup))await witch.update({"system.minionGroup":familiarClass.system.minionGroup,"system.minionLevelFormula":"@level"});
  const familiar=await Actor.create(familiarData);
  await master.setFlag(MODULE_ID,"currentFamiliarCreated",familiar.uuid);
  await familiar.refresh();
  await master.refresh();
}

export function installCardFamiliar() {
  const refreshMaster=familiar=>{
    if(game.users.activeGM!==game.user||familiar.getFlag(MODULE_ID,"familiarSpecies")!=="rhamphorhynchus")return;
    const master=game.actors.get(familiar.system.master?.id);
    if(master)master.refresh().catch(error=>console.error(MODULE_ID,error));
  };
  Hooks.on("deleteActor",refreshMaster);
  Hooks.on("updateActor",(actor,change)=>{
    const update=foundry.utils.flattenObject(change);
    if(Object.keys(update).some(path=>path.startsWith("system.attributes.hp.")||path==="system.attributes.conditions.dead"||path==="system.master.id"||path===`flags.${MODULE_ID}.familiarSpecies`))refreshMaster(actor);
  });
  Hooks.on("D35E.ItemUse.preUseItem",(item,actor,hook)=>{
    if(hook.customUse||item.getFlag(MODULE_ID,"key")!=="rhamphorhynchus-familiar")return;
    hook.customUse=true;
    hook.threeRCompletion=(async()=>{
      const action=await choose("魔宠联结",[["sheet","打开魔宠"],["near","魔宠在1英里内"],["far","魔宠在1英里外"]]);
      if(!action)return;
      if(!game.actors.some(row=>row.system.master?.id===actor.id))await syncCardFamiliar(actor);
      if(action==="sheet") {
        const pending=actor.getFlag(MODULE_ID,"familiarLinkPending");
        const familiar=pending?await fromUuid(pending):game.actors.find(row=>row.system.master?.id===actor.id&&row.getFlag(MODULE_ID,"familiarSpecies")==="rhamphorhynchus");
        if(!familiar)throw new Error("还没有建立魔宠联结。");
        if(pending&&await Dialog.confirm({title:"魔宠联结",content:`<p>${esc(familiar.name)}是你的喙嘴翼龙魔宠吗？</p>`})) {
          await familiar.setFlag(MODULE_ID,"familiarSpecies","rhamphorhynchus");
          await actor.setFlag(MODULE_ID,"currentFamiliarCreated",familiar.uuid);
          await actor.unsetFlag(MODULE_ID,"familiarLinkPending");await actor.refresh();
        }
        return familiar.sheet.render(true);
      }
      await actor.setFlag(MODULE_ID,"familiarNearby",action==="near");await actor.refresh();
      await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>魔宠在1英里${action==="near"?"内，主人获得＋4先攻加值":"外，主人不再获得魔宠的先攻加值"}。</p>`});
    })();
    hook.threeRCompletion.catch(error=>{console.error(MODULE_ID,error);ui.notifications.error(error.message);});
  });
  Hooks.on("updateToken",(token,change)=>{
    if(game.users.activeGM!==game.user||!Object.keys(change).some(key=>["x","y","elevation"].includes(key)))return;
    const actor=token.actor,master=actor?.system.master?.id?game.actors.get(actor.system.master.id):actor;
    if(master?.items.some(item=>item.getFlag(MODULE_ID,"key")==="rhamphorhynchus-familiar"&&effectIsActive(item)))master.refresh().catch(error=>console.error(MODULE_ID,error));
  });
}
