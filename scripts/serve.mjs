// Servidor estático simples para abrir o editor no navegador (sem Electron), útil para testes.
// Uso: npm run serve  →  http://localhost:5178
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = [path.join(root, 'src'), path.join(root, 'node_modules', 'paper', 'dist')];
const port = Number(process.env.PORT) || 5178;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

http
  .createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') return res.writeHead(302, { Location: '/src/index.html' }).end();
    const file = path.join(root, url);
    if (!allowed.some((dir) => file.startsWith(dir + path.sep))) return res.writeHead(403).end();
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('não encontrado');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Frame Animator em http://localhost:${port}`));
