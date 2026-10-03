export const MODULE_ID = "three-r-combat-hud";
export const ACTIONS = [
  { id: "standard", name: "标准", icon: "fa-sword" },
  { id: "move", name: "移动", icon: "fa-person-walking" },
  { id: "swift", name: "迅捷", icon: "fa-bolt" },
  { id: "immediate", name: "即时", icon: "fa-clock" },
  { id: "full", name: "全回合", icon: "fa-hourglass-half" },
  { id: "free", name: "自由", icon: "fa-feather" },
  { id: "aao", name: "借机", icon: "fa-crosshairs" },
  { id: "step", name: "5尺快步", icon: "fa-shoe-prints" }
];

// Client-local UI preferences and reminders only. Never written to actors or combatants.
export class HudStore {
  constructor() {
    this.key = `${MODULE_ID}:${game.world.id}:${game.user.id}:v1`;
    this.data = { layouts: {}, ledgers: {}, collapsed: false };
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? "null");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const key of ["layouts", "ledgers"]) {
          if (saved[key] && typeof saved[key] === "object" && !Array.isArray(saved[key])) this.data[key] = saved[key];
        }
        this.data.collapsed = Boolean(saved.collapsed);
        for (const key of ["frame", "commandFrameV2"]) {
          const frame = saved[key];
          if (frame && ["x", "y", "width", "height"].every(key => Number.isFinite(frame[key]))) {
            this.data[key] = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
          }
        }
      }
    } catch (error) { console.warn(`${MODULE_ID}: preferences could not be read`, error); }
    this.storageWarning = false;
  }

  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); }
    catch (error) {
      console.warn(`${MODULE_ID}: preferences could not be saved`, error);
      if (!this.storageWarning) ui.notifications.warn("HUD布局暂时无法保存，本次仍可使用。");
      this.storageWarning = true;
    }
  }

  layout(actor) {
    const layout = this.data.layouts[actor.uuid] ??= { favorites: [], order: [] };
    if (!Array.isArray(layout.favorites)) layout.favorites = [];
    if (!Array.isArray(layout.order)) layout.order = [];
    return layout;
  }

  favorite(actor, id) {
    const layout = this.layout(actor);
    layout.favorites = layout.favorites.includes(id) ? layout.favorites.filter(key => key !== id) : [...layout.favorites, id];
    this.save();
  }

  reorder(actor, from, to, visibleIds) {
    if (from === to) return;
    const layout = this.layout(actor);
    const order = [...new Set([...layout.order, ...visibleIds])];
    const start = order.indexOf(from);
    const end = order.indexOf(to);
    if (start < 0 || end < 0) return;
    order.splice(start, 1);
    order.splice(order.indexOf(to), 0, from);
    layout.order = order;
    this.save();
  }

  context(actor, token = null) {
    const combat = game.combat?.started ? game.combat : null;
    const combatant = combat?.combatants.find(entry => token ? entry.tokenId === token.id : entry.actor?.uuid === actor.uuid);
    return {
      key: `${token?.document.uuid ?? actor.uuid}|${combat?.id ?? "outside"}|${combat?.round ?? 0}`,
      combatId: combat?.id ?? null,
      round: combat?.round ?? 0,
      offTurn: Boolean(combatant && combat.current?.combatantId !== combatant.id)
    };
  }

  ledger(context) {
    let entries = this.data.ledgers[context.key];
    if (!Array.isArray(entries)) entries = this.data.ledgers[context.key] = [];
    if (entries.some(entry => !entry || !ACTIONS.some(action => action.id === entry.kind))) {
      entries = this.data.ledgers[context.key] = entries.filter(entry => entry && ACTIONS.some(action => action.id === entry.kind));
    }
    return entries;
  }

  record(context, kind, label, automatic = false, delta = 1) {
    if (!ACTIONS.some(action => action.id === kind)) return;
    const entries = this.ledger(context);
    if (delta < 0 && this.counts(context)[kind] === 0) return;
    entries.push({ kind, label: String(label), automatic, delta: delta < 0 ? -1 : 1, at: Date.now() });
    // Keep a bounded number of per-token round records, including the current one.
    const keys = Object.keys(this.data.ledgers).filter(key => key !== context.key);
    while (keys.length >= 40) delete this.data.ledgers[keys.shift()];
    this.save();
  }

  counts(context) {
    const counts = Object.fromEntries(ACTIONS.map(action => [action.id, 0]));
    for (const entry of this.ledger(context)) {
      if (Object.hasOwn(counts, entry.kind)) counts[entry.kind] = Math.max(0, counts[entry.kind] + (entry.delta < 0 ? -1 : 1));
    }
    return counts;
  }

  undo(context) { this.ledger(context).pop(); this.save(); }
  clear(context) { this.data.ledgers[context.key] = []; this.save(); }
}
