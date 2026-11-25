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
// עוקף בדיקה בלבד: חושף את העולם הפנימי כדי לקרוא את מצב המתגים
const engineSrc = readFileSync("maze-engine.js", "utf8")
  .replace("window.MazeGame = {\n    start(index) {", "window.__dbg = () => level;\n  window.MazeGame = {\n    start(index) {");
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
key("keydown", "ArrowUp"); // קפיצה (מחזיקים לחוץ = קפיצה מלאה)
tick(1);
const afterJump = window.__dbg();
console.log("after jump frame: group =", afterJump.toggleGroup, "timer =", afterJump.toggleTimer, "y =", snap().y);
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
console.log("stage46 start: group =", b46.toggleGroup, "timer =", b46.toggleTimer,
  "toggleOnJump =", b46.def.toggleOnJump, "flipOnJump =", b46.def.flipOnJump, "state =", snap().state);
key("keydown", "ArrowUp");
tick(1);
console.log("stage46 after jump: group =", window.__dbg().toggleGroup, "timer =", window.__dbg().toggleTimer, "y =", snap().y);
tick(1);
console.log("stage46 next frame: group =", window.__dbg().toggleGroup, "timer =", window.__dbg().toggleTimer, "y =", snap().y);
key("keyup", "ArrowUp");

// --- 3. כל 50 השלבים נטענים ורצים ---
let problems = [];
for (let i = 0; i < levels.length; i++) {
  try {
    window.MazeGame.start(i);
    tick(3);
    const s0 = snap();
    tick(60);
    if (snap().state === "dead") problems.push(`${i + 1}:death`);
  } catch (e) {
    problems.push(`${i + 1}:${e.message}`);
  }
}
console.log("50 levels:", problems.length ? problems.join(", ") : "none");
