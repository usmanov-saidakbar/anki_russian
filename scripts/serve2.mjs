// Static server for tests: /app/* -> the app repo, /preview.html -> the artifact preview wrapped like the artifact skeleton,
// /api/anki/:email -> in-memory sync store (same shape as the real server).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const APP = path.resolve(DIR, "../public");
const store = new Map();
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/anki/")) {
    const email = decodeURIComponent(url.pathname.slice(10));
    if (req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(store.get(email) || {})); }
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { store.set(email, JSON.parse(body)); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); });
    return;
  }
  if (url.pathname === "/__store") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(Object.fromEntries(store))); }
  if (url.pathname === "/preview.html") {
    const inner = fs.readFileSync(path.join(DIR, "preview/slovo-preview.html"), "utf8");
    res.writeHead(200, { "Content-Type": types[".html"] });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${inner}</body></html>`);
  }
  if (url.pathname.startsWith("/app/")) {
    let rel = url.pathname.slice(5) || "index.html";
    if (rel === "test.html") {
      const html = fs.readFileSync(path.join(APP, "index.html"), "utf8").replace('<script src="app.js">', '<script>window.SLOVO_CONFIG={syncUrl:"/api/anki/",storageKey:"slovo-test"}</script><script src="app.js">');
      res.writeHead(200, { "Content-Type": types[".html"] }); return res.end(html);
    }
    const f = path.join(APP, rel);
    if (f.startsWith(APP) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); return res.end(fs.readFileSync(f)); }
  }
  res.writeHead(404); res.end("not found");
}).listen(3918, "127.0.0.1", () => console.log("serving on 3918"));
