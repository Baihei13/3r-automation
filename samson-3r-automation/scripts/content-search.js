import { MODULE_ID, SOURCES } from "./catalog.js";
import { PF1_CLASSES } from "./pf1-content.js";

const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
const normalized = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
const TYPES = { spell: "法术", feat: "专长", ability: "能力／巫术／特性", class: "职业", archetype: "职业变体", race: "种族", weapon: "武器", equipment: "防具", consumable: "消耗品", item: "其他物品" };
const INDEX_FIELDS = ["type", "system.featType", "system.level", "system.source", "system.learnedAt.class", ...["source","key","category","englishName","ruleset","rulebook","canonicalKey","libraryClass","libraryClassLabel","clericPlan","clericSpell"].map(key=>`flags.${MODULE_ID}.${key}`)];
const PAGE_SIZE = 60;
const readablePack = pack => pack?.documentName === "Item" && pack.visible && pack.testUserPermission(game.user, "OBSERVER");
const modulePack = pack => pack.collection.startsWith("world.samson-") || pack.metadata.packageName === MODULE_ID;
const readableItem = item => item?.testUserPermission(game.user, "OBSERVER");
let activeSearch;
const SEARCH_STYLE_VERSION = "0.4.28";
let searchStylePromise;

function ensureSearchStyles() {
  if (searchStylePromise) return searchStylePromise;
  searchStylePromise = new Promise((resolve, reject) => {
    document.getElementById("samson-3r-content-search-style")?.remove();
    const link = document.createElement("link");
    link.id = "samson-3r-content-search-style"; link.rel = "stylesheet";
    link.href = `modules/${MODULE_ID}/styles/content-search.css?v=${SEARCH_STYLE_VERSION}`;
    const timeout = setTimeout(() => finish(new Error("内容搜索样式读取超时。请检查模块文件后重试。")), 10000);
    const finish = error => {
      clearTimeout(timeout); link.onload = null; link.onerror = null;
      if (error) { link.remove(); searchStylePromise = null; reject(error); }
      else resolve();
    };
    link.onload = () => finish();
    link.onerror = () => finish(new Error("内容搜索样式未能加载。请确认styles/content-search.css已上传到服务器。"));
    document.head.append(link);
  });
  return searchStylePromise;
}

function category(entry) {
  const explicit = entry.flags?.[MODULE_ID]?.category;
  if(["dual-cursed-oracle","witch-watcher"].includes(entry.flags?.[MODULE_ID]?.key))return "archetype";
  if (["racial", "feature", "hex", "curse", "revelation", "trait", "mystery", "patron"].includes(explicit)) return "ability";
  if (Object.hasOwn(TYPES, explicit)) return explicit;
  if (entry.type === "feat") return entry.system?.featType === "feat" ? "feat" : "ability";
  return Object.hasOwn(TYPES, entry.type) ? entry.type : "item";
}

function rowData(entry, pack = null) {
  const mark = entry.flags?.[MODULE_ID];
  const source = SOURCES[mark?.source];
  const kind = category(entry);
  const level = Number(entry.system?.level);
  const packTitle = pack?.title || "世界物品";
  const book = source?.label || String(entry.system?.source || "") || packTitle;
  const key = pack ? pack.getUuid(entry._id) : entry.uuid;
  const pfSources=new Set(["pf","pfu","arg","apg","um","uca","hhc","boc","iswg","teog","bof","lotfw","uw","bm","hots"]);
  const ruleset=mark?.ruleset||(pfSources.has(mark?.source)?"PF1":mark?.source&&SOURCES[mark.source]?"3.5":"");
  const classes=(entry.system?.learnedAt?.class??[]).filter(row=>Array.isArray(row)&&Number.isInteger(Number(row[1])));
  return { hidden:mark?.source==="pf"&&["human-dex","human-cha"].includes(mark?.key), key, pack: pack?.collection || "", id: entry._id || entry.id, name: entry.name, img: entry.img || "icons/svg/book.svg", kind,
    level: kind === "spell" && entry.system?.level != null && entry.system.level !== "" && Number.isInteger(level) && level >= 0 && level <= 9 ? level : null,
    book, packTitle, source: mark?.rulebook || source?.book || book, ruleset, classes, canonical:mark?.canonicalKey, libraryClass:mark?.libraryClass,
    coverage:mark?.clericPlan==="manual"?(mark.clericSpell==="create-water"?"仅计算产水量":"规则资料 · 独有效果未实现"):mark?.clericPlan&&mark.clericPlan!=="legacy"?"已有部分效果 · 边界见说明":null,
    haystack: normalized([entry.name, mark?.englishName, mark?.key, book, mark?.rulebook, packTitle, ruleset, TYPES[kind],...classes.flatMap(([name,level])=>[name,PF1_CLASSES[name],`${level}环`])].join(" ")) };
}

export class ContentSearchApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "samson-3r-content-search", classes: ["samson-content-search"], tag: "div",
    window: { title: "3r内容搜索", resizable: true }, position: { width: 700, height: 560 },
  };

  constructor(options = {}) {
    super(options);
    this.query = ""; this.scope = "module"; this.kind = ""; this.book = ""; this.ruleset="";this.spellClass="";this.spellLevel=""; this.page = 0;
    this.rows = []; this.byKey = new Map(); this.cache = new Map(); this.failed = [];
    this.loading = false; this.loaded = false; this.sequence = 0; this.progress = "";
    activeSearch = this;
  }

  async _renderHTML() {
    // Foundry can retain the old manifest's styles list until a server restart.
    // Load the current CSS before rendering results, also for the settings menu.
    await ensureSearchStyles();
    return `<div class="s3r-search-shell standard-form">
      <div class="s3r-search-query"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><input name="query" type="search" value="${esc(this.query)}" placeholder="输入名称或来源，中英文均可；空格可组合关键词" aria-label="搜索名称与来源"><button type="button" data-action="reload" title="重新读取合集"><i class="fas fa-rotate" aria-hidden="true"></i> 刷新</button></div>
      <div class="s3r-search-filters"><label>范围<select name="scope"><option value="module" ${this.scope === "module" ? "selected" : ""}>3r自动化资料</option><option value="all" ${this.scope === "all" ? "selected" : ""}>全部可读合集＋世界物品</option></select></label><label>类型<select name="kind"><option value="">全部类型</option>${Object.entries(TYPES).map(([key, label]) => `<option value="${key}" ${this.kind === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>来源<select name="book"><option value="">全部来源</option></select></label></div>
      <div class="s3r-search-filters"><label>规则<select name="ruleset"><option value="">全部规则</option><option value="3.5" ${this.ruleset==="3.5"?"selected":""}>3R</option><option value="PF1" ${this.ruleset==="PF1"?"selected":""}>PF1</option></select></label><label>施法职业<select name="spellClass"><option value="">全部职业</option></select></label><label>法术环级<select name="spellLevel"><option value="">全部环级</option>${Array.from({length:10},(_,level)=>`<option value="${level}" ${this.spellLevel===String(level)?"selected":""}>${level}环</option>`).join("")}</select></label></div>
      <p class="s3r-search-status" role="status" aria-live="polite"></p>
      <div class="s3r-search-results" role="list" aria-label="搜索结果"></div>
      <footer class="s3r-search-footer"><span>点击名称打开详情 · 拖动条目加入角色卡</span><div><button type="button" data-action="previous" aria-label="上一页"><i class="fas fa-chevron-left"></i></button><span class="s3r-search-page"></span><button type="button" data-action="next" aria-label="下一页"><i class="fas fa-chevron-right"></i></button></div></footer>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector('[name="query"]').addEventListener("input", event => {
      this.query = event.target.value; this.page = 0;
      clearTimeout(this.debounce); this.debounce = setTimeout(() => this.drawResults(), 120);
    });
    content.querySelector('[name="scope"]').addEventListener("change", event => {
      this.scope = event.target.value; this.book = ""; this.page = 0; this.load().catch(error => this.report(error));
    });
    for (const name of ["kind", "book","ruleset","spellClass","spellLevel"]) content.querySelector(`[name="${name}"]`).addEventListener("change", event => {
      this[name] = event.target.value; this.page = 0; this.drawSources();this.drawResults();
    });
    content.querySelector('[data-action="reload"]').addEventListener("click", () => { this.cache.clear(); this.load().catch(error => this.report(error)); });
    content.querySelector('[data-action="previous"]').addEventListener("click", () => { this.page = Math.max(0, this.page - 1); this.drawResults(); });
    content.querySelector('[data-action="next"]').addEventListener("click", () => { this.page++; this.drawResults(); });
    content.querySelector(".s3r-search-results").addEventListener("click", event => {
      const button = event.target.closest("[data-open]");
      if (button) this.openDocument(button.dataset.open).catch(error => this.report(error));
    });
    content.querySelector(".s3r-search-results").addEventListener("dragstart", event => {
      const row = this.byKey.get(event.target.closest("[data-key]")?.dataset.key);
      if (!row || !this.canRead(row) || !event.dataTransfer) { event.preventDefault(); return; }
      event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: row.key }));
      event.dataTransfer.effectAllowed = "copy";
    });
    content.querySelector('[name="query"]').addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      const button = content.querySelector("[data-open]");
      if (button) { event.preventDefault(); this.openDocument(button.dataset.open).catch(error => this.report(error)); }
    });
    this.drawSources(); this.drawResults();
    content.querySelector('[name="query"]').focus();
    if (!this.loaded && !this.loading) queueMicrotask(() => this.load().catch(error => this.report(error)));
    return content;
  }

  report(error) { console.error(`${MODULE_ID} | content search`, error); ui.notifications.error(`内容搜索：${error.message}`); }

  canRead(row) {
    return row.pack ? readablePack(game.packs.get(row.pack)) : readableItem(game.items.get(row.id));
  }

  async load() {
    const sequence = ++this.sequence;
    this.loading = true; this.loaded = true; this.rows = []; this.byKey.clear(); this.failed = []; this.page = 0;
    const scope = this.scope;
    const packs = game.packs.filter(pack => readablePack(pack) && (scope === "all" || modulePack(pack)));
    this.progress = `读取合集 0/${packs.length}……`; this.drawSources(); this.drawResults();
    let position = 0, finished = 0;
    // Only indexes are loaded. Three requests at a time keep large libraries responsive.
    const worker = async () => {
      while (position < packs.length && sequence === this.sequence) {
        const pack = packs[position++];
        try {
          let index = this.cache.get(pack.collection);
          if (!index) { index = await pack.getIndex({ fields: INDEX_FIELDS }); this.cache.set(pack.collection, index); }
          if (sequence !== this.sequence) return;
          if (readablePack(pack)) for (const entry of index) {
            const row = rowData(entry, pack); this.rows.push(row); this.byKey.set(row.key, row);
          }
        } catch (error) {
          if (sequence !== this.sequence) return;
          this.failed.push(pack.title); console.warn(`${MODULE_ID} | search index ${pack.collection}`, error);
        }
        if (sequence !== this.sequence) return;
        this.progress = `读取合集 ${++finished}/${packs.length}……`; this.drawSources(); this.drawResults();
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, packs.length) }, worker));
    if (sequence !== this.sequence) return;
    if (scope === "all") for (const item of game.items) if (readableItem(item)) {
      const row = rowData(item); this.rows.push(row); this.byKey.set(row.key, row);
    }
    this.loading = false; this.progress = ""; this.drawSources(); this.drawResults();
  }

  drawSources() {
    const select = this.element?.querySelector('[name="book"]'); if (!select) return;
    const books = [...new Set(this.rows.filter(row => this.canRead(row)).map(row => row.book))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    select.innerHTML = `<option value="">全部来源</option>${books.map(book => `<option value="${esc(book)}" ${this.book === book ? "selected" : ""}>${esc(book)}</option>`).join("")}`;
    if (this.book && !books.includes(this.book) && !this.loading) this.book = "";
    select.value = this.book;
    const classSelect=this.element.querySelector('[name="spellClass"]');
    const classes=[...new Set(this.rows.filter(row=>this.canRead(row)&&(!this.ruleset||row.ruleset===this.ruleset)).flatMap(row=>row.classes.map(([name])=>name)))].sort((a,b)=>(PF1_CLASSES[a]||a).localeCompare(PF1_CLASSES[b]||b,"zh-CN"));
    classSelect.innerHTML=`<option value="">全部职业</option>${classes.map(name=>`<option value="${esc(name)}">${esc(PF1_CLASSES[name]||name)}</option>`).join("")}`;
    if(this.spellClass&&!classes.includes(this.spellClass)&&!this.loading)this.spellClass="";
    classSelect.value=this.spellClass;
  }

  drawResults() {
    const root = this.element; const results = root?.querySelector(".s3r-search-results"); if (!results) return;
    const query = normalized(this.query), terms = query.split(" ").filter(Boolean);
    const filtered = this.rows.filter(row => !row.hidden && this.canRead(row) && (!this.kind || row.kind === this.kind) && (!this.book || row.book === this.book)
      &&(!this.ruleset||row.ruleset===this.ruleset)&&(!this.spellClass||row.classes.some(([name])=>name===this.spellClass))
      &&(this.spellLevel===""||(this.spellClass?row.classes.some(([name,level])=>name===this.spellClass&&Number(level)===Number(this.spellLevel)):row.level===Number(this.spellLevel)))
      && terms.every(term => row.haystack.includes(term)));
    const unique=new Map();
    for(const row of filtered) {
      const identity=row.canonical&&row.pack?`${row.canonical}:${this.spellClass||""}`:row.key,old=unique.get(identity);
      const preferred=this.spellClass?row.libraryClass===this.spellClass:!row.libraryClass;
      if(!old||preferred&&!(this.spellClass?old.libraryClass===this.spellClass:!old.libraryClass))unique.set(identity,row);
    }
    const rows=[...unique.values()];
    const rank = row => { const name = normalized(row.name); return query && name === query ? 0 : query && name.startsWith(query) ? 1 : 2; };
    rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "zh-CN") || a.packTitle.localeCompare(b.packTitle, "zh-CN"));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); this.page = Math.max(0, Math.min(this.page, pages - 1));
    results.innerHTML = rows.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE).map(row => `<article role="listitem" class="s3r-search-row" draggable="true" data-key="${esc(row.key)}"><img src="${esc(row.img)}" alt="" draggable="false" width="36" height="36" style="width:36px;height:36px;max-width:36px;max-height:36px;object-fit:contain"><div><button type="button" class="s3r-search-name" data-open="${esc(row.key)}">${esc(row.name)}</button><div class="s3r-search-meta"><span>${esc(row.ruleset)} · ${esc(TYPES[row.kind])}${row.level === null ? "" : ` · ${row.level}环`}</span>${row.kind==="spell"?`<span>${esc(row.classes.filter(([name])=>!this.spellClass||name===this.spellClass).map(([name,level])=>`${PF1_CLASSES[name]||name} ${level}环`).join("、"))}</span>`:""}<span title="${esc(row.source)}">${esc(row.book)}</span><span>${esc(row.packTitle)}</span>${row.coverage?`<span>${esc(row.coverage)}</span>`:""}</div></div><i class="fas fa-grip-vertical" aria-hidden="true"></i></article>`).join("")
      || `<p class="s3r-search-empty">${this.loading ? "正在读取条目……" : this.rows.length ? "没有符合条件的内容，可更换关键词或筛选。" : this.scope === "module" ? "还没有可读的3r资料合集，可切到“全部可读合集＋世界物品”。" : "没有可读的物品内容。"}</p>`;
    for (const image of results.querySelectorAll("img")) image.addEventListener("error", () => { image.removeAttribute("src"); image.hidden = true; }, { once: true });
    root.querySelector(".s3r-search-status").textContent = `${this.progress ? `${this.progress} ` : ""}${rows.length}条结果${this.failed.length ? `；未能读取：${this.failed.join("、")}` : ""}`;
    root.querySelector(".s3r-search-page").textContent = `${this.page + 1} / ${pages}`;
    root.querySelector('[data-action="previous"]').disabled = this.page === 0;
    root.querySelector('[data-action="next"]').disabled = this.page >= pages - 1;
    root.querySelector('[data-action="reload"]').disabled = this.loading;
  }

  async openDocument(key) {
    const row = this.byKey.get(key);
    if (!row || !this.canRead(row)) throw new Error("这个条目已移除，或你没有查看权限。请刷新搜索。");
    const document = row.pack ? await game.packs.get(row.pack).getDocument(row.id) : game.items.get(row.id);
    if (!document || !this.canRead(row) || (!row.pack && !readableItem(document))) throw new Error("条目不可读取，请刷新搜索。");
    return document.sheet.render(true);
  }

  async close(options = {}) {
    this.sequence++; this.loading = false; clearTimeout(this.debounce);
    if (activeSearch === this) activeSearch = null;
    return super.close(options);
  }
}

export function openContentSearch(query = "") {
  if (game.system.id !== "D35E") { ui.notifications.warn("3r内容搜索需要D35E系统。"); return; }
  activeSearch ||= new ContentSearchApp();
  if (query) { activeSearch.query = String(query).slice(0, 200); activeSearch.page = 0; }
  return activeSearch.render({ force: true });
}

export function registerContentSearch() {
  game.settings.registerMenu(MODULE_ID, "contentSearch", {
    name: "3r内容搜索", label: "打开内容搜索", hint: "查找法术、专长、能力、职业和物品，查看详情或拖入角色卡。",
    icon: "fas fa-magnifying-glass", type: ContentSearchApp, restricted: false,
  });
  game.keybindings.register(MODULE_ID, "contentSearch", {
    name: "3r内容搜索", hint: "打开内容搜索窗口；可在快捷键设置里更改。",
    editable: [{ key: "KeyF", modifiers: ["Control", "Shift"] }], onDown: () => { Promise.resolve(openContentSearch()).catch(error => ui.notifications.error(error.message)); return true; },
    restricted: false,
  });
}

export function installContentSearchButton() {
  const attach = (app, html) => {
    if (game.system.id !== "D35E") return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".s3r-search-launch")) return;
    const footer = root.querySelector(".directory-footer"); if (!footer) return;
    const button = document.createElement("button"); button.type = "button"; button.className = "s3r-search-launch";
    button.innerHTML = '<i class="fas fa-magnifying-glass" aria-hidden="true"></i> 3r内容搜索';
    button.addEventListener("click", () => Promise.resolve(openContentSearch()).catch(error => ui.notifications.error(error.message))); footer.append(button);
  };
  const attachSidebar = (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const pane = root?.querySelector("#compendium");
    if (pane) attach(app, pane);
  };
  Hooks.on("renderCompendiumDirectory", attach);
  Hooks.on("renderSidebarPF", attachSidebar);
  Hooks.on("renderSidebar", attachSidebar);
  if (ui.compendium?.element) attach(ui.compendium, ui.compendium.element);
  else if (ui.sidebar?.element) attachSidebar(ui.sidebar, ui.sidebar.element);
}
