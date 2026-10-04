import { MODULE_ID, SOURCES } from "./catalog.js";

// Reusable rule entries. Character selections live in current-card-sync.js.
const spell=(id,name,source,level,school,body,extra={})=>({
  name,type:"spell",img:"icons/svg/book.svg",
  system:{source:SOURCES[source].book,level,school,spellbook:"primary",actionType:"other",
    activation:{type:"standard",cost:1},components:{verbal:true,somatic:true},range:{units:"touch"},
    spellTarget:"一个生物",target:{value:"一个生物"},spellDurationData:{units:"minute",value:"@cl"},
    save:{type:"",dc:"0"},sr:false,description:{value:body},shortDescription:body,...extra},
  flags:{[MODULE_ID]:{key:`card-spell-${id}`,source,category:"spell",rulebook:SOURCES[source].book,
    currentCardSpell:id,contentRevision:4,cardRulesRevision:1}}
});
export const CARD_SPELLS=[
  spell("guidance","神导术","pf",0,"div","<p>目标在一次攻击检定、豁免或技能检定中获得＋1表现加值。在掷骰前决定使用；持续1分钟，或使用一次后结束。意志成功无效（无害），允许法术抗力（无害）。</p>",{
    learnedAt:{class:[["Cleric",0],["Druid",0],["Witch",0]]},spellDurationData:{units:"minute",value:"1"},save:{type:"willnegates",dc:"0",description:"无害"},sr:true}),
  spell("detect-poison","侦测毒性","pf",0,"div","<p>判断一个生物、物体或5尺立方区域是否有毒。辨别毒素种类需要DC20感知检定或DC20工艺（炼金）检定。可穿透障碍，但1尺石头、1寸普通金属、薄铅板或3尺木头／泥土会阻挡此法术。</p>",{
    learnedAt:{class:[["Cleric",0],["Druid",0],["Paladin",1],["Ranger",1],["Sorcerer",0],["Wizard",0],["Witch",0]]},range:{units:"close"},spellTarget:"一个生物、物体或5尺立方区域",spellDurationData:{units:"inst",value:""}}),
  spell("mage-armor","法师护甲","pf",1,"con","<p>一层看不见的力场包围目标，给予＋4盔甲加值。没有防具检定减值、奥术施法失败率或速度减损。力场护甲能够抵御虚体生物的攻击。持续每施法者等级1小时，可解消。意志成功无效（无害），不受法术抗力影响。器材：一块鞣制皮革。</p>",{
    subschool:"creation",learnedAt:{class:[["Sorcerer",1],["Wizard",1],["Witch",1]]},components:{verbal:true,somatic:true,focus:true,focusDescription:"一块鞣制皮革"},spellDurationData:{units:"hour",value:"@cl"},save:{type:"willnegates",dc:"0",description:"无害"}}),
  spell("enlarge-person","变巨术","pf",1,"trs","<p>目标类人生物及其装备增大一个体型等级，身高加倍、重量变为8倍。获得＋2力量体型加值、−2敏捷减值，并按新体型调整攻击、AC、触及和武器伤害。中型生物变为大型时占据10尺、触及10尺；速度不变。离开目标的装备恢复正常大小，不与其他增大体型的效果叠加。空间不足时可作力量检定挣破限制，否则只增长到可容纳的大小。持续每等级1分钟，可解消；强韧成功无效，允许法术抗力。材料：一小撮铁粉。</p>",{
    learnedAt:{class:[["Sorcerer",1],["Wizard",1],["Witch",1]]},activation:{type:"round",cost:1},range:{units:"close"},spellTarget:"一个类人生物",save:{type:"fortitudenegates",dc:"0"},sr:true,components:{verbal:true,somatic:true,material:true,materialDescription:"一小撮铁粉"}}),
  spell("command","命令术","pf",1,"enc","<p>向一个能理解你的活物发出一个词的命令，持续1轮。可以选择靠近（尽可能接近你）、丢下（放下手中物品）、倒下（俯卧）、逃跑（尽可能远离你）或停住（不作动作）。靠近和逃跑会正常引发借机攻击；倒下的目标可作其他动作，但不能起身。意志成功无效，允许法术抗力；这是胁迫、依赖语言、影响心灵效果。</p>",{
    subschool:"compulsion",learnedAt:{class:[["Cleric",1],["Witch",1]]},components:{verbal:true},range:{units:"close"},save:{type:"willnegates",dc:"0"},sr:true,spellDurationData:{units:"round",value:"1"}}),
  spell("ray-of-sickening","恶心射线","um",1,"nec","<p>以一道射线进行远程接触攻击。命中且强韧豁免失败的目标陷入恶心状态：攻击、武器伤害、豁免、技能及属性检定−2。豁免成功则无效。持续每施法者等级1分钟，允许法术抗力。材料：一滴汗液。</p>",{
    learnedAt:{class:[["Cleric",1],["Druid",1],["Sorcerer",1],["Wizard",1],["Summoner",1],["Witch",1]]},actionType:"rsak",ability:{attack:"dex",vsTouchAc:true,critRange:20,critMult:2},range:{units:"close"},save:{type:"fortitudenegates",dc:"0"},sr:true,components:{verbal:true,somatic:true,material:true,materialDescription:"一滴汗液"}}),
  spell("pesh-vigor","仙人掌萃的活力","bm",1,"trs","<p>被接触的活物获得＋2力量增强加值，持续每等级1轮。每轮一次，可用自由动作让增强加值再提高2点，持续1轮；每提高2点承受1d6非致命伤害，并额外减少1轮法术持续时间。每5施法者等级可额外提高2点，15级时最多＋10、4d6非致命伤害。不能耗用超过剩余时长的轮数。法术结束后目标疲乏。意志成功无效，允许法术抗力。材料：价值15金币的一剂仙人掌萃。</p>",{
    learnedAt:{class:[["Alchemist",1],["Antipaladin",1],["Arcanist",1],["Bloodrager",1],["Cleric",1],["Druid",1],["Magus",1],["Shaman",1],["Sorcerer",1],["Wizard",1],["Summoner",1]]},spellDurationData:{units:"round",value:"@cl"},save:{type:"willnegates",dc:"0"},sr:true,components:{verbal:true,somatic:true,material:true,materialDescription:"价值15金币的一剂仙人掌萃"}}),
  spell("charm-person","魅惑人类","pf",1,"enc","<p>令一个类人生物把你视为可信赖的朋友，其态度变为友善。若你或盟友正在威胁或攻击它，目标的豁免获得＋5。不会把目标变成傀儡；要求它做通常不愿做的事，需要成功赢得魅力对抗，同一个要求不能重试。不会服从自杀或明显伤害自己的命令。你或盟友威胁目标的行为会解除魅惑。持续每等级1小时；意志成功无效，允许法术抗力。这是魅惑、影响心灵效果。</p>",{
    subschool:"charm",learnedAt:{class:[["Bard",1],["Sorcerer",1],["Wizard",1],["Witch",1]]},range:{units:"close"},spellTarget:"一个类人生物",spellDurationData:{units:"hour",value:"@cl"},save:{type:"willnegates",dc:"0"},sr:true}),
  spell("comprehend-languages","通晓语言","phb",1,"div","<p>理解所听到的口语和所读到的文字。必须接触说话者或文字；理解文字只限字面含义，每分钟可阅读一页。不会授予说话或书写该语言的能力，也不能解读密码、隐藏含义或魔法文字。可以识别魔法文字，但不能阅读其法术内容。持续每等级10分钟。材料：一撮煤灰和盐。</p>",{
    learnedAt:{class:[["Bard",1],["Cleric",1],["Sorcerer",1],["Wizard",1],["Witch",1]]},range:{units:"personal"},spellTarget:"自身",spellDurationData:{units:"minute",value:"10*@cl"},components:{verbal:true,somatic:true,material:true,divineFocus:1,materialDescription:"一撮煤灰和盐"}}),
  spell("ears-of-the-city","聆听城市","hots",1,"div","<p>目标感知城市居民过去和现在的片段言语与景象。每轮可以作一次收集信息检定，等同花费1d4小时询问当地居民；也可以用侦察或聆听代替收集信息。专注收集信息期间视为目盲和耳聋。短促片段不能直接辨认某人在某个地点的具体行为。持续每等级1轮；意志成功无效（无害），允许法术抗力（无害）。材料或法器：一小块砖头。</p>",{
    learnedAt:{class:[["Bard",1],["Cleric",1],["Inquisitor",1],["Shaman",1],["Sorcerer",1],["Wizard",1],["Witch",1]]},spellDurationData:{units:"round",value:"@cl"},save:{type:"willnegates",dc:"0",description:"无害"},sr:true,components:{verbal:true,somatic:true,material:true,divineFocus:1,materialDescription:"一小块砖头"}}),
  spell("amanuensis","抄写术","sc",0,"trs","<p>将普通文字抄录到备好的空白纸页、书本或羊皮纸上，每分钟250词。不会复制插图或魔法文字，但会触发原件上的文字魔法陷阱；混有魔法文字或插图的位置留白。不会翻译，也不会令你理解原件。空白纸页不足时暂停；法术持续期间可以改换原件、抄录位置或补足空白纸页继续。近距，持续每等级10分钟；意志成功无效（物体），允许法术抗力（物体）。</p>",{
    learnedAt:{class:[["Cleric",0],["Sorcerer",0],["Wizard",0]]},range:{units:"close"},spellTarget:"有文字的物体",save:{type:"willnegates",dc:"0",description:"物体"},sr:true,spellDurationData:{units:"minute",value:"10*@cl"}})
];

export const CARD_GEAR=[
  ["parchment","羊皮纸",0.2,0,"用于书写的一张羊皮纸。"],
  ["rope-hempen","麻绳（50尺）",1,10,"一卷50尺长的麻绳。HP2，挣断DC23。"],
  ["backpack","背包",2,2,"用于携带物品的背包。"]
].map(([id,name,price,weight,body])=>({name,type:"loot",img:"icons/svg/item-bag.svg",
  system:{source:SOURCES.phb.book,quantity:1,price,weight,carried:true,description:{value:`<p>${body}</p>`}},
  flags:{[MODULE_ID]:{key:`card-gear-${id}`,source:"phb",category:"item",contentRevision:4}}}));

export const WING_FAMILIAR={name:"喙嘴翼龙魔宠",type:"feat",img:"icons/svg/wing.svg",
  system:{featType:"classFeat",source:"",description:{value:"<p>喙嘴翼龙是一种超小型魔宠，有昏暗视觉与灵敏嗅觉，陆地速度10尺、飞行速度40尺（一般）。主人获得＋4先攻加值。魔宠在1英里范围内时，主人获得魔宠所授予的特殊加值。飞行冲锋进入敌人空间不因进入空间引发借机攻击，且该次啮咬伤害＋2。</p>"},
    activation:{type:"special",cost:0},changes:[["4*@rhamphorhynchusNearby","misc","init","untyped"]]},
  flags:{[MODULE_ID]:{key:"rhamphorhynchus-familiar",source:"uw",category:"feature",contentRevision:4}}
};

