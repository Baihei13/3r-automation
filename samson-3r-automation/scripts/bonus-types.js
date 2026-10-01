export const BONUS_TYPES={racial:"种族",luck:"幸运",deflection:"偏斜",resist:"抗力（反抗）",competence:"表现",morale:"士气",trait:"背景",circumstance:"环境",insight:"洞察",enh:"增强",untyped:"无名",penalty:"未注明类型的减值",armor:"盔甲",shield:"盾牌",naturalArmor:"天生防御",dodge:"闪避",size:"体型",sacred:"神圣",profane:"亵渎",inherent:"内在",alchemical:"炼金",base:"基础",replace:"替换","base-replace":"基础替换"};
const aliases={enhancement:"enh",resistance:"resist","natural armor":"naturalArmor",naturalarmor:"naturalArmor","natural-armor":"naturalArmor","size modifier":"size",natural:"naturalArmor"};
export const normalizeBonusType=type=>!String(type??"").trim()?"untyped":aliases[String(type).toLowerCase()]??type;

// Keep the legacy export, but descriptions contain rule text only.
// Types and stacking are calculation data, not a generated description appendix.
export function withBonusDetails(item,description=item.system?.description?.value??"") {
  return String(description).replace(/<section\b[^>]*\bdata-3r-bonuses\b[^>]*>[\s\S]*?<\/section>/gi,"");
}
