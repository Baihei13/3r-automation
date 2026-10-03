export const MODULE_ID = "samson-3r-automation";

// A separate world Item compendium is created for each actual rulebook source.
export const SOURCES = {
  pf: { label: "Pathfinder 核心规则", book: "Pathfinder RPG Core Rulebook" },
  pfu: { label: "Pathfinder Unchained", book: "Pathfinder Unchained" },
  arg: { label: "Advanced Race Guide", book: "Advanced Race Guide" },
  apg: { label: "Advanced Player's Guide", book: "Advanced Player's Guide" },
  um: { label: "Ultimate Magic", book: "Ultimate Magic" },
  uca: { label: "Ultimate Campaign", book: "Ultimate Campaign" },
  hhc: { label: "Heroes of the High Court", book: "Heroes of the High Court" },
  boc: { label: "Blood of the Coven", book: "Blood of the Coven" },
  iswg: { label: "Inner Sea World Guide", book: "Inner Sea World Guide" },
  tob: { label: "Tome of Battle", book: "Tome of Battle: The Book of Nine Swords" },
  cs: { label: "Complete Scoundrel", book: "Complete Scoundrel" },
  teog: { label: "Taldor, Echoes of Glory", book: "Taldor, Echoes of Glory" },
  bof: { label: "Blood of Fiends", book: "Blood of Fiends" },
  lotfw: { label: "Legacy of the First World", book: "Legacy of the First World" },
  ua: { label: "Unearthed Arcana", book: "Unearthed Arcana" },
  cw: { label: "完美战力", book: "Complete Warrior" },
  phb: { label: "3.5 玩家手册", book: "Player's Handbook v.3.5" },
  car: { label: "完美奥术", book: "Complete Arcane" },
  cd: { label: "完美神力", book: "Complete Divine" },
  cc: { label: "完美斗士", book: "Complete Champion" },
  sc: { label: "法术汇编", book: "Spell Compendium" },
  uw: { label: "Ultimate Wilderness", book: "Ultimate Wilderness" },
  bm: { label: "Black Markets", book: "Black Markets" },
  hots: { label: "Heroes of the Streets", book: "Heroes of the Streets" }
};

const feature = (name, source, description, extra = {}) => ({
  name, type: "feat", img: "icons/svg/book.svg",
  system: { featType: "classFeat", source: "",
    description: { value: `<p>${description}</p><p data-3r-rulebook><small>来源：${SOURCES[source].label}（${SOURCES[source].book}）</small></p>` }, ...extra },
  flags: { [MODULE_ID]: { key: name, source, rulebook: SOURCES[source].book } }
});

const feat = (name, source, description, extra = {}) => ({
  ...feature(name, source, description, extra),
  system: { ...feature(name, source, description, extra).system, featType: "feat" }
});

export const ITEMS = {
  pf: [
    { name: "PF 人类", type: "race", img: "icons/svg/mystery-man.svg", system: {
      source: SOURCES.pf.book, description: { value: "<p>自选一项属性 +2；1 级额外专长；每级额外 1 点技能点；中型，陆地速度 30 尺。</p>" },
      changes: [["2", "ability", "str", "racial"]], counterName: "feat.base;bonusSkillPoints"
    }, flags: { [MODULE_ID]: { key: "human-pf", source: "pf", abilityChoice: "str" } } }
  ],
  ua: [
    feature("修道牧师：学问", "ua", "按修道牧师等级 + 智力修正值作逸闻知识检定；知识（历史）至少 5 级再加 +2。不可取 10 或 20。"),
    feature("修道牧师：扩展法术列表", "ua", "在牧师法术表中加入传讯术（0环）；抹消术、鉴定术、隐形仆役（1环）；狐之狡黠（2环）；幻影文字、秘密书页、巧言术（3环）；侦测探知（4环）；解析魔法（6环）；隐匿术（7环）；异象术（9环）。"),
    feature("修道牧师：知识领域奖励", "ua", "除正常的两个领域外，额外获得知识领域及其神授力量和领域法术。")
  ],
  cw: [
    feature("计划领域", "cw", "神授力量：获得法术延时作为奖励专长。领域法术依次为死亡侦测、卜筮术、锐耳术／鹰眼术、状态术、侦测探知、英雄宴、高等探知、辨明位置、时间停止。")
  ],
  phb: [
    feat("法术延时", "phb", "施法时可选择将合格的非瞬发法术持续时间加倍；需要高一级法术位。"),
    feat("武器专攻：巨剑", "phb", "使用巨剑的攻击检定 +1；前提为基本攻击加值至少 +1 且擅长巨剑。", {
      requirements: [["基本攻击加值至少 +1", "1", "bab"]]
    }),
    feature("战争领域", "phb", "获得所信仰神祇偏好武器的擅长与武器专攻。领域法术依次为魔化武器、灵能武器、魔化防具、神能、焰击术、剑刃障壁、律令目盲、律令震慑、律令死亡。"),
    feature("驱散不死生物", "phb", "以一个标准动作驱散不死生物，不引发借机攻击。每日可使用3＋魅力修正值次；驱散检定为1d20＋魅力修正值，驱散伤害为2d6＋牧师等级＋魅力修正值。"),
    feature("自发转换治疗法术", "phb", "善良牧师，以及信仰善良神祇的中立牧师，可以放弃一个已准备的非领域法术，转而施放同环或更低环的治疗法术。其他中立牧师需固定选择驱散或呵斥；选择驱散者自发施放治疗法术，选择呵斥者自发施放造成伤害法术。")
  ],
  car: [feat("法术持久", "car", "合格的个人或固定射程法术持续 24 小时；通常提高 6 个法术等级。")],
  cd: [feat("神圣超魔：法术持久", "cd", "消耗 1 + 6 = 7 次驱散不死生物次数，使合格法术持久而不提高法术位。")],
  cc: [feat("知识虔诚", "cc", "知识（任意）至少 5 级时生效。每场战斗每类生物检定一次相应知识技能，按结果在攻击与伤害上得到 +1 至 +5 洞察加值；未达前提时保留专长但不生效。", {
    requirements: [["任意知识技能至少 5 级", "max(@skills.kar.rank, @skills.kdu.rank, @skills.ken.rank, @skills.kge.rank, @skills.khi.rank, @skills.klo.rank, @skills.kna.rank, @skills.kno.rank, @skills.kpl.rank, @skills.kre.rank, @skills.kps.rank) >= 5", "generic"]]
  })],
  sc: [
    { name: "石拳术药水", type: "consumable", img: "icons/svg/potion.svg", system: {
      source: SOURCES.sc.book, consumableType: "potion", quantity: 1,
      description: { value: "<p>一只手变得坚硬如石。在攻击、擒抱与击破物体时获得等效的＋6力量增强加值；可以进行造成1d6伤害的猛击。持续1分钟。</p>" }
    }, flags: { [MODULE_ID]: { key: "fist-of-stone-potion", source: "sc", legacyOnly:true } } }
  ]
};

export const DOMAIN_SPELLS = {
  planning: ["Deathwatch", "Augury", "Clairaudience/Clairvoyance", "Status", "Detect Scrying", "Heroes' Feast", "Greater Scrying", "Discern Location", "Time Stop"],
  war: ["Magic Weapon", "Spiritual Weapon", "Magic Vestment", "Divine Power", "Flame Strike", "Blade Barrier", "Power Word Blind", "Power Word Stun", "Power Word Kill"],
  cloistered: ["Message", "Erase", "Identify", "Unseen Servant", "Fox's Cunning", "Illusory Script", "Secret Page", "Tongues", "Detect Scrying", "Analyze Dweomer", "Sequester", "Vision"]
};

export const KNOWLEDGE_SKILLS = {
  aberration: "kdu", animal: "kna", construct: "kar", dragon: "kar", elemental: "kpl",
  fey: "kna", giant: "kna", humanoid: "klo", magicalBeast: "kar",
  monstrousHumanoid: "kna", ooze: "kdu", outsider: "kpl", plant: "kna",
  undead: "kre", vermin: "kna"
};

export const KNOWLEDGE_LABELS = {
  kar: "知识（神秘）", kdu: "知识（地城）", ken: "知识（工程）",
  kge: "知识（地理）", khi: "知识（历史）", klo: "知识（地方）",
  kna: "知识（自然）", kpl: "知识（位面）", kre: "知识（宗教）"
};

