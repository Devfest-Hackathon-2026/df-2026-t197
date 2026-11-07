import JSZip from 'jszip';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseXml, child, children, attr } from './xml.mjs';

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const DEFAULT_LIMITS = Object.freeze({ inputBytes: 64 * 1024 ** 2, totalBytes: 128 * 1024 ** 2, partBytes: 64 * 1024 ** 2, xmlBytes: 8 * 1024 ** 2, entries: 10000 });

function validName(name) {
  return name && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !name.split('/').includes('..') && !/^[a-z]:/i.test(name);
}

// Check the central directory before asking JSZip to inflate any entry.
function centralDirectory(buffer, limits) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw new Error('INVALID_ZIP: end record missing');
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), offset = buffer.readUInt32LE(end + 16);
  if (count === 65535 || size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64_NOT_SUPPORTED');
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count) throw new Error('MULTIDISK_ZIP_NOT_SUPPORTED');
  if (count > limits.entries || offset + size > end) throw new Error('ZIP_DIRECTORY_LIMIT_OR_BOUNDS');
  let cursor = offset, total = 0; const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > offset + size || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('INVALID_ZIP_DIRECTORY');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const packed = buffer.readUInt32LE(cursor + 20), unpacked = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > offset + size) throw new Error('INVALID_ZIP_DIRECTORY');
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    if (!(flags & 0x800) && nameBytes.some(b => b > 127)) throw new Error('NON_UTF8_ZIP_NAME_NOT_SUPPORTED');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    if (!validName(name)) throw new Error('UNSAFE_ZIP_NAME');
    if (entries.has(name)) throw new Error('DUPLICATE_ZIP_ENTRY');
    if (flags & 1) throw new Error('ENCRYPTED_ZIP_NOT_SUPPORTED');
    if (![0, 8].includes(method)) throw new Error('ZIP_COMPRESSION_NOT_SUPPORTED');
    if ([packed, unpacked, buffer.readUInt32LE(cursor + 42)].includes(0xffffffff)) throw new Error('ZIP64_NOT_SUPPORTED');
    if (unpacked > limits.partBytes || (/\.(xml|rels)$/i.test(name) && unpacked > limits.xmlBytes)) throw new Error('PART_SIZE_LIMIT');
    total += unpacked; if (total > limits.totalBytes) throw new Error('TOTAL_SIZE_LIMIT');
    entries.set(name, { bytes: unpacked, compressedBytes: packed }); cursor = next;
  }
  if (cursor !== offset + size) throw new Error('INVALID_ZIP_DIRECTORY_SIZE');
  return entries;
}

export class PptxPackage {
  static async open(input, customLimits = {}) {
    const limits = { ...DEFAULT_LIMITS, ...customLimits };
    if (Object.values(limits).some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('INVALID_READ_LIMITS');
    const buffer = Buffer.from(input);
    if (buffer.length > limits.inputBytes) throw new Error('INPUT_SIZE_LIMIT');
    const declared = centralDirectory(buffer, limits);
    let zip; try { zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false }); } catch { throw new Error('INVALID_ZIP_OR_CRC'); }
    for (const [name, entry] of Object.entries(zip.files)) {
      if (!declared.has(name) || (entry.unsafeOriginalName && entry.unsafeOriginalName !== name)) throw new Error('ZIP_NAME_CHANGED_OR_UNDECLARED');
    }
    return new PptxPackage(zip, declared, buffer.length, sha256(buffer));
  }
  constructor(zip, declared, bytes, hash) {
    this.zip = zip; this.declared = declared; this.bytes = bytes; this.hash = hash;
    this.xmlCache = new Map(); this.relCache = new Map(); this.issues = [];
  }
  issue(code, part, detail, severity = 'warning') { this.issues.push({ code, part, detail, severity }); }
  has(part) { return Boolean(this.zip.file(part)); }
  async raw(part) { const f = this.zip.file(part); if (!f) throw new Error(`MISSING_PART: ${part}`); return f.async('nodebuffer'); }
  async xml(part, required = true) {
    if (!this.has(part)) { if (required) this.issue('MISSING_PART', part, 'Referenced part does not exist', 'error'); return null; }
    if (!this.xmlCache.has(part)) this.xmlCache.set(part, this.raw(part).then(b => parseXml(b.toString('utf8'), part)));
    try { return await this.xmlCache.get(part); }
    catch (error) { if (required) this.issue('INVALID_XML', part, error.message, 'error'); return null; }
  }
  resolve(source, target) {
    if (!target || /\\|\0/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) throw new Error('INVALID_INTERNAL_TARGET');
    const noFragment = target.split('#')[0];
    if (noFragment.includes('?')) throw new Error('QUERY_IN_PART_TARGET_NOT_SUPPORTED');
    let decoded; try { decoded = decodeURIComponent(noFragment); } catch { throw new Error('INVALID_TARGET_ENCODING'); }
    const resolveName = value => {
      const name = path.posix.normalize(value.startsWith('/') ? value.slice(1) : path.posix.join(path.posix.dirname(source), value));
      if (!validName(name) || name === '.') throw new Error('TARGET_OUTSIDE_PACKAGE');
      return name;
    };
    const encodedPart = resolveName(noFragment || path.posix.basename(source));
    const decodedPart = resolveName(decoded || path.posix.basename(source));
    return this.has(encodedPart) ? encodedPart : decodedPart;
  }
  async relationships(source = '') {
    if (this.relCache.has(source)) return this.relCache.get(source);
    const part = source ? path.posix.join(path.posix.dirname(source), '_rels', `${path.posix.basename(source)}.rels`) : '_rels/.rels';
    const root = await this.xml(part, false); const result = [];
    if (root) {
      if (!child({ childNodes: [root] }, 'rel', 'Relationships')) this.issue('RELATIONSHIP_NAMESPACE', part, 'Unexpected relationships namespace', 'error');
      const ids = new Set();
      for (const node of children(root, 'rel', 'Relationship')) {
        const id = attr(node, 'Id'), type = attr(node, 'Type'), target = attr(node, 'Target'), mode = attr(node, 'TargetMode');
        const external = mode === 'External';
        if (!id || ids.has(id)) this.issue('DUPLICATE_OR_MISSING_REL_ID', part, id, 'error');
        ids.add(id);
        const standardType = /^(http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/|http:\/\/purl\.oclc\.org\/ooxml\/officeDocument\/relationships\/)/.test(type ?? '');
        const relationship = { id, type, kind: standardType ? type.split('/').at(-1) : null, target, external, part: null, exists: false };
        if (mode && mode !== 'External' && mode !== 'Internal') this.issue('UNKNOWN_TARGET_MODE', part, mode, 'error');
        if (!external) {
          try { relationship.part = this.resolve(source, target); relationship.exists = this.has(relationship.part); }
          catch (error) { this.issue('INVALID_REL_TARGET', part, error.message, 'error'); }
          if (relationship.part && !relationship.exists) this.issue('MISSING_REL_TARGET', part, relationship.part, 'error');
        }
        result.push(relationship);
      }
    } else if (this.has(part)) this.issue('UNREADABLE_RELATIONSHIPS', part, 'Could not parse relationship file', 'error');
    this.relCache.set(source, result); return result;
  }
  async oneRelationship(source, kind, { required = false } = {}) {
    const matches = (await this.relationships(source)).filter(r => r.kind === kind && !r.external);
    if (matches.length > 1) { this.issue('AMBIGUOUS_RELATIONSHIP', source, kind, 'error'); return null; }
    if (!matches.length && required) this.issue('MISSING_RELATIONSHIP', source, kind, 'error');
    return matches[0]?.exists ? matches[0] : null;
  }
  async inventory() {
    const output = [];
    for (const [part, declared] of this.declared) if (!part.endsWith('/')) output.push({ part, bytes: declared.bytes, sha256: sha256(await this.raw(part)) });
    return output;
  }
}
