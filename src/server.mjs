import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { renderDeck } from './renderer.mjs';
import { inspectPptx } from './inspect.mjs';
import { createMcpServer } from './mcp.mjs';
import { FileStore, PPTX_TYPE, describeFile } from './files.mjs';

const MiB = 1024 ** 2;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const tokenMatches = (header, token) => {
  const given = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

// accessToken: when set, /mcp, /render and POST /files require "Authorization: Bearer <token>".
// GET /files/<id> stays open because the unguessable id is itself the capability.
export function createServer({ files = new FileStore(), accessToken = process.env.ACCESS_TOKEN, publicBaseUrl = process.env.PUBLIC_BASE_URL } = {}) {
  let busy = false;
  const exclusive = async fn => {
    if (busy) throw new Error('GENERATOR_BUSY: retry later');
    busy = true;
    try { return await fn(); } finally { busy = false; }
  };
  const baseUrlFor = req => (publicBaseUrl ?? `${String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]}://${req.headers.host}`).replace(/\/$/, '');

  return http.createServer(async (req, res) => {
    const json = (status, value) => { if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && pathname === '/health') return json(200, { status: 'ok', service: 'research-slides', llm: 'not-connected', mcp: '/mcp' });

      const download = pathname.match(/^\/files\/([A-Za-z0-9_-]{32})$/);
      if (req.method === 'GET' && download) {
        const file = files.get(download[1]);
        if (!file) return json(404, { error: 'File not found or expired' });
        res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.name.replace(/[^\w.-]/g, '_')}"`, 'Content-Length': file.buffer.length, 'Cache-Control': 'no-store' });
        return res.end(file.buffer);
      }

      const routes = ['/mcp', '/render', '/files'];
      if (!routes.includes(pathname)) return json(404, { error: 'Not found' });
      if (accessToken && !tokenMatches(req.headers.authorization, accessToken)) return json(401, { error: 'Unauthorized' });

      if (pathname === '/mcp') {
        // Stateless Streamable HTTP: each POST gets its own server/transport, so any instance can answer.
        if (req.method !== 'POST') return json(405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
        let body;
        try { body = JSON.parse((await readBody(req, 16 * MiB)).toString('utf8')); }
        catch (error) { return error instanceof HttpError ? json(error.status, { error: error.message }) : json(400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }); }
        const server = createMcpServer({ files, baseUrl: baseUrlFor(req), exclusive });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { transport.close(); server.close(); });
        await server.connect(transport);
        return await transport.handleRequest(req, res, body);
      }

      if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

      if (pathname === '/files') {
        const type = req.headers['content-type'] ?? '';
        if (!type.startsWith(PPTX_TYPE) && !type.startsWith('application/octet-stream')) return json(415, { error: `Use ${PPTX_TYPE}` });
        const name = String(req.headers['x-file-name'] ?? 'input.pptx').slice(0, 200);
        try { return json(201, describeFile(files.put(await readBody(req, files.maxFileBytes), { name }), baseUrlFor(req))); }
        catch (error) { return error instanceof HttpError ? json(error.status, { error: error.message }) : json(400, { error: 'Invalid upload' }); }
      }

      // POST /render
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'Use application/json' });
      if (busy) return json(503, { error: 'Generator busy; retry later' });
      try {
        const buffer = await exclusive(async () => {
          const deck = JSON.parse((await readBody(req, 8 * MiB)).toString('utf8'));
          const { buffer } = await renderDeck(deck, { allowLocalPaths: false });
          if ((await inspectPptx(buffer)).status !== 'passed') throw new HttpError(500, 'Output validation failed');
          return buffer;
        });
        res.writeHead(200, { 'Content-Type': PPTX_TYPE, 'Content-Disposition': 'attachment; filename="slides.pptx"', 'Content-Length': buffer.length }); res.end(buffer);
      } catch (error) {
        // Do not echo input, local paths, or library internals to a remote client.
        json(error instanceof HttpError ? error.status : 400, { error: error instanceof HttpError ? error.message : 'Invalid or unsupported deck input' });
      }
    } catch (error) {
      json(500, { error: 'Internal error' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  createServer().listen(port, '0.0.0.0', () => console.log(`Research Slides listening on ${port}; MCP at /mcp; LLM not connected`));
}
