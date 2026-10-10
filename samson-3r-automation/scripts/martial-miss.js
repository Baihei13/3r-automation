import { MODULE_ID } from "./catalog.js";
import { effectIsActive } from "./effect-state.js";

const percent=value=>Math.min(100,Math.max(0,Number(value)||0));
// This is an attacker's penalty, not concealment granted to its defenders.
export function martialAttackMissChance(actor,item=null) {
  if(item&&!["mwak","rwak","msak","rsak"].includes(item.system?.actionType))return 0;
  let chance=0;
  for(const effect of actor?.items??[])if(effect.type==="buff"&&effectIsActive(effect))
    chance=Math.max(chance,percent(effect.flags?.[MODULE_ID]?.martialEffect?.missChance));
  return chance;
}
export function martialMissChanceForRoll(attack,actor) {
  // Snapshot at attack time survives effect expiration before damage is applied.
  return Object.hasOwn(attack??{},"martialMissChance")?percent(attack.martialMissChance):martialAttackMissChance(actor);
}
export function applyMartialMissChance(values,chance) {
  if(!chance||values.finalAc.noCheck)return;
  values.forceConcealRoll=true;
  values.finalAc.concealOverride=Math.max(chance,Number(values.finalAc.concealOverride)||0,
    values.finalAc.fullConceal?50:values.finalAc.conceal?20:0);
}
export function nativeAttackActor(message,{tokenId=null,actorId=null}={}) {
  const data=message?.flags?.D35E?.chatTemplateData;
  const token=tokenId??data?.tokenId;
  if(token) {
    const parts=String(token).split(".");
    if(parts.length===2)return game.scenes.get(parts[0])?.tokens.get(parts[1])?.actor??null;
    if(parts.length===4&&parts[0]==="Scene"&&parts[2]==="Token")return game.scenes.get(parts[1])?.tokens.get(parts[3])?.actor??null;
    // Older native cards sometimes carry only the current scene Token ID.
    return canvas.tokens?.get(token)?.actor??null;
  }
  const speaker=message?.speaker;
  if(speaker?.scene&&speaker?.token)return game.scenes.get(speaker.scene)?.tokens.get(speaker.token)?.actor??null;
  return game.actors.get(actorId??speaker?.actor??data?.actor?.id)??null;
}

export function installMartialMissPresentation() {
  Hooks.on("renderChatMessageHTML",(message,html)=>{
    if(message.flags?.D35E?.template==="systems/D35E/templates/chat/damage-description.html") {
      showNativeMissResult(message,html);return;
    }
    if(message.flags?.D35E?.template!=="systems/D35E/templates/chat/attack-roll.html")return;
    const root=html?.nodeType===1?html:html?.[0];if(!root)return;
    const attacks=message.flags.D35E.chatTemplateData?.attacks??[];
    for(const [index,row] of [...root.querySelectorAll(".chat-attack")].entries()) {
      row.querySelector(".three-r-attack-miss-chance")?.remove();
      const chance=percent(attacks[index]?.attack?.martialMissChance);
      if(!chance)continue;
      const note=document.createElement("p");note.className="three-r-attack-miss-chance";
      note.textContent=`攻击失手率：${chance}%（应用伤害时检定）`;
      (row.querySelector(".toggle-header")??row).append(note);
    }
  });
}

function showNativeMissResult(message,html) {
  const root=html?.nodeType===1?html:html?.[0];if(!root)return;
  root.querySelector(".three-r-miss-result")?.remove();
  const data=message.flags.D35E.chatTemplateData;
  // Read the actual native result, never infer a new roll from its probability.
  if(!data?.concealRolled||!Number.isFinite(data.concealRoll)||!Number.isFinite(data.concealTarget)
    ||typeof data.concealMiss!=="boolean"||typeof data.hit!=="boolean")return;
  const whisper=message.whisper??[];
  if(message.isContentVisible===false||whisper.length&&!whisper.includes(game.user.id)&&!(message.isAuthor&&!message.blind))return;
  // Respect the native setting that hides an unowned target's damage details.
  const speaker=message.speaker,actor=speaker?.actor?game.actors.get(speaker.actor):canvas.tokens?.get(speaker?.token)?.actor;
  if(!game.user.isGM&&actor&&!actor.testUserPermission(game.user,"LIMITED")&&game.settings.get("D35E","playersNoDamageDetails"))return;
  const header=root.querySelector(".D35E.chat-card .card-content > .toggle-box > .toggle-header");if(!header)return;
  const summary=document.createElement("div");summary.className="three-r-miss-result";
  const values=document.createElement("p");values.textContent=`失手检定：1d100＝${data.concealRoll}；失手率${data.concealTarget}%`;
  const outcome=document.createElement("p"),label=document.createElement("strong");
  label.textContent=data.concealMiss?(data.hit?"失手检定未通过；最终判为命中":"失手，本次未命中")
    :(data.hit?"未失手，本次命中":"未失手，攻击仍未命中");
  outcome.append(label);summary.append(values,outcome);header.append(summary);
}
