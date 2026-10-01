import { MODULE_ID } from "./catalog.js";
import { choose, timedBuff, replaceTimedBuff, within, recordAction } from "./rules-bridge.js";
const throws=new Map();
export function captureTanglefootAttack(attack) {
  const context=throws.get(attack.item?.uuid);
  if(context)context.attack=attack.attack;
}
export async function throwTanglefoot(item) {
  const actor=item.actor,targets=[...game.user.targets];
  if(Number(item.system.quantity)<1)throw new Error("绊足包已用完。");
  if(targets.length!==1||!targets[0].actor)throw new Error("请指定一个绊足包目标。");
  const target=targets[0].actor;
  if(!target.isOwner)throw new Error("请由GM投向该目标，以便结算纠缠及反射豁免。");
  if(!within(actor,target,50))throw new Error("绊足包投掷最大范围为5个10尺射程单位。");
  if(!await Dialog.confirm({title:"绊足包：确认使用环境",content:"<p>水下无效；超大型及以上生物不受影响。确认这次可以投掷？</p>"}))return;
  if(["huge","grg","col"].includes(target.system.traits.size))throw new Error("目标过大，绊足包不起作用。");
  const increment=Array.from({length:5},(_,i)=>i+1).find(n=>within(actor,target,n*10));
  const data={_id:foundry.utils.randomID(),name:"绊足包：远程接触攻击",type:"attack",img:item.img,
    system:{actionType:"rwak",attackType:"weapon",proficient:true,activation:{type:"standard",cost:1},range:{units:"ft",value:10},attackBonus:String(-2*(increment-1)),
      ability:{attack:"dex",damage:"",vsTouchAc:true,critRange:"20",critMult:2},description:{value:item.system.description.value}},flags:{[MODULE_ID]:{key:"tanglefoot-throw"}}};
  const attack=new CONFIG.Item.documentClass(data,{parent:actor});
  const context={};throws.set(attack.uuid,context);
  const ac=Number(target.system.attributes.ac.touch.total);
  try {
    const result=await attack.uses.useAttack({temporaryItem:true},actor);
    if(!result?.wasRolled)return;
    if(result.roll)await result.roll;
    await item.update({"system.quantity":Number(item.system.quantity)-1});
    const rolled=context.attack;
    if(!rolled||rolled.isFumble||(!rolled.isNatural20&&rolled.total<ac))return;
    if(!await Dialog.confirm({title:"确认绊足包命中",content:"<p>攻击达到接触AC。确认隐蔽、掩体等没有令这次攻击失手，且目标仍是刚才指定的生物。</p>"}))return;
    const duration=await new Roll("2d4").evaluate();
    await duration.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:"绊足包：纠缠持续轮数"});
    const save=await target.rollSavingThrow("ref",null,15);
    if(save?.total==null)throw new Error("尚未结算反射豁免，请用聊天卡按实际结果补记纠缠。");
    const die=save.dice.find(d=>d.faces===20)?.total;
    const stuck=die===1||(die!==20&&save.total<15);
    const flying=await choose("目标当前是否依靠翅膀飞行？",[["ground","在地面"],["wings","依靠翅膀飞行"],["other-flight","其他方式飞行"]]);
    if(!flying)throw new Error("请补记目标的飞行状态，绊足包已投出。");
    const existing=target.items.filter(i=>i.getFlag(MODULE_ID,"key")==="tanglefoot-entangled"&&i.system.active);
    const previous=existing.length?existing.every(i=>i.getFlag(MODULE_ID,"previousEntangled")):Boolean(target.system.attributes.conditions.entangled);
    const effectData=timedBuff("绊足包：纠缠","tanglefoot-entangled",duration.total*6,
      [],{sourceActor:actor.uuid,sourceItemUuid:item.uuid,glueHp:15,stuck:stuck&&flying!=="other-flight",flying,previousEntangled:previous});
    effectData.img=item.img;
    effectData.system.description.value=item.system.description.value;
    const effect=await replaceTimedBuff(target,effectData);
    await syncTanglefootSpeed(target);
    await target.update({"system.attributes.conditions.entangled":true});
    if(!target.items.some(i=>i.getFlag(MODULE_ID,"key")==="tanglefoot-escape"))await target.createEmbeddedDocuments("Item",[{name:"绊足包：挣脱／清除黏胶",type:"feat",img:"icons/svg/net.svg",system:{featType:"misc",source:"",activation:{type:"standard",cost:1},description:{value:"<p>DC17力量挣脱，或累计15点挥砍伤害清除黏胶。挥砍黏胶自动命中；须按实际挥砍伤害填写。纠缠施法需要DC15专注。</p>"}},flags:{[MODULE_ID]:{key:"tanglefoot-escape",requiresBuff:"tanglefoot-entangled"}}}]);
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:target}),content:`<p>${target.name}纠缠${duration.total}轮：攻击−2、敏捷−4、速度减半；${stuck&&flying!=="other-flight"?(flying==="wings"?"翼飞行失败，须由GM结算坠落。":"粘在地面，不能移动。"):"反射成功或不受粘附，仍受纠缠。"}施法需DC15专注。</p>`,flags:{[MODULE_ID]:{tanglefootEffect:effect.uuid}}});
  }finally{throws.delete(attack.uuid);}
}
export async function clearTanglefoot(actor,effect) {
  if(effect.system.active&&actor.items.has(effect.id))await effect.update({"system.active":false});
  const other=actor.items.some(i=>i.id!==effect.id&&i.getFlag(MODULE_ID,"key")==="tanglefoot-entangled"&&i.system.active);
  if(!other&&!effect.getFlag(MODULE_ID,"previousEntangled"))await actor.update({"system.attributes.conditions.entangled":false});
  await syncTanglefootSpeed(actor);
}
export async function syncTanglefootSpeed(actor) {
  const active=actor.items.filter(i=>i.getFlag(MODULE_ID,"key")==="tanglefoot-entangled"&&i.system.active);
  for(const item of active) {
    const rows=[];
    if(JSON.stringify(item.system.changes)!==JSON.stringify(rows))await item.update({"system.changes":rows});
  }
}
export async function escapeTanglefoot(actor) {
  const effect=actor.items.find(i=>i.getFlag(MODULE_ID,"key")==="tanglefoot-entangled"&&i.system.active);
  if(!effect)throw new Error("没有正在生效的绊足包。");
  const method=await choose("清除黏胶",[["strength","DC17力量挣脱"],["slashing","记录对黏胶造成的挥砍伤害"]]);
  if(method==="strength") {
    const roll=await actor.rollAbilityTest("str");if(roll?.total==null)return;
    await recordAction(actor,"standard");
    if(roll.total>=17)await clearTanglefoot(actor,effect);
  }else if(method==="slashing") {
    const input=await Dialog.prompt({title:"实际挥砍伤害（不扣角色HP）",content:'<input type="number" min="0" name="amount">',label:"记录",rejectClose:false,callback:h=>(h[0]??h).querySelector("input").value});
    if(input==null||input==="")return;
    const amount=Number(input);if(!Number.isFinite(amount)||amount<0)throw new Error("伤害必须为非负数。");
    const remaining=Math.max(0,Number(effect.getFlag(MODULE_ID,"glueHp"))-amount);
    await effect.setFlag(MODULE_ID,"glueHp",remaining);
    if(!remaining)await clearTanglefoot(actor,effect);
  }
}
