import { ActorSheetPF } from "../../../systems/D35E/module/actor/sheets/base.js";
import { MODULE_ID } from "./catalog.js";
import { getState,martial,check,acquisitionCheck,currentAcquisition,DISCIPLINES,state as safeState,martialCombat } from "./martial-state.js";
import { MARTIAL_ITEMS } from "./martial-content.js";
import { planFor } from "./martial-plans.js";

const esc=value=>foundry.utils.escapeHTML(String(value??""));
const titles={strike:"攻击技",boost:"强化技",counter:"应对技",utility:"其他武技",stance:"架势"};
const actions={standard:"标准",move:"移动",swift:"迅捷",immediate:"反应",full:"整轮",free:"自由"};
const remembered=new WeakMap();
const preparationDrafts=new WeakMap();
const collapsedLevels=new WeakMap();
const readyKey=ids=>[...ids].sort().join(",");
function preparationSelection(actor,s) {
  let draft=preparationDrafts.get(actor);
  if(draft&&(s.encounter||draft.profile!==s.id||draft.baseline!==readyKey(s.profile.readied))) {
    preparationDrafts.delete(actor);draft=null;
  }
  return new Set((draft?.ids??s.profile.readied).filter(id=>s.moves.some(item=>item.id===id)));
}
const button=(action,label,id="",reason="")=>`<button type="button" data-martial-action="${action}" data-id="${esc(id)}" ${reason?`disabled title="${esc(reason)}"`:""}>${label}</button>`;
function resolutionHint(item) {
  const p=planFor(item);
  if(!p)return "尚未登记结算参数；请由DM按全文处理";
  const repaired={
    "stance-of-clarity":"每次行动选择一个目标，原生防御结算读取对该目标的洞察AC＋2及对其他攻击者的AC−2。",
    "step-of-the-wind":"读取Foundry原生困难地形区域，忽略其有限移动倍率；对其中目标攻击＋2，冲撞／摔绊对抗＋4。第三方地形与单独录入的技能惩罚尚未接入。",
    "stonefoot-stance":"更大体型攻击者的AC＋2、力量对抗＋2；实际路径累计5尺后结束架势。",
    "hunter-s-sense":"5尺内原生感官定位；移动动作嗅闻30尺内普通气味的方向。风向、气味强度／掩盖和气味追踪尚未实现。",
    "blood-in-the-water":"从原生应用伤害时的实际命中和重击结果叠加攻击／武器伤害，不重复计同一击；一分钟未重击清零。",
    "mighty-throw":"原生近战接触攻击，命中后进行双方3.5摔绊对抗；按修正自动选优势属性。主GM点选最多10尺的合法远离落点，目标倒地，不引发借机。特殊触及、坐骑及未登记的摔绊免疫尚需裁定。",
    "charging-minotaur":"校验方格地图冲锋路线、双方力量／体型／已识别专长及稳定性；成功后推移并结算2d6＋力量钝击。主GM选择实际推进距离，非方格及特殊冲锋能力尚未接入。",
    "sudden-leap":"保留跳跃骰，地图点选落点并限制距离；读取同一行动的直线助跑，未助跑时距离减半。翻滚避借机使用原生技能；特殊地形技能修正和垂直跳跃尚未实现。",
    "distracting-ember":"放置5尺触及的场景夹击标记，供原生攻击夹击计算使用；发动者行动末移除。标记没有火元素的生命值／完整生物数据，受攻击等情况尚未实现。"
  };
  repaired["mind-over-body"]=repaired["action-before-thought"]=repaired["moment-of-perfect-mind"]="从正在进行的原生豁免读取种类和DC；操作者选定应对后以专注骰替代，天然1不自动失败。必须有可靠来源，第三方无来源快掷尚未接入。";
  repaired["counter-charge"]="从原生冲锋窗口在攻击前邀请操作者；双方同属性对抗读取实际属性、体型及已接架势，成功阻止攻击，失败敌方额外＋2。成功后可选的两格推离仍需操作者在地图处理。";
  if(repaired[martial(item)?.definition])return repaired[martial(item).definition];
  const names={attack:"原生攻击与伤害结算卡",area:"范围豁免与效果结算卡",boost:"持续强化与后续攻击联动",stance:"架势效果与事件入口",counter:"应对检定；敌方事件由DM处理",movement:"移动检定／落点确认",throw:"对抗初骰与结算卡",opposed:"对抗初骰与结算卡",scene:"记录发动；场景结果由DM处理",initiative:"记录发动；先攻调整由DM处理","extra-action":"记录发动；额外动作由DM处理"};
  return `${names[p.mode]??"由DM按全文处理"}${p.note?`。${p.note}`:""}${p.conflict?`。来源差异：${p.conflict}`:""}`;
}

function contents(actor,section="known") {
  if(section==="ready")section="known";
  const s=getState(actor,{readOnly:true}),p=s.profile,owner=actor.isOwner,gm=game.user.isGM,selected=preparationSelection(actor,s),combat=martialCombat(actor),preparingBlocked=Boolean(s.encounter||combat);
  const pending=Object.values(s.saved.receipts??{}).some(r=>r.status==="initiated"),complete=!s.pending.known&&!s.pending.stances&&p.readied.length===s.quotas.readied;
  const tabs=`<nav class="martial-subnav">${[["known","武技"],["stances","架势"],["growth","职业与成长"]].map(([id,label])=>`<button type="button" data-martial-section="${id}" class="${id===section?"active":""}">${label}</button>`).join("")}</nav>`;
  const head=`<header><strong>贤者之剑 ${s.level}级</strong><span>武道等级 ${s.initiatorLevel} · 最高武技 ${s.maxLevel}级</span><span>武技 ${s.moves.length}/${s.quotas.known} · 准备 ${p.readied.length}/${s.quotas.readied} · 架势 ${s.stances.length}/${s.quotas.stances}</span></header>`;
  if(!s.id)return `<h2>武术</h2><p>先从“Tome of Battle → 职业”拖入贤者之剑。在这里学习武技、准备招式与切换架势。</p><p>已有角色不会自动获得职业或招式。</p>`;
  const list=(items,prepare=false)=>{
    if(!items.length)return "<p>尚未学习。</p>";
    const levels=new Map();
    for(const item of [...items].sort((a,b)=>martial(a).level-martial(b).level||a.name.localeCompare(b.name,"zh"))) {
      const level=martial(item).level;if(!levels.has(level))levels.set(level,[]);levels.get(level).push(item);
    }
    return [...levels].map(([level,groupItems])=>{
    const groupKey=`${prepare?"moves":"stances"}:${level}`;
    const rows=groupItems.map(item=>{
    const m=martial(item),spent=p.expended.includes(item.id),active=s.saved.activeStance===item.id;
    const freeCounter=planFor(s.activeStance)?.freeCounter&&m.kind==="counter"&&m.action==="immediate"&&!s.saved.freeCounterUsed;
    const availability=check(actor,item,{freeCounter},s),reasons=[...availability.reasons];
    if(martialCombat(actor)&&m.kind==="counter"&&s.saved.counterUsed?.includes(item.id))reasons.push("本次行动周期已发动过这个应对技");
    const ready=p.readied.includes(item.id),status=m.kind==="stance"?active?"当前架势":"可切换架势":spent?"已消耗":ready?"已准备":"未准备";
    return `<tr>${prepare?`<td class="martial-prepare-cell"><input type="checkbox" data-ready="yes" value="${item.id}" aria-label="准备${esc(item.name)}" ${selected.has(item.id)?"checked":""} ${!owner||preparingBlocked?"disabled":""}></td>`:""}<td><div class="martial-spell-name"><img src="${esc(item.img)}" width="28" height="28" alt="">${button("details",esc(item.name),item.id)}</div><small>${titles[m.kind]} · ${status}</small>${reasons.length?`<small class="martial-unavailable">${esc(reasons.join("；"))}</small>`:""}<details class="martial-row-info"><summary>效果说明</summary>${esc(resolutionHint(item))}</details></td><td>${esc(m.disciplineName)}</td><td>${actions[m.action]}</td><td>${m.kind==="stance"?active?"持续":"—":ready?spent?"0 / 1":"1 / 1":"—"}</td><td class="martial-use-cell">${owner?button(m.kind==="stance"?"stance":"initiate",m.kind==="stance"?active?"结束":"进入":spent?"已用完":"使用",item.id,reasons.join("；")):""}</td></tr>`;
    }).join("");
    return `<details class="martial-level-group" data-martial-level="${groupKey}" ${collapsedLevels.get(actor)?.has(groupKey)?"":"open"}><summary>${level}级${prepare?"武技":"架势"} · ${groupItems.length}招</summary><div class="martial-list-scroll"><table class="martial-spell-list"><thead><tr>${prepare?"<th>准备</th>":""}<th>招式</th><th>流派</th><th>动作</th><th>剩余</th><th>使用</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    }).join("");
  };
  const setup=`<section class="martial-setup"><p>还可学习${s.pending.known}招武技、${s.pending.stances}种架势。等级和学习条件自动读取角色卡。</p><div class="martial-toolbar">${owner&&s.pending.known?button("learn","学习武技"):""}${owner&&s.pending.stances?button("learn-stance","学习架势"):""}</div></section>`;
  const boundary=`<details class="martial-boundaries"><summary>自动化范围与使用方法</summary><p>已接学习前提、准备与消耗、恢复、架势切换及部分攻击／伤害／豁免／状态结算。先在场景选择目标；武器、应对属性、落点等真实选择仍由操作者决定。命中与重击读取原生结算，不填写敌方AC或DC。</p><p>每招“效果说明”列出已接入和仍未实现的部分。141条是完整规则资料数量，不代表141条都已实现数值效果；特殊地形、完整虚体、部分重定向和高等级场景效果仍有缺口。</p></details>`;
  const preparation=s.moves.length?`<div class="martial-toolbar"><span class="martial-ready-count" aria-live="polite">已勾选 ${selected.size}/${s.quotas.readied} 招${preparationDrafts.has(actor)?" · 尚未保存":""}</span>${owner?button("prepare","准备所选武技","",preparingBlocked?"战斗或遭遇内不能更换准备":selected.size!==s.quotas.readied?`请勾选${s.quotas.readied}招`:""):""}</div><p>${preparingBlocked?"每招用后变为0/1，可整轮冥想恢复一招。":"准备后可直接使用，无需开始遭遇。勾选后点击准备才保存；更换准备需要五分钟冥想与练习。"}</p>`:"";
  let body;
  if(section==="stances")body=`<p>架势持续生效，不占准备名额和使用次数。进入、切换或主动结束用迅捷动作。</p>${list(s.stances)}<div class="martial-toolbar">${owner&&s.pending.stances?button("learn-stance","学习架势"):""}${owner&&martial(s.activeStance)?.definition==="hunter-s-sense"?button("scent","嗅闻方向（移动动作）"):""}${owner&&gm&&s.activeStance&&martial(s.activeStance)?.definition!=="blood-in-the-water"?button("event","处理当前架势事件"):""}</div>`;
  else if(section==="growth")body=`<p>待选武技 ${s.pending.known}；待选架势 ${s.pending.stances}。学习时记录取得等级；升级不会代选。</p><p>贤者之剑流派专攻：${esc(Object.entries(p.choices??{}).filter(([k,v])=>v&&k!=="unarmored").map(([k,v])=>(DISCIPLINES[v]??v)).join("、")||"尚未选择")}</p><div class="martial-toolbar">${owner?button("focus","选择贤者之剑流派专攻")+button("configure","配置武术知识与职业能力")+(s.level>=7?button("sense","感知魔法"):"")+(s.level>=4?button("replace","按升级机会替换武技"):"")+(s.level>=20?button("dual","双重强化：两招同时发动")+(gm?button("reset-dual","DM：休息后恢复每日次数"):""):""):""}</div><details><summary>规则与来源</summary><p>扩展大全2.40 / 战斗卷册；条目全文保存具体源页与哈希。轻甲AC默认按汇编原文，仅穿轻甲；不穿甲是否生效请在专攻配置中由DM选择。</p><p>反射闪避、双重强化及复杂招式的结算边界见条目和覆盖记录。</p></details>`;
  else body=`${s.pending.known||s.pending.stances?setup:""}<div class="martial-toolbar"><span>${s.encounter?"遭遇进行中":preparationDrafts.has(actor)?"准备勾选尚未保存":p.readied.length?"已准备的武技可直接使用":"在下表勾选要准备的武技"}</span>${owner&&p.expended.length?button("recover","冥想恢复一招"):""}${owner&&pending?button("resume","继续未完成使用"):""}</div>${list(s.moves,true)}${preparation}${owner&&gm?`<details class="martial-dm"><summary>DM：恢复与行动管理（可选）</summary><div class="martial-toolbar">${complete||s.encounter?button(s.encounter?"end":"start",s.encounter?"确认结束遭遇并恢复武技":"确认新遭遇并恢复武技"):""}${!combat?button("turn","开始下一次行动")+button("end-turn","结束当前行动")+button("target-turn","当前目标开始行动"):""}</div></details>`:""}`;
  if(section==="growth")body=`<p>职业特性请在“特性 → 职业”展开贤者之剑查看，或打开“职业特性”分类。贤者之剑的流派专攻需要先学会该流派的武技或架势，再自行选择。</p>${body}${owner&&gm?`<details class="martial-dm"><summary>DM：补录历史学习记录</summary><p>只有补录过去等级的选择时需要填写当时等级。普通学习会自动读取当前角色卡，已有取得记录不会重算。</p><div class="martial-toolbar">${button("history-learn","补录武技")}${button("history-stance","补录架势")}${button("history-replace","补录升级替换")}</div></details>`:""}`;
  return head+tabs+`<div class="martial-scroll">${body}${boundary}</div>`;
}

async function ask(title,content,label="确认") {
  return foundry.applications.api.DialogV2.wait({window:{title},rejectClose:false,content:`<form class="martial-learning-form">${content}</form>`,buttons:[{action:"ok",label,callback:(_e,_b,d)=>Object.fromEntries(new FormData(d.element.querySelector("form")))}]});
}
export async function learningDialog(actor,kind="move",replace=false,selected=null,historical=false) {
  const s=getState(actor,{readOnly:true}),current=currentAcquisition(actor);
  let acquired=current,replaceId=null;
  if(historical) {
    if(!game.user.isGM)throw new Error("历史学习记录由DM补录。");
    const record=await ask("DM：补录过去的学习",`<p>仅用于补录过去的升级选择。当前角色卡不能证明过去各职业的升级顺序，请按当时记录填写。</p><label>取得时贤者之剑等级<input name="level" type="number" min="1" max="${s.level}" value="${s.level}" required></label><label>取得时其他职业或种族生命骰<input name="otherLevels" type="number" min="0" max="${current.otherLevels}" value="${current.otherLevels}" required></label>`);
    if(!record)return null;
    const level=Number(record.level),otherLevels=Number(record.otherLevels);
    if(!Number.isInteger(level)||level<1||level>s.level||!Number.isInteger(otherLevels)||otherLevels<0||otherLevels>current.otherLevels)throw new Error("历史取得等级或生命骰记录无效。");
    const initiatorLevel=level+Math.floor(otherLevels/2);
    acquired={level,otherLevels,initiatorLevel,maxLevel:Math.min(9,Math.floor((initiatorLevel+1)/2))};
  }
  if(replace) {
    if(acquired.level<4||acquired.level%2||s.profile.replacements?.[acquired.level])throw new Error("这个等级没有可用的武技替换机会。");
    const old=s.moves.filter(item=>Number(martial(item).learnedLevel)<=acquired.level);
    if(!old.length)throw new Error("这个取得等级没有可替换的已学武技。");
    const choice=await ask("替换武技：选择旧招式",`<label>将被替换的武技<select name="replaceId">${old.map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select></label><p>接下来选择新招式。确认学习之前不会撤回旧招式。</p>`);
    if(!choice)return null;replaceId=choice.replaceId;
  }
  const entries=MARTIAL_ITEMS.filter(i=>(martial(i).kind==="stance")===(kind==="stance")&&martial(i).level<=acquired.maxLevel);
  const reasonsFor=item=>acquisitionCheck(actor,item,{level:acquired.level,otherLevels:acquired.otherLevels,replaceId},s);
  if(selected) {
    const requested=entries.find(item=>martial(item).definition===selected);
    if(!requested)throw new Error("这招超过当前可学习的最高等级。");
    const reasons=reasonsFor(requested);if(reasons.length)throw new Error(reasons.join("；"));
  }
  if(!entries.some(item=>!reasonsFor(item).length)){ui.notifications.warn("当前没有符合学习条件的招式；请检查已学名额与流派前提。");return null;}
  const options=entries.sort((a,b)=>martial(a).level-martial(b).level||a.name.localeCompare(b.name,"zh")).map(i=>{
    const m=martial(i),reasons=reasonsFor(i);
    return `<option value="${esc(m.definition)}" ${m.definition===selected?"selected":""} ${reasons.length?"disabled":""}>${m.level}级 · ${esc(m.disciplineName)} · ${esc(i.name)}${reasons.length?`（${esc(reasons.join("；"))}）`:""}</option>`;
  }).join("");
  const answer=await ask(kind==="stance"?"学习架势":replace?"选择新武技":"学习武技",`<p>${historical?"按补录记录":"已从角色卡自动读取"}：贤者之剑${acquired.level}级，其他生命骰${acquired.otherLevels}；武道等级${acquired.initiatorLevel}，最高可学${acquired.maxLevel}级。</p>${replace?`<p>替换：${esc(actor.items.get(replaceId)?.name)}</p>`:`<p>还可学习${kind==="stance"?s.pending.stances:s.pending.known}${kind==="stance"?"种架势":"招武技"}。</p>`}<label>选择${kind==="stance"?"架势":"武技"}<select name="definition" required>${options}</select></label><p>灰色条目尚不符合条件。确认后会保存本次取得记录。</p>`,"学习");
  return answer?{...answer,replaceId,acquisitionMode:historical?"historical":"current",...(historical?{level:acquired.level,otherLevels:acquired.otherLevels}:{acquisitionPreview:{level:current.level,otherLevels:current.otherLevels}})}:null;
}

export async function openMartial(actor) {actor.sheet._initialTab??={};actor.sheet._initialTab.primary="martial";await actor.sheet.render(true);}
async function useMartialItem(actor,itemId,event) {
  const item=actor.items.get(itemId);
  if(!item||!actor.isOwner)throw new Error("招式不存在或没有角色操纵权限。");
  let completion;
  // Native ItemUse delegates this item to martial-runtime. Wait for that same
  // command; never launch a second command or charge ordinary spell resources.
  const hookId=Hooks.on("D35E.ItemUse.preUseItem",(usedItem,usedActor,hook)=>{
    if(usedItem.id===item.id&&usedActor?.uuid===actor.uuid)completion=hook.threeRCompletion;
  });
  try {
    await item.use({ev:event});
    if(!completion)throw new Error("武术使用入口尚未加载，请重新进入世界后再使用。");
    return await completion;
  } finally {Hooks.off("D35E.ItemUse.preUseItem",hookId);}
}
export function installMartialSheet(command) {
  const original=ActorSheetPF.prototype.activateListeners;
  ActorSheetPF.prototype.activateListeners=function(html,...args) {
    const root=html?.nodeType===1?html:html?.[0],nav=root?.querySelector('nav[data-group="primary"]'),body=root?.querySelector(".primary-body");
    if(nav&&body&&["character","npc"].includes(this.actor.type)) {
      const tab=document.createElement("a");tab.className="item";tab.dataset.tab="martial";tab.textContent="武术";nav.insertBefore(tab,nav.querySelector('[data-tab="feats"]'));
      const page=document.createElement("div");page.className="tab martial-page";page.dataset.tab="martial";page.dataset.group="primary";
      page.innerHTML=contents(this.actor,remembered.get(this.actor)||"known");body.append(page);
      page.addEventListener("toggle",event=>{
        if(!event.target.matches("details[data-martial-level]"))return;
        const levels=collapsedLevels.get(this.actor)??new Set(),key=event.target.dataset.martialLevel;
        if(event.target.open)levels.delete(key);else levels.add(key);
        collapsedLevels.set(this.actor,levels);
      },true);
      page.addEventListener("change",event=>{
        if(!event.target.matches('input[data-ready="yes"]'))return;
        // Capture before native FormApplication's input listener submits the
        // whole actor form and redraws it. These are local, unsaved selections.
        event.stopPropagation();
        const s=getState(this.actor),ids=Array.from(page.querySelectorAll('input[data-ready="yes"]:checked'),input=>input.value),count=ids.length;
        if(!this.actor.isOwner||s.encounter||martialCombat(this.actor)){page.innerHTML=contents(this.actor,remembered.get(this.actor)||"known");return;}
        preparationDrafts.set(this.actor,{profile:s.id,baseline:readyKey(s.profile.readied),ids});
        page.querySelector(".martial-ready-count").textContent=`已勾选 ${count}/${s.quotas.readied} 招 · 尚未保存`;
        const prepare=page.querySelector('[data-martial-action="prepare"]');if(!prepare)return;
        prepare.disabled=!this.actor.isOwner||Boolean(s.encounter||martialCombat(this.actor))||count!==s.quotas.readied;
        prepare.title=s.encounter||martialCombat(this.actor)?"战斗或遭遇内不能更换准备":count!==s.quotas.readied?`请勾选${s.quotas.readied}招`:"";
      },true);
      page.addEventListener("click",async event=>{
        const section=event.target.closest("[data-martial-section]")?.dataset.martialSection;
        if(section){event.preventDefault();event.stopPropagation();remembered.set(this.actor,section);page.innerHTML=contents(this.actor,section);return;}
        const control=event.target.closest("[data-martial-action]");if(!control)return;event.preventDefault();event.stopPropagation();
        const action=control.dataset.martialAction,id=control.dataset.id;control.disabled=true;
        try {
          if(action==="details"){this.actor.items.get(id)?.sheet.render(true);return;}
          let request={actorUuid:this.actor.uuid,op:action,itemId:id};
          if(["learn","learn-stance","replace","history-learn","history-stance","history-replace"].includes(action)) {const value=await learningDialog(this.actor,["learn-stance","history-stance"].includes(action)?"stance":"move",["replace","history-replace"].includes(action),null,action.startsWith("history-"));if(!value)return;request={...request,...value,op:"learn"};}
          if(action==="resume"){const pending=Object.entries(safeState(this.actor).receipts??{}).find(([_id,r])=>r.status==="initiated");if(!pending){ui.notifications.info("没有未完成的发动。");return;}request={actorUuid:this.actor.uuid,op:"resume",commandId:pending[0]};}
          if(action==="prepare")request.readied=Array.from(page.querySelectorAll('input[data-ready="yes"]:checked'),input=>input.value);
          const result=["initiate","stance"].includes(action)?await useMartialItem(this.actor,id,event):await command(request);
          if(result?.state==="pending")ui.notifications.info(result.reason);
          if(action==="prepare"&&result?.state==="performed")preparationDrafts.delete(this.actor);
          page.innerHTML=contents(this.actor,remembered.get(this.actor)||"known");
        }catch(error){ui.notifications.error(error.message);}finally{control.disabled=false;}
      });
    }
    return original.call(this,html,...args);
  };
}
