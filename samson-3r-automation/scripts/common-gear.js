// Generic native equipment. No character grant or currency change.
export const COMMON_GEAR = [
{
  "name": "法术材料包",
  "type": "loot",
  "img": "modules/samson-3r-automation/assets/icons/spell-component-pouch.png",
  "system": {
    "source": "Player's Handbook v.3.5",
    "uniqueId": "spell-component-pouch",
    "subType": "misc",
    "quantity": 1,
    "price": 5,
    "weight": 2,
    "carried": true,
    "identified": true,
    "description": {
      "value": "<p><strong>法术材料包（Spell Component Pouch）</strong></p><p>价格：5金币；重量：2磅。</p><p>一个小型皮制防水腰包，里面备有许多施法需要的材料。施法者可以找到施法所需的器材与材料，但不包括法术说明中订有特别价格的器材与材料、施展神术所需的法器，以及放不进此袋子的器材，例如德鲁伊施展探知时需要的天然水池。</p><p data-3r-rulebook><small>来源：3.5玩家手册（Player's Handbook v.3.5），装备／商品。</small></p>"
    }
  },
  "flags": {
    "samson-3r-automation": {
      "key": "spell-component-pouch",
      "source": "phb",
      "category": "item",
      "rulebook": "Player's Handbook v.3.5",
      "commonGear": true,
      "contentRevision": 1,
      "originalRule": "Spell Component Pouch",
      "ruleLocator": {
        "bookId": "dmg-3r-0.76",
        "internalPath": "6装备（Equipment）/商品（Goods）.htm",
        "section": "法术材料包（Spell Component Pouch）"
      }
    }
  },
  "effects": []
},
{
  name: "圣徽（木制）",
  type: "loot",
  img: "icons/svg/book.svg",
  system: {
    source: "Player's Handbook v.3.5", uniqueId: "holy-symbol", subType: "misc",
    quantity: 1, price: 1, weight: 0, carried: true, identified: true,
    description: {value: "<p><strong>圣徽（Holy Symbol，木制）</strong></p><p>价格：1金币；重量：不计。</p><p>圣徽用于聚集正能量，是牧师或圣武士施法与驱散不死生物的法器。各宗教使用特定样式；没有特定信仰的牧师通常使用太阳徽记。银制圣徽与木制圣徽的功效相同，只是地位不同。</p><hr><p><strong>使用：神圣超魔·法术持久</strong></p><p>在角色库存点击此物品图标，或在HUD“物品”中使用，选择符合条件的神术并沿原生施法窗口施放。自动读取角色的法术延时、法术持久、神圣超魔专长与驱散／斥喝能力；消耗7次驱散／斥喝及原法术次数，持续24小时。取消而未施法不消耗。圣徽可重复使用，不消耗物品数量；圣徽本身不授予专长、每日次数或魔法效果。</p><p data-3r-rulebook><small>物品来源：3.5玩家手册，装备／商品／圣徽。使用入口依据：完美神力·神圣超魔；完美奥术·法术持久。</small></p>"}
  },
  flags: {"samson-3r-automation": {
    key: "holy-symbol", source: "phb", category: "item", rulebook: "Player's Handbook v.3.5",
    commonGear: true, contentRevision: 1, originalRule: "Holy Symbol (Wooden)",
    ruleLocator: {bookId: "dmg-3r-0.76", internalPath: "6装备（Equipment）/商品（Goods）.htm", section: "圣徽（Holy Symbols）"}
  }},
  effects: []
}
];
