// Runs the browser tests against the app: node tests/e2e/run.mjs [name ...]
// Needs Playwright with Chromium installed (https://playwright.dev). The app is served from the repo root and
// /packs/ comes from tests/fixtures/packs (small real-data packs), so the tests never depend on the network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const fixtures = path.join(here, '../fixtures/packs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = p.startsWith('/packs/') ? path.join(fixtures, p.slice(7)) : path.join(root, p);
  if (!file.startsWith(root) || /\/(tests|tools|\.git)\//.test(p) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'calibr-e2e-'));

const wanted = process.argv.slice(2);
const files = fs.readdirSync(here).filter(f => f.endsWith('.cjs') && (!wanted.length || wanted.includes(f.replace('.cjs', ''))));
const CONCURRENCY = Math.max(1, Number(process.env.E2E_CONCURRENCY || 3));
let failed = 0; const flaky = [];
// Each suite launches its own browser and talks to the shared static server, so they can safely run side by side.
// Output is buffered per suite so the log stays readable.
const run = f => new Promise(r => {
  const chunks = [];
  const child = spawn(process.execPath, [path.join(here, f)], { env: { ...process.env, BASE: base, OUT: out } });
  child.stdout.on('data', d => chunks.push(d)); child.stderr.on('data', d => chunks.push(d));
  child.on('exit', code => r({ code, log: Buffer.concat(chunks).toString() }));
});
const runWithRetry = async f => {
  let res = await run(f), retried = false;
  if (res.code !== 0) { retried = true; const first = res; res = await run(f); res.log = `${first.log}FAIL ${f} (retrying once)\n${res.log}`; if (res.code === 0) flaky.push(f); }
  process.stdout.write(`${res.log}${res.code === 0 ? 'PASS' : 'FAIL'} ${f}${retried && res.code === 0 ? ' (passed on retry)' : ''}\n\n`);
  if (res.code !== 0) failed++;
};
const queue = [...files];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => { while (queue.length) await runWithRetry(queue.shift()); }));
if (flaky.length) console.log(`::warning::flaky suites that passed on retry: ${flaky.join(', ')}`);
server.close();
console.log(failed ? `${failed} of ${files.length} e2e suites failed (screenshots in ${out})` : `all ${files.length} e2e suites passed`);
process.exit(failed ? 1 : 0);
