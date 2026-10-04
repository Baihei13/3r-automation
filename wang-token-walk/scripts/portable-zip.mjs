// Small, local ZIP codec. Image files are already compressed: exports use STORE.
// No CDN dependency, executable payload, or extraction to the host filesystem.
export const PACKAGE_LIMITS = { total: 128 * 1024 * 1024, file: 16 * 1024 * 1024, entries: 2052, json: 2 * 1024 * 1024 };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const safeName = name => typeof name === "string" && name.length <= 240 && /^[\p{L}\p{N}\p{M}_./-]+$/u.test(name)
  && !name.startsWith("/") && !name.split("/").some(part => part === ".." || part === "." || !part);
const header = length => ({ bytes: new Uint8Array(length), view: null });
function block(length) { const result = header(length); result.view = new DataView(result.bytes.buffer); return result; }

export function makeZip(files) {
  if (files.length > PACKAGE_LIMITS.entries) throw new Error("素材数量超过上限。");
  const parts = [], directory = [], names = new Set();
  let offset = 0, total = 0, directorySize = 0;
  for (const [name, bytes] of files) {
    if (!safeName(name) || names.has(name)) throw new Error("素材包文件名无效或重复。");
    names.add(name); total += bytes.length;
    if (total > PACKAGE_LIMITS.total) throw new Error("素材包超过128 MB，请拆分导出。");
    const filename = encoder.encode(name), crc = crc32(bytes);
    const local = block(30), central = block(46);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x800, true); local.view.setUint16(12, 33, true);
    local.view.setUint32(14, crc, true); local.view.setUint32(18, bytes.length, true);
    local.view.setUint32(22, bytes.length, true); local.view.setUint16(26, filename.length, true);
    central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true); central.view.setUint16(8, 0x800, true);
    central.view.setUint16(14, 33, true); central.view.setUint32(16, crc, true);
    central.view.setUint32(20, bytes.length, true); central.view.setUint32(24, bytes.length, true);
    central.view.setUint16(28, filename.length, true); central.view.setUint32(42, offset, true);
    parts.push(local.bytes, filename, bytes); directory.push(central.bytes, filename);
    offset += 30 + filename.length + bytes.length; directorySize += 46 + filename.length;
  }
  const end = block(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true); end.view.setUint32(12, directorySize, true);
  end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.bytes], { type: "application/zip" });
}

export async function readBoundedBody(body, maximum) {
  const reader = body.getReader(), parts = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      length += result.value.length;
      if (length > maximum) throw new Error("文件数据超过允许大小。");
      parts.push(result.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export async function openZip(file) {
  if (file.size > PACKAGE_LIMITS.total + 4 * PACKAGE_LIMITS.json) throw new Error("素材包超过允许大小。");
  const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
  const inside = (offset, size) => {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > bytes.length) throw new Error("ZIP文件不完整。");
  };
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error("不是完整的ZIP素材包。");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
    || view.getUint16(end + 8, true) !== view.getUint16(end + 10, true)) throw new Error("不支持分卷ZIP。");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (!count || count > PACKAGE_LIMITS.entries || start + size !== end) throw new Error("ZIP目录无效或素材过多。");
  inside(start, size);
  const entries = new Map();
  let position = start, total = 0;
  for (let index = 0; index < count; index++) {
    inside(position, 46);
    if (view.getUint32(position, true) !== 0x02014b50) throw new Error("ZIP目录已损坏。");
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true), compressed = view.getUint32(position + 20, true), length = view.getUint32(position + 24, true);
    const nameSize = view.getUint16(position + 28, true), extra = view.getUint16(position + 30, true), comment = view.getUint16(position + 32, true);
    const offset = view.getUint32(position + 42, true);
    inside(position + 46, nameSize + extra + comment);
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameSize));
    if (!safeName(name) || entries.has(name) || flags & 1 || ![0, 8].includes(method)
      || view.getUint16(position + 34, true)) throw new Error("ZIP包含无效、重复、加密或不支持的文件。");
    total += length;
    if (length > PACKAGE_LIMITS.file || total > PACKAGE_LIMITS.total) throw new Error("素材解压大小超过允许上限。");
    inside(offset, 30);
    if (view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 8, true) !== method) throw new Error("ZIP文件头不一致。");
    const localNameSize = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true);
    inside(offset + 30, localNameSize + localExtra);
    if (decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNameSize)) !== name) throw new Error("ZIP文件名不一致。");
    const dataStart = offset + 30 + localNameSize + localExtra;
    if (dataStart + compressed > start || method === 0 && compressed !== length) throw new Error("ZIP数据范围无效。");
    entries.set(name, { name, length, crc, async read() {
      let data = bytes.subarray(dataStart, dataStart + compressed);
      if (method === 8) {
        try { data = await readBoundedBody(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")), length); }
        catch { throw new Error("无法解压素材，请使用模块直接导出的ZIP包。"); }
      }
      if (data.length !== length || crc32(data) !== crc) throw new Error("素材包数据校验失败。");
      return data;
    } });
    position += 46 + nameSize + extra + comment;
  }
  if (position !== end) throw new Error("ZIP目录长度无效。");
  return entries;
}
