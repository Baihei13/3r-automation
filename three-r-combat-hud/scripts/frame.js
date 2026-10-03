// Client UI geometry only. Never writes a token, actor, action or world setting.
const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
const clamp = (value, low, high) => Math.max(low, Math.min(Math.max(low, high), value));

export class HudFrame {
  constructor(store, refresh) {
    this.store = store;
    this.refresh = refresh;
    this.active = null;
    this.root = null;
  }

  get frameKey() { return this.root?.dataset.layout === "command" ? "commandFrameV2" : "frame"; }
  get saved() { return this.store.data[this.frameKey]; }
  set saved(value) { if (value) this.store.data[this.frameKey] = value; else delete this.store.data[this.frameKey]; }

  limits(root) {
    const dock = root.querySelector(".trh-dock");
    const identity = root.querySelector(".trh-identity");
    const rest = root.querySelector(".trh-rest-control");
    const scale = Number.parseFloat(root.style.getPropertyValue("--trh-scale")) || 1;
    const sidebar = Number.parseFloat(root.style.getPropertyValue("--trh-sidebar-width")) || 0;
    const command = root.dataset.layout === "command";
    // Theme cuts stay within the panel; its drag footprint remains rectangular.
    const left = command ? 24
      : (identity?.getBoundingClientRect().width ?? 118) + 18;
    const right = window.innerWidth - sidebar - (rest?.getBoundingClientRect().width ?? 44) - 18;
    const available = Math.max(120, right - left);
    const rect = dock.getBoundingClientRect();
    const mainHeight = dock.querySelector(".trh-main")?.getBoundingClientRect().height ?? 0;
    const chrome = dock.classList.contains("is-collapsed") ? 86 * scale : rect.height - mainHeight;
    return {
      left, right: Math.max(left + 120, right), top: 8, bottom: window.innerHeight - 8,
      minWidth: Math.min(280 * scale, available), maxWidth: available,
      minHeight: Math.min(window.innerHeight - 16, Math.max(140 * scale, chrome + (command ? 160 : 64) * scale)),
      maxHeight: Math.max(80, window.innerHeight - 16),
      identityHeight: command ? 0 : identity?.getBoundingClientRect().height ?? 0
    };
  }

  constrain(root, frame) {
    const bounds = this.limits(root);
    const width = clamp(frame.width, bounds.minWidth, bounds.maxWidth);
    const height = clamp(frame.height, bounds.minHeight, bounds.maxHeight);
    const top = Math.max(bounds.top, bounds.identityHeight - height + 8);
    return {
      x: clamp(frame.x, bounds.left, bounds.right - width),
      y: clamp(frame.y, top, bounds.bottom - height), width, height
    };
  }

  apply(root, requested) {
    this.root = root;
    if (arguments.length < 2) requested = this.saved;
    const bar = root.querySelector(".trh-bar");
    const dock = root.querySelector(".trh-dock");
    if (!bar || !dock) return;
    bar.classList.toggle("is-positioned", Boolean(requested));
    bar.classList.toggle("is-frame-collapsed", dock.classList.contains("is-collapsed"));
    if (!requested) {
      for (const name of ["--trh-frame-x", "--trh-frame-y", "--trh-frame-width", "--trh-frame-height"]) bar.style.removeProperty(name);
    } else {
      // Width first: responsive avatar/category rules affect the available space.
      bar.style.setProperty("--trh-frame-width", `${requested.width}px`);
      const frame = this.constrain(root, requested);
      for (const [key, value] of Object.entries(frame)) bar.style.setProperty(`--trh-frame-${key}`, `${Math.round(value)}px`);
    }
    const rect = dock.getBoundingClientRect();
    const above = rect.top - 8;
    const below = window.innerHeight - rect.bottom - 8;
    const useBelow = above < 160 && below > above;
    dock.classList.toggle("has-drawer-below", useBelow);
    dock.style.setProperty("--trh-drawer-space", `${Math.max(60, (useBelow ? below : above) - 10)}px`);
  }

  begin(root, direction, event) {
    const dock = root.querySelector(".trh-dock");
    const rect = dock.getBoundingClientRect();
    const collapsed = dock.classList.contains("is-collapsed");
    const original = this.saved ? { ...this.saved } : null;
    const start = { x: rect.left, y: rect.top, width: rect.width,
      height: collapsed ? original?.height ?? 240 : rect.height };
    this.active = { direction, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      start, original, latest: start, root, dock };
    root.classList.add("is-adjusting");
    dock.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  adjusted(start, direction, dx, dy, root) {
    const limits = this.limits(root);
    const frame = { ...start };
    if (direction === "move") { frame.x += dx; frame.y += dy; }
    else {
      if (direction.includes("w")) {
        const edge = start.x + start.width;
        frame.x = clamp(start.x + dx, Math.max(limits.left, edge - limits.maxWidth), edge - limits.minWidth);
        frame.width = edge - frame.x;
      }
      if (direction.includes("e")) frame.width = clamp(start.width + dx, limits.minWidth, Math.min(limits.maxWidth, limits.right - start.x));
      if (direction.includes("n")) {
        const edge = start.y + start.height;
        frame.y = clamp(start.y + dy, Math.max(limits.top, edge - limits.maxHeight), edge - limits.minHeight);
        frame.height = edge - frame.y;
      }
      if (direction.includes("s")) frame.height = clamp(start.height + dy, limits.minHeight, Math.min(limits.maxHeight, limits.bottom - start.y));
    }
    return this.constrain(root, frame);
  }

  finish(cancelled = false) {
    const drag = this.active;
    if (!drag) return;
    this.active = null;
    drag.root.classList.remove("is-adjusting");
    if (cancelled) this.apply(drag.root, drag.original);
    else {
      this.saved = this.constrain(drag.root, drag.latest);
      this.store.save();
      this.apply(drag.root);
    }
    if (drag.dock.hasPointerCapture(drag.pointerId)) drag.dock.releasePointerCapture(drag.pointerId);
    if (!cancelled) this.refresh();
  }

  cancel() { this.finish(true); }
  reset() { this.cancel(); this.saved = null; this.store.save(); if (this.root) this.apply(this.root); }

  bind(root, options) {
    this.apply(root);
    root.addEventListener("pointerdown", event => {
      if (event.button !== 0 || this.active) return;
      const handle = event.target.closest("[data-trh-resize]");
      const direction = handle?.dataset.trhResize;
      const header = event.target.closest(".trh-topline");
      if (!DIRECTIONS.has(direction) && (!header || event.target.closest("button, input, select, a, .trh-targets"))) return;
      this.begin(root, DIRECTIONS.has(direction) ? direction : "move", event);
    }, options);
    root.addEventListener("pointermove", event => {
      const drag = this.active;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.latest = this.adjusted(drag.start, drag.direction, event.clientX - drag.clientX, event.clientY - drag.clientY, root);
      this.apply(root, drag.latest);
      event.preventDefault();
    }, options);
    root.addEventListener("pointerup", event => { if (this.active?.pointerId === event.pointerId) this.finish(); }, options);
    root.addEventListener("pointercancel", event => { if (this.active?.pointerId === event.pointerId) this.cancel(); }, options);
    root.addEventListener("lostpointercapture", event => { if (this.active?.pointerId === event.pointerId) this.cancel(); }, options);
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.active) { event.preventDefault(); this.cancel(); return; }
      const direction = event.target.closest("[data-trh-resize]")?.dataset.trhResize;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!DIRECTIONS.has(direction) || !delta) return;
      event.preventDefault();
      const rect = root.querySelector(".trh-dock").getBoundingClientRect();
      const start = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      const increment = event.shiftKey ? 24 : 8;
      this.saved = this.adjusted(start, direction, delta[0] * increment, delta[1] * increment, root);
      this.store.save(); this.apply(root);
    }, options);
  }
}
