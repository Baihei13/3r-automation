import { MODULE_ID } from "./catalog.js";

// The timeline may change the deadline. It takes precedence over the original cast.
export function effectDeadline(item) {
  const timeline=item.getFlag?.("d35e-world-timeline","timer")?.end;
  const original=item.getFlag?.(MODULE_ID,"expiresAt");
  return Number.isFinite(timeline)?timeline:Number.isFinite(original)?original:null;
}
export function effectIsActive(item,now=game.time.worldTime) {
  if(!["buff","aura"].includes(item.type))return true;
  const end=effectDeadline(item);
  return Boolean(item.system.active)&&(end===null||end>now);
}
