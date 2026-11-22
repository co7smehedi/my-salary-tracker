/* Regression-test harness for My Salary Tracker. Usage: node run.js <path-to-app-folder>
   Serves the folder on a local port, runs pure-logic tests in Node and behaviour tests in a real browser (Playwright/Chromium).
   Every browser test gets a brand-new browser profile (empty IndexedDB / localStorage). Nothing outside the target folder is touched. */
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain' };

function serve(dir) {
  const ctl = { swSuffix: '' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    let body = fs.readFileSync(f);
    if (p === '/service-worker.js' && ctl.swSuffix) body = Buffer.concat([body, Buffer.from('\n' + ctl.swSuffix)]);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, ctl, base: 'http://127.0.0.1:' + server.address().port })));
}

const results = [];
const tests = [];
function test(name, fn, opts) { tests.push({ name, fn, opts: opts || {} }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }

module.exports = { serve, test, tests, results, assert, eq };
