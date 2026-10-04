import { DIR_DEFS } from "./sheet-registry.mjs";
import {
  ACTOR_FORMAT, ANIMATION_SLOTS, PRESET_FORMAT, buildActorPresetBundle, normalizeAnimation,
  readActorPresetState, validateActorPresetBundle, validatePreset, getAnimationBaseActor, safeExportName,
} from "./animation-data.mjs";
import { playTokenAnimation } from "./walk-engine.mjs";
import { exportAssetPackage, readPresetFile, withAssetTransfer } from "./asset-package.mjs";

const MODULE_ID = "wang-token-walk";
const LABELS = { walk: "移动", attack: "通用攻击", cast: "通用施法", hit: "生命值下降", death: "生命值归零" };
const escape = (value) => foundry.utils.escapeHTML(String(value ?? ""));
const freshAnimation = () => ({ fps: 10, directional: false, eightWay: false, directions: { default: [] } });
const newId = () => foundry.utils.randomID(12);
const filename = (path) => String(path || "").split(/[\\/]/).pop() || "未选择图片";

function downloadJson(filename, value) {
  foundry.utils.saveDataToFile(JSON.stringify(value, null, 2), "application/json",
    filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_"));
}

export class ActorPresetEditorApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "wang-token-walk-actor-presets",
    classes: ["wang-token-walk", "wang-token-walk-editor"],
    tag: "div",
    window: { title: "角色动画预设", resizable: true, contentClasses: ["wang-token-walk-scroll"] },
    position: { width: 700, height: 660 },
  };

  constructor({ actor, slot = "walk" }) {
    super({ id: `wang-token-walk-presets-${actor.id}` });
    this.sourceActor = actor;
    this.actor = getAnimationBaseActor(actor);
    if (!this.actor) throw new Error("找不到指示物对应的原角色，请先将角色保存到角色列表。");
    this.presetState = readActorPresetState(actor);
    this.selectedId = this.presetState.bindings[slot] || Object.keys(this.presetState.presets)[0] || "";
    if (!this.selectedId) this._createDraft();
  }

  _createDraft() {
    this.selectedId = newId();
    this.presetState.presets[this.selectedId] = { name: "新预设", animation: freshAnimation() };
  }

  _selected() { return this.presetState.presets[this.selectedId]; }

  _sync() {
    if (!this.element) return;
    const preset = this._selected();
    if (!preset) return;
    preset.name = this.element.querySelector('[name="presetName"]')?.value.trim() || "新预设";
    const animation = preset.animation;
    animation.fps = Number(this.element.querySelector('[name="fps"]')?.value) || 10;
    const endMode = this.element.querySelector('[name="endFrameMode"]')?.value || "restore";
    animation.endFrame = endMode === "custom"
      ? Math.max(1, Math.min(48, Math.trunc(Number(this.element.querySelector('[name="endFrameIndex"]')?.value) || 1)))
      : endMode;
    animation.directional = Boolean(this.element.querySelector('[name="directional"]')?.checked);
    animation.eightWay = Boolean(this.element.querySelector('[name="eightWay"]')?.checked);
    animation.directions ||= {};
    for (const dir of DIR_DEFS) {
      const inputs = [...this.element.querySelectorAll(`input[name^="frame-${dir.key}-"]`)];
      if (inputs.length) animation.directions[dir.key] = inputs.map((input) => input.value.trim());
    }
    for (const slot of ANIMATION_SLOTS) {
      this.presetState.bindings[slot] = this.element.querySelector(`[name="bind-${slot}"]`)?.value || "";
    }
  }

  async _renderHTML() {
    const preset = this._selected();
    const animation = preset.animation;
    const endMode = Number.isInteger(animation.endFrame) ? "custom" : animation.endFrame || "restore";
    const ids = Object.keys(this.presetState.presets);
    const oldState = this.sourceActor !== this.actor ? readActorPresetState(this.sourceActor, { local: true }) : null;
    const recover = oldState && Object.keys(oldState.presets).length && JSON.stringify(oldState) !== JSON.stringify(readActorPresetState(this.actor));
    const options = ids.map((id) => `<option value="${escape(id)}" ${id === this.selectedId ? "selected" : ""}>${escape(this.presetState.presets[id].name)}</option>`).join("");
    const bindings = ANIMATION_SLOTS.map((slot) => `<div class="form-group"><label>${LABELS[slot]}</label><div class="form-fields"><select name="bind-${slot}"><option value="">不播放</option>${ids.map((id) => `<option value="${escape(id)}" ${this.presetState.bindings[slot] === id ? "selected" : ""}>${escape(this.presetState.presets[id].name)}</option>`).join("")}</select></div></div>`).join("");
    const rows = DIR_DEFS.filter((dir) => dir.key === "default" || (animation.directional && (["up", "right", "down", "left"].includes(dir.key) || animation.eightWay))).map((dir) => {
      const frames = animation.directions?.[dir.key] || [];
      return `<fieldset class="wtw-dir"><legend>${escape(dir.label)}</legend><div class="wtw-frames">${frames.length ? frames.map((path, index) => `<div class="wtw-frame">${path ? `<img class="wtw-thumb" src="${escape(path)}" alt="">` : '<div class="wtw-thumb wtw-thumb-empty"></div>'}<span class="wtw-filename" title="${escape(path)}">${escape(filename(path))}</span><input name="frame-${dir.key}-${index}" value="${escape(path)}" placeholder="图片路径"><button type="button" data-action="browse" data-dir="${dir.key}" data-index="${index}" title="浏览图片"><i class="fas fa-folder-open"></i></button><button type="button" data-action="removeFrame" data-dir="${dir.key}" data-index="${index}" title="删除帧"><i class="fas fa-trash"></i></button></div>`).join("") : '<p class="notes">还没有帧</p>'}</div><button type="button" data-action="addFrame" data-dir="${dir.key}"><i class="fas fa-plus"></i> 添加帧</button></fieldset>`;
    }).join("");
    return `<div class="wang-token-walk-form standard-form wtw-editor-shell"><div class="wtw-editor-scroll">
      <p class="notes">预设保存到角色列表中的「${escape(this.actor.name)}」，以后重新拖出这个角色也会使用。创建预设后在下方指定何时自动播放；同一预设可用于多个时机。</p>
      ${recover ? '<button type="button" data-action="recoverToken">载入当前指示物的旧预设</button><p class="notes">只载入编辑器；确认内容后点击保存，才能给以后拖出的指示物使用。</p>' : ""}
      <div class="form-group"><label>当前预设</label><div class="form-fields"><select name="presetSelect">${options}</select><button type="button" data-action="create">新建</button><button type="button" data-action="remove">删除</button></div></div>
      <div class="form-group"><label>预设名称</label><div class="form-fields"><input name="presetName" maxlength="80" value="${escape(preset.name)}"></div></div>
      <fieldset class="wtw-dir"><legend>自动播放</legend>${bindings}</fieldset>
      <div class="form-group"><label>帧率 FPS</label><div class="form-fields"><input type="number" name="fps" min="4" max="24" value="${escape(animation.fps)}"></div></div>
      <div class="form-group"><label>播放结束后</label><div class="form-fields"><select name="endFrameMode"><option value="restore" ${endMode === "restore" ? "selected" : ""}>恢复原图</option><option value="first" ${endMode === "first" ? "selected" : ""}>停在首帧</option><option value="last" ${endMode === "last" ? "selected" : ""}>停在末帧</option><option value="custom" ${endMode === "custom" ? "selected" : ""}>指定帧</option></select><input type="number" name="endFrameIndex" min="1" max="48" value="${Number.isInteger(animation.endFrame) ? animation.endFrame : 1}" ${endMode === "custom" ? "" : "disabled"} aria-label="停止后显示第几帧"></div></div>
      <p class="notes">死亡动画会保持到生命值恢复；选“恢复原图”时，死亡仍默认停在末帧。</p>
      <div class="form-group"><label class="checkbox"><input type="checkbox" name="directional" ${animation.directional ? "checked" : ""}>按朝向使用不同帧（可选）</label></div>
      ${animation.directional ? `<div class="form-group"><label class="checkbox"><input type="checkbox" name="eightWay" ${animation.eightWay ? "checked" : ""}>启用八方向</label></div>` : ""}
      ${rows}
      <fieldset class="wtw-dir"><legend>单个预设</legend><div class="button-row"><button type="button" data-action="exportPresetPackage">导出预设＋素材包</button><button type="button" data-action="exportPreset">仅导出JSON</button><label class="wtw-file-label">导入JSON或ZIP<input type="file" name="importPreset" accept=".json,.zip,application/json,application/zip"></label></div></fieldset>
      <fieldset class="wtw-dir"><legend>整套角色预设</legend><div class="button-row"><button type="button" data-action="exportActorPackage">导出角色＋素材包</button><button type="button" data-action="exportActor">仅导出角色JSON</button><label class="wtw-file-label">导入角色JSON或ZIP<input type="file" name="importActor" accept=".json,.zip,application/json,application/zip"></label></div><p class="notes">包含此角色所有预设、自动播放分配，以及各动作已设置的动画。ZIP还包含引用的帧图片，导入时选择存放目录或COS/CDN网址。找不到或无法唯一匹配的动作会跳过。</p></fieldset>
      <button type="button" data-action="importDemo">载入游荡者示例（移动与攻击）</button>
    </div><div class="wtw-editor-footer button-row"><button type="button" data-action="preview">本机试播</button><button type="button" data-action="save">保存角色预设</button></div></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const actions = {
      create: ActorPresetEditorApp.#create,
      remove: ActorPresetEditorApp.#remove,
      addFrame: ActorPresetEditorApp.#addFrame,
      removeFrame: ActorPresetEditorApp.#removeFrame,
      browse: ActorPresetEditorApp.#browse,
      save: ActorPresetEditorApp.#save,
      preview: ActorPresetEditorApp.#preview,
      exportPreset: ActorPresetEditorApp.#exportPreset,
      exportActor: ActorPresetEditorApp.#exportActor,
      exportPresetPackage: ActorPresetEditorApp.#exportPresetPackage,
      exportActorPackage: ActorPresetEditorApp.#exportActorPackage,
      importDemo: ActorPresetEditorApp.#importDemo,
      recoverToken: ActorPresetEditorApp.#recoverToken,
    };
    for (const button of content.querySelectorAll('button[data-action]')) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        Promise.resolve().then(() => actions[button.dataset.action].call(this, event, button)).catch((error) => {
          console.error(`${MODULE_ID} | preset action`, error);
          ui.notifications.error(`预设操作失败：${error.message}`);
        });
      });
    }
    content.querySelector('[name="presetSelect"]')?.addEventListener("change", (event) => {
      this._sync(); this.selectedId = event.target.value; this.render({ force: true });
    });
    for (const name of ["directional", "eightWay"]) content.querySelector(`[name="${name}"]`)?.addEventListener("change", () => {
      this._sync(); this.render({ force: true });
    });
    content.querySelector('[name="endFrameMode"]')?.addEventListener("change", (event) => {
      content.querySelector('[name="endFrameIndex"]').disabled = event.target.value !== "custom";
    });
    for (const input of content.querySelectorAll('input[name^="frame-"]')) input.addEventListener("input", () => {
      const label = input.closest(".wtw-frame")?.querySelector(".wtw-filename");
      if (label) { label.textContent = filename(input.value); label.title = input.value; }
    });
    content.querySelector('[name="importPreset"]')?.addEventListener("change", (event) => this._importPreset(event));
    content.querySelector('[name="importActor"]')?.addEventListener("change", (event) => this._importActor(event));
    return content;
  }

  static async #create(event) { event.preventDefault(); this._sync(); this._createDraft(); this.render({ force: true }); }

  static async #recoverToken(event) {
    event.preventDefault();
    this.presetState = readActorPresetState(this.sourceActor, { local: true });
    this.selectedId = Object.keys(this.presetState.presets)[0] || "";
    if (!this.selectedId) this._createDraft();
    this.render({ force: true });
    ui.notifications.info("场上旧预设已载入，请确认自动播放分配，再保存到原角色。");
  }

  static async #remove(event) {
    event.preventDefault();
    if (!await foundry.applications.api.DialogV2.confirm({ window: { title: "删除预设" }, content: `<p>删除「${escape(this._selected().name)}」？保存后才会写入角色。</p>` })) return;
    delete this.presetState.presets[this.selectedId];
    for (const slot of ANIMATION_SLOTS) if (this.presetState.bindings[slot] === this.selectedId) this.presetState.bindings[slot] = "";
    this.selectedId = Object.keys(this.presetState.presets)[0] || "";
    if (!this.selectedId) this._createDraft();
    this.render({ force: true });
  }

  static async #addFrame(event, target) { event.preventDefault(); this._sync(); (this._selected().animation.directions[target.dataset.dir] ||= []).push(""); this.render({ force: true }); }
  static async #removeFrame(event, target) { event.preventDefault(); this._sync(); this._selected().animation.directions[target.dataset.dir]?.splice(Number(target.dataset.index), 1); this.render({ force: true }); }

  static async #browse(event, target) {
    event.preventDefault(); this._sync();
    const dir = target.dataset.dir, index = Number(target.dataset.index);
    const current = this._selected().animation.directions[dir]?.[index] || "";
    const Picker = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
    await new Picker({ type: "image", current, callback: (path) => {
      this._selected().animation.directions[dir][index] = path;
      this.render({ force: true });
    } }).browse(current);
  }

  _validState() {
    this._sync();
    const presets = {};
    for (const [id, value] of Object.entries(this.presetState.presets)) {
      const animation = normalizeAnimation(value.animation);
      if (!animation) continue;
      presets[id] = validatePreset({ name: value.name, animation });
    }
    if (!Object.keys(presets).length) throw new Error("至少给一个预设添加帧。");
    const bindings = Object.fromEntries(ANIMATION_SLOTS.map((slot) => [slot, presets[this.presetState.bindings[slot]] ? this.presetState.bindings[slot] : ""]));
    return { presets, bindings };
  }

  async _saveState(state) {
    if (!game.user.isGM && !this.actor.isOwner) throw new Error("需要角色列表中原角色的编辑权限，不能只保存到场上副本。");
    await this.actor.update({
      [`flags.${MODULE_ID}.presetLibrary`]: Object.entries(state.presets).map(([id, preset]) => ({ id, ...preset })),
      [`flags.${MODULE_ID}.presetBindings`]: state.bindings,
    });
    this.presetState = structuredClone(state);
    if (!this.presetState.presets[this.selectedId]) {
      this.selectedId = Object.keys(this.presetState.presets)[0] || "";
      if (!this.selectedId) this._createDraft();
    }
  }

  static async #save(event) {
    event.preventDefault();
    try { await this._saveState(this._validState()); ui.notifications.info("角色动画预设已保存。已启用移动动画的 Token 请重新启用，以更新待机图片。"); this.render({ force: true }); }
    catch (error) { console.warn(`${MODULE_ID} | save presets`, error); ui.notifications.error(`保存失败：${error.message}`); }
  }

  static async #preview(event) {
    event.preventDefault();
    try {
      this._sync();
      const animation = validatePreset(this._selected()).animation;
      const token = canvas.tokens?.controlled?.find((candidate) => getAnimationBaseActor(candidate.actor)?.uuid === this.actor.uuid)
        || this.sourceActor.getActiveTokens?.().find((candidate) => candidate.document && !candidate.destroyed)
        || this.actor.getActiveTokens?.().find((candidate) => candidate.document && !candidate.destroyed);
      if (!token) return ui.notifications.warn("请先将角色放到当前场景。");
      await playTokenAnimation(token, animation, { holdLast: false });
    } catch (error) { console.warn(`${MODULE_ID} | preview`, error); ui.notifications.error(`试播失败：${error.message}`); }
  }

  static async #exportPreset(event) {
    event.preventDefault();
    try { this._sync(); const preset = validatePreset(this._selected()); downloadJson(`${safeExportName(preset.name)}-预设.json`, { format: PRESET_FORMAT, version: 1, ...preset }); }
    catch (error) { ui.notifications.error(`无法导出：${error.message}`); }
  }

  static async #exportActor(event) {
    event.preventDefault();
    try {
      const state = this._validState();
      downloadJson(`${safeExportName(this.actor.name)}-角色预设.json`, this._actorBundle(state));
    } catch (error) { ui.notifications.error(`无法导出：${error.message}`); }
  }

  static async #exportPresetPackage(event) {
    event.preventDefault();
    this._sync();
    const preset = validatePreset(this._selected());
    await withAssetTransfer(this, progress => exportAssetPackage(
      { format: PRESET_FORMAT, version: 1, ...preset }, `${safeExportName(preset.name)}-素材包`, progress));
  }

  static async #exportActorPackage(event) {
    event.preventDefault();
    const payload = this._actorBundle(this._validState());
    await withAssetTransfer(this, progress => exportAssetPackage(payload, `${safeExportName(this.actor.name)}-角色素材包`, progress));
  }

  _actorBundle(state) {
    const bundle = buildActorPresetBundle(this.actor, state);
    if (this.sourceActor !== this.actor) {
      const old = buildActorPresetBundle(this.sourceActor, state);
      const known = new Set(bundle.actions.map(action => `${action.id}:${action.name}:${action.type}`));
      bundle.actions.push(...old.actions.filter(action => !known.has(`${action.id}:${action.name}:${action.type}`)));
    }
    return bundle;
  }

  async _importPreset(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      this._sync();
      const value = await withAssetTransfer(this, progress => readPresetFile(file, PRESET_FORMAT, progress));
      if (!value) return;
      const preset = validatePreset(value);
      this.selectedId = newId(); this.presetState.presets[this.selectedId] = preset;
      this.render({ force: true }); ui.notifications.info("预设已载入；点击“保存角色预设”后生效。");
    } catch (error) { ui.notifications.error(`导入失败：${error.message}`); }
    finally { event.target.value = ""; }
  }

  async _importActor(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      this._sync();
      const matched = await withAssetTransfer(this, async progress => {
        const payload = await readPresetFile(file, ACTOR_FORMAT, progress, value =>
          foundry.applications.api.DialogV2.confirm({ window: { title: "导入角色预设" }, content: `<p>用文件中的 ${Object.keys(value.presets).length} 个预设替换此角色的预设，并尝试匹配 ${value.actions.length} 个动作动画？</p><p>只写入动画设置，不改变角色属性或物品内容。</p>` }));
        if (!payload) return null;
        const value = validateActorPresetBundle(payload);
        progress("保存角色与动作动画……");
        const changes = [], used = new Set();
        for (const action of value.actions) {
          const exact = this.actor.items.get(action.id);
          const candidates = this.actor.items.filter(candidate => candidate.name === action.name && candidate.type === action.type);
          const item = exact?.name === action.name && exact.type === action.type ? exact : candidates.length === 1 ? candidates[0] : null;
          if (!item || used.has(item.id)) continue;
          used.add(item.id);
          changes.push({ _id: item.id, [`flags.${MODULE_ID}.actionAnimation`]: action.animation });
        }
        await this._saveState({ presets: value.presets, bindings: value.bindings });
        if (changes.length) {
          try { await this.actor.updateEmbeddedDocuments("Item", changes, { recursive: false }); }
          catch (error) { throw new Error(`角色预设已写入，但动作动画保存失败：${error.message}。请重新导入。`); }
        }
        return { count: changes.length, total: value.actions.length };
      });
      if (!matched) return;
      this.selectedId = Object.keys(this.presetState.presets)[0] || "";
      if (!this.selectedId) this._createDraft();
      this.render({ force: true }); ui.notifications.info(`角色预设已导入；${matched.count}/${matched.total} 个动作动画已匹配。`);
    } catch (error) { console.warn(`${MODULE_ID} | import actor presets`, error); ui.notifications.error(`导入失败：${error.message}`); }
    finally { event.target.value = ""; }
  }

  static async #importDemo(event) {
    event.preventDefault(); this._sync();
    try {
      const base = `modules/${MODULE_ID}/assets/sheets/rogue-demo/`;
      const [walk, attack] = await Promise.all(["manifest.json", "attack.json"].map(async (name) => {
        const response = await fetch(base + name); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json();
      }));
      const walkId = newId(), attackId = newId();
      this.presetState.presets[walkId] = validatePreset({ name: "游荡者移动", animation: walk });
      this.presetState.presets[attackId] = validatePreset({ name: "游荡者攻击", animation: attack });
      this.presetState.bindings.walk = walkId; this.presetState.bindings.attack = attackId; this.selectedId = walkId;
      this.render({ force: true }); ui.notifications.info("示例预设已载入；点击“保存角色预设”后生效。");
    } catch (error) { console.warn(`${MODULE_ID} | demo`, error); ui.notifications.error(`示例载入失败：${error.message}`); }
  }
}

export function openActorPresetEditor(actor, slot = "walk") {
  const base = getAnimationBaseActor(actor);
  if (!base) return ui.notifications.warn("找不到指示物对应的原角色，请先将角色保存到角色列表。");
  if (!game.user.isGM && !base.isOwner) return ui.notifications.warn("需要角色列表中原角色的编辑权限。");
  return new ActorPresetEditorApp({ actor, slot }).render({ force: true });
}

