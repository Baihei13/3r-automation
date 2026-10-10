import { MODULE_ID } from "./catalog.js";
import { stanceEffect,sceneToken,feetScale,feetDistance } from "./martial-context.js";
import { DetectionModeBlindSensePF } from "../../../systems/D35E/module/canvas/detection-modes.js";
import { assertConditionAction,commitConditionAction } from "./condition-runtime.js";
import { recordAction } from "./rules-bridge.js";

const ID="threeRScent",active=actor=>Boolean(stanceEffect(actor,"hunter-s-sense"));
const presence=new Map();let frame=null;
const scentless=actor=>actor?.system.attributes?.conditions?.incorporeal||actor?.system.traits?.incorporeal
  ||actor?.items.some(i=>i.type==="buff"&&i.system.active&&i.flags?.[MODULE_ID]?.martialEffect?.plan?.condition==="incorporeal");
class ScentDetection extends DetectionModeBlindSensePF {
  static ID=ID;
  static LABEL="灵敏嗅觉（5尺定位，仍有隐蔽）";
  _canDetect(source,target) {
    return active(source.object?.actor)&&Boolean(target.actor)&&!scentless(target.actor)
      &&source.object?.document.level===target.document?.level;
  }
}
async function syncToken(token) {
  if(game.users.activeGM!==game.user||!token.actor||!token.parent.tokens.has(token.id))return;
  const modes=token.detectionModes,enabled=active(token.actor),range=5*(feetScale(token.parent)??0);
  if(Array.isArray(modes)) {
    const present=modes.find(m=>m.id===ID);
    if(enabled&&range>0&&present?.enabled&&present.range===range||!enabled&&!present)return;
    await token.update({detectionModes:[...modes.filter(m=>m.id!==ID),...(enabled&&range>0?[{id:ID,enabled:true,range}]:[])]});
  }else {
    if(enabled&&range>0){if(modes?.[ID]?.enabled&&modes[ID].range===range)return;await token.update({[`detectionModes.${ID}`]:{enabled:true,range}});}
    else if(modes?.[ID])await token.update({[`detectionModes.-=${ID}`]:null});
  }
}
export async function syncScentTokens(actor) {
  for(const token of canvas.scene?.tokens??[])if(token.actor?.uuid===actor.uuid)await syncToken(token);
}
export async function useScent(actor,user=game.user) {
  if(!active(actor))throw new Error("请先进入狩猎嗅觉架势。");
  const source=sceneToken(actor);if(!source||!feetScale())throw new Error("嗅闻需要场景中的角色和尺／米单位。");
  assertConditionAction(actor,null,{kind:"move",user});
  const directions=new Set(),names=["东","东南","南","西南","西","西北","北","东北"];
  for(const token of canvas.tokens.placeables) {
    if(!token.actor||token.id===source.id||token.document.level!==source.document.level||scentless(token.actor))continue;
    if(feetDistance(source.center,token.center)>30||source.checkCollision(token.center,{type:"move",mode:"any"}))continue;
    const angle=Math.atan2(token.center.y-source.center.y,token.center.x-source.center.x);
    directions.add(names[(Math.round(angle/(Math.PI/4))+8)%8]);
  }
  await commitConditionAction(actor,"move",{user});await recordAction(actor,"move");
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),whisper:[...new Set([user.id,game.user.id])],content:`<p>嗅闻：${directions.size?`气味来自${[...directions].join("、")}。`:"30尺内没有发现可识别的生物气味。"}</p><p>目前按无风、普通气味计算；风向、浓烈／掩盖气味和气密隔断尚无可靠场景数据，未自动处理。5尺内定位仍保留隐形和隐蔽失手几率。</p>`});
  return {state:"performed",kind:"move"};
}
export function installMartialScent() {
  CONFIG.Canvas.detectionModes[ID]=new ScentDetection({id:ID,label:ScentDetection.LABEL,type:foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER});
  const report=error=>console.error(MODULE_ID,"灵敏嗅觉感官同步",error);
  const refreshPresence=()=>{
    if(frame!==null)return;
    frame=requestAnimationFrame(()=>{
      frame=null;if(!feetScale())return;
      for(const source of canvas.tokens?.controlled??[]) {
        if(!source.actor?.isOwner||!active(source.actor))continue;
        const found=(canvas.tokens?.placeables??[]).some(t=>t.id!==source.id&&t.actor&&!scentless(t.actor)&&t.document.level===source.document.level
          &&feetDistance(source.center,t.center)<=30&&!source.checkCollision(t.center,{type:"move",mode:"any"}));
        if(found!==presence.get(source.document.uuid)){presence.set(source.document.uuid,found);ui.notifications.info(found?"狩猎嗅觉：30尺内有生物的普通气味；嗅闻方向需要移动动作。":"狩猎嗅觉：30尺内未发现生物的普通气味。");}
      }
    });
  };
  for(const hook of ["moveToken","controlToken","createToken","deleteToken","canvasReady"])Hooks.on(hook,refreshPresence);
  Hooks.on("canvasTearDown",()=>{presence.clear();if(frame!==null)cancelAnimationFrame(frame);frame=null;});
  Hooks.on("canvasReady",()=>{for(const token of canvas.scene.tokens)if(active(token.actor)||token.detectionModes?.[ID])syncToken(token).catch(report);});
  Hooks.on("createToken",token=>{if(active(token.actor))syncToken(token).catch(report);});
  // Only changes to this stance trigger a Token update; moving, rendering or
  // calculating an attack does not write an Actor or scan the world.
  for(const hook of ["createItem","updateItem","deleteItem"])Hooks.on(hook,(item,change)=>{if(item.actor&&item.flags?.[MODULE_ID]?.martialEffect?.definition==="hunter-s-sense"){
    if(hook!=="updateItem"||foundry.utils.hasProperty(change,"system.active"))for(const token of canvas.tokens?.placeables??[])if(token.actor?.uuid===item.actor.uuid)presence.delete(token.document.uuid);
    syncScentTokens(item.actor).catch(report);refreshPresence();
  }});
  for(const token of canvas.scene?.tokens??[])if(active(token.actor)||token.detectionModes?.[ID])syncToken(token).catch(report);
}
