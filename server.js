// Sky Shards: static game + live ghosts + daily leaderboard.
// Run: npm install && npm start   (PORT defaults to 3000)
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "scores.json");
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "skyshards:board";
const MIN_RUN = 20; // seconds; nothing faster is humanly possible

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- storage ---------------- */
let board = { days: {}, all: [] };
let saveTimer = null;

async function load() {
  try {
    if (UPSTASH_URL) {
      const r = await fetch(`${UPSTASH_URL}/get/${KEY}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
      const j = await r.json();
      if (j.result) board = JSON.parse(j.result);
      console.log("Leaderboard loaded from Upstash");
    } else if (fs.existsSync(DATA_FILE)) {
      board = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      console.log("Leaderboard loaded from", DATA_FILE);
    }
  } catch (e) { console.error("Could not load leaderboard:", e.message); }
  board.days = board.days || {}; board.all = board.all || [];
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const body = JSON.stringify(board);
    try {
      if (UPSTASH_URL) {
        await fetch(`${UPSTASH_URL}/set/${KEY}`, { method: "POST", headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }, body });
      } else {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, body);
      }
    } catch (e) { console.error("Could not save leaderboard:", e.message); }
  }, 1500);
}
function upsert(list, entry, cap) {
  const i = list.findIndex(r => r.nick.toLowerCase() === entry.nick.toLowerCase());
  if (i >= 0) { if (entry.time >= list[i].time) return false; list.splice(i, 1); }
  list.push(entry); list.sort((a, b) => a.time - b.time); list.length = Math.min(list.length, cap);
  return true;
}
function prune() {
  const keys = Object.keys(board.days).sort();
  while (keys.length > 14) delete board.days[keys.shift()];
}
const publicBoard = () => ({
  today: (board.days[today()] || []).slice(0, 20).map(({ nick, time }) => ({ nick, time })),
  all: board.all.slice(0, 20).map(({ nick, time }) => ({ nick, time })),
});

/* ---------------- nicknames ---------------- */
const BLOCK = ["nigg", "nigé", "fag", "faggot", "retard", "hitler", "nazi", "cunt", "fuck", "shit", "whore", "rape",
  "хуй", "хуе", "хуё", "пизд", "ебл", "ебa", "еба", "ебу", "бля", "сука", "пидор", "пидр", "залуп", "мудак", "гандон", "шлюх", "нигер", "негр"];
function cleanNick(raw) {
  let s = String(raw || "").normalize("NFKC").replace(/[^\p{L}\p{N} _\-.]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  const flat = s.toLowerCase().replace(/[\s_\-.0-9]/g, "").replace(/[@4]/g, "a").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/0/g, "o");
  if (!s || BLOCK.some(w => flat.includes(w))) s = "drifter" + (100 + Math.floor(Math.random() * 900));
  return s;
}

/* ---------------- http ---------------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".ico": "image/x-icon", ".css": "text/css" };
const gameFragment = fs.readFileSync(path.join(PUBLIC, "game.html"), "utf8");
function page(host, proto) {
  const origin = `${proto}://${host}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="A voxel race across floating islands. Bridge the gaps with melting clouds, grab every crystal shard, top today's leaderboard.">
<meta property="og:type" content="website">
<meta property="og:title" content="Sky Shards">
<meta property="og:description" content="Everyone races the same floating islands today. Build cloud bridges before they melt, grab every shard.">
<meta property="og:url" content="${origin}/">
<meta property="og:image" content="${origin}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Sky Shards">
<meta name="twitter:description" content="Everyone races the same floating islands today. Build cloud bridges before they melt.">
<meta name="twitter:image" content="${origin}/og.png">
<script>window.SKY_ONLINE=true</script>
</head><body style="margin:0">${gameFragment}</body></html>`;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
    res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" });
    return res.end(page(req.headers.host, proto));
  }
  if (url.pathname === "/api/board") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(publicBoard()));
  }
  if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }
  const file = path.normalize(path.join(PUBLIC, url.pathname));
  if (!file.startsWith(PUBLIC) || path.basename(file) === "game.html") { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
    res.end(buf);
  });
});

/* ---------------- websocket ---------------- */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2048 });
const players = new Map();
let nextId = 1;

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s);
}
wss.on("connection", ws => {
  const p = { id: nextId++, nick: "guest", x: 0, y: 0, z: 0, yaw: 0, shards: 0, playing: false, startAt: 0, msgs: 0, alive: true };
  players.set(ws, p);
  ws.send(JSON.stringify({ t: "welcome", id: p.id, day: today() }));
  ws.send(JSON.stringify({ t: "board", board: publicBoard() }));
  ws.on("pong", () => { p.alive = true; });
  ws.on("message", data => {
    if (++p.msgs > 40) return; // per-second budget
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === "hello") p.nick = cleanNick(m.nick);
    else if (m.t === "start") {
      p.nick = cleanNick(m.nick || p.nick); p.playing = true; p.shards = 0;
      if (!m.resume || !p.startAt) p.startAt = Date.now();
    }
    else if (m.t === "pos" && p.playing) {
      const n = v => (typeof v === "number" && isFinite(v) ? Math.max(-50, Math.min(150, v)) : 0);
      p.x = n(m.x); p.y = n(m.y); p.z = n(m.z); p.yaw = typeof m.yaw === "number" ? m.yaw : 0;
      p.shards = Math.max(0, Math.min(99, m.shards | 0));
    }
    else if (m.t === "finish" && p.playing) {
      p.playing = false;
      const time = Number(m.time);
      const elapsed = (Date.now() - p.startAt) / 1000;
      if (!isFinite(time) || time < MIN_RUN || time > elapsed + 3) {
        ws.send(JSON.stringify({ t: "result", msg: "That run couldn’t be verified, so it wasn’t added to the board." }));
        return;
      }
      const day = today();
      const entry = { nick: p.nick, time: Math.round(time * 10) / 10, falls: m.falls | 0, at: Date.now() };
      board.days[day] = board.days[day] || [];
      const improved = upsert(board.days[day], { ...entry }, 200);
      upsert(board.all, { ...entry, day }, 200);
      prune(); scheduleSave();
      const list = board.days[day];
      const rank = list.findIndex(r => r.nick.toLowerCase() === p.nick.toLowerCase()) + 1;
      ws.send(JSON.stringify({ t: "result", rank, improved, best: list[rank - 1]?.time }));
      broadcast({ t: "board", board: publicBoard() });
    }
  });
  ws.on("close", () => players.delete(ws));
});

// 10 Hz presence broadcast + rate-limit reset
setInterval(() => {
  const list = [...players.values()].slice(0, 60).map(({ id, nick, x, y, z, yaw, shards, playing }) => ({ id, nick, x, y, z, yaw, shards, playing }));
  broadcast({ t: "players", list });
}, 100);
setInterval(() => { for (const p of players.values()) p.msgs = 0; }, 1000);
// drop dead sockets
setInterval(() => {
  for (const ws of wss.clients) {
    const p = players.get(ws); if (!p) continue;
    if (!p.alive) { ws.terminate(); continue; }
    p.alive = false; ws.ping();
  }
}, 30000);
// new day: tell everyone so the next run uses the new world
let lastDay = today();
setInterval(() => { if (today() !== lastDay) { lastDay = today(); broadcast({ t: "board", board: publicBoard() }); } }, 60000);

load().then(() => server.listen(PORT, () => console.log(`Sky Shards on http://localhost:${PORT}`)));
