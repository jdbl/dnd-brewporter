#!/usr/bin/env node
// Tiny local CORS-bypass proxy for the Wikidot D&D Importer Foundry module.
//
// CORS is a browser-enforced restriction — it doesn't apply to a plain Node
// process fetching a URL server-side. This proxy does exactly that: fetch
// the real page here (no CORS), hand it back to Foundry's browser client
// with a permissive header attached.
//
// Usage: node wikidot-proxy.mjs
// Leave it running while importing in Foundry. Bound to 127.0.0.1 only —
// not reachable from the network, only from this machine.

import http from "node:http";

const PORT = 8091;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  if (url.pathname !== "/fetch") {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }

  const target = url.searchParams.get("url");
  if (!target) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("missing ?url=");
    return;
  }

  try {
    const upstream = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 (wikidot-proxy)" } });
    const body = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "text/plain" }).end(`Proxy fetch failed: ${err.message}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Wikidot proxy listening on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  Fetch:        http://localhost:${PORT}/fetch?url=<encoded-url>`);
  console.log("Leave this running while importing in Foundry. Ctrl+C to stop.");
});
