// Shop app server. No npm packages needed. Requires Node 22.13+.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

// ---------- .env ----------
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const PASSWORD = process.env.APP_PASSWORD || "";
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const AUTO_SYNC = process.env.AUTO_SYNC === "1";
if (!PASSWORD || PASSWORD === "choose-a-long-password") {
  console.error("Set APP_PASSWORD in the .env file first (copy .env.example to .env).");
  process.exit(1);
}

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DB_FILE = path.join(ROOT, "data", "shop.db");
const SESSION_DAYS = 30;
const SECRET = crypto.createHash("sha256").update("shop-session:" + PASSWORD).digest();

const ALLOWED_KEYS = new Set([
  "inventory-manager-products-v1",
  "inventory-sales-log-v1",
  "inventory-invoices-v1",
  "inventory-usd-rate-v1",
  "shop-expenses-log-v1",
  "purchase-invoices-v1",
  "shop-receivables-v1",
  "shop-payables-v1",
  "daily-todo-manager-tasks-v1",
  "contacts-manager-v1",
]);

// ---------- git sync (optional) ----------
function git(...args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: ROOT }, (err, stdout, stderr) => resolve({ err, out: stdout + stderr }));
  });
}
let pushTimer = null;
let pushing = false;
function schedulePush() {
  if (!AUTO_SYNC) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 60 * 1000);
}
async function pushNow() {
  if (!AUTO_SYNC || pushing) return;
  pushing = true;
  clearTimeout(pushTimer);
  await git("add", "data/shop.db");
  const c = await git("commit", "-m", "data " + new Date().toISOString());
  if (!c.err) {
    const p = await git("push");
    console.log(p.err ? "git push FAILED (pull first? another machine may have saved):\n" + p.out : "Pushed data to GitHub.");
  }
  pushing = false;
}

// ---------- database ----------
async function openDb() {
  if (AUTO_SYNC) {
    const r = await git("pull", "--ff-only");
    console.log(r.err ? "git pull FAILED:\n" + r.out : "git pull: " + r.out.trim());
  }
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA journal_mode = DELETE"); // keeps the data in ONE file, good for git
  db.exec(`CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL,
    ver INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`);
  return db;
}

// ---------- sessions ----------
function sign(exp) {
  return exp + "." + crypto.createHmac("sha256", SECRET).update(String(exp)).digest("hex");
}
function validSession(req) {
  const m = /(?:^|;\s*)shop_session=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const [exp, mac] = decodeURIComponent(m[1]).split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac("sha256", SECRET).update(exp).digest("hex");
  return mac.length === good.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good));
}
const attempts = new Map(); // ip -> [timestamps]
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  attempts.set(ip, list);
  return list.length >= 8;
}

// ---------- helpers ----------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
function json(res, code, obj, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(req, res, urlPath) {
  if (urlPath === "/") urlPath = "/index.html";
  let file;
  try {
    file = path.normalize(path.join(PUBLIC, decodeURIComponent(urlPath)));
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (!file.startsWith(PUBLIC + path.sep)) return res.writeHead(403).end("Forbidden");
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end("Not found");

  if (type.startsWith("text/html")) {
    // Inject the database script into every page, so the HTML files need no edits.
    let html = fs.readFileSync(file, "utf8");
    if (!html.includes("/db.js") && path.basename(file) !== "login.html") {
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => m + '<script src="/db.js"></script>')
        : '<script src="/db.js"></script>' + html;
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    return res.end(html);
  }
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}

// ---------- start ----------
openDb().then((db) => {
  const getAll = db.prepare("SELECT k, v, ver FROM kv");
  const getOne = db.prepare("SELECT ver FROM kv WHERE k = ?");
  const insert = db.prepare("INSERT INTO kv (k, v, ver, updated_at) VALUES (?, ?, 1, ?)");
  const update = db.prepare("UPDATE kv SET v = ?, ver = ver + 1, updated_at = ? WHERE k = ?");

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      const ip = req.socket.remoteAddress || "";

      if (p === "/api/login" && req.method === "POST") {
        if (tooManyAttempts(ip)) return json(res, 429, { error: "Too many attempts. Wait a minute." });
        let pass = "";
        try {
          pass = JSON.parse(await readBody(req, 10000)).password || "";
        } catch {}
        const a = crypto.createHash("sha256").update(String(pass)).digest();
        const b = crypto.createHash("sha256").update(PASSWORD).digest();
        if (!crypto.timingSafeEqual(a, b)) {
          attempts.get(ip).push(Date.now());
          return json(res, 401, { error: "Wrong password." });
        }
        const exp = Date.now() + SESSION_DAYS * 86400000;
        const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
        return json(res, 200, { ok: true }, {
          "Set-Cookie": `shop_session=${encodeURIComponent(sign(exp))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`,
        });
      }
      if (p === "/api/logout") {
        return json(res, 200, { ok: true }, { "Set-Cookie": "shop_session=; HttpOnly; Path=/; Max-Age=0" });
      }
      if (p === "/login.html") return serveStatic(req, res, p);

      if (!validSession(req)) {
        if (p.startsWith("/api/")) return json(res, 401, { error: "unauthorized" });
        res.writeHead(302, { Location: "/login.html?next=" + encodeURIComponent(p) });
        return res.end();
      }

      if (p === "/api/all" && req.method === "GET") {
        const data = {};
        const ver = {};
        for (const row of getAll.all()) {
          data[row.k] = row.v;
          ver[row.k] = row.ver;
        }
        return json(res, 200, { data, ver });
      }

      if (p === "/api/set" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        const { k, v } = body;
        const ver = Number(body.ver) || 0;
        if (!ALLOWED_KEYS.has(k) || typeof v !== "string") return json(res, 400, { error: "bad request" });
        const row = getOne.get(k);
        const current = row ? row.ver : 0;
        if (current !== ver) return json(res, 409, { error: "conflict", ver: current });
        const now = new Date().toISOString();
        if (row) update.run(v, now, k);
        else insert.run(k, v, now);
        schedulePush();
        return json(res, 200, { ok: true, ver: current + 1 });
      }

      if (p.startsWith("/api/")) return json(res, 404, { error: "not found" });
      return serveStatic(req, res, p);
    } catch (e) {
      console.error(e);
      json(res, 500, { error: "server error" });
    }
  });

  server.listen(PORT, HOST, () => console.log(`Shop app running: http://localhost:${PORT}`));

  const shutdown = async () => {
    server.close();
    await pushNow();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
