import { MODULE_ID } from "./catalog.js";
import { worldActors, choose, timedBuff, replaceTimedBuff, applySpellBuff, curseLevel, grantHealth, promiseAttack, recordAction } from "./rules-bridge.js";
import { legalisticConversation, trackMentalEffect } from "./progression.js";

let panel;
const key = item => item?.getFlag(MODULE_ID, "key");
const has = (actor, value) => actor.items.some(item => key(item) === value);
const day = () => Math.floor(game.time.worldTime / 86400);
const chat = (actor, content) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
const safe = value => String(value).replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const rangeInSceneUnits = feet => {
  const units = String(canvas.scene?.grid?.units ?? "").toLowerCase();
  return /^(m|meter|meters|米|公尺)$/.test(units) ? feet * 0.3 : feet;
};

function targeted(actor, { self = false, range = 30, requiresEdit = true } = {}) {
  const selected = [...game.user.targets];
  if (selected.length !== 1 || !selected[0].actor) throw new Error("请先在地图上指定一个目标 Token。");
  const target = selected[0];
    if (!self && target.actor.uuid === actor.uuid) throw new Error("这项能力不能对自己使用。");
  if (requiresEdit && !target.actor.testUserPermission(game.user, "OWNER")) {
    throw new Error("你没有目标角色的编辑权限；请 GM 对该目标执行此操作。");
  }
  if (range != null) {
    const caster = canvas.tokens.placeables.find(token => token.actor?.id === actor.id);
    if (!caster) throw new Error("施法者需要在当前地图上有 Token，才能判断 30 尺距离。");
    const distance = canvas.grid.measurePath([caster.center, target.center]).distance;
    if (distance > rangeInSceneUnits(range)) throw new Error(`目标超出了 ${range} 尺的能力范围。`);
  }
  return target.actor;
}

function buff(name, keyName, seconds, changes = [], flags = {}) {
  return timedBuff(name,keyName,seconds,changes,flags);
}

async function replaceBuff(target, data) {
  return [await replaceTimedBuff(target,data)];
}

async function witchAction(actor, action, detail) {
  const level = Number(actor.items.find(item => key(item) === "witch")?.system.levels ?? 0);
  if (action === "samsaran-reset") {
    if (!game.user.isGM) throw new Error("由 GM 在休息或恢复每日能力后重置种族法术。");
    await actor.setFlag(MODULE_ID, "samsaranSpells", { used: [] });
    return ui.notifications.info("轮回者魔法的每日次数已重置。");
  }
  if (action.startsWith("samsaran-")) {
    if (!has(actor, "samsaran-magic") || Number(actor.system.abilities.cha.total ?? 0) < 11) {
      throw new Error("轮回者魔法需要该种族能力和至少 11 魅力。");
    }
    const spell = action.slice("samsaran-".length);
    if (!["languages", "deathwatch", "stabilize"].includes(spell)) throw new Error("未知的轮回者魔法。");
    const racialLevel=Math.max(1,Number(actor.system.attributes.hd.total));
    const spellItem=actor.items.find(i=>key(i)===action);
    const used = actor.getFlag(MODULE_ID, "samsaranSpells")?.used ?? [];
    if (used.includes(spell)) throw new Error("今天已经使用过这个轮回者法术。");
    if (spellItem && Number(spellItem.system.uses.value)<1)throw new Error("今日该种族法术次数已用完。");
    const target = spell === "stabilize" ? targeted(actor, { self: true, range: 25+5*Math.floor(racialLevel/2) }) : actor;
    if (spell === "stabilize") {
      if(["undead","construct"].includes(target.system.attributes.creatureType))throw new Error("稳定伤势只能用于活着的生物，不能用于不死生物或构装体。");
      if(Number(target.system.attributes.hp.value)>=0 || Number(target.system.attributes.hp.value)<=-Number(target.system.abilities.con.total))throw new Error("目标需要处于负生命值、尚未死亡。");
      await target.update({ "system.attributes.conditions.stable": true });
    } else {
      const name = spell === "languages" ? "通晓语言" : "观命术";
      const effect=await replaceTimedBuff(actor,buff(name, `samsaran-${spell}-buff`, 600 * racialLevel, [],
        { sourceActor: actor.uuid,sourceItemUuid:spellItem?.uuid }));
      if(spellItem)await effect.update({"system.description.value":spellItem.system.description.value});
    }
    await actor.setFlag(MODULE_ID, "samsaranSpells", { used: [...used, spell] });
    if(spellItem)await spellItem.update({"system.uses.value":Number(spellItem.system.uses.value)-1});
    await recordAction(actor,"standard");
    await chat(actor, `<p>${safe(actor.name)}使用轮回者魔法：${spell === "stabilize" ? `稳定${safe(target.name)}的伤势` : spell === "languages" ? "通晓语言" : "观命术"}；该能力每天各可使用一次。</p>`);
    return;
  }
  if (action === "lifebound") {
    if (!has(actor, "lifebound")) throw new Error("角色没有生命之缚能力。");
    const save = detail;
    if (!["fort", "ref", "will", "stabilize"].includes(save)) throw new Error("请选择豁免类型。");
    if(save==="stabilize"&&Number(actor.system.attributes.hp.value)>=0)throw new Error("稳定伤势检定只用于负生命值。");
    if(save==="stabilize"&&(["undead","construct"].includes(actor.system.attributes.creatureType)||Number(actor.system.attributes.hp.value)<=-Number(actor.system.abilities.con.total)))throw new Error("稳定检定只能用于尚未死亡的活着生物。");
    const changes=save==="stabilize"?[["2","abilityChecks","conChecks","racial"],[String(Math.min(0,Number(actor.system.attributes.hp.value))),"abilityChecks","conChecks","untyped"]]:[["2","savingThrows",save,"racial"]];
    const effect=await replaceTimedBuff(actor,buff("生命之缚：本次符合条件的检定","lifebound-check",null,changes));
    try {
      const roll=save==="stabilize"?await actor.rollAbilityTest("con"):await actor.rollSavingThrow(save);
      if(save==="stabilize"&&roll?.total>=10)await actor.update({"system.attributes.conditions.stable":true});
    }finally{if(actor.items.has(effect.id))await effect.delete();}
    return;
  }
  if (level < 1) throw new Error("角色目前没有女巫等级。");
  if (action === "ward" || action === "luck") {
    const feature = action === "ward" ? "ward" : "protective-luck";
    if (!has(actor, feature)) throw new Error("角色没有对应巫术。");
    const target = targeted(actor,{range:action==="ward"?null:30});
    if (action === "ward") {
      for (const owner of worldActors()) {
        const previous = owner.items.filter(item => key(item) === "witch-ward" &&
          [actor.id,actor.uuid].includes(item.getFlag(MODULE_ID, "sourceActor")));
        if (previous.length && !owner.testUserPermission(game.user, "OWNER")) {
          throw new Error("旧守护目标不归你编辑；请 GM 更换守护目标。");
        }
        if (previous.length) await owner.deleteEmbeddedDocuments("Item", previous.map(item => item.id));
      }
      const bonus = level >= 16 ? 4 : level >= 8 ? 3 : 2;
      await replaceBuff(target, buff("守护", "witch-ward", null,
        [[String(bonus), "ac", "ac", "deflection"],
          [String(bonus), "savingThrows", "allSavingThrows", "resist"]], { sourceActor: actor.uuid }));
      await chat(actor, `<p>${safe(actor.name)}对${safe(target.name)}施加守护：AC 和豁免 +${bonus}。首次被击中或豁免失败时移除“守护”增益。</p>`);
    } else {
      const rounds = 1 + (level >= 8 ? 1 : 0) + (level >= 16 ? 1 : 0);
      await replaceBuff(target, buff("幸庇", "witch-protective-luck", rounds * 6, [],
        { sourceActor: actor.uuid }));
      await chat(actor, `<p>${safe(actor.name)}对${safe(target.name)}施加幸庇，持续 ${rounds} 轮。攻击者针对该目标的攻击检定掷两次，取较差结果。</p>`);
    }
    await recordAction(actor,"standard");
    return;
  }
  if (action === "cackle") {
    if (!has(actor, "cackle")) throw new Error("角色没有尖笑巫术。");
    const period=game.combat?.started?`${game.combat.id}:${game.combat.round}`:`time:${Math.floor(game.time.worldTime/6)}`;
    if(actor.getFlag(MODULE_ID,"cacklePeriod")===period)throw new Error("本轮已经使用过尖笑。");
    let count = 0;
    const visited = new Set();
    for (const token of canvas.tokens.placeables) {
      const target = token.actor;
      if (!target?.testUserPermission(game.user, "OWNER")) continue;
      if (visited.has(target.uuid)) continue;
      visited.add(target.uuid);
      const caster = canvas.tokens.placeables.find(other => other.actor?.id === actor.id);
      if (!caster || canvas.grid.measurePath([caster.center, token.center]).distance > rangeInSceneUnits(30)) continue;
      const effects = target.items.filter(item => ["witch-protective-luck","witch-agony","witch-charm","witch-evil-eye","witch-fortune","witch-misfortune"].includes(key(item)) &&
        [actor.id,actor.uuid].includes(item.getFlag(MODULE_ID, "sourceActor")) &&
        item.getFlag(MODULE_ID, "expiresAt") > game.time.worldTime);
      for (const effect of effects) {
        await effect.update({ [`flags.${MODULE_ID}.expiresAt`]: effect.getFlag(MODULE_ID, "expiresAt") + 6,
          "system.timeline.total": Number(effect.system.timeline?.total ?? 0) + 1,
          "flags.d35e-world-timeline.timer.end":effect.getFlag(MODULE_ID,"expiresAt")+6,
          "flags.d35e-world-timeline.timer.seconds":Number(effect.getFlag("d35e-world-timeline","timer")?.seconds??0)+6 });
        count++;
      }
    }
    await actor.setFlag(MODULE_ID,"cacklePeriod",period);
    await recordAction(actor,"move");
    await chat(actor, `<p>${safe(actor.name)}尖笑：30 尺内 ${count} 个由她施加的幸庇效果延长 1 轮。</p>`);
    return;
  }
  if (action === "covenant-reset") {
    const previous=actor.getFlag(MODULE_ID,"covenant");
    if(!game.user.isGM && previous?.preparedAt!=null && Math.floor(previous.preparedAt/86400)===day())throw new Error("今天已经准备过守望对象；需要更正时请GM操作。");
    const target = targeted(actor, { self:true, range: null });
    await actor.setFlag(MODULE_ID, "covenant", { target: target.uuid, used: 0,preparedAt:game.time.worldTime });
    await chat(actor, `<p>${safe(actor.name)}已在准备法术时指定 ${safe(target.name)} 为守望对象；今日可用 ${Math.max(1, Math.floor(level / 2))} 次。</p>`);
    return;
  }
  if (action.startsWith("covenant-")) {
    if (!has(actor, "covenant-ally")) throw new Error("角色没有守望誓约。");
    const target = targeted(actor,{self:true});
    const record = actor.getFlag(MODULE_ID, "covenant") ?? {};
    if (![target.id,target.uuid].includes(record.target)) throw new Error("这个目标不是今日准备法术时指定的守望对象。");
    const limit = Math.max(1, Math.floor(level / 2));
    if (Number(record.used ?? 0) >= limit) throw new Error("今日守望誓约次数已用完。");
    const intMod = Number(actor.system.abilities.int.mod ?? 0);
    if (action === "covenant-health") {
      const amount = Math.max(1, level + intMod);
      const [effect]=await replaceBuff(target, buff("守望誓约：健康", "covenant-health", intMod * 60, [],
        { sourceActor: actor.uuid, tempHpGranted: amount }));
      await grantHealth(target,effect,amount);
    } else if (action === "covenant-safeguard") {
      const bonus = Math.max(1, Math.floor(level / 2));
      const allocation=await choose(`分配 ${bonus} 点防护：AC偏斜加值`,Array.from({length:Math.min(5,bonus)+1},(_,i)=>[String(i),`AC +${i}，豁免 +${Math.min(5,bonus-i)}`]));
      if(allocation==null)return;
      const ac=Number(allocation);
      if(!Number.isFinite(ac))return;
      const save=Math.min(5,bonus-ac);
      await replaceBuff(target, buff("守望誓约：防护", "covenant-safeguard", intMod * 60,
        [[String(ac),"ac","ac","deflection"],[String(save),"savingThrows","allSavingThrows","resist"]], { sourceActor: actor.uuid }));
    } else if (action === "covenant-sr") {
      const resistance = (level >= 10 ? 11 : 6) + level;
      await replaceBuff(target, buff("守望誓约：抗法", "covenant-sr", intMod * 6,
        [[`max(0,${resistance}-@attributes.sr.total)`, "misc", "spellResistance", "untyped"]], { sourceActor: actor.uuid,spellResistance:resistance }));
    } else if (action === "covenant-solace") {
      const eligible=[...target.items.filter(i=>i.type==="buff"&&i.system.active),...target.effects.filter(e=>!e.disabled)]
        .filter(i=>i.getFlag(MODULE_ID,"expiresAt")||i.getFlag("d35e-world-timeline","timer")||Number(i.duration?.seconds)>0);
      const selected=await choose("慰藉：选择要压制的非永久法术",eligible.map(i=>[i.uuid,i.name]));
      if(!selected)return;
      const effect=await fromUuid(selected);
      const sourceCl=effect.getFlag(MODULE_ID,"cl")??Number(await Dialog.prompt({title:"原法术施法者等级",content:'<input type="number" name="cl" min="1" value="1">',label:"确定",rejectClose:false,callback:h=>(h[0]??h).querySelector("input").value}));
      if(!sourceCl)return;
      const roll = await new Roll(`1d20 + ${level}`).evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor:
        `守望誓约：慰藉，解除DC ${11+sourceCl}，${roll.total>=11+sourceCl?"成功":"失败"}。` });
      if(roll.total>=11+sourceCl) {
        const seconds=Math.max(1,intMod)*6,started=game.time.worldTime;
        const end=effect.getFlag("d35e-world-timeline","timer")?.end??effect.getFlag(MODULE_ID,"expiresAt")??(effect.duration?.startTime+effect.duration?.seconds);
        await target.setFlag(MODULE_ID,"suppressedSpells",[...(target.getFlag(MODULE_ID,"suppressedSpells")??[]),{uuid:effect.uuid,active:effect.system?.active,disabled:effect.disabled,end,started,seconds,restoreAt:started+seconds}]);
        await effect.update(effect.type==="buff"?{"system.active":false}:{disabled:true});
      }
    } else throw new Error("未知的守望誓约能力。");
    await actor.setFlag(MODULE_ID, "covenant", { ...record, used: Number(record.used ?? 0) + 1 });
    await recordAction(actor,"standard");
    if (action !== "covenant-solace") await chat(actor, `<p>${safe(actor.name)}对${safe(target.name)}使用${safe(action)}；今日已用 ${Number(record.used ?? 0) + 1}/${limit} 次。</p>`);
  }
}

async function oracleAction(actor, action, detail) {
  if (["favor","shield","enhanced-diplomacy"].includes(action)) {
    const spellKey={favor:"pf-spell-divine-favor",shield:"pf-spell-shield-of-faith","enhanced-diplomacy":"enhanced-diplomacy"}[action];
    const spell=actor.items.find(i=>key(i)===spellKey);
    if(!spell)throw new Error("角色缺少这项法术。");
    return spell.use();
  }
  if(action==="misfortune" || action==="fortune") {
    const feature=actor.items.find(i=>key(i)===action && !i.getFlag(MODULE_ID,"unselected"));
    if(!feature)throw new Error("角色未正式选取这项启示。");
    const target=action==="fortune"?actor:targeted(actor,{requiresEdit:false});
    const previous=actor.getFlag(MODULE_ID,"misfortune")??{};
    if(action==="misfortune" && Number(previous[target.uuid]??0)>game.time.worldTime)throw new Error("该目标在24小时内免疫这名先知的厄运。");
    if(action==="fortune" && Number(feature.system.uses.value)<1)throw new Error("幸运次数已用完。");
    const messages=game.messages.contents.filter(m=>m.visible && m.speaker.actor===target.id && m.rolls.some(r=>r.dice.some(d=>d.faces===20))).slice(-20).reverse();
    const id=await choose("结果宣布前：选择要重掷的检定",messages.map(m=>[m.id,`${m.flavor??target.name}：${m.rolls.find(r=>r.dice.some(d=>d.faces===20)).total}`]));
    if(!id)return;
    const message=game.messages.get(id),old=message.rolls.find(r=>r.dice.some(d=>d.faces===20));
    const d20=old.dice.find(d=>d.faces===20);
    if(d20.number!==1)throw new Error("该检定含多个d20，请由GM选择须重掷的具体骰子。");
    const roll=await new Roll(`1d20 + (${old.total-d20.total})`).evaluate();
    await roll.toMessage({speaker:message.speaker,flavor:`${feature.name}：保留原检定其它加值，替换原d20；必须采用新结果。`,flags:{[MODULE_ID]:{replacesMessage:id,originalFormula:old.formula}}});
    if(action==="misfortune")await actor.setFlag(MODULE_ID,"misfortune",{...previous,[target.uuid]:game.time.worldTime+86400});
    else await feature.update({"system.uses.value":Number(feature.system.uses.value)-1});
    await recordAction(actor,"immediate");
    return;
  }
  if(action==="promise") {
    if(!has(actor,"legalistic"))throw new Error("角色没有守律诅咒。");
    const record=actor.getFlag(MODULE_ID,"promise")??{};
    if(record.day===day()&&record.used)throw new Error("今日守律履约加值已用过。");
    const selection=await choose("履约：选择本次检定",[
      ...Object.keys(actor.system.skills).map(k=>[`skill:${k}`,`技能：${game.i18n.localize(CONFIG.D35E.skills[k]??actor.system.skills[k].name??k)}`]),
      ...["fort","ref","will"].map(k=>[`save:${k}`,`豁免：${game.i18n.localize(CONFIG.D35E.savingThrows[k])}`]),
      ...["str","dex","con","int","wis","cha"].map(k=>[`ability:${k}`,`属性：${game.i18n.localize(CONFIG.D35E.abilities[k])}`]),
      ...actor.items.filter(i=>i.type==="attack").map(i=>[`attack:${i.id}`,`攻击：${i.name}`])]);
    if(!selection)return;
    const [kind,id]=selection.split(":");
    if(kind==="attack") {
      if(await promiseAttack(actor,actor.items.get(id)))await actor.setFlag(MODULE_ID,"promise",{day:day(),used:true});
      return;
    }
    const row=kind==="skill"?["4","skill",`skill.${id}`,"morale"]:kind==="save"?["4","savingThrows",id,"morale"]:kind==="ability"?["4","abilityChecks",`${id}Checks`,"morale"]:["4","attack","attack","morale"];
    const [effect]=await replaceBuff(actor,buff("守律：本次履约 +4 士气","legalistic-promise",null,[row],{sourceActor:actor.uuid}));
    let result;
    try {
      if(kind==="skill")result=await actor.rollSkill(id);
      if(kind==="save")result=await actor.rollSavingThrow(id);
      if(kind==="ability")result=await actor.rollAbilityTest(id);
      if(result?.wasRolled || result?.total!=null)await actor.setFlag(MODULE_ID,"promise",{day:day(),used:true});
    } finally {if(actor.items.has(effect.id))await effect.delete();}
    return;
  }
  if(action==="broken-promise") {
    if(!has(actor,"legalistic"))throw new Error("角色没有守律诅咒。");
    await replaceBuff(actor,buff("守律：违约（恶心）","legalistic-sickened",86400,[
      ["-2","attack","attack","penalty"],["-2","damage","wdamage","penalty"],["-2","savingThrows","allSavingThrows","penalty"],
      ["-2","skills","skills","penalty"],["-2","abilityChecks","allChecks","penalty"]],{sourceActor:actor.uuid}));
    return;
  }
  if(action==="fulfilled-promise") {
    const effects=actor.items.filter(i=>["legalistic-sickened","legalistic-nauseated"].includes(key(i)));
    if(effects.length)await actor.deleteEmbeddedDocuments("Item",effects.map(i=>i.id));
    return;
  }
}

async function rogueAction(actor, action) {
  if (action === "sneak") return rogueAction(actor,"native-attack");
  if (action === "two-weapons" || action === "native-attack") {
    const attacks=actor.items.filter(i=>i.type==="attack" && (action==="native-attack" || key(actor.items.get(i.system.originalWeaponId))==="sleeve-blade"));
    const id=await choose("使用系统攻击（双武器在攻击对话框选择主/副手）",attacks.map(i=>[i.id,i.name]));
    if(id)return actor.items.get(id).use();
    return;
  }
  if (action === "find-trap" || action === "disable-trap") {
    if (!has(actor, "trapfinding")) throw new Error("角色没有寻找陷阱能力。");
    return actor.rollSkill(action === "find-trap" ? "src" : "dev");
  }
}

export function openCharacterPanel(actor) {
  const character = actor?.getFlag(MODULE_ID, "characterKey");
  if (!["wind", "qing", "lazarus"].includes(character)) return;
  if (!actor.testUserPermission(game.user, "OWNER")) return ui.notifications.warn("需要角色的所有者权限。");
  panel ??= document.createElement("section");
  panel.id = "three-r-character-panel";
  const buttons = character === "qing" ? `
    <button data-action="samsaran-languages">种族：通晓语言</button>
    <button data-action="samsaran-deathwatch">种族：观命术</button>
    <button data-action="samsaran-stabilize">种族：稳定伤势</button>
    ${game.user.isGM ? `<button data-action="samsaran-reset">重置种族法术</button>` : ""}
    <label>生命之缚检定 <select name="lifebound-save"><option value="fort">强韧</option><option value="ref">反射</option><option value="will">意志</option><option value="stabilize">稳定伤势</option></select></label>
    <button data-action="lifebound">掷生命之缚检定</button>
    <button data-action="luck">幸庇（指定目标）</button><button data-action="ward">守护（指定目标）</button>
    <button data-action="cackle">尖笑（延长幸庇）</button>
    ${game.user.isGM ? `<button data-action="covenant-reset">准备法术：指定守望对象</button>` : ""}
    <button data-action="covenant-health">誓约：健康</button>
    <button data-action="covenant-safeguard">誓约：防护 AC</button>
    <button data-action="covenant-safeguard" data-detail="save">誓约：防护豁免</button>
    <button data-action="covenant-solace">誓约：慰藉</button>
    <button data-action="covenant-sr">誓约：抗法</button>`
    : character === "lazarus" ? `<button data-action="misfortune">厄运：重掷</button>
      <button data-action="promise">守律：履约誓言</button>
      <button data-action="broken-promise">守律：违背承诺</button>
      <button data-action="favor">施放神恩</button><button data-action="shield">施放虔诚护盾</button>
      <button data-action="enhanced-diplomacy">增强交涉：检定</button>`
      : `<button data-action="two-weapons">双袖剑攻击</button>
         <button data-action="sneak">武器攻击（自动判断偷袭）</button>
         <button data-action="find-trap">定位陷阱</button>
         <button data-action="disable-trap">解除陷阱</button>`;
  panel.innerHTML = `<header><strong>${safe(actor.name)} · 3r自动化</strong><button data-action="close" aria-label="关闭">×</button></header>
    <p>先在地图上指定一个目标。效果会显示在目标角色的增益列表；30 尺能力会检查地图距离。</p>
    ${character === "lazarus" ? `<label>增强交涉用于 <select name="enhanced-skill"><option value="dip">交涉</option><option value="int">威吓</option></select></label>` : ""}
    <div class="three-r-actions">${buttons}</div>
    <small>角色卡未写的选择仍保留空缺。需要判断命中、豁免或特殊触发条件的能力，面板会在聊天中标明需要确认的步骤。</small>`;
  if (!panel.isConnected) document.body.append(panel);
  panel.onclick = async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "close") { panel.remove(); return; }
    try {
      if (character === "qing") await witchAction(actor, action,
        action === "lifebound" ? panel.querySelector("[name='lifebound-save']").value : button.dataset.detail);
      if (character === "lazarus") await oracleAction(actor, action,
        action === "enhanced-diplomacy" ? panel.querySelector("[name='enhanced-skill']").value : undefined);
      if (character === "wind") await rogueAction(actor, action);
    } catch (error) {
      console.error(`${MODULE_ID}: character action`, error);
      ui.notifications.warn(error.message);
    }
  };
}

export async function dispatchCharacterAction(actor,action,detail) {
  if(!actor.isOwner)throw new Error("需要该角色的所有者权限。");
  if(action==="samsaran-menu")action=await choose("轮回者魔法",[["samsaran-languages","通晓语言"],["samsaran-deathwatch","观命术"],["samsaran-stabilize","稳定伤势"]]);
  if(action==="trap-menu")action=await choose("寻找陷阱",[["find-trap","搜索陷阱"],["disable-trap","解除陷阱"]]);
  if(action==="lifebound"&&!detail)detail=await choose("生命之缚：仅对应情境才获得+2",[["fort","强韧"],["ref","反射"],["will","意志"],["stabilize","负生命值稳定伤势"]]);
  if(action==="curse-menu")action=await choose("守律诅咒",[["promise","履约检定 +4"],["broken-promise","违约：恶心"],["fulfilled-promise","履约：结束恶心"],["conversation","5级：一对一交谈"],["mental-saves","10级：追踪影响心灵效果"],["oathbreaker","15级：他人违背承诺"],["curse-settings","选择不成长的诅咒"]]);
  if(action==="conversation")return legalisticConversation(actor);
  if(action==="mental-saves")return trackMentalEffect(actor);
  if(action==="oathbreaker") {
    if(curseLevel(actor,"legalistic")<15)throw new Error("成长中的守律诅咒达到15级后才可使用。");
    const target=targeted(actor,{range:null});
    await replaceBuff(target,buff("守律：违背对先知的承诺","legalistic-oathbreaker",86400,[],{sourceActor:actor.uuid,penalty:Math.max(1,Number(actor.system.abilities.cha.mod))}));
    return;
  }
  if(action==="curse-settings") {
    const value=await choose("选择哪个诅咒不随等级成长",[["legalistic","守律不成长，隐居成长"],["reclusive","隐居不成长，守律成长"]]);
    if(value)await actor.setFlag(MODULE_ID,"fixedCurse",value);
    return;
  }
  if(!action)return;
  if(["luck","ward","cackle","lifebound"].includes(action)||/^(samsaran|covenant)-/.test(action))await witchAction(actor,action,detail);
  else if(["misfortune","fortune","promise","broken-promise","fulfilled-promise","favor","shield","enhanced-diplomacy"].includes(action))await oracleAction(actor,action,detail);
  else await rogueAction(actor,action);
}
