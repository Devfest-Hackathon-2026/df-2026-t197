import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderDeck } from './renderer.mjs';
import { inspectPptx } from './inspect.mjs';

export function createServer() {
  let busy = false;
  return http.createServer(async (req, res) => {
    const json = (status, value) => { if (!res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
    if (req.method === 'GET' && req.url === '/health') return json(200, { status: 'ok', service: 'research-slides', llm: 'not-connected' });
    if (req.method !== 'POST' || req.url !== '/render') return json(404, { error: 'Not found' });
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'Use application/json' });
    if (busy) return json(503, { error: 'Generator busy; retry later' });
    busy = true;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) { json(413, { error: 'Request too large' }); return; }
        chunks.push(chunk);
      }
      const deck = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const { buffer } = await renderDeck(deck, { allowLocalPaths: false });
      const structure = await inspectPptx(buffer);
      if (structure.status !== 'passed') return json(500, { error: 'Output validation failed' });
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Content-Disposition': 'attachment; filename="slides.pptx"', 'Content-Length': buffer.length }); res.end(buffer);
    } catch (error) {
      // Do not echo input, local paths, or library internals to a remote client.
      json(400, { error: 'Invalid or unsupported deck input' });
    } finally { busy = false; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  createServer().listen(port, '0.0.0.0', () => console.log(`Research Slides listening on ${port}; LLM not connected`));
}
