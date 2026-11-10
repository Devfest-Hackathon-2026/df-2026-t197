import crypto from 'node:crypto';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// Short-lived in-memory storage for MCP/HTTP clients that cannot share a filesystem with the server.
// IDs are unguessable capabilities. Data is lost on restart and is not shared between Cloud Run instances.
export class FileStore {
  constructor({ ttlMs = 30 * 60 * 1000, maxFileBytes = 32 * 1024 ** 2, maxTotalBytes = 256 * 1024 ** 2, now = () => Date.now() } = {}) {
    Object.assign(this, { ttlMs, maxFileBytes, maxTotalBytes, now });
    this.files = new Map();
  }

  purge() {
    const time = this.now();
    for (const [id, file] of this.files) if (file.expiresAt <= time) this.files.delete(id);
  }

  get totalBytes() { let n = 0; for (const f of this.files.values()) n += f.buffer.length; return n; }

  put(buffer, { name = 'slides.pptx', contentType = PPTX_TYPE } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('FILE_EMPTY');
    if (buffer.length > this.maxFileBytes) throw new Error('FILE_TOO_LARGE');
    if (contentType === PPTX_TYPE && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error('NOT_A_ZIP_PACKAGE');
    this.purge();
    // Evict the oldest files rather than refusing new work when memory is full.
    for (const id of this.files.keys()) { if (this.totalBytes + buffer.length <= this.maxTotalBytes) break; this.files.delete(id); }
    if (this.totalBytes + buffer.length > this.maxTotalBytes) throw new Error('FILE_STORE_FULL');
    const id = crypto.randomBytes(24).toString('base64url');
    const file = { id, buffer, name, contentType, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), expiresAt: this.now() + this.ttlMs };
    this.files.set(id, file);
    return file;
  }

  get(id) {
    this.purge();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(id)) return undefined;
    return this.files.get(id);
  }
}

export const describeFile = (file, baseUrl) => ({
  fileId: file.id, name: file.name, bytes: file.buffer.length, sha256: file.sha256,
  expiresAt: new Date(file.expiresAt).toISOString(),
  downloadUrl: `${baseUrl}/files/${file.id}`
});
