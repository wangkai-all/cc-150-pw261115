// 零依赖静态服务器 + 样本数据 API
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const DATA_FILES = {
  catalog: 'data/catalog.json',
  programs: 'data/programs.json',
  equivalences: 'data/equivalences.json',
  prerequisites: 'data/prerequisites.json',
  students: 'data/students.json',
  'prerequisites-issue': 'data/prerequisites-issue.json',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname.startsWith('/api/sample/')) {
      const key = url.pathname.replace('/api/sample/', '');
      if (!DATA_FILES[key]) {
        res.writeHead(404).end('unknown sample');
        return;
      }
      const body = await readFile(join(here, DATA_FILES[key]), 'utf8');
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(body);
      return;
    }
    // 静态资源：页面在 /web，引擎 ESM 在 /src（页面直接复用同一套审计代码）
    let baseDir = 'web';
    if (url.pathname.startsWith('/src/')) baseDir = 'src';
    let path = url.pathname === '/' ? '/web/index.html' : `/${baseDir}${url.pathname.replace(/^\/src/, '')}`;
    const filePath = join(here, path);
    const allowedRoots = [join(here, 'web'), join(here, 'src')];
    if (!allowedRoots.some((root) => filePath.startsWith(root))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    } else {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(`500 ${err.message}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`学业检查页面: http://localhost:${PORT}`);
});
