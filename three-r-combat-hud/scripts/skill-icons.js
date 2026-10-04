import { MODULE_ID } from "./state.js";
import { SKILL_ICON_KEYS } from "./skill-icon-map.js";

// Presentation only. Skill identifiers and native rollSkill calls stay intact.
export function skillIcon(id) {
  return `modules/${MODULE_ID}/assets/icons/${SKILL_ICON_KEYS[String(id).split(".")[0]] ?? "magic"}.png`;
}
