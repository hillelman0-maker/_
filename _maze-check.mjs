import { readFileSync } from "fs";

const handlers = {};
const rafQueue = [];

const el = () => ({
  textContent: "", innerHTML: "", style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, appendChild() {}, setAttribute() {}
});

const ctxProxy = new Proxy({}, {
  get(t, prop) {
    if (prop === "canvas") return canvas;
    if (prop === "measureText") return () => ({ width: 0 });
    if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") {
      return () => ({ addColorStop() {} });
    }
    return t[prop] !== undefined ? t[prop] : () => {};
  },
  set(t, prop, value) { t[prop] = value; return true; }
});

const canvas = {
  width: 640, height: 400,
  getContext: () => ctxProxy,
  addEventListener() {},
  style: {}
};

const store = new Map();

globalThis.window = globalThis;
globalThis.document = {
  getElementById: id => (id === "game" ? canvas : el()),
  querySelectorAll: () => [],
  querySelector: () => el(),
  addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
  createElement: () => el(),
  body: el()
};
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
globalThis.Image = class { constructor() { this.src = ""; } addEventListener() {} };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } };
globalThis.addEventListener = (type, fn) => { (handlers[type] ||= []).push(fn); };
globalThis.dispatchEvent = () => {};
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); return rafQueue.length; };

const load = f => (0, eval)(readFileSync(f, "utf8"));
load("maze-levels.js");
const engineSrc = readFileSync("maze-engine.js", "utf8")
  .replace(/window\.MazeGame = \{/g, "window.__dbg = () => level;\n  window.__player = () => player;\n  window.MazeGame = {");
(0, eval)(engineSrc);

let clock = 0;
function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    const q = rafQueue.splice(0, rafQueue.length);
    clock += 1000 / 60;
    for (const cb of q) cb(clock);
  }
}

const key = (type, k) => {
  for (const fn of handlers[type] || []) fn({ key: k, preventDefault() {}, repeat: false });
};
const snap = () => window.MazeGame.snapshot();

const levels = window.MazeLevels;
console.log("levels:", levels.length, "| stage26 delay:", levels[25].toggleDelay, "| stage46 delay:", levels[45].toggleDelay);

// --- 1. תזמון ההחלפה בשלב 26 ---
window.MazeGame.start(25);
tick(2);
const before = window.__dbg();
console.log("start: group =", before.toggleGroup, "timer =", before.toggleTimer);
key("keydown", "ArrowUp");
tick(1);
const afterJump = window.__dbg();
console.log("after jump: group =", afterJump.toggleGroup, "timer =", afterJump.toggleTimer);
key("keyup", "ArrowUp");
const timeline = [];
for (let i = 0; i < 14; i++) {
  tick(1);
  const l = window.__dbg();
  timeline.push(`${i + 2}:${l.toggleGroup}${l.toggleTimer ? "/" + l.toggleTimer : ""}`);
}
console.log("frames -> group:", timeline.join(" "));

// --- 2. שלב 46 נשאר מיידי ---
window.MazeGame.start(45);
tick(2);
const b46 = window.__dbg();
console.log("stage46: toggleOnJump =", b46.def.toggleOnJump, "delay =", b46.def.toggleDelay, "state =", snap().state);

// --- 3. שלב 27: autoJump, solvable ---
window.MazeGame.start(26);
tick(2);
const bf27 = window.__dbg();
console.log("stage27 autoJump:", bf27.def.autoJump, "| solids:", bf27.solids.map(s => [s.x, s.y, s.w, s.h]));
console.log("stage27 spikes:", bf27.spikes.map(s => [s.x, s.y, s.w, s.h, s.dir]));

const RUNP = 3.8, GRAVP = 0.58, PWP = 26, PHP = 32;
const SPIKES = bf27.spikes.map(s => ({ x: s.x, y: 352 - s.h, w: s.w, h: s.h }));
const GOAL = bf27.goal;
const ovp = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const pbox = s => ({ x: s.x, y: s.y, w: PWP, h: PHP });
function pstep(s, d) {
  const n = { x: Math.max(0, Math.min(640 - PWP, s.x + d * RUNP)), y: s.y, vy: s.vy + GRAVP, landed: false };
  n.y = s.y + n.vy;
  if (n.y + PHP >= 352 && n.vy > 0) { n.y = 352 - PHP; n.vy = 0; n.landed = true; }
  if (n.landed) n.vy = -11;
  return n;
}
const pdead = n => SPIKES.some(b => ovp(pbox(n), b));
function landingFor(s, d) {
  let cur = s;
  for (let i = 0; i < 60; i++) {
    const n = pstep(cur, d);
    if (pdead(n)) return { ok: false };
    if (n.landed) return { ok: true, x: n.x };
    cur = n;
  }
  return { ok: false };
}

let dirNow = 0;
const setDir = d => {
  if (d === dirNow) return;
  key("keyup", "ArrowLeft"); key("keyup", "ArrowRight");
  if (d > 0) key("keydown", "ArrowRight");
  if (d < 0) key("keydown", "ArrowLeft");
  dirNow = d;
};

let s27 = null, landed = [];
for (let f = 0; f < 900; f++) {
  const st = snap();
  if (st.state !== "play") { s27 = st; break; }
  const p = window.__player();
  const me = { x: p.x, y: p.y, vy: p.vy };
  if (landed.length === 0 || f === 0) landed.push(Math.round(me.x));
  let best = null;
  for (const d of [1, 0, -1]) {
    const r = landingFor(me, d);
    if (!r.ok) continue;
    if (!best || r.x > best.x) best = { d, x: r.x };
  }
  setDir(best ? best.d : 0);
  tick(1);
  const after = window.__player();
  if (after.vy === -11 && Math.abs(after.x - me.x) < 4) landed.push(Math.round(after.x));
  s27 = snap();
}
console.log("stage27 result:", s27.state, "x=", Math.round(s27.x), "frame=", s27.frame, "| landings:", landed.slice(0, 8).join(","));

// sanity: holding right dies
window.MazeGame.start(26);
tick(2);
setDir(1);
let died = null;
for (let f = 0; f < 200; f++) {
  tick(1);
  const st = snap();
  if (st.state !== "play") { died = st; break; }
}
console.log("stage27 hold-right:", died ? died.state : "survived", died ? "x=" + Math.round(died.x) : "");
