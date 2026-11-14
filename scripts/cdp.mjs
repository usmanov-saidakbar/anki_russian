// Tiny Chrome DevTools Protocol driver (no dependencies): node cdp.mjs <chrome> <test.mjs>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [chrome, testFile] = process.argv.slice(2);
const dir = path.dirname(new URL(import.meta.url).pathname);
const profile = path.join(dir, "chrome-profile");
fs.rmSync(profile, { recursive: true, force: true });
const proc = spawn(chrome, ["--headless", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

const page = {
  send,
  sleep,
  consoleErrors,
  async goto(url) {
    await send("Page.navigate", { url });
    await sleep(1200);
  },
  async eval(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  },
  async size(width, height, mobile = false) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
  },
  async shot(file, selector) {
    const params = { format: "png" };
    if (selector) {
      const box = await this.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
      params.clip = { ...box, scale: 1 };
      params.captureBeyondViewport = true;
    }
    const { data } = await send("Page.captureScreenshot", params);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  },
};
await send("Page.enable");
await send("Runtime.enable");

let failed = false;
try {
  const { default: test } = await import(path.resolve(testFile));
  await test(page);
} catch (err) {
  failed = true;
  console.error("TEST FAILED:", err.stack || err);
}
if (consoleErrors.length) {
  failed = true;
  console.error("PAGE ERRORS:\n" + consoleErrors.join("\n"));
}
ws.close();
proc.kill();
process.exit(failed ? 1 : 0);
