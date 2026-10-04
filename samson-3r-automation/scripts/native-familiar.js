// Resolve the actual native class, including localized or suffixed names.
// Never substitute an arbitrary minion, animal companion or descriptive feat.
const recognizable = value => /familiar|魔宠/i.test(String(value ?? "").normalize("NFKC"));
const validGroup = group => typeof group === "string" && group.trim() && group.toLowerCase() !== "none";
const eligible = item => item?.type === "class" && item.system?.classType === "minion" && validGroup(item.system.minionGroup)
  && (recognizable(item.name) || recognizable(item.system.minionGroup));

export async function findNativeFamiliarClass() {
  // D35E 3.1.0 declares minion-classes separately from ordinary classes.
  // Check the native location first; the old location is only a legacy fallback.
  const collections = ["D35E.minion-classes", "D35E.classes"];
  let readable = 0, invalid = false;
  for (const collection of collections) {
    const pack = game.packs.get(collection);
    if (!pack?.visible || !pack.testUserPermission(game.user, "OBSERVER")) continue;
    readable++;
    const index = await pack.getIndex({ fields: ["type", "system.classType", "system.minionGroup"] });
    const candidates = index.filter(row => row.type === "class" && (recognizable(row.name) || recognizable(row.system?.minionGroup)));
    const documents = [];
    for (const row of candidates) {
      const item = await pack.getDocument(row._id);
      if (eligible(item)) documents.push(item);
    }
    if (documents.length === 1) return documents[0];
    if (documents.length > 1) throw new Error(`${pack.title}里有多个魔宠职业（${documents.map(item => item.name).join("、")}），未自动选择。请先检查重复条目。`);
    invalid ||= candidates.length > 0;
  }
  if (!readable) throw new Error("无法读取D35E随从职业合集。请检查D35E.minion-classes是否存在及当前GM的访问权限。");
  if (invalid) throw new Error("已找到魔宠同名条目，但它不是有效的随从职业：职业类型应为minion，随从分组不能为none。请导出该原生职业条目以便核对。");
  throw new Error("D35E随从职业合集里没有可确认的魔宠职业。请检查Minion Classes（D35E.minion-classes）中的Familiar职业。未创建魔宠，也未改动主人数据。");
}
