import { DIR_DEFS, listSheets, loadManifest } from "./sheet-registry.mjs";
import {
  ANIMATION_SLOTS, ACTION_TRIGGERS, PRESET_FORMAT, getActorAnimation, getItemAnimation, normalizeAnimation, getAnimationBaseActor, safeExportName,
} from "./animation-data.mjs";
import { playTokenAnimation } from "./walk-engine.mjs";
import { exportAssetPackage, readPresetFile, withAssetTransfer } from "./asset-package.mjs";

const MODULE_ID = "wang-token-walk";
const SLOT_LABELS = { walk: "走路", attack: "通用攻击", cast: "通用施法", hit: "挨打", death: "死亡" };
const TRIGGER_LABELS = {
  onUse: "使用动作时", onCast: "施法时", onAttack: "攻击掷骰时", onDamage: "伤害掷骰时", onCrit: "暴击时",
};
const escape = (value) => foundry.utils.escapeHTML(String(value ?? ""));
const filename = (path) => String(path || "").split(/[\\/]/).pop() || "未选择图片";

function emptyAnimation(walk = false) {
  return { fps: 10, eightWay: false, directional: walk, trigger: "onUse",
    directions: walk ? { up: [], right: [], down: [], left: [] } : { default: [] } };
}

export class AnimationEditorApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "wang-token-walk-animation-editor",
    classes: ["wang-token-walk", "wang-token-walk-editor"],
    tag: "div",
    window: { title: "角色帧动画", resizable: true, contentClasses: ["wang-token-walk-scroll"] },
    position: { width: 660, height: 640 },
  };

  constructor({ actor = null, item = null, slot = "walk" } = {}) {
    super({ id: `wang-token-walk-animation-${String(item?.uuid || actor?.uuid || "editor").replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      window: { title: item ? "动作帧动画" : "角色帧动画" } });
    this.sourceActor = actor || item?.actor || null;
    this.actor = item ? this.sourceActor : getAnimationBaseActor(this.sourceActor);
    this.item = item;
    this.slot = ANIMATION_SLOTS.includes(slot) ? slot : "walk";
    this.drafts = {};
  }

  get isItem() { return Boolean(this.item); }
  get isWalk() { return !this.isItem && this.slot === "walk"; }

  _draft() {
    const key = this.isItem ? "action" : this.slot;
    if (!this.drafts[key]) {
      const saved = this.isItem ? getItemAnimation(this.item) : getActorAnimation(this.sourceActor, this.slot);
      this.drafts[key] = saved ? foundry.utils.deepClone(saved) : emptyAnimation(this.isWalk);
      if (this.drafts[key].directional === undefined) {
        this.drafts[key].directional = this.isWalk || !this.drafts[key].directions?.default;
      }
    }
    return this.drafts[key];
  }

  async _renderHTML() {
    const draft = this._draft();
    const endMode = Number.isInteger(draft.endFrame) ? "custom" : draft.endFrame || "restore";
    const showDirections = this.isWalk || draft.directional;
    const slots = ANIMATION_SLOTS.map((slot) =>
      `<option value="${slot}" ${this.slot === slot ? "selected" : ""}>${SLOT_LABELS[slot]}</option>`
    ).join("");
    const triggers = ACTION_TRIGGERS.map((trigger) =>
      `<option value="${trigger}" ${draft.trigger === trigger ? "selected" : ""}>${TRIGGER_LABELS[trigger]}</option>`
    ).join("");
    const legacy = !this.isItem && this.slot === "walk" ? listSheets().map((sheet) =>
      `<option value="${escape(sheet.id)}">${escape(sheet.label)}</option>`
    ).join("") : "";
    const rows = DIR_DEFS.filter((dir) =>
      (dir.key === "default" && !this.isWalk) ||
      (showDirections && (["up", "right", "down", "left"].includes(dir.key) || draft.eightWay))
    ).map((dir) => {
      const frames = draft.directions?.[dir.key] || [];
      const inputs = frames.map((path, index) => `
        <div class="wtw-frame">
          ${path ? `<img class="wtw-thumb" src="${escape(path)}" alt="">` : `<div class="wtw-thumb wtw-thumb-empty"></div>`}
          <span class="wtw-filename" title="${escape(path)}">${escape(filename(path))}</span>
          <input type="text" name="frame-${dir.key}-${index}" value="${escape(path)}" placeholder="选择帧图片">
          <button type="button" data-action="browse" data-dir="${dir.key}" data-index="${index}" title="浏览图片"><i class="fas fa-folder-open"></i></button>
          <button type="button" data-action="removeFrame" data-dir="${dir.key}" data-index="${index}" title="删除帧"><i class="fas fa-trash"></i></button>
        </div>`).join("");
      return `<fieldset class="wtw-dir"><legend>${escape(dir.label)}</legend>
        <div class="wtw-frames">${inputs || '<p class="notes">还没有帧</p>'}</div>
        <button type="button" data-action="addFrame" data-dir="${dir.key}"><i class="fas fa-plus"></i> 添加帧</button>
      </fieldset>`;
    }).join("");

    return `<div class="wang-token-walk-form standard-form wtw-editor-shell"><div class="wtw-editor-scroll">
      <p class="notes">${this.isItem ? `此动画只属于动作「${escape(this.item.name)}」。` : `这些帧只属于角色「${escape(this.actor?.name)}」。`}${this.isWalk ? "走路按方向播放。" : "默认只需填写通用帧；有不同朝向的素材时再启用方向。"}</p>
      ${this.isItem ? `<div class="form-group"><label>播放时机</label><div class="form-fields"><select name="trigger">${triggers}</select></div></div>`
        : `<div class="form-group"><label>动画类型</label><div class="form-fields"><select name="slot">${slots}</select></div></div>`}
      <div class="form-group"><label>帧率 FPS</label><div class="form-fields"><input type="number" name="fps" min="4" max="24" step="1" value="${escape(draft.fps)}"></div></div>
      <div class="form-group"><label>播放结束后</label><div class="form-fields"><select name="endFrameMode"><option value="restore" ${endMode === "restore" ? "selected" : ""}>恢复原图</option><option value="first" ${endMode === "first" ? "selected" : ""}>停在首帧</option><option value="last" ${endMode === "last" ? "selected" : ""}>停在末帧</option><option value="custom" ${endMode === "custom" ? "selected" : ""}>指定帧</option></select><input type="number" name="endFrameIndex" min="1" max="48" value="${Number.isInteger(draft.endFrame) ? draft.endFrame : 1}" ${endMode === "custom" ? "" : "disabled"} aria-label="停止后显示第几帧"></div></div>
      ${this.isWalk ? "" : `<div class="form-group"><label class="checkbox"><input type="checkbox" name="directional" ${draft.directional ? "checked" : ""}>按角色朝向播放不同帧（可选）</label></div>`}
      ${showDirections ? `<div class="form-group"><label class="checkbox"><input type="checkbox" name="eightWay" ${draft.eightWay ? "checked" : ""}>启用八方向</label></div>` : ""}
      ${rows}
      ${legacy ? `<hr><div class="form-group"><label>导入旧共用表</label><div class="form-fields"><select name="legacySheet"><option value="">— 选择 —</option>${legacy}</select><button type="button" data-action="importLegacy">复制帧到此角色</button></div></div>` : ""}
      ${!this.isItem && ["walk", "attack"].includes(this.slot) ? `<div class="form-group"><label>示例素材</label><div class="form-fields"><button type="button" data-action="importDemo">载入游荡者${this.slot === "walk" ? "走路" : "攻击"}帧</button></div></div>` : ""}
      ${this.isItem ? `<div class="form-group button-row"><button type="button" data-action="exportPackage">导出动作＋素材包</button><button type="button" data-action="exportPreset">仅导出动作JSON</button><label class="wtw-file-label">导入JSON或ZIP<input type="file" name="importActionPreset" accept=".json,.zip,application/json,application/zip"></label></div>` : ""}
    </div><div class="wtw-editor-footer button-row"><button type="button" data-action="preview"><i class="fas fa-play"></i> 本机试播</button><button type="button" data-action="save"><i class="fas fa-save"></i> 保存</button><button type="button" data-action="clear"><i class="fas fa-trash"></i> 清除此动画</button></div></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const actions = {
      browse: AnimationEditorApp.#onBrowse,
      addFrame: AnimationEditorApp.#onAddFrame,
      removeFrame: AnimationEditorApp.#onRemoveFrame,
      importLegacy: AnimationEditorApp.#onImportLegacy,
      importDemo: AnimationEditorApp.#onImportDemo,
      save: AnimationEditorApp.#onSave,
      clear: AnimationEditorApp.#onClear,
      preview: AnimationEditorApp.#onPreview,
      exportPreset: AnimationEditorApp.#onExportPreset,
      exportPackage: AnimationEditorApp.#onExportPackage,
    };
    for (const button of content.querySelectorAll('button[data-action]')) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        Promise.resolve().then(() => actions[button.dataset.action].call(this, event, button)).catch((error) => {
          console.error(`${MODULE_ID} | action editor`, error);
          ui.notifications.error(`动作动画操作失败：${error.message}`);
        });
      });
    }
    content.querySelector('[name="slot"]')?.addEventListener("change", (event) => {
      this._syncDraft();
      this.slot = event.target.value;
      this.render({ force: true });
    });
    content.querySelector('[name="eightWay"]')?.addEventListener("change", () => {
      this._syncDraft();
      this.render({ force: true });
    });
    content.querySelector('[name="directional"]')?.addEventListener("change", () => {
      this._syncDraft();
      this.render({ force: true });
    });
    content.querySelector('[name="endFrameMode"]')?.addEventListener("change", (event) => {
      content.querySelector('[name="endFrameIndex"]').disabled = event.target.value !== "custom";
    });
    for (const input of content.querySelectorAll('input[name^="frame-"]')) input.addEventListener("input", () => {
      const label = input.closest(".wtw-frame")?.querySelector(".wtw-filename");
      if (label) { label.textContent = filename(input.value); label.title = input.value; }
    });
    content.querySelector('[name="importActionPreset"]')?.addEventListener("change", (event) => this._importActionPreset(event));
    return content;
  }

  async _importActionPreset(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = await withAssetTransfer(this, progress => readPresetFile(file, PRESET_FORMAT, progress));
      if (!data) return;
      const animation = normalizeAnimation(data.animation, { item: true });
      if (!animation) throw new Error("预设没有有效帧。");
      this.drafts.action = animation;
      this.render({ force: true });
      ui.notifications.info("动作预设已载入；点击“保存”后生效。");
    } catch (error) { ui.notifications.error(`导入失败：${error.message}`); }
    finally { event.target.value = ""; }
  }

  static async #onExportPreset(event) {
    event.preventDefault();
    this._syncDraft();
    const animation = normalizeAnimation(this._draft(), { item: true });
    if (!animation) return ui.notifications.error("请至少添加一帧图片。");
    const data = { format: PRESET_FORMAT, version: 1, name: this.item.name, animation };
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json",
      `${safeExportName(this.item.name)}-动作预设.json`);
  }

  static async #onExportPackage(event) {
    event.preventDefault();
    this._syncDraft();
    const animation = normalizeAnimation(this._draft(), { item: true });
    if (!animation) throw new Error("请至少添加一帧图片。");
    await withAssetTransfer(this, progress => exportAssetPackage(
      { format: PRESET_FORMAT, version: 1, name: this.item.name, animation }, `${safeExportName(this.item.name)}-动作素材包`, progress));
  }

  _syncDraft() {
    if (!this.element) return;
    const draft = this._draft();
    draft.fps = Number(this.element.querySelector('[name="fps"]')?.value) || 10;
    const endMode = this.element.querySelector('[name="endFrameMode"]')?.value || "restore";
    draft.endFrame = endMode === "custom"
      ? Math.max(1, Math.min(48, Math.trunc(Number(this.element.querySelector('[name="endFrameIndex"]')?.value) || 1)))
      : endMode;
    draft.directional = this.isWalk || Boolean(this.element.querySelector('[name="directional"]')?.checked);
    draft.eightWay = Boolean(this.element.querySelector('[name="eightWay"]')?.checked);
    if (this.isItem) draft.trigger = this.element.querySelector('[name="trigger"]')?.value || "onUse";
    draft.directions ||= {};
    for (const dir of DIR_DEFS) {
      const inputs = [...this.element.querySelectorAll(`input[name^="frame-${dir.key}-"]`)];
      if (inputs.length) draft.directions[dir.key] = inputs.map((input) => input.value.trim());
    }
  }

  static async #onBrowse(event, target) {
    event.preventDefault();
    this._syncDraft();
    const dir = target.dataset.dir;
    const index = Number(target.dataset.index);
    const current = this._draft().directions[dir]?.[index] || "";
    const Picker = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
    await new Picker({ type: "image", current, callback: (path) => {
      this._draft().directions[dir][index] = path;
      this.render({ force: true });
    } }).browse(current);
  }

  static async #onAddFrame(event, target) {
    event.preventDefault();
    this._syncDraft();
    const dir = target.dataset.dir;
    this._draft().directions[dir] ||= [];
    this._draft().directions[dir].push("");
    this.render({ force: true });
  }

  static async #onRemoveFrame(event, target) {
    event.preventDefault();
    this._syncDraft();
    this._draft().directions[target.dataset.dir]?.splice(Number(target.dataset.index), 1);
    this.render({ force: true });
  }

  static async #onImportLegacy(event) {
    event.preventDefault();
    const id = this.element.querySelector('[name="legacySheet"]')?.value;
    if (!id) return;
    this._syncDraft();
    const manifest = await loadManifest(id);
    this.drafts.walk = { ...emptyAnimation(true), ...foundry.utils.deepClone(manifest), directional: true };
    this.render({ force: true });
  }

  static async #onImportDemo(event) {
    event.preventDefault();
    this._syncDraft();
    const name = this.slot === "walk" ? "manifest.json" : "attack.json";
    try {
      const response = await fetch(`modules/${MODULE_ID}/assets/sheets/rogue-demo/${name}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.drafts[this.slot] = await response.json();
      this.render({ force: true });
    } catch (error) {
      console.warn(`${MODULE_ID} | demo frames`, error);
      ui.notifications.error("载入游荡者示例帧失败。");
    }
  }

  static async #onSave(event) {
    event.preventDefault();
    this._syncDraft();
    const animation = normalizeAnimation(this._draft(), { item: this.isItem });
    if (!animation) return ui.notifications.error("请至少添加一帧图片。");
    try {
      if (this.isItem) await this.item.setFlag(MODULE_ID, "actionAnimation", animation);
      else {
        const all = foundry.utils.deepClone(this.actor.getFlag(MODULE_ID, "animations") || {});
        all[this.slot] = animation;
        await this.actor.setFlag(MODULE_ID, "animations", all);
      }
      ui.notifications.info(this.slot === "walk" && !this.isItem
        ? "走路帧已保存。已启用走路的 Token 请重新启用，以更新待机图片。"
        : "帧动画已保存。");
    } catch (err) {
      console.warn(`${MODULE_ID} | save animation`, err);
      ui.notifications.error("保存失败，请确认你有这个角色或动作的编辑权限。");
    }
  }

  static async #onClear(event) {
    event.preventDefault();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "清除帧动画" }, content: "<p>确定清除当前动画设置吗？</p>",
    });
    if (!confirmed) return;
    try {
      if (this.isItem) await this.item.unsetFlag(MODULE_ID, "actionAnimation");
      else {
        const all = foundry.utils.deepClone(this.actor.getFlag(MODULE_ID, "animations") || {});
        delete all[this.slot];
        await this.actor.setFlag(MODULE_ID, "animations", all);
      }
      this.drafts[this.isItem ? "action" : this.slot] = emptyAnimation(this.isWalk);
      this.render({ force: true });
    } catch (err) {
      console.warn(`${MODULE_ID} | clear animation`, err);
      ui.notifications.error("清除失败，请确认编辑权限。");
    }
  }

  static async #onPreview(event) {
    event.preventDefault();
    this._syncDraft();
    const animation = normalizeAnimation(this._draft(), { item: this.isItem });
    if (!animation) return ui.notifications.error("请至少添加一帧图片。");
    const tokens = this.sourceActor?.getActiveTokens?.() || this.actor?.getActiveTokens?.() || [];
    const token = canvas.tokens?.controlled?.find((candidate) => getAnimationBaseActor(candidate.actor)?.uuid === getAnimationBaseActor(this.actor)?.uuid)
      || tokens.find((candidate) => candidate.document && !candidate.destroyed);
    if (!token) return ui.notifications.warn("请先把角色放在当前场景，再试播动画。");
    try {
      await playTokenAnimation(token, animation, { holdLast: false });
    } catch (error) {
      console.warn(`${MODULE_ID} | preview`, error);
      ui.notifications.error("试播失败，请检查帧图片的路径。");
    }
  }
}

export function openActorAnimationEditor(actor, slot = "walk") {
  const base = getAnimationBaseActor(actor);
  if (!base || (!game.user.isGM && !base.isOwner)) return ui.notifications.warn("需要角色列表中原角色的编辑权限。");
  return new AnimationEditorApp({ actor, slot }).render({ force: true });
}

export function openItemAnimationEditor(item) {
  return new AnimationEditorApp({ item }).render({ force: true });
}
