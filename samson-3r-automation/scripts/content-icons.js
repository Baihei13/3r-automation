import { MODULE_ID } from "./catalog.js";
import { RULE_ICON_KEYS } from "./rule-icon-map.js";

// Replace default art or the exact icon assigned by revision 1; preserve user art.
const defaults = new Set(["", "icons/svg/book.svg", "icons/svg/item-bag.svg"]);
const supported = new Set(["feat", "spell", "buff"]);
const path = key => `modules/${MODULE_ID}/assets/icons/${key}.png`;

function legacyIconKey(item) {
  const mark = item.flags?.[MODULE_ID] ?? {};
  const label = `${mark.key ?? ""} ${item.name ?? ""}`;
  const choices = [
    [/familiar|companion|魔宠|动物伙伴/i,"animal"],
    [/heal|cure|vigor|vitality|stabilize|治疗|活力|稳定|回春/i,"heal"],
    [/armor|shield|defense|护甲|防御|守望|防护/i,"shield"],
    [/stone-fist|unarmed|石拳|徒手/i,"fist"],
    [/finesse|weapon|attack|strike|战斗|攻击|武器|专攻/i,"blade"],
    [/stealth|invisibility|躲藏|潜行|隐形/i,"sneak"],
    [/speed|initiative|反射|先攻|速度/i,"speed"],
    [/luck|fortune|misfortune|命运|幸运|厄运|不幸/i,"rune"],
    [/detect|vision|deathwatch|侦测|锐耳|鹰眼|视力|洞察/i,"vision"],
    [/knowledge|lore|language|知识|逸闻|语言|抄写|阅读/i,"magic"],
    [/charm|command|魅惑|命令|诅咒|意志|精神/i,"mind"],
    [/nature|druid|自然|德鲁伊/i,"nature"],
    [/turn-undead|divine|domain|驱散|领域|神圣|神恩/i,"ward"]
  ];
  for (const [pattern, key] of choices) if (pattern.test(label)) return key;
  if (item.type === "spell") return ({div:"vision", enc:"mind", ill:"sneak", nec:"rune", abj:"shield"})[item.system?.school] ?? "magic";
  return mark.category === "racial" || item.system?.featType === "racial" ? "ward" : "rune";
}

function iconKey(item) {
  const mark = item.flags?.[MODULE_ID] ?? {};
  return RULE_ICON_KEYS[mark.key] ?? RULE_ICON_KEYS[item.name] ?? legacyIconKey(item);
}

function replaceable(item) {
  const mark = item.flags?.[MODULE_ID];
  return Boolean(mark?.key && supported.has(item.type) &&
    (defaults.has(item.img ?? "") || (mark.iconRevision === 1 && item.img === path(legacyIconKey(item)))));
}

export function applySeedIcon(item) {
  if (replaceable(item)) {
    item.img = path(iconKey(item));
    item.flags[MODULE_ID].iconRevision = 2;
    item.flags[MODULE_ID].assignedIcon = item.img;
  }
  return item;
}

export function contentIconRepairs(item) {
  const mark = item.flags?.[MODULE_ID];
  if (!replaceable(item)) return {};
  const update = {
    img:path(iconKey(item)),
    [`flags.${MODULE_ID}.previousIcon`]:mark.previousIcon ?? item.img ?? "",
    [`flags.${MODULE_ID}.iconRevision`]:2,
    [`flags.${MODULE_ID}.assignedIcon`]:path(iconKey(item))
  };
  if (mark.iconRevision === 1) update[`flags.${MODULE_ID}.previousIconRevision1`] = item.img;
  return update;
}
