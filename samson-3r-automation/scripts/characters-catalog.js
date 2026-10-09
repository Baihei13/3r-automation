import { MODULE_ID, SOURCES } from "./catalog.js";

const entry = (key, name, type, source, category, description, system = {}) => ({
  name, type, img: "icons/svg/book.svg",
  system: { source: type === "feat" ? "" : SOURCES[source].book,
    description: { value: `<p>${description}</p><p data-3r-rulebook><small>来源：${SOURCES[source].label}（${SOURCES[source].book}）</small></p>` }, ...system },
  flags: { [MODULE_ID]: { key, source, category, rulebook: SOURCES[source].book } }
});
const feat = (key, name, source, category, description, system = {}) =>
  entry(key, name, "feat", source, category, description,
    { featType: category === "feat" || category === "trait" ? category : "classFeat", ...system });
const race = (key, name, source, description, changes, extra = {}) =>
  entry(key, name, "race", source, "race", description, { changes, ...extra });
const row = (level, slots) => [String(level), ...slots.map(String)];
const progression = lines => lines.trim().split("\n").map((line, index) =>
  row(index + 1, [...line.trim().split(/\s+/).map(Number), ...Array(10).fill(-1)].slice(0, 10)));
const WITCH_SLOTS = progression(`3 1
4 2
4 2 1
4 3 2
4 3 2 1
4 3 3 2
4 4 3 2 1
4 4 3 3 2
4 4 4 3 2 1
4 4 4 3 3 2
4 4 4 4 3 2 1
4 4 4 4 3 3 2
4 4 4 4 4 3 2 1
4 4 4 4 4 3 3 2
4 4 4 4 4 4 3 2 1
4 4 4 4 4 4 3 3 2
4 4 4 4 4 4 4 3 2 1
4 4 4 4 4 4 4 3 3 2
4 4 4 4 4 4 4 4 3 3
4 4 4 4 4 4 4 4 4 4`).map(([level, ...slots]) =>
  [level, ...slots.map(value => String(Number(value) < 0 ? -1 : Number(value) - 1))]);
const ORACLE_SLOTS = progression(`4 3
5 4
5 5
6 6 3
6 6 4
7 6 5 3
7 6 6 4
8 6 6 5 3
8 6 6 6 4
9 6 6 6 5 3
9 6 6 6 6 4
9 6 6 6 6 5 3
9 6 6 6 6 6 4
9 6 6 6 6 6 5 3
9 6 6 6 6 6 6 4
9 6 6 6 6 6 6 5 3
9 6 6 6 6 6 6 6 4
9 6 6 6 6 6 6 6 5 3
9 6 6 6 6 6 6 6 6 4
9 6 6 6 6 6 6 6 6 6`);
const ORACLE_KNOWN = progression(`4 2
5 2
5 3
6 3 1
6 4 2
7 4 2 1
7 5 3 2
8 5 3 2 1
8 5 4 3 2
9 5 4 3 2 1
9 5 5 4 3 2
9 5 5 4 3 2 1
9 5 5 4 4 3 2
9 5 5 4 4 3 2 1
9 5 5 4 4 4 3 2
9 5 5 4 4 4 3 2 1
9 5 5 4 4 4 3 3 2
9 5 5 4 4 4 3 3 2 1
9 5 5 4 4 4 3 3 3 2
9 5 5 4 4 4 3 3 3 3`);
const klass = (key, name, source, description, data) =>
  entry(key, name, "class", source, "class", description, {
    levels: 1, maxLevel: 20, automaticFeatures: false, ...data
  });

export const CHARACTER_ITEMS = {
  pf: [
    race("human-dex", "PF 人类（敏捷 +2）", "pf", "人类，自选敏捷 +2；1 级额外专长与每级额外技能点。", [["2", "ability", "dex", "racial"]], { counterName: "feat.base;bonusSkillPoints" }),
    race("human-cha", "PF 人类（魅力 +2）", "pf", "人类，自选魅力 +2；1 级额外专长与每级额外技能点。", [["2", "ability", "cha", "racial"]], { counterName: "feat.base;bonusSkillPoints" }),
    feat("two-weapon-fighting", "双武器攻击", "pf", "feat", "敏捷至少 15；使用两把轻型武器时，主手与副手攻击通常各受 -2 减值。"),
    entry("leather", "皮甲", "equipment", "pf", "equipment", "轻甲，护甲加值 +2。", { equipmentType: "armor", equipmentSubtype: "lightArmor", equipped: true, armor: { value: 2, dex: 6, acp: 0 }, spellFailure: 10 }),
    entry("banded-mail", "混织铁甲", "equipment", "pf", "equipment", "重甲，护甲加值 +7，敏捷上限 +1，防具检定减值 -6。", {
      equipmentType: "armor", equipmentSubtype: "heavyArmor", equipped: true,
      armor: { value: 7, dex: 1, acp: -6 }, spellFailure: 35
    }),
    entry("tanglefoot", "绊足包", "consumable", "pf", "consumable", "远程接触攻击命中后按 PF 规则造成纠缠；由 GM 判定目标、豁免及后续效果。", { quantity: 1 }),
    entry("masterwork-tools", "精制小偷工具", "equipment", "pf", "equipment", "用于解除装置与开锁时 +2 环境加值。", {
      quantity: 1, equipped: true, changes: [["2", "skill", "skill.dev", "circumstance"], ["2", "skill", "skill.opl", "circumstance"]]
    }),
    entry("adventurer-kit", "冒险者工具包", "equipment", "pf", "item", "背包、铺盖、腰包、蜡烛、打火石、铁锅、餐具、绳、肥皂、火把、五天口粮和水袋。", { quantity: 1 })
  ],
  pfu: [
    klass("unchained-rogue", "游荡者（Pathfinder Unchained）", "pfu",
      "1 级：偷袭 +1d6、寻找陷阱 +1、巧技训练授予武器娴熟。", {
        customTag: "unchainedRogue", hd: 8, hp: 8, bab: "med", skillsPerLevel: 8,
        savingThrows: { fort: { value: "low" }, ref: { value: "high" }, will: { value: "low" } },
        sneakAttackGroup: "unchainedRogue", sneakAttackFormula: "ceil(@level/2)"
      }),
    feat("finesse-training", "巧技训练", "pfu", "feature", "1 级获得武器娴熟；3 级起才能选择一种武器用敏捷取代力量加到伤害。"),
    feat("weapon-finesse", "武器娴熟", "pfu", "feat", "持轻型武器时，近战攻击可用敏捷修正取代力量修正。"),
    feat("sneak-attack", "偷袭 +1d6", "pfu", "feature", "目标失去 AC 的敏捷加值或被夹击时，命中额外造成 1d6 精准伤害；远程需在 30 尺内。重击不翻倍。"),
    feat("trapfinding", "寻找陷阱 +1", "pfu", "feature", "1 级对定位陷阱的察觉和解除装置 +1，并可解除魔法陷阱。")
  ],
  tob: [feat("shadow-blade", "影之刃", "tob", "feat", "须掌握并正在使用一种影手派步法，且使用影手派武器时才可将敏捷修正加入近战伤害。未掌握并使用步法时无效。")],
  cs: [entry("sleeve-blade", "袖剑", "weapon", "cs", "weapon", "视作匕首，出击前须将其从袖中弹出。", {
    quantity: 1, proficient: true, equipped: true, weaponType: "simple", weaponSubtype: "light",
    baseWeaponType: "dagger", properties: { fin: true },
    weaponData: { damageRoll: "1d4", damageType: "Piercing", critRange: "19", critMult: 2, size: "med" }
  })],
  arg: [
    race("samsaran", "轮回者", "arg", "智力 +2、感知 +2、体质 -2；昏暗视觉、生命之缚、轮回者魔法、前世秘术。",
      [["2", "ability", "int", "racial"], ["2", "ability", "wis", "racial"], ["-2", "ability", "con", "racial"]],
      { senses: { lowLight: true,lowLightMultiplier:2 } }),
    feat("lifebound", "生命之缚", "arg", "feature", "对即死、负能量、移除负向等级的豁免以及负生命值下的稳定检定 +2 种族加值；只在对应情形适用。"),
    feat("samsaran-magic", "轮回者魔法", "arg", "feature", "魅力至少 11 时，通晓语言、观命术、稳定伤势各每日 1 次。"),
    feat("mystic-past-life", "前世秘术", "arg", "feature", "将另一施法职业的法术加入当前施法职业的法术表，数量等于1＋施法关键属性修正值，在1级时固定。来源法术必须同为奥术或同为神术，可以选择尚不能施放的高环法术。取代前世残片。")
  ],
  apg: [
    entry("bec-de-corbin", "鸦嘴战锤（黑曜石）", "weapon", "apg", "weapon", "黑曜石通常不允许制作这种双手武器，使用这个材质特例前须由DM明确允许。黑曜石使价格为普通武器的一半、重量为75%、硬度为一半，具有易碎特性。黑曜石通常限于造成挥砍或穿刺伤害的轻型、单手武器及矛尖、箭头，不能制作护甲；材料魔法强化后移除易碎，可制作石头允许的装备。材料强化另需每磅100金币，与魔化武器的临时增强加值分开。易碎：攻击天然骰出1时破损，已破损时再次出1则摧毁；精制品和普通魔法附魔不会自行移除易碎。破损损失最大HP的一半（向下取整）加1；解除破损仅恢复这部分损失，不恢复破武等其他伤害。破损时攻击与伤害−2，重击为20／×2。武器来源：《进阶玩家手册》；材质与易碎来源：《终极装备》。", {
      quantity: 1, equipped: true, proficient: true, weaponType: "martial", weaponSubtype: "2h",
      hardness:2,
      weaponData: { damageRoll: "1d10", damageType: "Bludgeoning and Piercing", critRange: "20", critMult: 3, size: "med" }
    }),
    klass("witch", "女巫", "apg", "奥术准备施法，以智力施法。守望女巫的每日法术数另减 1。", {
      customTag: "witch", hd: 6, hp: 6, bab: "low", skillsPerLevel: 2,
      savingThrows: { fort: { value: "low" }, ref: { value: "low" }, will: { value: "high" } },
      spellcastingType: "arcane", spellcastingSpontaneus: false, hasSpellbook: true,
      spellcastingAbility: "int", spellslotAbility: "int", spellsPerLevel: WITCH_SLOTS
    }),
    feat("extra-hex", "额外巫术", "apg", "feat", "额外获得一项符合前提的女巫巫术。"),
    feat("ward", "守护", "apg", "hex", "给另一生物 +2 偏斜 AC 与 +2 抗力豁免；首次被命中或豁免失败时消失，同时只能有一个目标；不能对自身使用。"),
    feat("cackle", "尖笑", "apg", "hex", "移动动作，令 30 尺内符合条件的既有巫术效果延长 1 轮；幸庇按其特殊说明也可延长。"),
    klass("oracle", "先知", "apg", "自发神术施法，以魅力施法。双重诅咒改变职业能力。", {
      customTag: "oracle", hd: 8, hp: 8, bab: "med", skillsPerLevel: 4,
      savingThrows: { fort: { value: "low" }, ref: { value: "low" }, will: { value: "high" } },
      spellcastingType: "divine", spellcastingSpontaneus: true, hasSpellbook: true,
      spellcastingAbility: "cha", spellslotAbility: "cha", spellsPerLevel: ORACLE_SLOTS,
      spellsKnownPerLevel: ORACLE_KNOWN
    }),
    feat("additional-traits", "额外背景", "apg", "feat", "额外选择两个来自不同背景列表的特性，具体特性由玩家选择。"),
    feat("reactionary", "反制者", "apg", "trait", "先攻 +2 背景加值。", { changes: [["2", "misc", "init", "trait"]] }),
    feat("battle-mystery", "战斗秘示域", "apg", "mystery", "可选择的战斗秘示域；启示由玩家按等级选择，奖励法术按秘示域等级获得。"),
    feat("skill-at-arms", "军械精通", "apg", "revelation", "擅长所有军用武器、中甲及重甲。")
  ],
  hhc: [
    feat("witch-watcher", "守望女巫", "hhc", "feature", "每个已解锁法术环级的基础每日施法数减 1；每天准备法术时指定守望对象并获得守望誓约。"),
    feat("protective-luck", "幸庇", "hhc", "hex", "给 30 尺内另一生物持续 1 轮的保护：以攻击检定为目标时，攻击者掷两次取较差结果；不可对自己使用。"),
    feat("covenant-ally", "守望誓约", "hhc", "feature", "准备法术时选定一名守望对象。1 级每天共享 1 次使用机会；在 30 尺内可选择健康、防护、慰藉或抗法。")
  ],
  boc: [feat("celestial-agenda", "神圣之路庇护主", "boc", "patron", "善良阵营；授予守护巫术。欺骗或威胁他人的技能检定 -2。4、10、16 级替换庇护主奖励法术。", {
    changes: [["-2", "skill", "skill.blf", "penalty"], ["-2", "skill", "skill.int", "penalty"],
      ["-2", "skill", "skill.slt", "penalty"]]
  })],
  um: [
    feat("dual-cursed-oracle", "双重诅咒先知", "um", "archetype", "先知职业变体；选择两个诅咒，其中一个不随等级提升。"),
    feat("misfortune", "厄运", "um", "revelation", "1 级：直觉动作，在结果宣布前使 30 尺内目标重掷一个已掷出的 d20，必须接受新结果；同一目标每日仅一次。")
  ],
  bof: [feat("legalistic", "守律诅咒", "bof", "curse", "违背承诺时恶心 24 小时或直到履约；每日一次，履约时对自己的一次检定 +4 士气。")],
  lotfw: [feat("reclusive", "隐居诅咒", "lotfw", "curse", "战斗中盟友的接触法术仍需近战接触攻击，且须对盟友法术豁免；自己施放在自己身上的瞬间法术施法者等级 +1。")],
  iswg: [feat("noble-scion", "贵族后裔：战争之子", "iswg", "feat", "魅力至少 13 且 1 级选取；知识（贵族）+2 并为本职技能；以魅力而非敏捷修正先攻。", {
    requirements: [["魅力至少 13", "@abilities.cha.total >= 13", "generic"]],
    changes: [["(@abilities.cha.total >= 13 ? @abilities.cha.mod - @abilities.dex.mod : 0)", "misc", "init", "untyped"],
      ["(@abilities.cha.total >= 13 ? 2 : 0)", "skill", "skill.kno", "untyped"]]
  })],
  uca: [feat("fates-favored", "天佑者", "uca", "trait", "享受幸运加值时，该加值增加 1。")],
  teog: [entry("enhanced-diplomacy", "增强交涉", "spell", "teog", "spell", "0环祷念，在一次交涉或威吓检定上提供+2表现加值。", { level: 0, spellbook: "primary" })]
};

