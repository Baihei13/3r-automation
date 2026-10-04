import { ACTOR_FORMAT, PRESET_FORMAT, normalizeAnimation, validateActorPresetBundle, validatePreset, safeExportName } from "./animation-data.mjs";
import { PACKAGE_LIMITS, crc32, makeZip, openZip, readBoundedBody } from "./portable-zip.mjs";

const PACKAGE_FORMAT = "wang-token-walk.asset-package";
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
const pickerClass = () => foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
const assetPath = /^assets\/[\p{L}\p{N}\p{M}_-]+-\d{6}\.(png|jpg|gif|webp|avif|bmp)$/u;
const presetPath = /^[\p{L}\p{N}\p{M}_-]+\.json$/u;
const filename = path => String(path).split(/[\\/]/).pop().split(/[?#]/)[0];

function payloadData(value) {
  if (value?.version !== 1) throw new Error("不支持这个预设版本。");
  if (value.format === ACTOR_FORMAT) return {
    format: ACTOR_FORMAT, version: 1, actorName: String(value.actorName ?? "").slice(0, 160),
    ...validateActorPresetBundle(value),
  };
  if (value.format !== PRESET_FORMAT) throw new Error("不是受支持的动画预设。");
  const preset = validatePreset(value);
  if (Object.hasOwn(value.animation, "trigger")) preset.animation = normalizeAnimation(value.animation, { item: true });
  return { format: PRESET_FORMAT, version: 1, ...preset };
}
function animations(payload) {
  return payload.format === ACTOR_FORMAT
    ? [...Object.values(payload.presets).map(preset => preset.animation), ...payload.actions.map(action => action.animation)]
    : [payload.animation];
}
function paths(payload) { return [...new Set(animations(payload).flatMap(animation => Object.values(animation.directions).flat()))]; }
function packageLabel(payload) { return safeExportName(payload.format === ACTOR_FORMAT ? payload.actorName : payload.name); }
function namedSources(payload) {
  const entries = payload.format === ACTOR_FORMAT
    ? [...Object.values(payload.presets), ...payload.actions] : [payload];
  const names = new Map();
  for (const entry of entries) for (const [direction, frames] of Object.entries(entry.animation.directions)) {
    for (const path of frames) if (!names.has(path)) names.set(path, `${safeExportName(entry.name)}-${direction}`);
  }
  return names;
}
function remap(payload, replacements) {
  for (const animation of animations(payload)) for (const [direction, frames] of Object.entries(animation.directions)) {
    animation.directions[direction] = frames.map(path => {
      if (!replacements.has(path)) throw new Error("素材包中缺少预设引用的图片。");
      return replacements.get(path);
    });
  }
  return payload;
}
function imageType(bytes) {
  if (bytes[0] === 137 && decoder.decode(bytes.subarray(1, 4)) === "PNG" && bytes[4] === 13 && bytes[5] === 10) return ["png", "image/png"];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ["jpg", "image/jpeg"];
  const ascii = String.fromCharCode(...bytes.subarray(0, 32));
  if (/^GIF8[79]a/.test(ascii)) return ["gif", "image/gif"];
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return ["webp", "image/webp"];
  if (ascii.slice(4, 8) === "ftyp" && /avif|avis/.test(ascii.slice(8))) return ["avif", "image/avif"];
  if (ascii.startsWith("BM")) return ["bmp", "image/bmp"];
  throw new Error("素材包支持PNG、JPEG、WebP、GIF、AVIF和BMP图片；当前文件不是这些图片格式。");
}
async function fetchImage(path, maximum = PACKAGE_LIMITS.file) {
  const url = new URL(path, document.baseURI);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("请先把帧图片上传到FVTT或图片服务器，再导出素材包。");
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 30000);
  try {
    const response = await fetch(url.href, { mode: "cors", credentials: "same-origin", signal: abort.signal });
    if (!response.ok) throw new Error(`图片请求返回HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > maximum) throw new Error("单张图片超过允许大小。");
    const bytes = await readBoundedBody(response.body, maximum);
    imageType(bytes);
    return bytes;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("图片读取超时。");
    if (error instanceof TypeError) throw new Error("图片无法读取，请检查图片地址及COS/CDN的跨域读取设置。");
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function withAssetTransfer(editor, operation) {
  if (editor._assetTransferBusy) return null;
  editor._assetTransferBusy = true;
  const controls = [...editor.element.querySelectorAll("button,input,select")].map(element => [element, element.disabled]);
  controls.forEach(([element]) => { element.disabled = true; });
  const status = document.createElement("p"); status.className = "notes wtw-transfer-status"; status.setAttribute("role", "status");
  editor.element.querySelector(".wtw-editor-footer")?.append(status);
  try { return await operation(message => { status.textContent = message; }); }
  finally {
    editor._assetTransferBusy = false; status.remove();
    controls.forEach(([element, disabled]) => { if (element.isConnected) element.disabled = disabled; });
  }
}

export async function exportAssetPackage(value, name, progress = () => {}) {
  const payload = payloadData(value), sources = paths(payload);
  const sourceNames = namedSources(payload), label = packageLabel(payload);
  if (!sources.length || sources.length > 2048) throw new Error("素材包需要1至2048张图片，请拆分过大的角色预设。");
  const replacements = new Map(), assets = [], files = [], identical = new Map();
  let total = 0;
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]; progress(`读取图片 ${index + 1}/${sources.length}：${filename(source)}`);
    let bytes;
    try { bytes = await fetchImage(source); }
    catch (error) { throw new Error(`${filename(source)}：${error.message} 未生成缺图素材包。`); }
    const [extension, type] = imageType(bytes), crc = crc32(bytes), identity = `${crc}:${bytes.length}:${extension}`;
    const previous = identical.get(identity)?.find(asset => asset.bytes.every((byte, offset) => byte === bytes[offset]));
    if (previous) { replacements.set(source, previous.path); continue; }
    total += bytes.length;
    if (total > PACKAGE_LIMITS.total - 2 * PACKAGE_LIMITS.json) throw new Error("素材包超过128 MB，请拆分导出。");
    const path = `assets/${sourceNames.get(source)}-${String(assets.length + 1).padStart(6, "0")}.${extension}`;
    replacements.set(source, path); assets.push({ path, type, size: bytes.length, crc32: crc }); files.push([path, bytes]);
    if (!identical.has(identity)) identical.set(identity, []);
    identical.get(identity).push({ path, bytes });
  }
  remap(payload, replacements);
  const presetBytes = encoder.encode(JSON.stringify(payload, null, 2));
  if (presetBytes.length > PACKAGE_LIMITS.json) throw new Error("预设数据超过2 MB，请拆分导出。");
  const presetFile = `${label}-${payload.format === ACTOR_FORMAT ? "角色预设" : "预设"}.json`;
  const manifest = { format: PACKAGE_FORMAT, version: 2, name: label, preset: presetFile, assets };
  files.unshift(["package.json", encoder.encode(JSON.stringify(manifest, null, 2))], [presetFile, presetBytes]);
  files.push(["README.txt", encoder.encode(`素材包：${label}\n在1.5.1或更新版的角色帧/动作帧窗口导入这个ZIP，可自动上传图片并改写路径。\nCOS：解压后上传整个assets目录，再在ZIP导入窗口选择‘使用已上传的图片目录’，填入assets的上级目录网址。\n原JSON导入只记录路径，不能自动上传图片。\n`)]);
  progress(`打包 ${assets.length} 张图片……`);
  const blob = makeZip(files), url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${name}.zip`.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  ui.notifications.info(`素材包已导出，共${assets.length}张图片。`);
}

async function readPackage(file, expectedFormat, progress) {
  progress("读取素材包……");
  const entries = await openZip(file);
  const readJson = async name => {
    const entry = entries.get(name);
    if (!entry || entry.length > PACKAGE_LIMITS.json) throw new Error("素材包缺少清单或清单过大。");
    return JSON.parse(decoder.decode(await entry.read()));
  };
  const manifest = await readJson("package.json");
  if (manifest.format !== PACKAGE_FORMAT || ![1, 2].includes(manifest.version)
    || (manifest.version === 1 ? manifest.preset !== "preset.json" : typeof manifest.preset !== "string" || !presetPath.test(manifest.preset) || manifest.preset.length > 160 || manifest.preset === "package.json")
    || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 2048) throw new Error("不是受支持的预设＋素材包。");
  const payload = payloadData(await readJson(manifest.preset));
  if (payload.format !== expectedFormat) throw new Error(expectedFormat === ACTOR_FORMAT ? "请在单个预设或动作窗口导入这个包。" : "请在整套角色预设处导入这个包。");
  const assets = new Map();
  for (const asset of manifest.assets) {
    if (!assetPath.test(asset?.path) || assets.has(asset.path) || !Number.isInteger(asset.size) || asset.size <= 0
      || !Number.isInteger(asset.crc32) || asset.crc32 < 0 || asset.crc32 > 0xffffffff) throw new Error("素材清单无效或重复。");
    const entry = entries.get(asset.path);
    if (!entry || entry.length !== asset.size || entry.crc !== asset.crc32) throw new Error("素材包缺图或图片信息不一致。");
    const bytes = await entry.read(), [extension, type] = imageType(bytes);
    if (!asset.path.endsWith(`.${extension}`) || asset.type !== type) throw new Error("素材类型与图片内容不一致。");
    assets.set(asset.path, { ...asset, bytes });
  }
  for (const name of entries.keys()) if (!["package.json", manifest.preset, "README.txt"].includes(name) && !assets.has(name)) throw new Error("素材包包含未登记文件。");
  if (paths(payload).some(path => !assets.has(path))) throw new Error("预设引用了素材包之外的图片。");
  return { payload, assets };
}

class ImportDestinationApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "wang-token-walk-package-destination", classes: ["wang-token-walk"],
    window: { title: "导入预设＋素材包", resizable: true }, position: { width: 590 },
  };
  constructor(bundle, resolve) { super({ id: `wang-token-walk-package-destination-${foundry.utils.randomID(12)}` }); this.bundle = bundle; this.resolve = resolve; this.mode = "upload"; this.destination = null; this.base = ""; }
  static prompt(bundle) { return new Promise((resolve, reject) => { new this(bundle, resolve).render({ force: true }).catch(reject); }); }
  async close(...args) { this.resolve?.(null); this.resolve = null; return super.close(...args); }
  async _renderHTML() {
    return `<div class="standard-form wang-token-walk-form"><p>包含${this.bundle.assets.size}张图片。导入后${this.bundle.payload.format === ACTOR_FORMAT ? "替换此角色的动画预设，并匹配同名同类动作" : "载入当前编辑器，点击保存后生效"}。</p>
      <div class="form-group"><label>图片存放方式</label><select name="mode"><option value="upload" ${this.mode === "upload" ? "selected" : ""}>上传到FVTT资源目录或已接入的桶</option><option value="external" ${this.mode === "external" ? "selected" : ""}>使用已上传的图片目录（COS/CDN）</option></select></div>
      ${this.mode === "upload" ? `<div class="form-group"><label>目标目录</label><div class="form-fields"><input readonly value="${escape(this.destination ? `${this.destination.source}：${this.destination.target}` : "尚未选择")}"><button type="button" data-action="browse">选择目录</button></div></div><p class="notes">在选中目录新建独立素材文件夹，保留原文件。桶需要先接入FVTT的文件浏览器。</p>`
        : `<div class="form-group"><label>图片目录网址</label><input name="base" type="url" value="${escape(this.base)}" placeholder="https://你的图片域名/动画包/"></div><p class="notes">先解压ZIP，把assets文件夹上传到这个网址下面。这里填assets的上级目录；该网址加包内图片相对路径应能打开图片。读取全部图片成功后才应用预设；无需在预设中保存桶密钥。</p>`}
      <p class="notes">关闭此窗口即可取消。</p><div class="button-row"><button type="button" data-action="import">开始导入</button><button type="button" data-action="cancel">取消</button></div></div>`;
  }
  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector('[name="mode"]').addEventListener("change", event => { this.base = content.querySelector('[name="base"]')?.value ?? this.base; this.mode = event.target.value; this.render({ force: true }); });
    content.querySelector('[data-action="cancel"]').addEventListener("click", () => this.close());
    content.querySelector('[data-action="browse"]')?.addEventListener("click", async () => {
      try {
        const Picker = pickerClass();
        const picker = new Picker({ type: "folder", current: this.destination?.target || "", callback: path => {
          this.destination = { source: picker.activeSource, target: picker.target || path, bucket: picker.source?.bucket };
          this.render({ force: true });
        } });
        await picker.browse();
      } catch (error) { ui.notifications.error(`目录选择失败：${error.message}`); }
    });
    content.querySelector('[data-action="import"]').addEventListener("click", async () => {
      try {
        let choice;
        if (this.mode === "upload") {
          if (!this.destination || this.destination.source === "public") throw new Error("请选择可上传的用户目录或已接入的桶。");
          choice = { mode: "upload", ...this.destination };
        } else {
          const base = new URL(content.querySelector('[name="base"]').value.trim());
          if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("请填写不带临时签名或参数的图片目录网址。");
          if (document.location.protocol === "https:" && base.protocol !== "https:") throw new Error("当前FVTT使用HTTPS，图片目录也请使用HTTPS。");
          base.pathname = `${base.pathname.replace(/\/+$/, "")}/`; choice = { mode: "external", base: base.href };
        }
        const resolve = this.resolve; this.resolve = null; resolve?.(choice); await this.close();
      } catch (error) { ui.notifications.error(`尚未导入：${error.message}`); }
    });
    return content;
  }
}

async function importAssets(bundle, choice, progress) {
  const replacements = new Map();
  if (choice.mode === "external") {
    let count = 0;
    for (const asset of bundle.assets.values()) {
      const path = new URL(asset.path, choice.base).href; progress(`核对已上传图片 ${++count}/${bundle.assets.size}`);
      const bytes = await fetchImage(path);
      if (bytes.length !== asset.size || crc32(bytes) !== asset.crc32) throw new Error("图片目录中的素材与当前ZIP不一致，请上传本包的assets文件夹。");
      replacements.set(asset.path, path);
    }
  } else {
    const Picker = pickerClass(), options = choice.bucket ? { bucket: choice.bucket } : {};
    await Picker.browse(choice.source, choice.target, options);
    const folder = `${String(choice.target).replace(/\/+$/, "")}${choice.target ? "/" : ""}${packageLabel(bundle.payload)}-${foundry.utils.randomID(8)}`;
    await Picker.createDirectory(choice.source, folder, options);
    let count = 0;
    try {
      for (const asset of bundle.assets.values()) {
        progress(`上传图片 ${++count}/${bundle.assets.size}`);
        const file = new File([asset.bytes], filename(asset.path), { type: asset.type });
        const result = await Picker.upload(choice.source, folder, file, options, { notify: false });
        if (!result?.path || result.error || result.status === "error") throw new Error("上传接口没有返回可用图片地址。");
        const returned = new URL(result.path, document.baseURI);
        if (!["https:", "http:"].includes(returned.protocol)) throw new Error("上传接口返回了无效图片地址。");
        replacements.set(asset.path, result.path);
      }
    } catch (error) { throw new Error(`上传未完成，预设尚未应用。已上传文件保留在${folder}，可在文件浏览器处理。${error.message}`); }
  }
  return remap(bundle.payload, replacements);
}

export async function readPresetFile(file, expectedFormat, progress = () => {}, confirm = async () => true) {
  if (!/\.zip$/i.test(file.name)) {
    if (file.size > PACKAGE_LIMITS.json) throw new Error("JSON预设超过2 MB。");
    const payload = payloadData(JSON.parse(await file.text()));
    if (payload.format !== expectedFormat) throw new Error("请在对应的单个预设或整套角色预设入口导入。");
    return await confirm(payload) ? payload : null;
  }
  const bundle = await readPackage(file, expectedFormat, progress);
  if (!await confirm(bundle.payload)) return null;
  const choice = await ImportDestinationApp.prompt(bundle);
  if (!choice) return null;
  return importAssets(bundle, choice, progress);
}
