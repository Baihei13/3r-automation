import { ACTIONS } from "./state.js";
import { skillIcon } from "./skill-icons.js";
import { automationApi, automationFlag } from "./integration.js";

export const TABS = [
  ["all", "全部"], ["favorites", "收藏"], ["weapons", "攻击"], ["spells", "法术"],
  ["abilities", "能力"], ["skills", "技能"], ["items", "物品"], ["checks", "检定"], ["effects", "状态"], ["actions", "通用"]
];
// Order by action cost, with reactions at the end; never sort by remaining count.
export const ACTION_ORDER = ["full", "standard", "move", "swift", "immediate", "free"];
export const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const owned = actor => Boolean(actor?.testUserPermission(game.user, "OWNER"));
const fmt = value => value === Infinity ? "∞" : Number.isFinite(Number(value)) ? String(Number(value)) : "—";
const actionNames = { ...Object.fromEntries(ACTIONS.map(action => [action.id, `${action.name}动作`])),
  full: "全回合动作", step: "5尺快步", aao: "反应动作", attack: "攻击动作", passive: "被动", round: "1轮", special: "特殊" };
export const actionLabel = item => actionNames[item.system?.activation?.type] ?? "查看详情";
// Persisted identity is safe to read even without the optional rule module.
// Capability and actual execution still belong to that module.
const martialEntry=item=>item.flags?.["samson-3r-automation"]?.martial;
const martialBook=entry=>`martial:${entry.profile??"unassigned"}`;
function martialResource(item,actor) {
  const m=martialEntry(item),saved=actor?.flags?.["samson-3r-automation"]?.martial;
  if(m.retired)return "已替换";
  if(m.kind==="stance")return saved?.activeStance===item.id?"持续":"未进入";
  const p=saved?.profiles?.[m.profile];
  if(!p?.readied?.includes(item.id))return "未准备";
  return p.expended?.includes(item.id)?"0 / 1":"1 / 1";
}

export function actionKinds(item, route = itemActionRoute(item)) {
  if(route?.mode === "reference" || route?.mode === "configure") return [];
  if(item.type==="full-attack")return ["full"];
  if(item.type==="weapon"||item.type==="attack") {
    const melee=item.type==="attack"?item.system.actionType==="mwak":["light","1h","2h"].includes(item.system.weaponSubtype);
    return melee?["standard","full","immediate"]:["standard","full"];
  }
  const raw=route?.kind ?? martialEntry(item)?.action ?? item.system?.activation?.type;
  const kind=raw==="attack"?"standard":raw==="round"?"full":raw==="aao"?"immediate":raw;
  return ACTION_ORDER.includes(kind)?[kind]:[];
}

export function actorChoices() {
  // Selection is the sole authority. No scene roster, world Actors or assigned-character fallback.
  const controlled = canvas.ready ? (canvas.tokens?.controlled ?? []) : [];
  if (controlled.length !== 1) return [];
  const token = controlled[0];
  if (!owned(token.actor) || (!game.user.isGM && token.document.hidden)) return [];
  return [{ key: token.document.uuid, actor: token.actor, token }];
}

export function resourceLabel(item) {
  if(martialEntry(item))return martialResource(item,item.actor);
  if (automationFlag(item, "key") === "legalistic" && item.actor) {
    const record = automationFlag(item.actor, "promise");
    return `每日${record?.used && record.day === Math.floor(game.time.worldTime / 86400) ? 0 : 1}次`;
  }
  if (item.type === "spell" && item.actor?.system.attributes?.spells?.spellbooks?.[item.system.spellbook]?.usePowerPoints) {
    return `${fmt(item.system.powerPointsCost)}点`;
  }
  if (item.type === "spell" || item.isCharged) {
    const value = item.charges;
    if (value === Infinity) return "无限";
    if (Number.isFinite(Number(value))) return `${fmt(value)}次`;
  }
  if (["consumable", "loot", "weapon", "equipment"].includes(item.type)) return `×${fmt(item.system.quantity ?? 1)}`;
  return "";
}

export function displayName(item) {
  // Translate only the system-generated attack suffix. Preserve player-authored names.
  return String(item.displayName || item.name || "未命名").replace(/\s*\(Thrown\)$/i, "（投掷）");
}

function spellbookName(actor, key) {
  const defaults = { primary: "主法术书", secondary: "副法术书", tertiary: "第三法术书", spelllike: "类法术" };
  const book = actor.system.attributes?.spells?.spellbooks?.[key] ?? {};
  const label = /^(Primary|Secondary|Tertiary|Spell.?Like)$/i.test(book.name ?? "") ? defaults[key] || "法术书" : book.name || defaults[key] || "法术书";
  const classItem = book.class ? actor.items.find(item => item.type === "class" && (item.system.customTag === book.class || item.id === book.class)) : null;
  // D35E computes default class tags from names; use its prepared class record.
  const className = classItem ? displayName(classItem) : actor.system.classes?.[book.class]?.name;
  return `${className || (book.class === "_hd" ? "种族／生命骰" : "未关联职业")} · ${label}`;
}

// Match the actual useNative routes. An activation label alone does not make
// a description-only feat executable, and effect toggles need no action roll.
export function itemActionRoute(item) {
  return automationApi()?.hudItemAction?.(item) ?? null;
}

export function itemAvailability(item, actor = item.actor, route = itemActionRoute(item)) {
  const martial=martialEntry(item);
  if(martial&&!route)return {availability:"reference",reference:true,unavailable:false,reason:"启用3r自动化后才能发动武术 · 点击查看全文"};
  if(route?.mode === "reference" || route?.mode === "configure") return {availability:"reference",reference:true,unavailable:false,reason:route.label || "被动能力 · 点击查看规则"};
  const executable = ["weapon", "buff", "aura", "spell", "consumable", "full-attack"].includes(item.type)
    || item.hasAction || route?.mode === "action" || Boolean(route?.kind);
  if (!executable) return { availability: "reference", reference: true, unavailable: false, reason: "规则说明 · 点击查看" };
  if (["buff", "aura"].includes(item.type)) return { availability: "available", reference: false, unavailable: false, reason: "" };
  let reason = "";
  if(route?.available===false)reason=route.label||"当前不能使用";
  else if (item.system.quantity != null && Number(item.system.quantity) <= 0) reason = "数量为0";
  else if (item.system.requiresPsionicFocus && !actor?.system.attributes?.psionicFocus) reason = "需要灵能集中";
  else if ((route?.kind ?? item.system.activation?.type) === "immediate" && actor?.system.attributes?.conditions?.flatFooted) reason = "措手不及时不能使用反应动作";
  else if (!martial && (item.type === "spell" || item.isCharged || item.system.linkedChargeItem?.id)
    && Number(item.charges) < Number(item.chargeCost)) {
    const book = actor?.system.attributes?.spells?.spellbooks?.[item.system.spellbook];
    reason = book?.usePowerPoints ? "灵能点不足" : item.type === "spell" ? "无剩余施法次数" : "剩余次数不足";
  }
  if (!reason) reason = conditionRestriction(actor, item, { kind: actionKinds(item,route)[0] ?? item.system.activation?.type });
  return { availability: reason ? "unavailable" : "available", reference: false, unavailable: Boolean(reason), reason };
}

function conditionRestriction(actor, item, options) {
  const api = automationApi();
  if (typeof api?.checkConditionAction !== "function") return "";
  // This optional API is a read-only rule check: no rolls, writes or resource use.
  try { api.checkConditionAction(actor, item, options); return ""; }
  catch (error) { return error.message || "当前状态不能执行"; }
}

export function commonAvailability(actor, entry, token) {
  let reason = "";
  if (entry.id === "movement-correction") {
    if (game.combat?.started && !game.user.isGM) reason = "战斗移动记录由DM更正";
  } else {
    reason = conditionRestriction(actor, null, { kind: entry.id === "step" ? "move" : entry.kind, common: entry.id });
    if (!reason && ["charge", "defensive", "aao"].includes(entry.id)
      && !actor.items.some(item => item.type === "attack" && item.system.actionType === "mwak")) reason = "尚无原生近战攻击方式";
    if (!reason && entry.id === "step" && (!game.combat?.started || !game.combat.combatants.some(combatant => combatant.tokenId === token?.id))) reason = "仅限已加入战斗的棋子";
  }
  return { availability: reason ? "unavailable" : "available", unavailable: Boolean(reason), reason };
}

export const AVAILABILITY_TABS = [["available", "可用操作"], ["unavailable", "暂不可用"], ["reference", "规则说明"]];
export function availabilitySections(entries, category = "") {
  return AVAILABILITY_TABS
    .map(([availability, label]) => ({ availability, name: category ? `${category} · ${label}` : label,
      cards: entries.filter(entry => entry.availability === availability) }))
    .filter(section => section.cards.length);
}

function card(item, favorites, actor) {
  const route=itemActionRoute(item),m=martialEntry(item);
  const availability = itemAvailability(item, actor,route);
  return {
    id: item.id, name: displayName(item), img: item.img || "icons/svg/book.svg",
    favorite: favorites.includes(item.id), resource: resourceLabel(item),
    action: ["buff", "aura"].includes(item.type) ? (item.system.active ? "已启用" : "未启用") : availability.reference ? route?.label || "查看详情"
      : route?.label || (route?.kind ? actionNames[route.kind] : actionLabel(item)),
    passive: availability.reference, ...availability, item,
    actionKinds:actionKinds(item,route),
    level: m?finite(m.level):item.type === "spell" ? finite(item.system.level) : null,
    book: m?martialBook(m):item.type === "spell" ? item.system.spellbook || "primary" : "",
    spellInfo: m?`${m.level}级${m.kind==="stance"?"架势":"武技"} · ${m.disciplineName}`:item.type === "spell" ? `${finite(item.system.level)}环 · ${spellbookName(actor, item.system.spellbook || "primary")}` : "",
    low: m?martialResource(item,actor)==="0 / 1":Boolean((item.type === "spell" || item.isCharged) && Number(item.charges) <= 0),
    note: item.type === "weapon" && !item.system.equipped ? "未装备"
      : item.type === "feat" && !availability.reference && !item.hasAction && !route ? "手动结算" : ""
  };
}

export function itemCards(actor, store, tab, filters = {}) {
  const layout = store.layout(actor);
  let cards = [];
  const items = Array.from(actor.items);
  const weaponIds = new Set(items.filter(item => item.type === "attack").map(item => item.system.originalWeaponId).filter(Boolean));
  for (const item of items) {
    let group;
    if (["attack", "full-attack", "weapon"].includes(item.type)) {
      if (item.type === "weapon" && weaponIds.has(item.id)) continue;
      group = "weapons";
    } else if (martialEntry(item)||item.type === "spell") group = "spells";
    else if (item.type === "feat") group = "abilities";
    else if (["buff", "aura"].includes(item.type)) group = "effects";
    else if (["consumable", "equipment", "loot"].includes(item.type)) group = "items";
    else continue;
    if (tab !== "all" && tab !== group && !(tab === "favorites" && layout.favorites.includes(item.id))) continue;
    const entry = card(item, layout.favorites, actor);
    entry.group=group;
    if(filters.action&&!entry.actionKinds.includes(filters.action))continue;
    if (tab === "spells" && filters.book && entry.book !== filters.book) continue;
    if (tab === "spells" && filters.level !== "" && filters.level != null && entry.level !== Number(filters.level)) continue;
    if (filters.query && !entry.name.toLocaleLowerCase().includes(filters.query.toLocaleLowerCase())) continue;
    cards.push(entry);
  }
  const ordered = new Map(layout.order.map((id, index) => [id, index]));
  cards.sort((left, right) => (ordered.get(left.id) ?? 100000) - (ordered.get(right.id) ?? 100000)
    || (left.level ?? 0) - (right.level ?? 0) || left.name.localeCompare(right.name, "zh-CN"));
  return cards;
}

export function actorResources(actor) {
  const result=[],seen=new Set();
  const add=(id,name,value,max)=> {
    if(seen.has(id)||value==null||!Number.isFinite(Number(value)))return;
    const capacity=Number(max);
    if(!(capacity>0)&&Number(value)===0)return;
    seen.add(id);
    result.push({id,name,value:fmt(value),max:Number.isFinite(capacity)&&capacity>0?` / ${fmt(capacity)}`:"",
      hasCapacity:Number.isFinite(capacity)&&capacity>0,percent:capacity>0?Math.max(0,Math.min(100,100*Number(value)/capacity)):0});
  };
  // Native resource pools are arbitrary item-backed tags, not a fixed list of classes.
  for(const [tag,data] of Object.entries(actor.system.resources??{})) {
    if(!data||typeof data!=="object")continue;
    const item=data._id?actor.items.get(data._id):null;
    if(data._id&&!item)continue; // Ignore stale links, without deleting character data.
    if(item&&!item.system.uses?.isResource)continue;
    add(item?.id??`resource:${tag}`,item?displayName(item):data.label||data.name||tag,
      item?.system.uses?.value??data.value,item?.system.uses?.max??data.max);
  }
  for(const item of actor.items)if(item.system.uses?.isResource)
    add(item.id,displayName(item),item.system.uses.value,item.system.uses.max);
  const books=spellResources(actor);
  for(const [id,book] of Object.entries(actor.system.attributes?.spells?.spellbooks??{}))if(book.usePowerPoints)
    add(`power:${id}`,`${books.find(entry=>entry.id===id)?.name||"法术书"} · 灵能点`,book.powerPoints,book.dailyPowerPointsTotal??book.powerPointsTotal);
  return result;
}

export function spellResources(actor) {
  const result = [];
  const spells = Array.from(actor.items).filter(item => item.type === "spell"&&!martialEntry(item));
  for (const [key, book] of Object.entries(actor.system.attributes?.spells?.spellbooks ?? {})) {
    const members = spells.filter(item => (item.system.spellbook || "primary") === key);
    if (!members.length && !book.class) continue;
    const levels = [];
    for (let level = 0; level <= 9; level++) {
      const listed = members.filter(item => finite(item.system.level) === level);
      const slot = book.spells?.[`spell${level}`];
      if (!listed.length && finite(slot?.max) <= 0) continue;
      const infinite = listed.length && listed.every(item => item.charges === Infinity);
      if (book.usePowerPoints) continue;
      const value = book.spontaneous ? finite(slot?.value) : listed.reduce((sum, item) => sum + finite(item.charges), 0);
      const max = book.spontaneous ? finite(slot?.max) : null;
      levels.push({ level, value: infinite ? "∞" : fmt(value), max: max === null ? "" : ` / ${fmt(max)}`,
        title: book.spontaneous ? "原生剩余法术位" : "本环已准备的剩余次数；无限法术单独标记" });
    }
    result.push({ id: key, name: spellbookName(actor, key), cl: fmt(book.cl?.total), levels,
      power: book.usePowerPoints ? `${fmt(book.powerPoints)} / ${fmt(book.dailyPowerPointsTotal ?? book.powerPointsTotal)}` : "" });
  }
  return result;
}

export function spellSources(actor,books=spellResources(actor)) {
  const sources=books.map(({id,name})=>({id,name,martial:false}));
  for(const item of actor.items){
    const m=martialEntry(item);if(!m)continue;
    const id=martialBook(m);if(sources.some(row=>row.id===id))continue;
    const klass=actor.items.get(m.profile);
    sources.push({id,name:`${klass?displayName(klass):"未关联来源"} · 武术`,martial:true});
  }
  return sources;
}

export function targetCards() {
  return Array.from(game.user.targets).filter(token => game.user.isGM || (!token.document.hidden && token.isVisible))
    .map(token => ({ id: token.id, name: token.name, img: token.document.texture?.src || "icons/svg/target.svg" }));
}

export function checkCards(actor) {
  const local = (key, fallback) => { const value = game.i18n.localize(key); return value === key ? fallback : value; };
  const skillNames = { apr:"估价", blc:"平衡", blf:"唬骗", clm:"攀爬", coc:"专注", crf:"手艺", dsc:"解读文书", dip:"交涉", dev:"解除装置", dis:"易容", esc:"脱逃", fog:"伪造文书", gif:"搜集信息", han:"驯养动物", hea:"医疗", hid:"躲藏", int:"威吓", jmp:"跳跃", kar:"知识（神秘）", kdu:"知识（地城）", ken:"知识（建筑与工程）", kge:"知识（地理）", khi:"知识（历史）", klo:"知识（地方）", kna:"知识（自然）", kno:"知识（贵族与皇室）", kpl:"知识（位面）", kre:"知识（宗教）", kps:"知识（灵能）", lis:"聆听", mos:"潜行", opl:"开锁", prf:"表演", pro:"专业", rid:"骑术", src:"搜索", sen:"察言观色", slt:"手上功夫", spk:"语言", spl:"辨识法术", spt:"侦察", sur:"野外求生", swm:"游泳", tmb:"滚翻", umd:"使用魔法装置", uro:"绳技", aut:"自我催眠", psi:"灵能辨识", upd:"使用灵能装置" };
  return {
    abilities: Object.entries(actor.system.abilities ?? {}).map(([id, data]) => ({ id,
      name: {str:"力量",dex:"敏捷",con:"体质",int:"智力",wis:"感知",cha:"魅力"}[id] ?? local(CONFIG.D35E.abilities?.[id] ?? id, id), value: fmt(data.total), mod: fmt(data.mod) })),
    saves: Object.entries(actor.system.attributes?.savingThrows ?? {}).map(([id, data]) => ({ id,
      name: {fort:"强韧",ref:"反射",will:"意志"}[id] ?? id, value: fmt(data.total) })),
    skills: Object.entries(actor.system.skills ?? {}).flatMap(([id, data]) => {
      const name = data.name || skillNames[id] || local(CONFIG.D35E.skills?.[id] ?? id, id);
      const img = data.img || skillIcon(id);
      const entries = [{ id, name, img, value: fmt(data.mod ?? data.total) }];
      for (const [subId, sub] of Object.entries(data.subSkills ?? {})) entries.push({ id: `${id}.subSkills.${subId}`, name: sub.name || name, img: sub.img || img, value: fmt(sub.mod ?? sub.total) });
      return entries;
    }).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  };
}

// Read the same computed sourceDetails as the native sheet. No bonus is
// inferred from equipped items, descriptions, or another module's private API.
export function defenseCards(actor) {
  const labels = {Base:"基础",Strength:"力量",Dexterity:"敏捷",Constitution:"体质",Wisdom:"感知",
    "Dexterity (Uncanny Dodge)":"敏捷（直觉闪避）","Negative Levels":"负向等级",
    "Temporary Buffs":"临时增益","Permanent Buffs":"永久增益","Item Buffs":"物品增益",
    "Misc Buffs":"其他增益",Buffs:"增益",Equipment:"装备",Weapons:"武器",Feats:"专长",
    "Class Features":"职业特性","Racial Traits":"种族特性",Race:"种族",Size:"体型",Traits:"特质"};
  const names = text => {
    let name = game.i18n.localize(String(text ?? "来源未记录"));
    for (const [key, value] of Object.entries(labels)) {
      if (name === key) return value;
      name = name.replace(`${key} → `, `${value} → `);
    }
    return name;
  };
  const entries = [
    ["normal","AC","普通AC","ac.normal","ac"],
    ["touch","接触","接触AC","ac.touch","ac"],
    ["flatFooted","措手","措手不及AC","ac.flatFooted","ac"],
    ["fort","强韧","强韧豁免","savingThrows.fort","save"],
    ["ref","反射","反射豁免","savingThrows.ref","save"],
    ["will","意志","意志豁免","savingThrows.will","save"]
  ];
  return entries.map(([id, name, label, path, kind]) => {
    const total = foundry.utils.getProperty(actor.system.attributes, `${path}.total`);
    const details = actor.sourceDetails?.[`system.attributes.${path}.total`];
    const sources = (Array.isArray(details) ? details : Object.values(details ?? {}))
      .filter(source => source && source.value != null && Number(source.value) !== 0)
      .map(source => ({name:names(source.name),value:Number.isFinite(Number(source.value))
        ? `${Number(source.value)>0?"+":""}${Number(source.value)}` : String(source.value)}));
    const numeric = sources.every(source => Number.isFinite(Number(source.value)));
    const sum = sources.reduce((value, source) => value + Number(source.value), 0);
    const note = !sources.length ? "系统尚未提供加值来源。" :
      numeric && Number.isFinite(Number(total)) && Math.abs(sum-Number(total))>1e-8
        ? "来源明细未覆盖当前总值，以角色卡总值为准。" : "";
    const value = total == null ? "—" : fmt(total);
    return {id,name,label,kind,isSave:kind==="save",value,sources,note,
      tooltip:[`${label} ${value}`,...sources.map(source=>`${source.name}：${source.value}`),note,
        kind==="save"?"点击进行原生豁免检定":""].filter(Boolean).join("\n")};
  });
}

export function reminderView(actor, token, store, context) {
  const counts = store.counts(context);
  const messages = [];
  if (counts.full) messages.push("已记录全回合动作；通常占用本回合的标准与移动动作。");
  if (counts.standard + counts.full > 1) messages.push("本轮已记录多次标准／全回合动作，请核对。");
  if (counts.move + counts.full > 1) messages.push("已记录多次移动消耗；用标准动作换移动时可继续操作。");
  if (counts.swift + counts.immediate > 1) messages.push("迅捷与反应动作已多次使用，请核对回合时机。");
  if (counts.immediate) messages.push("反应动作在自己行动轮使用占本轮迅捷动作；在他人行动轮使用后，下次行动结束前不能再做迅捷或反应动作。");
  if (counts.step && counts.move) messages.push("已同时记录5尺快步与移动，请核对是否符合具体动作规则。");
  const combatant = game.combat?.combatants?.find(entry => token ? entry.tokenId === token.id : entry.actor?.uuid === actor.uuid);
  const nextSwift = Boolean(automationFlag(combatant, "nextSwiftSpent"));
  if (nextSwift) messages.push("3r自动化记录了下回合迅捷动作已占用。");
  const shared = Math.max(counts.swift, counts.immediate);
  const remaining = {
    standard: Math.max(0, 1 - counts.standard - counts.full - Math.max(0, counts.move - 1)),
    move: Math.max(0, 1 - counts.move - counts.full),
    swift: Math.max(0, 1 - shared - (nextSwift ? 1 : 0)), immediate: Math.max(0, 1 - shared),
    full: counts.full || counts.standard || counts.move ? 0 : 1,
    free: "∞",
    step: counts.step || counts.move ? 0 : 1
  };
  return {
    actions: ACTIONS.map(action => ({ ...action, count: counts[action.id], remaining: remaining[action.id], exhausted: remaining[action.id] === 0 })), messages,
    history: store.ledger(context).slice(-5).reverse().map(entry => ({
      name: ACTIONS.find(action => action.id === entry.kind)?.name ?? "动作",
      label: entry.label, delta: entry.delta < 0 ? "−1" : "+1", source: entry.automatic ? "自动" : "手动"
    })),
    native: combatant ? [combatant.usedAttackAction && "标准已标记", combatant.usedMoveAction && "移动已标记", combatant.usedSwiftAction && "迅捷已标记"].filter(Boolean).join(" · ") : ""
  };
}
