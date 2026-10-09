import { MODULE_ID } from "./catalog.js";
import { registerSeeds } from "./content.js";

export let CLERIC_SPELLS=[];
export async function loadClericContent() {
  const response=await fetch(`modules/${MODULE_ID}/data/cleric-spells-3r.json`);
  if(!response.ok)throw new Error("无法读取3R牧师法术正文。");
  CLERIC_SPELLS=await response.json();
  registerSeeds(CLERIC_SPELLS);
}
