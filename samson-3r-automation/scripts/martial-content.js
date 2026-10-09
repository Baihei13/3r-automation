import { MODULE_ID } from "./catalog.js";
import { registerSeeds } from "./content.js";
export let MARTIAL_ITEMS=[],SWORDSAGE=null,SWORDSAGE_FEATURES=[];
export async function loadMartialContent() {
  const [moves,klass,features]=await Promise.all([fetch(`modules/${MODULE_ID}/data/martial-swordsage.json`),fetch(`modules/${MODULE_ID}/data/martial-class.json`),fetch(`modules/${MODULE_ID}/data/martial-class-features.json`)]);
  if(!moves.ok||!klass.ok||!features.ok)throw new Error("无法读取贤者之剑完整资料。");
  MARTIAL_ITEMS=await moves.json();SWORDSAGE=await klass.json();SWORDSAGE_FEATURES=await features.json();
  registerSeeds([SWORDSAGE,...SWORDSAGE_FEATURES,...MARTIAL_ITEMS]);
}
export async function installMartialLibrary(pack,ensureItems) {
  await ensureItems(pack,[SWORDSAGE,...SWORDSAGE_FEATURES,...MARTIAL_ITEMS]);
}
