/**
 * 走路表注册：内置 index + 世界内可视化保存的表 +（可选）额外 manifest 路径
 */
const MODULE_ID = "wang-token-walk";

/** @type {Map<string, { id: string, label: string, path?: string, source: string, manifest?: object }>} */
const SHEETS = new Map();

export function listSheets() {
  return [...SHEETS.values()].map(({ id, label, path, source }) => ({
    id,
    label,
    path: path || "",
    source: source || "builtin",
  }));
}

export function getSheetEntry(sheetId) {
  return SHEETS.get(sheetId) || null;
}

export function getWorldSheets() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, "worldSheets") || {});
}

export async function saveWorldSheet(manifest) {
  if (!game.user.isGM) {
    ui.notifications.error("需要 GM 才能保存走路表。");
    return null;
  }
  const id = String(manifest.id || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id) {
    ui.notifications.error("请填写有效的表 ID（字母数字_-）。");
    return null;
  }
  const label = String(manifest.label || id).trim() || id;
  const fps = Math.max(4, Math.min(24, Number(manifest.fps) || 10));
  const directions = {};
  for (const [dir, frames] of Object.entries(manifest.directions || {})) {
    const list = (frames || []).map((p) => String(p || "").trim()).filter(Boolean);
    if (list.length) directions[dir] = list;
  }
  if (!Object.keys(directions).length) {
    ui.notifications.error("至少为一个方向添加一帧图片。");
    return null;
  }

  const clean = {
    id,
    label,
    fps,
    eightWay: Boolean(manifest.eightWay),
    directions,
  };
  const all = getWorldSheets();
  all[id] = clean;
  await game.settings.set(MODULE_ID, "worldSheets", all);
  await refreshSheetIndex();
  ui.notifications.info(`已保存走路表：${label}`);
  return clean;
}

export async function deleteWorldSheet(sheetId) {
  if (!game.user.isGM) {
    ui.notifications.error("需要 GM 才能删除走路表。");
    return false;
  }
  const all = getWorldSheets();
  if (!all[sheetId]) {
    ui.notifications.warn("只能删除「世界自定义」走路表，不能删模块自带表。");
    return false;
  }
  delete all[sheetId];
  await game.settings.set(MODULE_ID, "worldSheets", all);
  await refreshSheetIndex();
  ui.notifications.info(`已删除走路表：${sheetId}`);
  return true;
}

export async function refreshSheetIndex() {
  SHEETS.clear();

  try {
    const idxUrl = `modules/${MODULE_ID}/assets/sheets/index.json`;
    const res = await fetch(idxUrl, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      for (const row of data.sheets || []) {
        if (!row?.id || !row?.path) continue;
        SHEETS.set(row.id, {
          id: row.id,
          label: row.label || row.id,
          path: row.path,
          source: "builtin",
        });
      }
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | index.json`, err);
  }

  // 世界内可视化编辑保存的表（可覆盖同名内置）
  try {
    const world = game.settings.get(MODULE_ID, "worldSheets") || {};
    for (const [id, man] of Object.entries(world)) {
      if (!man || typeof man !== "object") continue;
      SHEETS.set(id, {
        id,
        label: man.label || id,
        source: "world",
        manifest: foundry.utils.deepClone(man),
      });
    }
  } catch (_) {
    /* settings not ready */
  }

  const extra = String(game.settings.get(MODULE_ID, "extraManifests") || "");
  for (const line of extra.split(/\r?\n/)) {
    const path = line.trim();
    if (!path || path.startsWith("#")) continue;
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;
      const man = await res.json();
      const id = man.id || path.split("/").filter(Boolean).at(-2) || path;
      SHEETS.set(id, {
        id,
        label: man.label || man.name || id,
        path,
        source: "extra",
        manifest: man,
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | extra manifest`, path, err);
    }
  }

  return listSheets();
}

export async function loadManifest(sheetId) {
  const entry = SHEETS.get(sheetId);
  if (!entry) throw new Error(`未知走路表：${sheetId}`);
  if (entry.manifest) return foundry.utils.deepClone(entry.manifest);
  const res = await fetch(`${entry.path}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`找不到 manifest：${entry.path}`);
  const data = await res.json();
  entry.manifest = data;
  return foundry.utils.deepClone(data);
}

/** 规范化方向表：支持 4 向；斜向缺省时复用左右 */
export function resolveDirections(manifest) {
  const d = foundry.utils.deepClone(manifest.directions || {});
  const pick = (...keys) => {
    for (const k of keys) if (d[k]?.length) return d[k];
    return null;
  };
  if (!d.upRight) d.upRight = pick("upRight", "right", "up");
  if (!d.upLeft) d.upLeft = pick("upLeft", "left", "up");
  if (!d.downRight) d.downRight = pick("downRight", "right", "down");
  if (!d.downLeft) d.downLeft = pick("downLeft", "left", "down");
  return d;
}

export const DIR_DEFS = [
  { key: "default", label: "通用（无方向）" },
  { key: "up", label: "上 (背)" },
  { key: "right", label: "右" },
  { key: "down", label: "下 (正)" },
  { key: "left", label: "左" },
  { key: "upRight", label: "右上（可选）" },
  { key: "upLeft", label: "左上（可选）" },
  { key: "downRight", label: "右下（可选）" },
  { key: "downLeft", label: "左下（可选）" },
];
