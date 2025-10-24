// Proposed replacement for index.js
import createServer from '@tomphttp/bare-server-node';
import { fileURLToPath } from "url";
import http from 'http';
import serveStatic from "serve-static";
import { pipeline } from 'stream';
import { promisify } from 'util';
import { Buffer } from 'buffer';

const streamPipeline = promisify(pipeline);

// The following message MAY NOT be removed
console.log("Incognito\nThis program comes with ABSOLUTELY NO WARRANTY.\nThis is free software, and you are welcome to redistribute it\nunder the terms of the GNU General Public License as published...");

const port = process.env.PORT || 8080;
const bare = createServer('/bare/');
const serve = serveStatic(fileURLToPath(new URL("./static/", import.meta.url)), { fallthrough: false });
const server = http.createServer();

function isHopByHopHeader(name) {
  const hopByHop = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade'
  ];
  return hopByHop.includes(name.toLowerCase());
}

/**
 * Decode a base64 part or query parameter to target url.
 * Supports:
 *  - /p/<base64url>
 *  - /p/?link=<base64url>
 */
function decodeTargetUrl(reqUrl) {
  try {
    const u = new URL(reqUrl, `http://${req.headers.host}`);
    // query param ?link=base64(...)
    if (u.searchParams.has('link')) {
      const b = u.searchParams.get('link');
      return Buffer.from(b, 'base64').toString('utf8');
    }
    // path /p/<base64>
    const parts = u.pathname.split('/');
    if (parts.length >= 3 && parts[1] === 'p') {
      const b = parts.slice(2).join('/');
      return Buffer.from(b, 'base64').toString('utf8');
    }
  } catch (e) {}
  return null;
}

server.on('request', async (req, res) => {
  try {
    // let bare-server handle WebSocket upgrade routes and similar
    if (bare.shouldRoute(req)) {
      return bare.routeRequest(req, res);
    }

    // Handle proxy route: paths starting with /p/ or query '?link='
    if (req.url && (req.url.startsWith('/p/') || req.includes && req.includes('link='))) {
      const target = decodeTargetUrl(req.url);
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad proxy request');
      }

      // Build headers for upstream fetch: copy incoming headers, but remove hop-by-hop ones
      const upstreamHeaders = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (isHopByHopHeader(k)) continue;
        // do not forward host header, let fetch set it
        if (k.toLowerCase() === 'host') continue;
        upstreamHeaders[k] = v;
      }

      // Use global fetch (Node >=18). Forward method and body.
      const init = {
        method: req.method,
        headers: upstreamHeaders,
        // body: stream only for non-GET methods
      };

      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        init.body = req;
      }

      const upstreamRes = await fetch(target, init);

      // Copy status
      const status = upstreamRes.status;

      // Copy headers excluding hop-by-hop and set-cookie handling
      const outHeaders = {};
      upstreamRes.headers.forEach((value, name) => {
        if (isHopByHopHeader(name)) return;
        // We explicitly forward set-cookie headers as-is (some libs combine them)
        outHeaders[name] = value;
      });

      // If there are multiple Set-Cookie headers, ensure they are forwarded individually
      // The Fetch API may combine them; try to get raw headers if possible
      // For typical cases, the above is sufficient.

      // Write response headers and status
      res.writeHead(status, outHeaders);

      // Stream body: prefer piping the ReadableStream -> Node stream
      if (upstreamRes.body) {
        // Node 18+: readable Web stream -> Node Readable
        if (typeof (streamPipeline) !== 'undefined' && typeof upstreamRes.body.getReader === 'function') {
          // Convert WHATWG stream to Node stream and pipe
          const nodeReadable = (await import('stream')).Readable.fromWeb
            ? (await import('stream')).Readable.fromWeb(upstreamRes.body)
            : null;

          if (nodeReadable) {
            await streamPipeline(nodeReadable, res);
            return;
          }
        }

        // Fallback: read as ArrayBuffer chunks and write
        const reader = upstreamRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          // value is Uint8Array
          res.write(Buffer.from(value));
        }
        return res.end();
      } else {
        // No body
        return res.end();
      }
    }

    // Otherwise serve static
    serve(req, res, (err) => {
      res.writeHead(err?.statusCode || 500, null, {
        "Content-Type": "text/plain",
      });
      res.end(err?.stack || String(err));
    });
  } catch (e) {
    console.error('Proxy error:', e);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway: ' + (e && e.message));
  }
});

server.on('upgrade', (req, socket, head) => {
  if (bare.shouldRoute(req, socket, head)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

// Increase timeouts so long downloads / streaming do not cut at ~10s
server.keepAliveTimeout = 120 * 1000; // 2 minutes
server.headersTimeout = 130 * 1000;
server.setTimeout(120 * 1000);

server.listen({
  port: port,
});

console.log("Server running on port " + port);
