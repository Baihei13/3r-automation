export const ANIMATION_SLOTS = ["walk", "attack", "cast", "hit", "death"];
export const ACTION_TRIGGERS = ["onUse", "onCast", "onAttack", "onDamage", "onCrit"];
export const PRESET_FORMAT = "wang-token-walk.animation-preset";
export const ACTOR_FORMAT = "wang-token-walk.actor-presets";
export function getAnimationBaseActor(actor) {
  return actor?.isToken ? actor.token?.baseActor || null : actor || null;
}

function animationOwner(actor) {
  const base = getAnimationBaseActor(actor);
  // New saves belong to the world Actor; retain token-only presets until saved again.
  return base && ["presetBindings", "presetLibrary", "animations"].some(key =>
    base.getFlag?.("wang-token-walk", key) != null) ? base : actor;
}

export function safeExportName(value) {
  let name = Array.from(String(value ?? "").normalize("NFC").trim()
    .replace(/[^\p{L}\p{N}\p{M}_-]+/gu, "_")).slice(0, 60).join("").replace(/^_+|_+$/g, "") || "动画";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
  return name;
}
export const DIRECTIONS = [
  "default", "up", "right", "down", "left",
  "upRight", "upLeft", "downRight", "downLeft",
];

export function normalizeAnimation(input, { item = false } = {}) {
  const directions = {};
  for (const dir of DIRECTIONS) {
    const frames = input?.directions?.[dir];
    if (!Array.isArray(frames)) continue;
    const paths = frames.slice(0, 48).map((path) => String(path || "").trim()).filter(Boolean);
    if (paths.length) directions[dir] = paths;
  }
  if (!Object.keys(directions).length) return null;
  const fps = Math.max(4, Math.min(24, Number(input?.fps) || 10));
  const directional = input?.directional === undefined
    ? !directions.default && Object.keys(directions).some((key) => key !== "default")
    : Boolean(input.directional);
  const endFrame = input?.endFrame === "first" || input?.endFrame === "last"
    ? input.endFrame
    : Number.isInteger(Number(input?.endFrame)) && input?.endFrame !== null && input?.endFrame !== ""
      && Number(input.endFrame) >= 1 && Number(input.endFrame) <= 48
      ? Number(input.endFrame) : "restore";
  const animation = { fps, eightWay: Boolean(input?.eightWay), directional, endFrame, directions };
  if (item) {
    animation.trigger = ACTION_TRIGGERS.includes(input?.trigger) ? input.trigger : "onUse";
  }
  return animation;
}

export function getActorAnimation(actor, slot) {
  if (!ANIMATION_SLOTS.includes(slot)) return null;
  actor = animationOwner(actor);
  const bindings = actor?.getFlag?.("wang-token-walk", "presetBindings");
  if (bindings && Object.hasOwn(bindings, slot)) {
    const preset = actor?.getFlag?.("wang-token-walk", "presetLibrary")?.find?.((entry) => entry.id === bindings[slot]);
    return preset?.animation || null;
  }
  return actor?.getFlag?.("wang-token-walk", "animations")?.[slot] || null;
}

export function getItemAnimation(item) {
  return item?.getFlag?.("wang-token-walk", "actionAnimation") || null;
}

export function readActorPresetState(actor, { local = false } = {}) {
  if (!local) actor = animationOwner(actor);
  const presets = Object.fromEntries((actor?.getFlag?.("wang-token-walk", "presetLibrary") || [])
    .filter((entry) => entry?.id).map((entry) => [entry.id, { name: entry.name, animation: structuredClone(entry.animation) }]));
  const bindings = structuredClone(actor?.getFlag?.("wang-token-walk", "presetBindings") || {});
  const legacy = actor?.getFlag?.("wang-token-walk", "animations") || {};
  for (const slot of ANIMATION_SLOTS) {
    if (Object.hasOwn(bindings, slot) || !legacy[slot]) continue;
    const animation = normalizeAnimation(legacy[slot]);
    if (!animation) continue;
    const id = `legacy-${slot}`;
    if (!presets[id]) presets[id] = {
      name: { walk: "走路", attack: "通用攻击", cast: "通用施法", hit: "挨打", death: "死亡" }[slot],
      animation,
    };
    bindings[slot] = id;
  }
  return { presets, bindings };
}

export function validatePreset(value) {
  const name = String(value?.name || "").trim().slice(0, 80);
  const animation = normalizeAnimation(value?.animation);
  if (!name || !animation) throw new Error("预设需要名称和至少一帧图片。");
  for (const paths of Object.values(animation.directions)) {
    if (paths.some((path) => path.length > 1024)) throw new Error("帧图片路径过长。");
  }
  return { name, animation };
}

export function validateActorPresetBundle(value) {
  if (value?.format !== ACTOR_FORMAT || value?.version !== 1) throw new Error("不是受支持的角色预设文件。");
  const entries = Object.entries(value.presets || {});
  if (entries.length > 100) throw new Error("预设数量超过上限（100）。");
  const presets = {};
  for (const [id, preset] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) {
      throw new Error("预设编号无效。");
    }
    presets[id] = validatePreset(preset);
  }
  const bindings = {};
  for (const slot of ANIMATION_SLOTS) {
    const id = value.bindings?.[slot];
    bindings[slot] = typeof id === "string" && presets[id] ? id : "";
  }
  if (Array.isArray(value.actions) && value.actions.length > 200) throw new Error("动作动画数量超过上限（200）。");
  const actions = Array.isArray(value.actions) ? value.actions.map((entry) => ({
    id: String(entry?.id || "").slice(0, 64),
    name: String(entry?.name || "").slice(0, 160),
    type: String(entry?.type || "").slice(0, 60),
    animation: normalizeAnimation(entry?.animation, { item: true }),
  })).filter((entry) => entry.animation && entry.name) : [];
  return { presets, bindings, actions };
}

export function buildActorPresetBundle(actor, state) {
  return {
    format: ACTOR_FORMAT,
    version: 1,
    actorName: actor.name,
    presets: state.presets,
    bindings: state.bindings,
    actions: actor.items.filter((item) => item.getFlag("wang-token-walk", "actionAnimation")).map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      animation: item.getFlag("wang-token-walk", "actionAnimation"),
    })),
  };
}
