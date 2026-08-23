#!/usr/bin/env node
// Tiny local CORS-bypass proxy for the D&D Brewporter Foundry module.
//
// CORS is a browser-enforced restriction — it doesn't apply to a plain Node
// process fetching a URL server-side. This proxy does exactly that: fetch
// the real page/API here (no CORS), hand it back to Foundry's browser
// client with a permissive header attached.
//
// Two independent jobs live in this one process so there's still only one
// command to run:
//   - /fetch        generic page fetch (wikidot, Google Docs, ...)
//   - /ddb/*        D&D Beyond's authenticated character-builder API
//
// Usage: node wikidot-proxy.mjs
// Leave it running while importing in Foundry. Bound to 127.0.0.1 only —
// not reachable from the network, only from this machine.

import http from "node:http";

const PORT = 8091;

// ---- D&D Beyond auth -------------------------------------------------
//
// D&D Beyond's character-builder API needs a Bearer token, obtained by
// exchanging the user's CobaltSession cookie (their login token) at
// auth-service.dndbeyond.com. That exchange requires setting a Cookie
// header, which a cross-origin browser request can't do — so, same as the
// page-fetch job above, it has to happen server-side here.
//
// The cobalt value and the bearer it exchanges for are held ONLY in this
// process's memory — never written to disk, never echoed back to the
// browser. The bearer is short-lived (~5 minutes observed); this refreshes
// it transparently using the last cobalt value it was given, so the
// Foundry-side client never has to think about expiry.
const DDB_GAME_DATA_TYPES = new Set(["races", "feats", "classes", "backgrounds"]);
let ddbCobalt = null;
let ddbBearer = null;
let ddbBearerExpiresAt = 0;

async function exchangeCobaltForBearer(cobalt) {
  const res = await fetch("https://auth-service.dndbeyond.com/v1/cobalt-token", {
    method: "POST",
    headers: { Cookie: `CobaltSession=${cobalt}` },
  });
  if (!res.ok) throw new Error(`auth-service responded HTTP ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error("auth-service returned no token — the CobaltSession value is likely invalid or expired");
  return data.token;
}

async function getDdbBearer() {
  if (!ddbCobalt) throw new Error("No CobaltSession on file — call /ddb/auth first.");
  if (ddbBearer && Date.now() < ddbBearerExpiresAt) return ddbBearer;
  ddbBearer = await exchangeCobaltForBearer(ddbCobalt);
  // Observed token lifetime is ~5 minutes; refresh a little early.
  ddbBearerExpiresAt = Date.now() + 4 * 60 * 1000;
  return ddbBearer;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");

  // A plain GET with no custom headers (the /fetch and /ddb/game-data
  // routes) never triggers a CORS preflight, so this was never needed
  // until /ddb/auth's POST + Content-Type: application/json — a
  // "non-simple" request — added one. Without an explicit 2xx answer to
  // OPTIONS carrying Allow-Methods/Allow-Headers, the browser fails the
  // preflight and blocks the real request before it's ever sent, which
  // surfaces to calling code as a bare "Failed to fetch".
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    }).end();
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  if (url.pathname === "/fetch") {
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
    return;
  }

  if (url.pathname === "/ddb/auth" && req.method === "POST") {
    try {
      const { cobalt } = await readJsonBody(req);
      if (!cobalt) throw new Error("missing cobalt value");
      // Reset the cached bearer so a newly-pasted cobalt takes effect
      // immediately instead of waiting out the old one's ~5 minute life.
      ddbCobalt = cobalt;
      ddbBearer = null;
      ddbBearerExpiresAt = 0;
      await getDdbBearer(); // validates the cobalt value up front
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ success: true }));
    } catch (err) {
      ddbCobalt = null;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ success: false, message: err.message }));
    }
    return;
  }

  const gameDataMatch = url.pathname.match(/^\/ddb\/game-data\/([a-z]+)$/);
  if (gameDataMatch && req.method === "GET") {
    const type = gameDataMatch[1];
    if (!DDB_GAME_DATA_TYPES.has(type)) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ success: false, message: `Unsupported type "${type}"` }));
      return;
    }
    try {
      const bearer = await getDdbBearer();
      const upstream = await fetch(`https://character-service.dndbeyond.com/character/v5/game-data/${type}?sharingSetting=2`, {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      if (upstream.status === 401) {
        // Bearer rejected outright (cobalt itself expired/invalid) —
        // clear the cache so the next call forces a fresh exchange
        // instead of retrying the same dead token.
        ddbBearer = null;
        ddbBearerExpiresAt = 0;
      }
      const body = await upstream.text();
      res.writeHead(upstream.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(body);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ success: false, message: err.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Brewporter proxy listening on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  Fetch:        http://localhost:${PORT}/fetch?url=<encoded-url>`);
  console.log(`  DDB auth:     POST http://localhost:${PORT}/ddb/auth  { "cobalt": "<CobaltSession value>" }`);
  console.log(`  DDB data:     GET  http://localhost:${PORT}/ddb/game-data/<races|feats|classes|backgrounds>`);
  console.log("Leave this running while importing in Foundry. Ctrl+C to stop.");
});
