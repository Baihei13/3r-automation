import { getActorAnimation } from "./animation-data.mjs";
import { ACTOR_SHEET_ID } from "./walk-engine.mjs";
import { openActorPresetEditor } from "./preset-editor-app.mjs";
const MODULE_ID = "wang-token-walk";

/** Token 选用走路表 + 打开可视化编辑器 */
export class WalkConfigApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "wang-token-walk-config",
    classes: ["wang-token-walk"],
    tag: "div",
    window: {
      title: "WANGTOKENWALK.Title",
      resizable: false,
    },
    position: { width: 460 },
    actions: {
      enable: WalkConfigApp.#onEnable,
      disable: WalkConfigApp.#onDisable,
      test: WalkConfigApp.#onTest,
      refresh: WalkConfigApp.#onRefresh,
      editSheet: WalkConfigApp.#onEditSheet,
      newSheet: WalkConfigApp.#onNewSheet,
      editHit: WalkConfigApp.#onEditHit,
      editAttack: WalkConfigApp.#onEditAttack,
      editDeath: WalkConfigApp.#onEditDeath,
    },
  };

  async _prepareContext() {
    const tok = canvas.tokens?.controlled?.[0] || null;
    const actor = tok?.actor || null;
    return {
      tokenName: tok?.name || "（未选中）",
      actorName: actor?.name || "（无角色）",
      walk: Boolean(getActorAnimation(actor, "walk")),
      hit: Boolean(getActorAnimation(actor, "hit")),
      attack: Boolean(getActorAnimation(actor, "attack")),
      death: Boolean(getActorAnimation(actor, "death")),
      enabled: tok?.document?.getFlag(MODULE_ID, "sheet") === ACTOR_SHEET_ID,
    };
  }

  async _renderHTML() {
    const ctx = await this._prepareContext();
    return `
      <form class="flexcol wang-token-walk-form standard-form">
        <p class="notes">角色预设保存到角色列表中的原角色，重新拖出指示物也能播放。“启用走路”会保存当前及默认指示物的待机图片；单独动作的帧请到那个动作的物品页设置。</p>
        <div class="form-group">
          <label>角色 / Token</label>
          <div class="form-fields"><code>${foundry.utils.escapeHTML(ctx.actorName)} / ${foundry.utils.escapeHTML(ctx.tokenName)}</code></div>
        </div>
        <div class="form-group">
          <label>角色帧</label><div class="form-fields">走路：${ctx.walk ? "已设置" : "未设置"}　通用攻击：${ctx.attack ? "已设置" : "未设置"}　挨打：${ctx.hit ? "已设置" : "未设置"}　死亡：${ctx.death ? "已设置" : "未设置"}</div>
        </div>
        <div class="form-group button-row">
          <button type="button" data-action="enable"><i class="fas fa-person-walking"></i> 启用走路</button>
          <button type="button" data-action="test"><i class="fas fa-play"></i> 试播走路</button>
          <button type="button" data-action="disable"><i class="fas fa-ban"></i> 停用走路</button>
        </div>
        <hr>
        <div class="form-group button-row">
          <button type="button" data-action="editSheet"><i class="fas fa-person-walking"></i> 编辑走路帧</button>
          <button type="button" data-action="editAttack"><i class="fas fa-bolt"></i> 编辑通用攻击帧</button>
          <button type="button" data-action="editHit"><i class="fas fa-heart-crack"></i> 编辑挨打帧</button>
          <button type="button" data-action="editDeath"><i class="fas fa-skull"></i> 编辑死亡帧</button>
        </div>
      </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    return content;
  }

  static async #onRefresh(event) {
    event.preventDefault();
    await this.render({ force: true });
  }

  static async #onEnable(event) {
    event.preventDefault();
    const token = game.wangTokenWalk.resolveToken();
    if (!token) return;
    if (!getActorAnimation(token.actor, "walk")) return ui.notifications.warn("请先给此角色设置走路帧。");
    await game.wangTokenWalk.enableWalk({ token, sheetId: ACTOR_SHEET_ID });
    this.render({ force: true });
  }

  static async #onDisable(event) {
    event.preventDefault();
    await game.wangTokenWalk.disableWalk();
    this.render({ force: true });
  }

  static async #onTest(event) {
    event.preventDefault();
    const token = game.wangTokenWalk.resolveToken();
    if (!token) return;
    if (!getActorAnimation(token.actor, "walk")) return ui.notifications.warn("请先给此角色设置走路帧。");
    await game.wangTokenWalk.testWalkInPlace({ token, sheetId: ACTOR_SHEET_ID });
  }

  static async #onNewSheet(event) {
    event.preventDefault();
    this._openActorSlot("walk");
  }

  static async #onEditSheet(event) {
    event.preventDefault();
    this._openActorSlot("walk");
  }

  static async #onEditHit(event) { event.preventDefault(); this._openActorSlot("hit"); }
  static async #onEditAttack(event) { event.preventDefault(); this._openActorSlot("attack"); }
  static async #onEditDeath(event) { event.preventDefault(); this._openActorSlot("death"); }

  _openActorSlot(slot) {
    const token = game.wangTokenWalk.resolveToken();
    if (!token?.actor) return;
    if (!game.user.isGM && !token.actor.isOwner) return ui.notifications.warn("需要角色编辑权限。");
    openActorPresetEditor(token.actor, slot);
  }
}

export function openWalkConfig() {
  return new WalkConfigApp().render({ force: true });
}
