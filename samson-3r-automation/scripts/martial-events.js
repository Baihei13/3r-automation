import { MODULE_ID } from "./catalog.js";
import { martial,check,getState } from "./martial-state.js";
import { PLANS } from "./martial-plans.js";
import { Roll35e } from "../../../systems/D35E/module/roll.js";

const events=new Map(),esc=v=>foundry.utils.escapeHTML(String(v??""));
export const saveKind=value=>/^fort/.test(value)?"fort":/^ref/.test(value)?"ref":/^will/.test(value)?"will":null;
export function registerMartialEvent(source) {
  for(const [id,row] of events)if(Date.now()-row.created>120000)events.delete(id);
  const id=foundry.utils.randomID();events.set(id,{...source,created:Date.now()});
  while(events.size>128)events.delete(events.keys().next().value);
  return id;
}
export const martialEventSource=key=>events.get(key);
export const closeMartialEvent=key=>events.delete(key);
const remoteWaiting=new Map();
const choiceWaiting=new Map();
async function ownerCounterChoice(actor,items,source) {
  const owner=game.users.find(u=>u.active&&!u.isGM&&actor.testUserPermission(u,"OWNER"));
  if(!owner)return null;
  const id=foundry.utils.randomID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{choiceWaiting.delete(id);reject(new Error("玩家应对选择超时，原检定尚未掷出。"));},90000);
    choiceWaiting.set(id,{resolve,reject,timer,user:owner.id,actor:actor.uuid,items:items.map(i=>i.id)});
    ChatMessage.create({content:"<p>即将进行原生检定，请选择是否发动应对。</p>",whisper:[owner.id],flags:{[MODULE_ID]:{nativeCounterChoice:{id,user:owner.id,actor:actor.uuid,items:items.map(i=>i.id),kind:source.kind}}}})
      .catch(error=>{clearTimeout(timer);choiceWaiting.delete(id);reject(error);});
  });
}
export async function requestMartialReaction(source) {
  if(game.users.activeGM===game.user) {
    const target=await fromUuid(source.target),key=registerMartialEvent(source);
    try{await chooseMartialReaction(target,key,p=>source.kind==="save"?p.saveBonus||p.replaces===source.save:p.replaces==="ac"||source.kind==="charge"&&p.opposedAbility);return {...martialEventSource(key)};}
    finally{closeMartialEvent(key);}
  }
  if(!game.users.activeGM)return {};
  const id=foundry.utils.randomID();
  return new Promise((resolve,reject)=>{
    // Do not fall through to a roll after a timeout: the GM could still be
    // resolving a counter. The original attack/save remains unrolled.
    const timer=setTimeout(()=>{remoteWaiting.delete(id);reject(new Error("应对等待主GM超时，原检定未掷出；请先确认GM端应对结束。"));},120000);
    remoteWaiting.set(id,{resolve,reject,timer});
    ChatMessage.create({content:"<p>原生检定等待武术应对。</p>",whisper:[game.users.activeGM.id],flags:{[MODULE_ID]:{nativeReactionRequest:{id,...source}}}})
      .catch(error=>{clearTimeout(timer);remoteWaiting.delete(id);reject(error);});
  });
}
export function installMartialReactionBridge() {
  const handled=new Set();
  Hooks.on("createChatMessage",async message=>{
    const author=message.author??message.user,reply=message.flags?.[MODULE_ID]?.nativeReactionReply;
    const choice=message.flags?.[MODULE_ID]?.nativeCounterChoice,selection=message.flags?.[MODULE_ID]?.nativeCounterSelection;
    if(choice&&choice.user===game.user.id&&author?.id===game.users.activeGM?.id) {
      try {
        const actor=await fromUuid(choice.actor);if(!actor?.isOwner)return;
        const items=choice.items.map(id=>actor.items.get(id)).filter(i=>martial(i)?.kind==="counter");
        const item=await foundry.applications.api.DialogV2.wait({window:{title:`${actor.name}：应对`},rejectClose:false,
          content:`<p>即将进行${choice.kind==="save"?"豁免":"敌方攻击"}。请选择应对技，或继续原检定。</p>`,
          buttons:[{action:"normal",label:"继续原检定",callback:()=>null},...items.map(i=>({action:i.id,label:i.name,callback:()=>i.id}))]});
        let ability;
        if(item&&PLANS[martial(actor.items.get(item))?.definition]?.opposedAbility)ability=await foundry.applications.api.DialogV2.wait({window:{title:"反制冲锋：对抗属性"},rejectClose:false,
          content:"<p>用力量还是敏捷进行同属性对抗？体型与已登记加值自动读取。</p>",buttons:[{action:"dex",label:"敏捷",callback:()=>"dex"},{action:"str",label:"力量",callback:()=>"str"}]});
        await ChatMessage.create({content:"<p>已提交应对选择。</p>",whisper:[author.id],flags:{[MODULE_ID]:{nativeCounterSelection:{id:choice.id,item:ability===null?null:item,ability}}}});
      }catch(error){console.error(MODULE_ID,"玩家应对选择",error);ui.notifications.error(error.message);}return;
    }
    if(selection&&game.users.activeGM===game.user) {
      const waiting=choiceWaiting.get(selection.id);if(!waiting||author?.id!==waiting.user)return;
      if(selection.item&&!waiting.items.includes(selection.item))return;
      const actor=await fromUuid(waiting.actor);if(!actor?.testUserPermission(author,"OWNER"))return;
      clearTimeout(waiting.timer);choiceWaiting.delete(selection.id);waiting.resolve(selection);return;
    }
    if(reply&&author?.id===game.users.activeGM?.id&&reply.user===game.user.id) {
      const waiting=remoteWaiting.get(reply.id);if(!waiting)return;
      clearTimeout(waiting.timer);remoteWaiting.delete(reply.id);
      if(reply.error)waiting.reject(new Error(reply.error));else{const result={...reply.result};if(result.roll)result.roll=Roll35e.fromData(result.roll);waiting.resolve(result);}return;
    }
    const request=message.flags?.[MODULE_ID]?.nativeReactionRequest;
    if(game.users.activeGM!==game.user||!request||handled.has(message.id))return;
    handled.add(message.id);while(handled.size>128)handled.delete(handled.values().next().value);
    try {
      const target=await fromUuid(request.target);if(!target?.items)throw new Error("应对目标已不存在。");
      let source;
      if(request.kind==="save") {
        const origin=game.messages.get(request.sourceMessage),data=origin?.flags?.D35E?.chatTemplateData;
        const native=origin?.flags?.[MODULE_ID]?.nativeMartial,dc=Number(native?.dc??data?.dc?.dc),kind=native?.save??saveKind(data?.dc?.type);
        if(!target.testUserPermission(author,"OWNER")||!origin||!(dc>0)||kind!==request.save)throw new Error("无法核实这次豁免的原生来源或权限。");
        source={kind:"save",target:target.uuid,sourceMessage:origin.id,dc,save:kind,label:"即将进行豁免"};
      }else {
        const attacker=await fromUuid(request.attacker),weapon=await fromUuid(request.weapon);
        if(!["attack","charge"].includes(request.kind)||!attacker?.testUserPermission(author,"OWNER")||weapon?.actor?.uuid!==attacker.uuid||!weapon.hasAttack)throw new Error("无法核实原生攻击来源或权限。");
        source={kind:request.kind,target:target.uuid,attacker:attacker.uuid,weapon:weapon.uuid,rolled:false,label:`${attacker.name}即将${request.kind==="charge"?"冲锋":"攻击"}`};
      }
      const result=await requestMartialReaction(source);
      const safe={ac:result.ac,blocked:result.blocked,unresolved:result.unresolved,chargeBonus:result.chargeBonus,skillSave:result.skillSave,roll:result.roll?.toJSON?.()};
      await ChatMessage.create({content:"<p>武术应对已完成。</p>",whisper:[author.id,game.user.id],flags:{[MODULE_ID]:{nativeReactionReply:{id:request.id,user:author.id,result:safe}}}});
    }catch(error){await ChatMessage.create({content:"<p>武术应对未完成，原检定尚未掷出。</p>",whisper:[author.id,game.user.id],flags:{[MODULE_ID]:{nativeReactionReply:{id:request.id,user:author.id,error:error.message}}}});}
  });
}
export async function chooseMartialReaction(actor,eventKey,kinds) {
  if(game.users.activeGM!==game.user)return null;
  const s=getState(actor,{readOnly:true}),source=events.get(eventKey);
  const freeCounter=PLANS[martial(s.activeStance)?.definition]?.freeCounter&&!s.saved.freeCounterUsed;
  const items=s.moves.filter(item=>{const m=martial(item),p=PLANS[m.definition];return m.kind==="counter"&&p&&kinds(p)&&check(actor,item,{freeCounter},s).available;});
  if(!items.length)return null;
  if(game.users.some(u=>u.active&&!u.isGM&&actor.testUserPermission(u,"OWNER"))) {
    const selected=await ownerCounterChoice(actor,items,source);
    if(!selected?.item)return null;
    return game.modules.get(MODULE_ID).api.martial.command({actorUuid:actor.uuid,itemId:selected.item,op:"initiate",context:{eventKey,opposedAbility:selected.ability}});
  }
  const answer=await foundry.applications.api.DialogV2.wait({window:{title:`${actor.name}：应对`},rejectClose:false,
    content:`<p>${esc(source.label??"即将进行检定")}。选择应对技，或继续原检定。</p>`,
    buttons:[{action:"normal",label:"继续原检定",callback:()=>null},...items.map(item=>({action:item.id,label:item.name,callback:()=>item.id}))]});
  if(!answer)return null;
  return game.modules.get(MODULE_ID).api.martial.command({actorUuid:actor.uuid,itemId:answer,op:"initiate",context:{eventKey}});
}
export async function resolveMartialContext(actor,item,request) {
  // Values affecting enemy checks never come from player form fields.
  const context={...request};delete context.dc;delete context.eventDC;delete context.saveKind;delete context.antimagic;delete context.grounded;
  const p=PLANS[martial(item).definition];
  if(p.mode!=="counter") {
    if(p.living)for(const uuid of context.targets??[]) {
      const target=await fromUuid(uuid);
      if(["undead","construct"].includes(target?.system.attributes?.creatureType))throw new Error("这招只对活物生效，所选目标为不死生物或构装生物，尚未消耗。");
    }
    return context;
  }
  const pending=events.get(context.eventKey);
  if(pending) {
    if(pending.target!==actor.uuid)throw new Error("这次敌方事件并非针对该角色。");
    if(p.replaces&&p.replaces!=="ac"&&pending.save!==p.replaces)throw new Error("这招不能替代本次豁免。");
    if(p.saveBonus&&!pending.save)throw new Error("该应对技需要一次正在进行的豁免。");
    if(p.opposedAbility&&pending.kind!=="charge")throw new Error("反制冲锋需要敌方冲锋的攻击前事件。");
    if((p.defense||p.opposedAttack)&&(pending.kind!=="attack"||!Number.isFinite(pending.attack?.total)))throw new Error("这招需要一次已掷出、尚未应用的敌方攻击。");
    if((p.replaces==="ac"||p.opposedAbility)&&pending.rolled)throw new Error("该应对技必须在敌方攻击掷骰前发动。");
    return context;
  }
  // Native cards keep the actual adjusted DC, save type and attack results.
  const candidates=[...game.messages].reverse().filter(message=>{
    const data=message.flags?.D35E?.chatTemplateData;
    if(!data||message.speaker.actor===actor.id)return false;
    const tokenIds=new Set((data.targets??[]).map(t=>t.id));
    const targeted=actor.isToken?tokenIds.has(actor.token.id):game.scenes.some(scene=>scene.tokens.some(t=>t.actor?.uuid===actor.uuid&&tokenIds.has(t.id)));
    // Fast-forward native cards may omit target metadata. They remain a
    // possible source only through the GM's explicit association dialog.
    return (targeted||!tokenIds.size)&&(p.saveBonus||["fort","ref","will"].includes(p.replaces)?Number(data.dc?.dc)>0&&(!p.replaces||saveKind(data.dc.type)===p.replaces):(data.attacks??[]).some(a=>a.hasAttack));
  }).slice(0,12);
  if(p.opposedAbility||p.replaces==="ac"||p.event) {
    // Before-attack counters cannot be attached to an already rolled card.
    throw new Error("请在敌方原生攻击的应对窗口发动这招；不能用已经掷过的攻击替代攻击前事件。");
  }
  let selected=candidates.find(m=>m.id===context.sourceMessage);
  if(!selected) {
    if(!candidates.length)throw new Error("没有针对该角色的原生攻击/法术来源卡。请从对应豁免或伤害应用入口发动应对，招式尚未消耗。");
    const answer=await foundry.applications.api.DialogV2.wait({window:{title:`DM：关联${item.name}的来源`},rejectClose:false,
      content:`<label>敌方攻击或法术<select name="source">${candidates.map(m=>`<option value="${m.id}">${esc(m.flags.D35E.chatTemplateData.name??m.flags.D35E.chatTemplateData.item?.name??"攻击/法术")}</option>`).join("")}</select></label>`,
      buttons:[{action:"ok",label:"使用此来源",callback:(_e,_b,d)=>d.element.querySelector('[name="source"]').value}]});
    if(!answer)return null;selected=candidates.find(m=>m.id===answer);
  }
  const data=selected.flags.D35E.chatTemplateData;
  const needsSave=Boolean(p.saveBonus||["fort","ref","will"].includes(p.replaces));
  const attacks=(data.attacks??[]).filter(a=>a.hasAttack&&Number.isFinite(a.attack?.total));
  let attack=attacks[0]?.attack;
  if(!needsSave&&attacks.length>1) {
    const answer=await foundry.applications.api.DialogV2.wait({window:{title:`DM：${item.name}应对哪次攻击`},rejectClose:false,
      content:`<label>来源卡中的攻击<select name="attack">${attacks.map((a,i)=>`<option value="${i}">${esc(a.label??`第${i+1}击`)}：${a.attack.total}</option>`).join("")}</select></label>`,
      buttons:[{action:"ok",label:"使用此攻击",callback:(_e,_b,d)=>d.element.querySelector('[name="attack"]').value}]});
    if(answer===null||answer===undefined)return null;attack=attacks[Number(answer)]?.attack;
  }
  context.sourceMessage=selected.id;
  context.eventKey=registerMartialEvent({target:actor.uuid,kind:needsSave?"save":"attack",save:saveKind(data.dc?.type),dc:Number(data.dc?.dc),attack,sourceActor:selected.speaker.actor,sourceMessage:selected.id,rolled:true,label:data.name});
  return context;
}
