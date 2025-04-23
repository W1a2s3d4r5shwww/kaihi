import { createServer as createBareServer } from '@tomphttp/bare-server-node';
import { fileURLToPath } from 'url';
import http from 'http';
import serveStatic from 'serve-static';
import { TextDecoder } from 'util';
import fetch from 'node-fetch';

// ライセンス表示
console.log(`Incognito
This program comes with ABSOLUTELY NO WARRANTY.
This is free software, and you are welcome to redistribute it
under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
`);

const port = process.env.PORT || 8080;
const bare = createBareServer('/bare/');
const serve = serveStatic(fileURLToPath(new URL('./static/', import.meta.url)), { fallthrough: false });
const server = http.createServer();

server.on('request', async (req, res) => {
  // ✅ /proxy/ で始まるリクエストは中間プロキシとして処理（文字化け対策）
  if (req.url.startsWith('/proxy/')) {
    const targetUrl = 'https://' + req.url.replace(/^\/proxy\//, '');
    try {
      const proxyRes = await fetch(targetUrl);
      const buffer = await proxyRes.arrayBuffer();
      const contentType = proxyRes.headers.get('content-type') || '';
      let charset = 'utf-8';
      const match = contentType.match(/charset=([^;]+)/i);
      if (match) charset = match[1].trim().toLowerCase();

      let text;
      try {
        const decoder = new TextDecoder(charset, { fatal: false });
        text = decoder.decode(buffer);
      } catch (e) {
        text = new TextDecoder('utf-8').decode(buffer);
      }

      // <meta charset> の書き換え
      text = text.replace(/<meta[^>]+charset=[^>]+>/i, '<meta charset="utf-8">');

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
      });
      res.end(text);
    } catch (err) {
      res.writeHead(500);
      res.end('Proxy error: ' + err.message);
    }
    return;
  }

  // 🧱 bare-server 経由の通常ルート
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    serve(req, res, (err) => {
      res.writeHead(err?.statusCode || 500, null, {
        'Content-Type': 'text/plain',
      });
      res.end(err?.stack);
    });
  }
});

server.on('upgrade', (req, socket, head) => {
  if (bare.shouldRoute(req, socket, head)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.listen({ port });
console.log('Server running on port ' + port);
