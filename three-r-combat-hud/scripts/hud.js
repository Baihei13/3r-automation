import { MODULE_ID, HudStore } from "./state.js";
import { TABS, ACTION_ORDER, owned, actorChoices, actorResources, itemCards, spellResources, targetCards, checkCards, defenseCards, reminderView, finite, commonAvailability, availabilitySections, AVAILABILITY_TABS } from "./model.js";
import { useNative, postHudAction, reportError } from "./actions.js";
import { COMMON_ACTIONS } from "./common-actions.js";
import { movementState, startStep, resetMovement } from "./movement.js";
import { THEMES, LAYOUTS, appearanceContext, applyAppearance } from "./appearance.js";
import { HudFrame } from "./frame.js";

const App = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

export class ThreeRCombatHud extends App {
  static DEFAULT_OPTIONS = {
    id: "three-r-combat-hud", classes: ["trh-root"], tag: "div",
    window: { frame: false, positioned: false, resizable: false, minimizable: false },
    position: { width: "auto", height: "auto" }
  };
  static PARTS = { content: { template: `modules/${MODULE_ID}/templates/hud.hbs` } };

  constructor(options = {}) {
    super(options);
    this.store = new HudStore();
    this.frame = new HudFrame(this.store, () => this.refresh());
    this.drawer = null;
    this.tab = "weapons";
    this.utilityTab = "actions";
    this.query = "";
    this.book = "";
    this.level = "";
    this.actionFilter = "";
    this.availabilityTab = "available";
    this.status = "";
    this.busy = false;
    this.enabled = Boolean(game.settings.get(MODULE_ID, "enabled"));
    this.scroll = 0;
    this.draggedId = null;
    this.refreshTimer = null;
  }

  selection() {
    const choices = actorChoices();
    return { choice: choices[0] ?? null };
  }

  refresh() {
    if (!this.enabled) return;
    clearTimeout(this.refreshTimer);
    const choice = this.selection().choice;
    if (this.element && choice?.key !== this.currentChoice?.key) this.element.style.visibility = "hidden";
    if (!choice) {
      this.currentChoice = null;
      this.close().catch(reportError);
      return;
    }
    if (this.frame.active) {
      if (choice.key === this.currentChoice?.key) return;
      this.frame.cancel();
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!this.enabled) return;
      if (this.frame.active) return;
      if (!this.selection().choice) { this.currentChoice = null; this.close().catch(reportError); }
      else this.render({ force: true }).catch(reportError);
    }, 90);
  }

  async toggle() {
    this.enabled = !this.enabled;
    await game.settings.set(MODULE_ID, "enabled", this.enabled);
    if (this.enabled) this.refresh();
    else await this.close();
  }

  async close(options = {}) {
    this.frame.cancel();
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.listenerAbort?.abort();
    if (this.element) this.element.style.visibility = "hidden";
    // Selection changes should not queue the generic window-closing transition.
    return super.close({ animate: false, ...options });
  }

  async _prepareContext() {
    const focused = document.activeElement;
    this.focusSnapshot = focused?.name === "trh-search" && this.element?.contains(focused)
      ? { start: focused.selectionStart, end: focused.selectionEnd } : null;
    const { choice } = this.selection();
    const actor = choice?.actor;
    this.currentChoice = choice;
    const scale = finite(game.settings.get(MODULE_ID, "scale"), 100) / 100;
    const appearance = appearanceContext();
    const utility = !["weapons", "spells", "abilities", "skills", "items"].includes(this.tab);
    const context = {
      ...appearance, isCommand: appearance.layout === "command", showAppearance: this.drawer === "appearance",
      isUtility: utility,
      mainTabs: [
        {id:"weapons",name:"攻击",icon:"fa-khanda",active:this.tab==="weapons",hero:true},
        {id:"spells",name:"法术",icon:"fa-wand-magic-sparkles",active:this.tab==="spells"},
        {id:"abilities",name:"能力",icon:"fa-bolt",active:this.tab==="abilities"},
        {id:"skills",name:"技能",icon:"fa-person-running",active:this.tab==="skills"},
        {id:"items",name:"物品",icon:"fa-suitcase",active:this.tab==="items"},
        {id:"utility",name:"实用",icon:"fa-dice-d20",active:utility}
      ],
      utilityTabs: TABS.filter(([id])=>!["weapons","spells","abilities","skills","items"].includes(id)).map(([id,name])=>({id,name,active:id===this.tab})),
      opacityPercent: Math.max(10, Math.min(100, finite(game.settings.get(MODULE_ID, "backgroundOpacity"), 45))),
      hasActor: Boolean(actor), selectionKey: choice?.key, collapsed: this.store.data.collapsed, scale, status: this.status,
      opacity: Math.max(0.1, Math.min(1, finite(game.settings.get(MODULE_ID, "backgroundOpacity"), 45) / 100)),
      showSearch: this.drawer === "search", showResources: this.drawer === "resources", showActions: this.drawer === "actions",
      busy: this.busy, tab: this.tab, query: this.query,
      filtered: Boolean(this.query || this.actionFilter || (this.tab === "spells" && (this.book || this.level !== ""))),
      isSpells: this.tab === "spells", isChecks: this.tab === "checks", isEffects: this.tab === "effects",
      isActions: this.tab === "actions",
      isSkills: this.tab === "skills", isCheckPage: ["checks", "skills"].includes(this.tab),
      tabs: TABS.map(([id, name]) => ({ id, name, active: id === this.tab }))
    };
    if (!actor) return context;
    const attributes = actor.system.attributes ?? {};
    const hp = attributes.hp ?? {};
    const max = finite(hp.max);
    const value = finite(hp.value);
    const resources = spellResources(actor);
    const targets = targetCards();
    const reminderContext = this.store.context(actor, choice.token);
    const reminder = reminderView(actor, choice.token, this.store, reminderContext);
    const cards = itemCards(actor, this.store, this.tab, { query: this.query, book: this.book, level: this.level,action:this.actionFilter });
    const commonCards=COMMON_ACTIONS.filter(entry=>!this.actionFilter||entry.kind===this.actionFilter)
      .filter(entry=>!this.query||entry.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()))
      .sort((a,b)=>(ACTION_ORDER.indexOf(a.kind)<0?99:ACTION_ORDER.indexOf(a.kind))-(ACTION_ORDER.indexOf(b.kind)<0?99:ACTION_ORDER.indexOf(b.kind)))
      .map(entry=>({...entry,isCommon:true,...commonAvailability(actor,entry,choice.token),favorite:this.store.layout(actor).favorites.includes(`common:${entry.id}`),cost:{standard:"标准",move:"移动",full:"全回合",free:"自由",immediate:"反应"}[entry.kind]??"无动作"}));
    const sections=[];
    if(this.tab==="all")for(const [id,name] of TABS) {
      const entries=id==="actions"?commonCards:cards.filter(card=>card.group===id).map(({item,...entry})=>entry);
      sections.push(...availabilitySections(entries,name).map(section=>({...section,name,showTitle:true})));
    }else {
      const entries=this.tab==="actions"?commonCards:this.tab==="favorites"
        ? [...cards.map(({item,...entry})=>entry),...commonCards.filter(entry=>entry.favorite)]
        : cards.map(({item,...entry})=>entry);
      sections.push(...availabilitySections(entries));
    }
    const availabilityTabs = AVAILABILITY_TABS.map(([id,name])=>({id,name,active:id===this.availabilityTab,
      count:sections.filter(section=>section.availability===id).reduce((count,section)=>count+section.cards.length,0)}));
    const visibleSections = sections.filter(section=>section.availability===this.availabilityTab);
    const checks = ["checks", "skills"].includes(this.tab) ? checkCards(actor) : null;
    const quickItems = itemCards(actor, this.store, "favorites", {}).filter(entry=>entry.availability==="available").map(({item,...entry})=>entry);
    const quickCommon = COMMON_ACTIONS.filter(entry=>this.store.layout(actor).favorites.includes(`common:${entry.id}`))
      .map(entry=>({...entry,isCommon:true,...commonAvailability(actor,entry,choice.token)})).filter(entry=>!entry.unavailable);
    if (checks && this.query) checks.skills = checks.skills.filter(skill => skill.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()));
    return {
      ...context, actorName: choice.token?.name ?? actor.name, actorImage: actor.img || "icons/svg/mystery-man.svg",
      quickFavorites: [...quickItems,...quickCommon].slice(0,6), hasQuickFavorites: quickItems.length + quickCommon.length > 0,
      hp: `${value} / ${max}`, hpPercent: max > 0 ? Math.max(0, Math.min(100, 100 * value / max)) : 0,
      tempHp: finite(hp.temp), ac: attributes.ac?.normal?.total ?? "—", touchAc: attributes.ac?.touch?.total ?? "—",
      flatAc: attributes.ac?.flatFooted?.total ?? "—", speed: attributes.speed?.land?.total ?? attributes.speed?.land?.base ?? "—",
      initiative: attributes.init?.total ?? "—", resources,identityResources:actorResources(actor),sections:visibleSections,hasSections:visibleSections.length>0,
      availabilityTabs,availabilityName:AVAILABILITY_TABS.find(([id])=>id===this.availabilityTab)?.[1],
      defenses: defenseCards(actor), saves: checkCards(actor).saves, movement: Object.fromEntries(Object.entries(movementState(choice.token)).map(([key,value])=>[key,typeof value === "number" ? Math.round(value * 100) / 100 : value])),
      stripActions: ACTION_ORDER.map(id=>({...reminder.actions.find(action=>action.id===id),active:this.actionFilter===id})),
      actionFilterName:reminder.actions.find(action=>action.id===this.actionFilter)?.name??"",
      filterBook: this.tab === "spells" ? resources.find(book => book.id === this.book)?.name ?? "" : "",
      filterLevel: this.tab === "spells" && this.level !== "" ? `${this.level}环` : "",
      targets, hasTargets: targets.length > 0,
      cards: cards.map(({ item, ...entry }) => entry), hasCards: Boolean(cards.length), checks,
      reminder, inCombat: Boolean(reminderContext.combatId), round: reminderContext.round,
      canEndTurn: Boolean(choice.token && game.combat?.started && game.user.isGM && game.combat.current?.tokenId === choice.token.id),
      books: [{ id: "", name: "全部职业／法术书", selected: !this.book }, ...resources.map(book => ({ id: book.id, name: book.name, selected: this.book === book.id }))],
      levels: [{ id: "", name: "全部环级", selected: this.level === "" }, ...Array.from({ length: 10 }, (_, level) => ({ id: String(level), name: `${level}环`, selected: this.level === String(level) }))]
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    // A selection can change while an asynchronous template render is finishing.
    if (!this.selection().choice || this.selection().choice.key !== context.selectionKey) {
      root.style.visibility = "hidden";
      this.refresh();
      return;
    }
    root.style.visibility = "visible";
    this.frame.cancel();
    this.listenerAbort?.abort();
    this.listenerAbort = new AbortController();
    const listenerOptions = { signal: this.listenerAbort.signal };
    root.style.setProperty("--trh-scale", String(context.scale));
    root.style.setProperty("--trh-opacity", String(context.opacity));
    applyAppearance(root, context);
    root.style.setProperty("--trh-panel-alpha", String(context.layout === "command" && context.solidPanels ? .94 : context.opacity));
    const sidebar = document.getElementById("sidebar");
    const bounds = sidebar?.getBoundingClientRect();
    const clearance = bounds && bounds.right >= window.innerWidth - 5 && bounds.width > 60 ? bounds.width : 0;
    root.style.setProperty("--trh-sidebar-width", `${clearance}px`);
    this.frame.bind(root, listenerOptions);
    const grid = root.querySelector(".trh-grid");
    if (grid) grid.scrollTop = this.scroll;
    grid?.addEventListener("scroll", () => { this.scroll = grid.scrollTop; }, { ...listenerOptions, passive: true });
    root.addEventListener("click", event => {
      const button = event.target.closest("[data-trh-action]");
      if (button) this.handle(button.dataset.trhAction, button.dataset, event).catch(reportError);
    }, listenerOptions);
    root.addEventListener("contextmenu", event => {
      const card = event.target.closest("[data-item-id]");
      if (!card) return;
      event.preventDefault();
      this.openDetails(card.dataset.itemId);
    }, listenerOptions);
    root.querySelector("[name='trh-search']")?.addEventListener("input", event => {
      const input = event.currentTarget;
      this.query = input.value;
      this.scroll = 0;
      this.refresh();
    }, listenerOptions);
    for (const filter of ["book", "level"]) root.querySelector(`[name='trh-${filter}']`)?.addEventListener("change", event => {
      this[filter] = event.currentTarget.value;
      this.scroll = 0;
      this.refresh();
    }, listenerOptions);
    for (const [key, choices] of [["theme", THEMES], ["layout", LAYOUTS]]) {
      root.querySelector(`[name='trh-${key}']`)?.addEventListener("change", event => {
        const value = event.currentTarget.value;
        if (Object.hasOwn(choices, value)) game.settings.set(MODULE_ID, key, value).catch(reportError);
      }, listenerOptions);
    }
    root.querySelector("[name='trh-opacity']")?.addEventListener("change", event => {
      const value = Number(event.currentTarget.value);
      if (Number.isFinite(value)) game.settings.set(MODULE_ID, "backgroundOpacity", Math.max(10, Math.min(100, value))).catch(reportError);
    }, listenerOptions);
    root.querySelector("[name='trh-solid-panels']")?.addEventListener("change", event => {
      game.settings.set(MODULE_ID, "stylishSolidPanels", event.currentTarget.checked).catch(reportError);
    }, listenerOptions);
    root.addEventListener("dragstart", event => {
      if (this.selection().choice?.key !== this.currentChoice?.key) { event.preventDefault(); return; }
      const cell = event.target.closest(".trh-card[data-item-id]");
      const actor = this.currentChoice?.actor;
      const item = actor?.items.get(cell?.dataset.itemId);
      if (!item) return;
      this.draggedId = item.id;
      event.dataTransfer.effectAllowed = "copyMove";
      event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid, trhActor: actor.uuid }));
    }, listenerOptions);
    root.addEventListener("dragend", () => { this.draggedId = null; }, listenerOptions);
    root.querySelector(".trh-grid")?.addEventListener("dragover", event => { event.preventDefault(); }, listenerOptions);
    root.querySelector(".trh-grid")?.addEventListener("drop", event => { this.drop(event).catch(reportError); }, listenerOptions);
    if (this.focusSnapshot) {
      const input = root.querySelector("[name='trh-search']");
      input?.focus();
      input?.setSelectionRange(this.focusSnapshot.start, this.focusSnapshot.end);
    }
  }

  async drop(event) {
    event.preventDefault();
    if (this.selection().choice?.key !== this.currentChoice?.key) return;
    const actor = this.currentChoice?.actor;
    if (!owned(actor)) return;
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if (data.type !== "Item" || typeof data.uuid !== "string") return;
    const item = await fromUuid(data.uuid);
    if (this.selection().choice?.key !== this.currentChoice?.key || this.currentChoice?.actor.uuid !== actor.uuid) return;
    if (!item || item.actor?.uuid !== actor.uuid) {
      ui.notifications.warn("请拖入当前角色自己的条目；HUD不会复制其他角色或合集的物品。");
      return;
    }
    const target = event.target.closest("[data-item-id]")?.dataset.itemId;
    if (this.draggedId && target) {
      this.store.reorder(actor, item.id, target, itemCards(actor, this.store, this.tab, { query: this.query, book: this.book, level: this.level,action:this.actionFilter }).map(card => card.id));
    } else {
      const layout = this.store.layout(actor);
      if (!layout.favorites.includes(item.id)) this.store.favorite(actor, item.id);
      this.tab = "favorites";
    }
    this.draggedId = null;
    this.refresh();
  }

  openDetails(id) {
    if (this.selection().choice?.key !== this.currentChoice?.key) return;
    const item = this.currentChoice?.actor.items.get(id);
    if (item && owned(item.actor)) item.sheet.render(true);
  }

  async handle(action, data, event) {
    if (action === "toggle") return this.toggle();
    const choice = this.selection().choice;
    if (!choice || choice.key !== this.currentChoice?.key || !owned(choice.actor)) { this.refresh(); return; }
    if (action === "collapse") { this.store.data.collapsed = !this.store.data.collapsed; this.store.save(); this.refresh(); return; }
    if (action === "drawer") {
      if (data.drawer === "search" && appearanceContext().layout === "command") {
        this.element?.querySelector(".trh-inline-search input")?.focus(); return;
      }
      this.drawer = this.drawer === data.drawer ? null : data.drawer;
      this.refresh(); return;
    }
    if (action === "reset-frame") { this.frame.reset(); this.refresh(); return; }
    if (action === "availability-tab") {
      if (!AVAILABILITY_TABS.some(([id])=>id===data.availability)) return;
      this.availabilityTab=data.availability; this.scroll=0; this.refresh(); return;
    }
    if (action === "clear-filters") { this.query = ""; this.book = ""; this.level = ""; this.actionFilter=""; this.scroll = 0; this.refresh(); return; }
    if (action === "filter-action") {
      if(!ACTION_ORDER.includes(data.kind))return;
      this.actionFilter=this.actionFilter===data.kind?"":data.kind;
      if(["checks","skills","effects"].includes(this.tab))this.actionFilter="";
      this.scroll=0;this.refresh();return;
    }
    if (action === "tab") {
      const next = data.tab === "utility" ? this.utilityTab : data.tab;
      if (!TABS.some(([id])=>id===next)) return;
      this.tab = next;
      this.availabilityTab = "available";
      if (!["weapons","spells","abilities","skills","items"].includes(next)) this.utilityTab=next;
      if(["checks","skills","effects"].includes(this.tab))this.actionFilter="";
      this.scroll = 0; this.query = ""; this.refresh(); return;
    }
    const { actor, token } = choice;
    const context = this.store.context(actor, token);
    if (action === "sheet") return actor.sheet.render(true);
    if (action === "rest") return actor.promptRest();
    if (action === "reset-movement") { if(!await resetMovement(token)){ui.notifications.info("战斗外不记录移动距离，无需更正。");return;} await postHudAction(actor,token,{label:"更正移动记录",detail:"已清空本轮移动记录。",context}); this.refresh(); return; }
    if (action === "step") {
      game.modules.get("samson-3r-automation")?.api?.checkConditionAction?.(actor,null,{kind:"move",common:"step"});
      if(movementState(token).stepping){ui.notifications.info("本回合已经启用五尺快步。");return;}
      await startStep(token);
      this.store.record(context, "free", "五尺快步", true);
      this.store.record(context, "step", "五尺快步", true);
      await postHudAction(actor,token,{label:"五尺快步",kind:"free",context});
      this.status = "本回合已切换快步；普通移动余量为0，五尺安全距离单独计算。";
      this.refresh(); return;
    }
    if (action === "common") {
      const entry = COMMON_ACTIONS.find(entry => entry.id === data.common);
      if (!entry) return;
      const availability = commonAvailability(actor,entry,token);
      if (availability.unavailable) { ui.notifications.warn(availability.reason); this.status=availability.reason; this.refresh(); return; }
      if (entry.id === "movement-correction") return this.handle("reset-movement",data,event);
      if (entry.id === "step") return this.handle("step", data, event);
      game.modules.get("samson-3r-automation")?.api?.checkConditionAction?.(actor,null,{kind:entry.kind,common:entry.id});
      if (["charge", "defensive", "aao"].includes(entry.id)) {
        const attacks = actor.items.filter(item => item.type === "attack" && item.system.actionType === "mwak");
        if (!attacks.length) { ui.notifications.warn("请先从武器页生成一个近战攻击方式。"); return; }
        const attack = await foundry.applications.api.DialogV2.wait({
          window: { title: entry.name }, content: `<p>${entry.text}</p>`, rejectClose: false,
          buttons: attacks.map(item => ({ action: item.id, label: String(item.displayName || item.name).replace(/[&<>"']/g, char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]), callback: () => item.id }))
        });
        if (attack && this.selection().choice?.key===choice.key) return this.handle("use", { itemId: attack, common: entry.id }, event);
        return;
      }
      const module = game.modules.get("samson-3r-automation");
      const api = module?.active ? module.api : null;
      const conditionOperations={"first-aid":"aid","wake-fascinated":"wake","escape-grapple":"escape"};
      const operation=entry.id==="coup"?"coup":conditionOperations[entry.id];
      if(operation&&api?.conditionOperation){
        const completed=await api.conditionOperation(actor,operation);
        if(completed){this.store.record(context,entry.kind,entry.name,false);this.refresh();}
        return completed;
      }
      const defenseApplied = entry.id === "defense" && typeof api?.commonAction === "function";
      if (defenseApplied) {
        await api.commonAction(actor, entry.id);
      } else {
        const confirmed = await foundry.applications.api.DialogV2.confirm({ window: { title: entry.name }, content: `<p>${entry.text}</p>${entry.id==="defense"?"<p>将发送全防御动作声明，AC增益请在原生角色卡中处理。</p>":""}<p>确认执行并记录本次动作？场景交互、触发条件与特殊裁定由玩家和DM完成。</p>` });
        if (!confirmed || this.selection().choice?.key!==choice.key || !owned(actor)) return;
        if (entry.id === "prone") await actor.update({ "system.attributes.conditions.prone": true });
        if (entry.id === "stand") await actor.update({ "system.attributes.conditions.prone": false });
      }
      if (entry.id === "double-move") {
        this.store.record(context, "standard", entry.name, false);
        this.store.record(context, "move", entry.name, false);
      } else this.store.record(context, entry.kind, entry.name, false);
      await postHudAction(actor,token,{label:entry.name,kind:entry.kind,detail:entry.id==="defense"&&!defenseApplied?`${entry.text} 本次仅声明，AC增益尚未自动施加。`:entry.text,
        declared:!defenseApplied && !["prone","stand"].includes(entry.id),context});
      if(!["move","double-move","run","withdraw"].includes(entry.id))await api?.commitConditionAction?.(actor,entry.kind);
      this.status = entry.kind ? `${entry.name}已记录；动作次数仅提醒。` : `${entry.name}不扣动作提醒。`;
      this.refresh(); return;
    }
    if (action === "details") return this.openDetails(data.itemId);
    if (action === "favorite") { this.store.favorite(actor, data.itemId); this.refresh(); return; }
    if (action === "favorite-common") { if(!COMMON_ACTIONS.some(entry=>entry.id===data.common))return; this.store.favorite(actor, `common:${data.common}`); this.refresh(); return; }
    if (action === "count") {
      const used=this.store.counts(context)[data.kind];
      if(typeof used!=="number"||(Number(data.delta)<0&&used===0))return;
      this.store.record(context, data.kind, "手动记录", false, Number(data.delta));
      await postHudAction(actor,token,{label:"更正动作提醒",kind:data.kind,detail:Number(data.delta)<0?"返还一次动作提醒；实际资源不变。":"补记使用一次动作。",context});
      this.refresh(); return;
    }
    if (action === "undo") { if(!this.store.ledger(context).length)return; this.store.undo(context); await postHudAction(actor,token,{label:"撤销最后一条动作提醒",context}); this.refresh(); return; }
    if (action === "reset") { if(!this.store.ledger(context).length)return; this.store.clear(context); await postHudAction(actor,token,{label:"清空本轮动作提醒",context}); this.refresh(); return; }
    if (action === "clear-targets") {
      for (const target of Array.from(game.user.targets)) target.setTarget(false, { user: game.user, releaseOthers: false });
      this.refresh(); return;
    }
    if (action === "initiative") return actor.rollInitiative({ createCombatants: true });
    if (action === "end-turn") {
      // No player-to-GM socket or new authority is introduced by the HUD.
      if (game.user.isGM && token && game.combat?.current?.tokenId === token.id) return game.combat.nextTurn();
      return;
    }
    if (action === "check") {
      if (data.kind === "ability") return actor.rollAbilityTest(data.key, { event });
      if (data.kind === "save") return actor.rollSavingThrow(data.key, undefined, undefined, { event });
      if (data.kind === "skill") return actor.rollSkill(data.key, { event });
    }
    if (action !== "use") return;
    if (this.actionFilter === "immediate" && !data.common) {
      const selectedItem = actor.items.get(data.itemId);
      if (selectedItem?.type === "weapon" && ["light","1h","2h"].includes(selectedItem.system.weaponSubtype)
        || selectedItem?.type === "attack" && selectedItem.system.actionType === "mwak")
        data = {...data,common:"aao"};
    }
    if (this.busy) { ui.notifications.info("当前操作尚未结束，请先完成或关闭原生窗口。"); return; }
    this.busy = true;
    this.status = "正在进行本次操作…";
    this.refresh();
    try {
      const result = await useNative(actor, token, data.itemId, event, context, data.common);
      if(result.state==="performed"&&!result.hasChat)await postHudAction(actor,token,{label:result.label,kind:result.kind,context});
      if(result.state==="toggled")await postHudAction(actor,token,{label:`${result.active?"启用":"停用"}：${result.label}`,context});
      if (result.state === "performed" && this.store.context(actor, token).key !== context.key) {
        this.status = "操作期间回合发生了变化，请在对应回合手动补记动作。";
      } else if (result.state === "performed" && result.kind) {
        this.store.record(context, result.kind, result.label, true);
        this.status = "已记录本次动作；提醒不限制后续操作。";
      } else if (result.state === "cancelled") this.status = "已取消，动作记录未增加。";
      else if (result.state === "performed") this.status = "已完成本次操作，不增加动作提醒。";
      else if (result.state === "handled") this.status = "能力选项已处理，动作记录未增加。";
      else if (result.state === "details") this.status = "已打开条目详情。";
      else if (result.state === "blocked") this.status = result.reason;
      else if (result.state === "toggled") this.status = "已切换效果状态。";
      else this.status = "未收到明确的动作完成结果；如已使用，请手动补记。";
    } catch (error) { this.status = "本次操作出现错误，动作记录未增加。"; throw error; }
    finally {
      this.busy = false;
      if (this.selection().choice?.key !== choice.key) this.status = "";
      this.refresh();
    }
  }
}
