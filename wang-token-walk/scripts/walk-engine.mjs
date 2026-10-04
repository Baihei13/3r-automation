/**
 * Token 走路引擎（Foundry v13/v14）
 */
import {
  loadManifest,
  resolveDirections,
  getSheetEntry,
  refreshSheetIndex,
  listSheets,
} from "./sheet-registry.mjs";
import { getActorAnimation, getAnimationBaseActor } from "./animation-data.mjs";

export const MODULE_ID = "wang-token-walk";
export const FLAG_SHEET = "sheet";
export const ACTOR_SHEET_ID = "@actor";
const FLAG_ORIGINAL_TEXTURE = "originalTexture";

/** @type {Map<string, PIXI.Texture>} */
const TEX = new Map();
const TEX_LOADING = new Map();
const SHEET_LOADING = new Map();
/** @type {Map<string, {x:number,y:number}>} */
const MOVE_FROM = new Map();
/** @type {Map<string, {x:number,y:number}>} */
const LAST_POS = new Map();
/** @type {Map<string, { path: string, sheetId: string }>} */
const PAINT = new Map();
/** @type {Map<string, { frames: string[], idx: number, nextAt: number, until: number, interval: number }>} */
const CYCLE = new Map();
const EVENT_CYCLE = new Map();
const HELD = new Map();
const LAST_FACING = new Map();

let previewTokenId = null;
let animateWrapped = false;
let boundTicker = null;
let nextPaintCheckAt = 0;

function getLoader() {
  return globalThis.foundry?.canvas?.loadTexture || globalThis.loadTexture || null;
}

async function loadTex(path) {
  const cached = TEX.get(path);
  if (cached && !cached.destroyed) return cached;
  if (TEX_LOADING.has(path)) return TEX_LOADING.get(path);
  const loader = getLoader();
  if (!loader) throw new Error("loadTexture unavailable");
  const loading = Promise.resolve(loader(path))
    .then((tex) => {
      if (!tex) throw new Error(`Could not load texture: ${path}`);
      TEX.set(path, tex);
      return tex;
    })
    .finally(() => TEX_LOADING.delete(path));
  TEX_LOADING.set(path, loading);
  return loading;
}

async function preloadSheet(sheetId) {
  const entry = getSheetEntry(sheetId);
  const cached = SHEET_LOADING.get(sheetId);
  if (cached?.entry === entry) return cached.promise;
  let failed = false;
  const promise = (async () => {
    const manifest = await loadManifest(sheetId);
    const dirs = resolveDirections(manifest);
    const paths = [...new Set(Object.values(dirs).flat().filter(Boolean))];
    await Promise.all(paths.map((p) => loadTex(p).catch((e) => {
      failed = true;
      console.warn(MODULE_ID, p, e);
    })));
    return { manifest, dirs };
  })();
  SHEET_LOADING.set(sheetId, { entry, promise });
  try {
    const result = await promise;
    if (failed && SHEET_LOADING.get(sheetId)?.promise === promise) SHEET_LOADING.delete(sheetId);
    return result;
  } catch (err) {
    if (SHEET_LOADING.get(sheetId)?.promise === promise) SHEET_LOADING.delete(sheetId);
    throw err;
  }
}

async function preloadAnimation(manifest) {
  if (!manifest?.directions) throw new Error("Animation has no frames");
  // Actor animations may have many unique frames. Resolve paths now and load only
  // the direction actually played, rather than uploading every frame on enable.
  return { manifest, dirs: resolveDirections(manifest) };
}

function preloadWalk(token, sheetId) {
  return sheetId === ACTOR_SHEET_ID
    ? preloadAnimation(getActorAnimation(token.actor, "walk"))
    : preloadSheet(sheetId);
}

export function getMovementSheetId(token) {
  return token?.document?.getFlag?.(MODULE_ID, FLAG_SHEET)
    || (getActorAnimation(token?.actor, "walk") ? ACTOR_SHEET_ID : null);
}

function defaultFps(manifest) {
  const setting = Number(game.settings.get(MODULE_ID, "defaultFps")) || 10;
  return Math.max(4, Math.min(24, Number(manifest?.fps) || setting));
}

function directionFromDelta(dx, dy, { eightWay = false } = {}) {
  if (dx === 0 && dy === 0) return null;
  if (!eightWay) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "down" : "up";
  }
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < ay * 0.4) return dy > 0 ? "down" : "up";
  if (ay < ax * 0.4) return dx > 0 ? "right" : "left";
  if (dx > 0 && dy < 0) return "upRight";
  if (dx < 0 && dy < 0) return "upLeft";
  if (dx > 0 && dy > 0) return "downRight";
  return "downLeft";
}

export function resolveToken(token = null) {
  if (token?.document && !token.destroyed) return token;
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length === 1) return controlled[0];
  if (controlled.length > 1) {
    ui.notifications.warn(game.i18n.localize("WANGTOKENWALK.SelectOne"));
    return null;
  }
  ui.notifications.warn(game.i18n.localize("WANGTOKENWALK.SelectFirst"));
  return null;
}

function forceMeshTexture(token, tex, { upright = true } = {}) {
  const mesh = token?.mesh;
  if (!mesh || !tex || tex.destroyed) return false;
  try {
    if (mesh.texture !== tex) mesh.texture = tex;
    if (token.texture !== undefined && token.texture !== tex) token.texture = tex;
    // Directional sprites already depict the facing; Token rotation must not rotate them again.
    mesh.angle = upright ? 0 : token.document.lockRotation ? 0 : token.document.rotation;
    return true;
  } catch (_) {
    return false;
  }
}

function setPaint(token, path) {
  if (!token?.id || !path) return false;
  const tex = TEX.get(path);
  if (!tex) return false;
  PAINT.set(token.id, {
    path,
    sheetId: token.document?.getFlag?.(MODULE_ID, FLAG_SHEET) || "",
  });
  if (EVENT_CYCLE.has(token.id) || HELD.has(token.id)) return true;
  return forceMeshTexture(token, tex);
}

function getEndFramePath(frames, endFrame) {
  if (!frames?.length || endFrame === "restore" || endFrame == null) return null;
  if (endFrame === "first") return frames[0];
  if (endFrame === "last") return frames.at(-1);
  if (Number.isInteger(endFrame) && endFrame >= 1) return frames[Math.min(endFrame, frames.length) - 1];
  return null;
}

async function setPaintAsync(token, path) {
  await loadTex(path);
  return setPaint(token, path);
}

function ensureTicker() {
  const ticker = canvas?.app?.ticker;
  if (!ticker) return;
  if (boundTicker === ticker) return;
  boundTicker?.remove(onTicker);
  ticker.add(onTicker);
  boundTicker = ticker;
}

function startWalkCycle(token, frames, durationMs, fps, { implicit = false, endFrame = "restore" } = {}) {
  if (!token?.id || !frames?.length || durationMs <= 0) return;
  ensureTicker();
  const interval = Math.round(1000 / Math.max(4, fps));
  const until = performance.now() + durationMs;
  const baseline = CYCLE.get(token.id)?.baseline || token.mesh?.texture || token.texture;
  CYCLE.set(token.id, {
    frames, baseline, implicit, endFramePath: getEndFramePath(frames, endFrame),
    idx: 0,
    nextAt: performance.now() + interval,
    until,
    interval,
  });
  if (!EVENT_CYCLE.has(token.id) && !HELD.has(token.id)) {
    if (implicit) forceMeshTexture(token, TEX.get(frames[0]));
    else setPaint(token, frames[0]);
  }
}

function stopWalkCycle(tokenId, { settle = true } = {}) {
  const cy = CYCLE.get(tokenId);
  CYCLE.delete(tokenId);
  if (settle && cy?.frames?.[0] && !EVENT_CYCLE.has(tokenId) && !HELD.has(tokenId)) {
    const token = canvas.tokens?.get(tokenId);
    if (token && !token.destroyed) {
      if (cy.endFramePath) setPaint(token, cy.endFramePath);
      else if (cy.implicit) forceMeshTexture(token, cy.baseline, { upright: PAINT.has(tokenId) });
      else setPaint(token, cy.frames[0]);
    }
  }
}

function restoreEventTexture(token, baseline) {
  const paint = PAINT.get(token.id);
  const tex = paint && TEX.get(paint.path);
  if (tex) forceMeshTexture(token, tex);
  else if (baseline) {
    forceMeshTexture(token, baseline, { upright: Boolean(token.document.getFlag(MODULE_ID, FLAG_SHEET)) });
  }
}

export function releaseHeldAnimation(token) {
  if (!token?.id) return;
  const held = HELD.get(token.id);
  const event = EVENT_CYCLE.get(token.id);
  HELD.delete(token.id);
  if (event?.holdLast) EVENT_CYCLE.delete(token.id);
  const baseline = held?.baseline || (event?.holdLast ? event.baseline : null);
  if (baseline && !token.destroyed) restoreEventTexture(token, baseline);
}

export async function playTokenAnimation(token, manifest, { kind = "action", holdLast = false } = {}) {
  if (!token?.id || token.destroyed || canvas.tokens?.get(token.id) !== token) return false;
  if (HELD.has(token.id) && kind !== "death") return false;
  const priority = { action: 1, hit: 2, death: 3 }[kind] || 1;
  const current = EVENT_CYCLE.get(token.id);
  if (current && current.priority > priority) return false;
  if (!manifest?.directions) return false;
  const dirs = resolveDirections(manifest);
  const facing = LAST_FACING.get(token.id) || "down";
  const frames = !manifest.directional && dirs.default?.length ? dirs.default
    : dirs[facing]?.length ? dirs[facing]
    : dirs.default?.length ? dirs.default
    : ["down", "right", "up", "left", "upRight", "upLeft", "downRight", "downLeft"]
      .map((dir) => dirs[dir]).find((paths) => paths?.length);
  if (!frames?.length) return false;
  await Promise.all([...new Set(frames)].map((path) => loadTex(path)));
  if (token.destroyed || canvas.tokens?.get(token.id) !== token) return false;
  if (kind === "death" && Number(token.actor?.system?.attributes?.hp?.value) > 0) return false;
  if (HELD.has(token.id) && kind !== "death") return false;
  if ((EVENT_CYCLE.get(token.id)?.priority || 0) > priority) return false;
  const prior = EVENT_CYCLE.get(token.id);
  const baseline = prior?.baseline || HELD.get(token.id)?.baseline
    || (CYCLE.get(token.id)?.implicit ? CYCLE.get(token.id).baseline : null)
    || token.mesh?.texture || token.texture;
  EVENT_CYCLE.delete(token.id);
  HELD.delete(token.id);
  const interval = Math.round(1000 / defaultFps(manifest));
  EVENT_CYCLE.set(token.id, {
    frames, idx: 0, nextAt: performance.now() + interval, interval,
    priority, baseline, holdLast, endFramePath: getEndFramePath(frames, manifest.endFrame),
  });
  ensureTicker();
  forceMeshTexture(token, TEX.get(frames[0]));
  return true;
}

function onTicker() {
  const now = performance.now();
  for (const [id, event] of EVENT_CYCLE) {
    const token = canvas.tokens?.get(id);
    if (!token || token.destroyed) { EVENT_CYCLE.delete(id); continue; }
    if (now < event.nextAt) continue;
    if (event.idx + 1 < event.frames.length) {
      event.idx++;
      event.nextAt = now + event.interval;
      forceMeshTexture(token, TEX.get(event.frames[event.idx]));
    } else {
      EVENT_CYCLE.delete(id);
      if (event.holdLast) {
        forceMeshTexture(token, TEX.get(event.endFramePath || event.frames.at(-1)));
        HELD.set(id, { baseline: event.baseline });
      }
      else if (event.endFramePath) setPaint(token, event.endFramePath);
      else restoreEventTexture(token, event.baseline);
    }
  }
  for (const [id, cy] of CYCLE) {
    if (EVENT_CYCLE.has(id) || HELD.has(id)) continue;
    const token = canvas.tokens?.get(id);
    if (!token || token.destroyed) {
      CYCLE.delete(id);
      continue;
    }
    if (now >= cy.until) {
      stopWalkCycle(id, { settle: true });
      continue;
    }
    if (now >= cy.nextAt) {
      cy.idx = (cy.idx + 1) % cy.frames.length;
      cy.nextAt = now + cy.interval;
      if (cy.implicit) forceMeshTexture(token, TEX.get(cy.frames[cy.idx]));
      else setPaint(token, cy.frames[cy.idx]);
    }
  }
  if (now < nextPaintCheckAt) return;
  nextPaintCheckAt = now + 100;
  for (const [id, st] of PAINT) {
    if (EVENT_CYCLE.has(id) || CYCLE.has(id) || HELD.has(id)) continue;
    const token = canvas.tokens?.get(id);
    if (!token || token.destroyed || !token.mesh ||
        (token.document?.getFlag?.(MODULE_ID, FLAG_SHEET) || "") !== st.sheetId) {
      PAINT.delete(id);
      continue;
    }
    const tex = TEX.get(st.path);
    if (tex && (token.mesh.texture !== tex || token.texture !== tex)) forceMeshTexture(token, tex);
  }
}

function idlePath(dirs) {
  return dirs.down?.[0] || dirs.right?.[0] || dirs.up?.[0] || dirs.left?.[0] || dirs.default?.[0] || null;
}

export async function enableWalk({ token = null, sheetId = null } = {}) {
  ensureTicker();
  const tok = resolveToken(token);
  if (!tok) return null;
  const actor = getAnimationBaseActor(tok.actor);
  if (!actor || (!game.user.isGM && !actor.isOwner)) {
    ui.notifications.warn("需要角色列表中原角色的编辑权限，才能保存默认指示物动画。");
    return null;
  }

  if (sheetId !== ACTOR_SHEET_ID && (sheetId || !getActorAnimation(tok.actor, "walk"))) {
    await refreshSheetIndex();
  }
  const sid =
    sheetId ||
    (getActorAnimation(tok.actor, "walk") ? ACTOR_SHEET_ID : null) ||
    tok.document.getFlag(MODULE_ID, FLAG_SHEET) ||
    listSheets()[0]?.id ||
    null;
  if (!sid || (sid === ACTOR_SHEET_ID ? !getActorAnimation(tok.actor, "walk") : !getSheetEntry(sid))) {
    ui.notifications.error(game.i18n.localize("WANGTOKENWALK.NoSheet"));
    return null;
  }

  let dirs;
  try {
    ({ dirs } = await preloadWalk(tok, sid));
  } catch (err) {
    console.warn(`${MODULE_ID} | load walk`, err);
    ui.notifications.error("读取走路帧失败，请检查图片路径。");
    return null;
  }
  const idle = idlePath(dirs);
  if (!idle) {
    ui.notifications.error(game.i18n.localize("WANGTOKENWALK.NoSheet"));
    return null;
  }
  try {
    await loadTex(idle);
  } catch (err) {
    console.warn(`${MODULE_ID} | load idle frame`, err);
    ui.notifications.error("找不到走路待机图片，请检查图片路径。");
    return null;
  }

  const changes = {
    [`flags.${MODULE_ID}.${FLAG_SHEET}`]: sid,
    "texture.src": idle,
    "texture.fit": "contain",
    "texture.alphaThreshold": 0.35,
  };
  if (!tok.document.getFlag(MODULE_ID, FLAG_SHEET)) {
    const { src, fit, alphaThreshold } = tok.document.texture;
    changes[`flags.${MODULE_ID}.${FLAG_ORIGINAL_TEXTURE}`] = { src, fit, alphaThreshold };
  }
  try {
    const prototype = actor.prototypeToken;
    const defaults = {
      [`prototypeToken.flags.${MODULE_ID}.${FLAG_SHEET}`]: sid,
      "prototypeToken.texture.src": idle,
      "prototypeToken.texture.fit": "contain",
      "prototypeToken.texture.alphaThreshold": 0.35,
    };
    if (!prototype.getFlag(MODULE_ID, FLAG_SHEET)) {
      const { src, fit, alphaThreshold } = prototype.texture;
      defaults[`prototypeToken.flags.${MODULE_ID}.${FLAG_ORIGINAL_TEXTURE}`] = { src, fit, alphaThreshold };
    }
    await actor.update(defaults);
    await tok.document.update(changes, { animate: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | enable update`, err);
    ui.notifications.error("无法完成走路动画保存；角色默认指示物可能已保存，但场上指示物未更新，请重新启用。");
    return null;
  }

  LAST_POS.set(tok.id, { x: tok.document.x, y: tok.document.y });
  setPaint(tok, idle);
  const label = sid === ACTOR_SHEET_ID ? "角色走路帧" : getSheetEntry(sid)?.label || sid;
  ui.notifications.info(
    game.i18n.format("WANGTOKENWALK.Enabled", { name: tok.name, sheet: label })
  );
  return tok;
}

export async function disableWalk({ token = null } = {}) {
  const tok = resolveToken(token);
  if (!tok) return null;
  const actor = getAnimationBaseActor(tok.actor), prototype = actor?.prototypeToken;
  if (prototype?.getFlag(MODULE_ID, FLAG_SHEET)) {
    if (!game.user.isGM && !actor.isOwner) {
      ui.notifications.warn("需要角色列表中原角色的编辑权限，才能停用默认指示物动画。");
      return null;
    }
    const original = prototype.getFlag(MODULE_ID, FLAG_ORIGINAL_TEXTURE);
    const defaults = {
      [`prototypeToken.flags.${MODULE_ID}.-=${FLAG_SHEET}`]: null,
      [`prototypeToken.flags.${MODULE_ID}.-=${FLAG_ORIGINAL_TEXTURE}`]: null,
    };
    if (typeof original?.src === "string") {
      defaults["prototypeToken.texture.src"] = original.src;
      defaults["prototypeToken.texture.fit"] = original.fit;
      defaults["prototypeToken.texture.alphaThreshold"] = original.alphaThreshold;
    }
    try { await actor.update(defaults); }
    catch (error) {
      console.warn(`${MODULE_ID} | disable prototype`, error);
      ui.notifications.error("无法停用角色默认指示物动画，请确认编辑权限。");
      return null;
    }
  }
  if (!tok.document.getFlag(MODULE_ID, FLAG_SHEET)) {
    stopWalkCycle(tok.id, { settle: false });
    EVENT_CYCLE.delete(tok.id);
    HELD.delete(tok.id);
    PAINT.delete(tok.id);
    const src = tok.document.texture?.src;
    if (src) {
      try { forceMeshTexture(tok, await loadTex(src), { upright: false }); }
      catch (error) { console.warn(`${MODULE_ID} | restore original texture`, error); }
    }
    return tok;
  }
  const original = tok.document.getFlag(MODULE_ID, FLAG_ORIGINAL_TEXTURE);
  const changes = {
    [`flags.${MODULE_ID}.-=${FLAG_SHEET}`]: null,
    [`flags.${MODULE_ID}.-=${FLAG_ORIGINAL_TEXTURE}`]: null,
  };
  if (typeof original?.src === "string") {
    changes["texture.src"] = original.src;
    changes["texture.fit"] = original.fit;
    changes["texture.alphaThreshold"] = original.alphaThreshold;
  }
  try {
    await tok.document.update(changes, { animate: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | disable update`, err);
    ui.notifications.error("停用未完成，默认指示物与场上指示物可能不同步，请重新操作。");
    return null;
  }
  stopWalkCycle(tok.id, { settle: false });
  EVENT_CYCLE.delete(tok.id);
  HELD.delete(tok.id);
  PAINT.delete(tok.id);
  forceMeshTexture(tok, tok.mesh?.texture, { upright: false });
  if (previewTokenId === tok.id) previewTokenId = null;
  LAST_POS.delete(tok.id);
  MOVE_FROM.delete(tok.id);
  if (typeof original?.src !== "string") {
    ui.notifications.warn("旧版启用的 Token 没有保存原图；停用后请手动选择原贴图。");
  }
  ui.notifications.info(game.i18n.format("WANGTOKENWALK.Disabled", { name: tok.name }));
  return tok;
}

export async function testWalkInPlace({ token = null, sheetId = null } = {}) {
  const tok = resolveToken(token);
  if (!tok) return null;
  if (EVENT_CYCLE.has(tok.id) || HELD.has(tok.id)) {
    ui.notifications.warn("此 Token 正在播放其他动画，请稍后试播走路。");
    return null;
  }
  if (previewTokenId) {
    ui.notifications.warn("已有走路动画正在试播，请等它结束。");
    return null;
  }
  if (sheetId !== ACTOR_SHEET_ID && (sheetId || !getActorAnimation(tok.actor, "walk"))) {
    await refreshSheetIndex();
  }
  const sid = sheetId || tok.document.getFlag(MODULE_ID, FLAG_SHEET) || listSheets()[0]?.id;
  if (!sid || (sid === ACTOR_SHEET_ID ? !getActorAnimation(tok.actor, "walk") : !getSheetEntry(sid))) {
    ui.notifications.error(game.i18n.localize("WANGTOKENWALK.NoSheet"));
    return null;
  }
  const { dirs, manifest } = await preloadWalk(tok, sid);
  const previousSheet = tok.document.getFlag(MODULE_ID, FLAG_SHEET);
  const previousPaint = PAINT.get(tok.id);
  const previousTexture = tok.mesh?.texture || tok.texture;
  stopWalkCycle(tok.id, { settle: false });
  previewTokenId = tok.id;
  let finalFrames = null;
  try {
    const fps = defaultFps(manifest);
    ui.notifications.info(`试播「${tok.name}」`);
    const previewDirections = ["up", "right", "down", "left"].some((dir) => dirs[dir]?.length)
      ? ["up", "right", "down", "left"] : ["default"];
    for (const dir of previewDirections) {
      if (previewTokenId !== tok.id || tok.destroyed) break;
      const frames = dirs[dir]?.length ? dirs[dir] : dirs.default;
      if (!frames?.length) continue;
      const interval = Math.round(1000 / fps);
      for (let i = 0; i < frames.length; i++) {
        if (previewTokenId !== tok.id) break;
        await setPaintAsync(tok, frames[i]);
        await new Promise((r) => setTimeout(r, interval));
      }
      if (previewTokenId === tok.id) finalFrames = frames;
    }
  } finally {
    if (!tok.destroyed && canvas.tokens?.get(tok.id) === tok &&
        tok.document.getFlag(MODULE_ID, FLAG_SHEET) === previousSheet) {
      const endPath = previewTokenId === tok.id ? getEndFramePath(finalFrames, manifest.endFrame) : null;
      if (endPath) setPaint(tok, endPath);
      else {
        if (previousPaint) PAINT.set(tok.id, previousPaint);
        else PAINT.delete(tok.id);
        if (previousTexture && !EVENT_CYCLE.has(tok.id) && !HELD.has(tok.id)) {
          forceMeshTexture(tok, previousTexture, { upright: Boolean(previousPaint || previousSheet) });
        }
      }
    }
    if (previewTokenId === tok.id) previewTokenId = null;
  }
  return tok;
}

async function beginMoveWalk(token, dir, dx, dy, durationOverride = null) {
  const sheetId = getMovementSheetId(token);
  if (!sheetId) return;
  const implicit = !token.document.getFlag(MODULE_ID, FLAG_SHEET);
  const startedAt = performance.now();
  const { dirs, manifest } = await preloadWalk(token, sheetId);
  if (token.destroyed || canvas.tokens?.get(token.id) !== token ||
      getMovementSheetId(token) !== sheetId) return;
  const eight = Boolean(manifest.eightWay || dirs.upRight);
  const useDir = eight ? directionFromDelta(dx, dy, { eightWay: true }) || dir : dir;
  const frames = dirs[useDir]?.length ? dirs[useDir] : dirs.default;
  if (!frames?.length) return;
  await Promise.all([...new Set(frames)].map((path) => loadTex(path)));
  if (token.destroyed || canvas.tokens?.get(token.id) !== token ||
      getMovementSheetId(token) !== sheetId) return;
  LAST_FACING.set(token.id, useDir);
  const fps = defaultFps(manifest);
  const dist = Math.hypot(dx, dy);
  const grid = canvas.grid?.size || 100;
  const durationMs = typeof durationOverride === "number" && Number.isFinite(durationOverride)
    ? durationOverride
    : Math.max(500, (dist / grid) * 350);
  startWalkCycle(token, frames, Math.max(250, durationMs - (performance.now() - startedAt)), fps,
    { implicit, endFrame: manifest.endFrame });
}

function wrapTokenAnimate() {
  if (animateWrapped) return;
  const TokenClass = CONFIG.Token?.objectClass;
  if (!TokenClass?.prototype?.animate) return;
  const original = TokenClass.prototype.animate;

  TokenClass.prototype.animate = async function wangTokenWalkAnimate(to = {}, options = {}) {
    const sheetId = getMovementSheetId(this);
    if (!sheetId || (!("x" in to) && !("y" in to))) return original.call(this, to, options);

    const from = MOVE_FROM.get(this.id) || LAST_POS.get(this.id) || { x: this.x, y: this.y };
    const dx = (to.x ?? this.document.x) - from.x;
    const dy = (to.y ?? this.document.y) - from.y;
    const dir = directionFromDelta(dx, dy);
    if (dir) beginMoveWalk(this, dir, dx, dy, options.duration).catch(() => null);

    try {
      return await original.call(this, to, options);
    } finally {
      MOVE_FROM.delete(this.id);
    }
  };
  animateWrapped = true;
}

function onPositionUpdate(doc, changes, options) {
  if (!getMovementSheetId(doc.object)) return;
  if (changes.x === undefined && changes.y === undefined) return;
  const token = doc.object;
  if (!token || token.destroyed) return;
  const from = MOVE_FROM.get(doc.id) || LAST_POS.get(doc.id) || { x: doc.x, y: doc.y };
  LAST_POS.set(doc.id, { x: doc.x, y: doc.y });
  const dx = doc.x - from.x;
  const dy = doc.y - from.y;
  const dir = directionFromDelta(dx, dy);
  if (!dir) return;
  beginMoveWalk(token, dir, dx, dy, options?.animation?.duration).catch(() => null);
}

export function installWalkEngine() {
  wrapTokenAnimate();
  ensureTicker();

  // Runs after Foundry refreshes the mesh, including each automatic rotation step.
  // Only the displayed sprite is kept upright; document rotation and vision remain intact.
  Hooks.on("refreshToken", (token) => {
    if (token.mesh && (token.document.getFlag(MODULE_ID, FLAG_SHEET)
        || PAINT.has(token.id) || CYCLE.has(token.id)
        || EVENT_CYCLE.has(token.id) || HELD.has(token.id))) token.mesh.angle = 0;
  });

  Hooks.on("controlToken", (token, controlled) => {
    if (controlled && previewTokenId && previewTokenId !== token.id) previewTokenId = null;
  });

  Hooks.on("preUpdateToken", (doc, changes) => {
    if (changes.x !== undefined || changes.y !== undefined) {
      const facing = directionFromDelta(
        (changes.x ?? doc.x) - doc.x,
        (changes.y ?? doc.y) - doc.y,
        { eightWay: true },
      );
      if (facing) LAST_FACING.set(doc.id, facing);
    }
    if (!getMovementSheetId(doc.object)) return;
    if (changes.x === undefined && changes.y === undefined) return;
    const from = { x: doc.x, y: doc.y };
    MOVE_FROM.set(doc.id, from);
    LAST_POS.set(doc.id, from);
  });

  Hooks.on("updateToken", (doc, changes, options) => {
    if ("texture" in changes && changes.x === undefined && changes.y === undefined) return;
    onPositionUpdate(doc, changes, options);
  });

  Hooks.on("canvasReady", () => {
    previewTokenId = null;
    MOVE_FROM.clear();
    LAST_POS.clear();
    PAINT.clear();
    CYCLE.clear();
    EVENT_CYCLE.clear();
    HELD.clear();
    LAST_FACING.clear();
    TEX.clear();
    SHEET_LOADING.clear();
    nextPaintCheckAt = 0;
    ensureTicker();
    wrapTokenAnimate();
  });

  console.log(`${MODULE_ID} | walk engine ready`);
}
