import {
  DIR_DEFS,
  getWorldSheets,
  loadManifest,
} from "./sheet-registry.mjs";

const MODULE_ID = "wang-token-walk";

function esc(s) {
  return foundry.utils.escapeHTML(String(s ?? ""));
}

/**
 * 可视化走路表编辑器：用 Foundry 文件浏览器点选每一帧
 */
export class SheetEditorApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "wang-token-walk-sheet-editor",
    classes: ["wang-token-walk", "wang-token-walk-editor"],
    tag: "div",
    window: {
      title: "WANGTOKENWALK.Editor.Title",
      resizable: true,
      contentClasses: ["wang-token-walk-scroll"],
    },
    position: { width: 660, height: 640 },
    actions: {
      browse: SheetEditorApp.#onBrowse,
      addFrame: SheetEditorApp.#onAddFrame,
      removeFrame: SheetEditorApp.#onRemoveFrame,
      save: SheetEditorApp.#onSave,
      del: SheetEditorApp.#onDelete,
      loadWorld: SheetEditorApp.#onLoadWorld,
      newSheet: SheetEditorApp.#onNew,
    },
  };

  /** @type {{ id: string, label: string, fps: number, eightWay: boolean, directions: Record<string,string[]> }} */
  _draft = {
    id: "",
    label: "",
    fps: 10,
    eightWay: false,
    directions: { up: [], right: [], down: [], left: [] },
  };

  _pendingLoadId = null;

  constructor(options = {}) {
    super(options);
    if (options.sheetId) this._pendingLoadId = options.sheetId;
  }

  async _ensureDraftLoaded() {
    if (!this._pendingLoadId) return;
    const id = this._pendingLoadId;
    this._pendingLoadId = null;
    try {
      const man = await loadManifest(id);
      this._draft = {
        id: man.id || id,
        label: man.label || man.id || id,
        fps: Number(man.fps) || 10,
        eightWay: Boolean(man.eightWay),
        directions: foundry.utils.deepClone(man.directions || {}),
      };
    } catch (_) {
      this._draft.id = id;
    }
  }

  async _renderHTML() {
    await this._ensureDraftLoaded();
    const d = this._draft;
    const world = getWorldSheets();
    const worldOpts = Object.entries(world)
      .map(
        ([id, man]) =>
          `<option value="${esc(id)}">${esc(man.label || id)}</option>`
      )
      .join("");

    const dirRows = DIR_DEFS.filter(
      (dir) => ["up", "right", "down", "left"].includes(dir.key) || d.eightWay
    );

    const dirBlocks = dirRows
      .map((dir) => {
        const frames = d.directions[dir.key] || [];
        const rows = frames
          .map((path, i) => {
            const thumb = path
              ? `<img class="wtw-thumb" src="${esc(path)}" alt="">`
              : `<div class="wtw-thumb wtw-thumb-empty"></div>`;
            return `
            <div class="wtw-frame" data-dir="${esc(dir.key)}" data-index="${i}">
              ${thumb}
              <input type="text" name="frame-${dir.key}-${i}" value="${esc(path)}" placeholder="点右侧文件夹选图">
              <button type="button" data-action="browse" data-dir="${esc(dir.key)}" data-index="${i}" title="浏览图片"><i class="fas fa-folder-open"></i></button>
              <button type="button" data-action="removeFrame" data-dir="${esc(dir.key)}" data-index="${i}" title="删除此帧"><i class="fas fa-trash"></i></button>
            </div>`;
          })
          .join("");
        return `
          <fieldset class="wtw-dir">
            <legend>${esc(dir.label)}</legend>
            <div class="wtw-frames">${
              rows || `<p class="notes">还没有帧 → 点「添加帧」用文件浏览器选图</p>`
            }</div>
            <button type="button" class="wtw-add" data-action="addFrame" data-dir="${esc(dir.key)}">
              <i class="fas fa-plus"></i> 添加帧
            </button>
          </fieldset>`;
      })
      .join("");

    return `
      <div class="wang-token-walk-form standard-form flexcol wtw-scroll-body">
        <p class="notes">用「文件夹」按钮从 Foundry 资源库选图，保存到<strong>本世界</strong>后即可给任意 Token 挂上。不必手写路径。</p>

        <div class="form-group">
          <label>加载已有世界表</label>
          <div class="form-fields">
            <select name="loadWorldId">
              <option value="">— 选择 —</option>
              ${worldOpts}
            </select>
            <button type="button" data-action="loadWorld">加载</button>
            <button type="button" data-action="newSheet">新建空白</button>
          </div>
        </div>

        <div class="form-group">
          <label>表 ID</label>
          <div class="form-fields">
            <input type="text" name="sheetId" value="${esc(d.id)}" placeholder="例如 hero01">
          </div>
        </div>
        <div class="form-group">
          <label>显示名称</label>
          <div class="form-fields">
            <input type="text" name="sheetLabel" value="${esc(d.label)}" placeholder="例如 英雄甲">
          </div>
        </div>
        <div class="form-group">
          <label>帧率 FPS</label>
          <div class="form-fields">
            <input type="number" name="sheetFps" value="${esc(d.fps)}" min="4" max="24" step="1">
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox">
            <input type="checkbox" name="eightWay" ${d.eightWay ? "checked" : ""}>
            启用八向（可填斜向帧；不填则复用左右）
          </label>
        </div>

        ${dirBlocks}

        <div class="form-group button-row">
          <button type="button" data-action="save"><i class="fas fa-save"></i> 保存到本世界</button>
          <button type="button" data-action="del"><i class="fas fa-trash"></i> 删除此世界表</button>
        </div>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    this._bindLiveFields(content);
    return content;
  }

  _bindLiveFields(root) {
    root.querySelector('[name="eightWay"]')?.addEventListener("change", (e) => {
      this._syncDraftFromDom();
      this._draft.eightWay = e.target.checked;
      this.render({ force: true });
    });
  }

  _syncDraftFromDom() {
    const root = this.element;
    if (!root) return;
    this._draft.id = root.querySelector('[name="sheetId"]')?.value?.trim() || "";
    this._draft.label = root.querySelector('[name="sheetLabel"]')?.value?.trim() || "";
    this._draft.fps = Number(root.querySelector('[name="sheetFps"]')?.value) || 10;
    this._draft.eightWay = Boolean(root.querySelector('[name="eightWay"]')?.checked);
    for (const dir of DIR_DEFS.map((x) => x.key)) {
      const inputs = [...root.querySelectorAll(`input[name^="frame-${dir}-"]`)];
      if (!inputs.length) continue;
      this._draft.directions[dir] = inputs.map((i) => i.value.trim()).filter((v) => v !== undefined);
      // keep empty slots while editing? filter empty on save only
      this._draft.directions[dir] = inputs.map((i) => i.value.trim());
    }
  }

  static async #onBrowse(event, target) {
    event.preventDefault();
    const dir = target.dataset.dir;
    const index = Number(target.dataset.index);
    this._syncDraftFromDom();
    const current = this._draft.directions[dir]?.[index] || "";
    const FP = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
    await new FP({
      type: "image",
      current,
      callback: (path) => {
        if (!this._draft.directions[dir]) this._draft.directions[dir] = [];
        this._draft.directions[dir][index] = path;
        this.render({ force: true });
      },
    }).browse(current);
  }

  static async #onAddFrame(event, target) {
    event.preventDefault();
    this._syncDraftFromDom();
    const dir = target.dataset.dir;
    if (!this._draft.directions[dir]) this._draft.directions[dir] = [];
    this._draft.directions[dir].push("");
    const index = this._draft.directions[dir].length - 1;
    await this.render({ force: true });
    const FP = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
    await new FP({
      type: "image",
      callback: (path) => {
        this._draft.directions[dir][index] = path;
        this.render({ force: true });
      },
    }).browse();
  }

  static async #onRemoveFrame(event, target) {
    event.preventDefault();
    this._syncDraftFromDom();
    const dir = target.dataset.dir;
    const index = Number(target.dataset.index);
    this._draft.directions[dir]?.splice(index, 1);
    this.render({ force: true });
  }

  static async #onSave(event) {
    event.preventDefault();
    this._syncDraftFromDom();
    // strip empty paths
    const directions = {};
    for (const [k, frames] of Object.entries(this._draft.directions || {})) {
      const list = (frames || []).map((p) => String(p || "").trim()).filter(Boolean);
      if (list.length) directions[k] = list;
    }
    const saved = await game.wangTokenWalk.saveWorldSheet({
      ...this._draft,
      directions,
    });
    if (saved) {
      this._draft = foundry.utils.deepClone(saved);
      this.render({ force: true });
    }
  }

  static async #onDelete(event) {
    event.preventDefault();
    this._syncDraftFromDom();
    const id = this._draft.id;
    if (!id) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "删除走路表" },
      content: `<p>确定删除世界走路表 <strong>${esc(id)}</strong>？</p>`,
    });
    if (!ok) return;
    await game.wangTokenWalk.deleteWorldSheet(id);
    this._draft = {
      id: "",
      label: "",
      fps: 10,
      eightWay: false,
      directions: { up: [], right: [], down: [], left: [] },
    };
    this.render({ force: true });
  }

  static async #onLoadWorld(event) {
    event.preventDefault();
    const id = this.element.querySelector('[name="loadWorldId"]')?.value;
    if (!id) return ui.notifications.warn("请先选择要加载的世界表。");
    const man = await loadManifest(id);
    this._draft = {
      id: man.id || id,
      label: man.label || id,
      fps: Number(man.fps) || 10,
      eightWay: Boolean(man.eightWay),
      directions: foundry.utils.deepClone(man.directions || {}),
    };
    this.render({ force: true });
  }

  static async #onNew(event) {
    event.preventDefault();
    this._draft = {
      id: "",
      label: "",
      fps: 10,
      eightWay: false,
      directions: { up: [""], right: [""], down: [""], left: [""] },
    };
    this.render({ force: true });
  }
}

export function openSheetEditor(sheetId = null) {
  return new SheetEditorApp({ sheetId }).render({ force: true });
}
