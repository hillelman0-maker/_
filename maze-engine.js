/*
 * מנוע המבוך — פיזיקה, קלט, מלכודות וציור.
 * המנוע לא מכיר אף שלב ספציפי: הוא מקבל מערך שלבים (window.MazeLevels,
 * ראו את הפורמט בראש maze-levels.js) ובונה מכל שלב עולם חי עם מצב ריצה.
 *
 * עקרונות:
 *   - כל סוג מלכודת ממומש במקום אחד (buildTrap / updateTrap / drawTrap), כך שאין
 *     שכפול קוד בין שלבים — שלב הוא נתון בלבד.
 *   - פיזיקה בקצב קבוע (60 צעדים בשנייה) עם צעד כפול כשהפריים ארוך.
 *   - מוות ⇒ חזרה מיידית לתחילת השלב, בלי חלון קופץ ובלי כפתור.
 *   - Coyote Time ו־Jump Buffering כדי ששליטה לא תרגיש אשמה במוות.
 *
 * חוזה חיצוני: window.MazeGame = { start, goto, restart }.
 * אירועים: window "maze:hud" ({stage,total,deaths,best,unlocked,win}).
 */
(function () {
  "use strict";

  const W = 640;
  const H = 400;
  const GRAV = 0.58;
  const JUMP = -11.6;
  const RUN = 3.8;
  const MAXFALL = 13;
  const JUMP_CUT = -4.2; // גובה קפיצה משתנה: שחרור המקש חותך את העלייה
  const PW = 26;
  const PH = 32;
  const COYOTE = 6;      // פריימים שאפשר עוד לקפוץ אחרי שירדת מקצה
  const BUFFER = 7;      // פריימים שנשמרת לחיצת קפיצה מוקדמת
  const RESPAWN = 11;    // ≈0.18 שניות עד חזרה לחיים
  const NEXT = 26;       // השהיה קצרה לפני השלב הבא

  const LEVELS = window.MazeLevels || [];

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const face = new Image();
  face.src = "assets/face.png?v=3";

  /* ---------- אחסון התקדמות ---------- */

  const KEY_UNLOCKED = "maze:unlocked";
  const KEY_DEATHS = "maze:deaths";
  const KEY_BEST = "maze:best";

  function readNum(key, fallback) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeNum(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (error) {
      /* אין אחסון — ההתקדמות תישמר עד לרענון */
    }
  }

  const lastStage = Math.max(1, LEVELS.length);
  let bestStage = Math.min(readNum(KEY_BEST, 1), lastStage);
  let unlocked = Math.min(Math.max(readNum(KEY_UNLOCKED, 1), bestStage), lastStage);
  let totalDeaths = readNum(KEY_DEATHS, 1) - 1; // 0 בפעם הראשונה
  if (totalDeaths < 0) totalDeaths = 0;

  /* ---------- מצב המשחק ---------- */

  let levelIndex = 0;
  let level = null;
  let player = null;
  let frame = 0;
  let state = "play";          // play | dead | clear | finished
  let stateTimer = 0;
  let hintTimer = 0;
  let started = false;

  // דלתות מסיח שכבר התגלו: המידע נשמר בין פסילות, אחרת הדלת האמיתית
  // הייתה נעלמת בכל מוות ואי אפשר היה לסיים את השלב לעולם.
  const foundDecoys = new Set();

  const keys = { left: false, right: false };
  let jumpBuffer = 0;
  let jumpHeld = false;   // המקש עוד לחוץ ⇒ הקפיצה גבוהה
  let jumpFlip = false;   // שלב שמהפך מקשים בכל קפיצה
  let blinkShow = 0;      // פריימים שבהם פלטפורמות הזיכרון נראות

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /* ---------- בניית שלב מנתונים ---------- */

  function buildLevel(def) {
    const alreadyFound = foundDecoys.has(levelIndex);
    const world = {
      def,
      solids: (def.solid || []).map(r => ({ x: r[0], y: r[1], w: r[2], h: r[3] })),
      fakes: [],
      spikes: [],
      crushers: [],
      springs: [],
      zones: [],
      walls: [],
      movers: [],
      chases: [],
      decoys: [],
      buttons: [],
      blink: [],
      toggles: [],
      noJump: [],
      ice: [],
      keys: [],
      saws: [],
      fallsaws: [],
      balls: [],
      gates: [],
      signs: [],
      toggleGroup: "a",
      toggleTimer: 0,
      hasKey: false,
      quiet: 0,
      patienceDone: false,
      downpour: false,
      lastSpring: -1,
      melt: def.melt ? { x: def.melt[0], y: def.melt[1], w: def.melt[2], h: def.melt[3], speed: def.melt[4] || 3.5 } : null,
      ceil: def.ceil ? { y: def.ceil[0], speed: def.ceil[1] || 0.7, on: !!def.ceil[2] } : null,
      clone: def.clone || null,
      reverseZone: null,
      buttonReverse: false,
      moved: false,
      goal: null,
      revealed: alreadyFound || !(def.goal && def.goal.hidden),
      flash: { text: "", timer: 0 }
    };

    for (const d of def.traps || []) {
      switch (d.t) {
        case "fake":
          world.fakes.push({
            x: d.x, y: d.y, w: d.w, h: d.h,
            when: d.when || "step", near: d.near || 40, delay: d.delay || 0,
            slideTo: d.slideTo, slideSpeed: d.slideSpeed || 1.4,
            state: "idle", timer: 0, vy: 0, shake: 0
          });
          break;
        case "spike": {
          const armedFromStart = d.tx === undefined && !d.zone && !d.dormant;
          world.spikes.push({
            x: d.x, y: d.y, w: d.w, h: d.h,
            dir: d.dir || "up", mode: d.mode || "real",
            power: d.power || 13, tx: d.tx, zone: d.zone,
            alert: d.zone ? { x: d.zone[0], y: d.zone[1], w: d.zone[2], h: d.zone[3] } : null,
            dormant: !!d.dormant, delay: d.delay || 0,
            up: armedFromStart ? 1 : 0, armed: armedFromStart, wait: 0
          });
          break;
        }
        case "crusher":
          world.crushers.push({
            x: d.x, y0: d.y0, y1: d.y1, y: d.y0, w: d.w, h: d.h,
            tx: d.tx === undefined ? 1e9 : d.tx, rest: d.rest || 60,
            look: d.look || "hammer", state: "idle", timer: 0
          });
          break;
        case "spring":
          world.springs.push({
            x: d.x, y: d.y, w: d.w, h: d.h,
            power: d.power || 14, hidden: !!d.hidden, seen: false,
            appearAt: d.appearAt || 0, slideTo: d.slideTo, slideWhenLeave: d.slideWhenLeave,
            sliding: false
          });
          break;
        case "reverse":
        case "grav":
          world.zones.push({ kind: d.t, x: d.x, y: d.y, w: d.w, h: d.h });
          break;
        case "wall":
          world.walls.push({ x: d.x, y: d.y, w: d.w, h: d.h, patience: !!d.patience });
          break;
        case "mover":
          world.movers.push({
            x: d.x, y: d.y, w: d.w, h: d.h,
            x0: d.x, y0: d.y,
            range: d.range || 0, speed: d.speed || 1,
            axis: d.axis || "x", phase: d.phase || 0
          });
          break;
        case "chase":
          world.chases.push({
            x: d.x, speed: d.speed || 0.9, side: d.side || "left",
            tx: d.tx === undefined ? 1e9 : d.tx, go: false
          });
          break;
        case "decoy":
          world.decoys.push({ x: d.x, y: d.y, w: d.w, h: d.h, gone: false });
          break;
        case "button":
          world.buttons.push({
            x: d.x, y: d.y, w: d.w, h: d.h, pressed: false,
            action: d.action || "open", text: d.text || "", goalTo: d.goalTo || null
          });
          break;
        case "blink":
          world.blink.push({ x: d.x, y: d.y, w: d.w, h: d.h });
          break;
        case "toggle":
          world.toggles.push({ x: d.x, y: d.y, w: d.w, h: d.h, group: d.group || "a" });
          break;
        case "nojump":
          world.noJump.push({ x: d.x, y: d.y, w: d.w, h: d.h });
          break;
        case "ice":
          world.ice.push({ x: d.x, y: d.y, w: d.w, h: d.h });
          break;
        case "key":
          world.keys.push({
            x: d.x, y: d.y, w: d.w || 22, h: d.h || 22, got: false,
            fleeTo: d.fleeTo || null, fleeX: d.fleeX === undefined ? 1e9 : d.fleeX, fled: false
          });
          break;
        case "saw":
          world.saws.push({
            x0: d.x, x: d.x, y: d.y, baseY: d.y, w: d.w || 46, h: d.h || 46,
            range: d.range || 128, speed: d.speed || 2, dir: 1, vy: 0, air: false
          });
          break;
        case "fallsaw":
          world.fallsaws.push({
            x: d.x, y: d.y === undefined ? -60 : d.y, y0: d.y === undefined ? -60 : d.y,
            y1: d.y1 === undefined ? 300 : d.y1, w: d.w || 44, h: d.h || 44,
            tx: d.tx === undefined ? 1e9 : d.tx, wait: -1, falling: false
          });
          break;
        case "ball":
          world.balls.push({ x: d.x, y: d.y, r: d.r || 34, speed: d.speed || 6, start: d.x });
          break;
        case "gate":
          world.gates.push({
            x: d.x, y: d.y === undefined ? 0 : d.y, w: d.w || 26, h: d.h || H,
            period: d.period || 90, phase: d.phase || 0,
            fast: d.fast || 2, fastX: d.fastX, boost: 1, open: false
          });
          break;
        case "sign":
          world.signs.push({ x: d.x, y: d.y, text: d.text || "" });
          break;
        default:
          break;
      }
    }

    const g = def.goal || { x: 560, y: 310, w: 38, h: 50 };
    world.goal = {
      x: g.x, y: g.y, w: g.w, h: g.h,
      hidden: !!g.hidden && !alreadyFound, locked: !!g.locked, flee: g.flee || null,
      hops: g.hops || 0, hopX: g.hopX === undefined ? 580 : g.hopX,
      appearAt: g.appear || 0,
      fleeRight: true
    };

    return world;
  }

  function placePlayer() {
    const spawn = (level.def.spawn || [30, 328]);
    player = {
      x: spawn[0], y: spawn[1], w: PW, h: PH,
      vx: 0, vy: 0, onGround: false, standing: null,
      coyote: 0, face: 1, trail: 0, jumping: false
    };
  }

  function loadLevel(index) {
    levelIndex = clamp(index, 0, LEVELS.length - 1);
    level = buildLevel(LEVELS[levelIndex]);
    placePlayer();
    frame = 0;
    state = "play";
    stateTimer = 0;
    hintTimer = LEVELS[levelIndex].hint ? 150 : 0;
    jumpBuffer = 0;
    jumpFlip = false;
    blinkShow = 0;
    // המקשים לא מתאפסים כאן: השחקן עוד מחזיק אותם בזמן החזרה לחיים

    if (levelIndex + 1 > bestStage) {
      bestStage = levelIndex + 1;
      writeNum(KEY_BEST, bestStage);
      syncOnline();
    }
    if (levelIndex + 1 > unlocked) {
      unlocked = levelIndex + 1;
      writeNum(KEY_UNLOCKED, unlocked);
    }
    emit();
  }

  /* ---------- התקדמות משותפת ---------- */

  function emit() {
    window.dispatchEvent(new CustomEvent("maze:hud", {
      detail: {
        stage: levelIndex + 1,
        total: LEVELS.length,
        deaths: totalDeaths,
        best: bestStage,
        unlocked,
        win: state === "finished"
      }
    }));
  }

  function applyOnline(data) {
    if (!data || !data.bests) return;
    const value = Number(data.bests.default);
    if (!Number.isFinite(value) || value <= bestStage) return;
    bestStage = Math.min(value, LEVELS.length);
    writeNum(KEY_BEST, bestStage);
    if (bestStage > unlocked) {
      unlocked = bestStage;
      writeNum(KEY_UNLOCKED, unlocked);
    }
    emit();
  }

  function loadOnline() {
    if (!window.OnlineScores) return;
    window.OnlineScores.get("maze", "default").then(applyOnline).catch(() => {});
  }

  function syncOnline() {
    if (!window.OnlineScores) return;
    window.OnlineScores.best("maze", "default", bestStage).then(applyOnline).catch(() => {});
  }

  /* ---------- מוות, ניצחון, מעברים ---------- */

  function kill() {
    if (state !== "play") return;
    state = "dead";
    stateTimer = RESPAWN;
    totalDeaths++;
    writeNum(KEY_DEATHS, totalDeaths + 1);
    emit();
  }

  function complete() {
    if (state !== "play") return;
    state = "clear";
    stateTimer = NEXT;
    const reached = levelIndex + 2;
    if (reached <= LEVELS.length && reached > unlocked) {
      unlocked = reached;
      writeNum(KEY_UNLOCKED, unlocked);
      emit();
    }
  }

  /* ---------- שאילתות ---------- */

  function gravityDir() {
    for (const z of level.zones) {
      if (z.kind !== "grav") continue;
      if (overlap(player, z)) return -1;
    }
    return 1;
  }

  // היפוך שמאל/ימין: נדלק ברגע שנכנסים לאזור ונשאר עד שיוצאים מצדו הימני.
  // (אזור שמחליף כיוון בכל פריים היה הופך לקיר — אי אפשר ללכת לתוכו.)
  function reversedControls() {
    return !!level.reverseZone || !!level.buttonReverse;
  }

  function solidsNow() {
    const list = [];
    for (const s of level.solids) list.push(s);
    for (const m of level.movers) list.push(m);
    for (const w of level.walls) if (!w.gone) list.push(w);
    if (level.melt && level.melt.w > 0) list.push(level.melt);
    for (const f of level.fakes) {
      if (f.state === "idle" || f.state === "shake" || f.state === "slide") list.push(f);
    }
    for (const b of level.blink) list.push(b);
    return list;
  }

  function spikeBox(s) {
    const len = s.h * s.up;
    if (len <= 0) return null;
    if (s.dir === "down") return { x: s.x, y: s.y, w: s.w, h: len };
    return { x: s.x, y: s.y - len, w: s.w, h: len };
  }

  function launch(power, gdir) {
    player.vy = -power * gdir;
    player.onGround = false;
    player.standing = null;
    player.coyote = 0;
    player.jumping = false; // שיגור אינו קפיצה: אין לחתוך אותו
  }

  /* ---------- עדכון מלכודות ---------- */

  function updateTraps(gdir) {
    // משטחים נעים (והסחיבה של מי שעומד עליהם)
    for (const m of level.movers) {
      const prevX = m.x;
      const prevY = m.y;
      m.phase += 0.018 * m.speed;
      if (m.axis === "y") m.y = m.y0 + Math.sin(m.phase) * m.range;
      else m.x = m.x0 + Math.sin(m.phase) * m.range;
      if (player.standing === m) {
        player.x += m.x - prevX;
        player.y += m.y - prevY;
      }
    }

    // פטישים / תקרות נופלות
    for (const c of level.crushers) {
      if (c.state === "idle" && player.x + PW > c.tx) {
        c.state = "fall";
      } else if (c.state === "fall") {
        c.y += 7;
        if (c.y >= c.y1) {
          c.y = c.y1;
          c.state = "rest";
          c.timer = c.rest;
        }
      } else if (c.state === "rest") {
        c.timer--;
        if (c.timer <= 0) c.state = "rise";
      } else if (c.state === "rise") {
        c.y -= 4;
        if (c.y <= c.y0) {
          c.y = c.y0;
          c.state = "idle";
        }
      }
    }

    // דוקרנים: סטטיים, מושהים, או ישנים עד שהדלת המזויפת מתגלה
    for (const s of level.spikes) {
      if (s.dormant && !level.revealed) continue;
      let trigger = false;
      if (s.tx !== undefined) trigger = player.x + PW > s.tx;
      else if (s.alert) trigger = overlap(player, s.alert);
      else trigger = true;
      if (!trigger) continue;
      if (!s.armed) {
        s.armed = true;
        s.wait = s.delay;
      }
      if (s.wait > 0) s.wait--;
      else s.up = Math.min(1, s.up + 0.14);
    }

    // רצפות מתפוררות או מחליקות
    for (const f of level.fakes) {
      if (f.state === "gone") continue;
      if (f.state === "idle") {
        if (f.when === "button") continue; // נפתחות רק בלחיצה על כפתור
        let trigger;
        const feet = player.y + PH;
        const overX = player.x < f.x + f.w && player.x + PW > f.x;
        if (f.when === "step") {
          // עמידה בדיוק על המשטח: אין חפיפה אנכית, לכן בודקים את כפות הרגליים
          trigger = overX && Math.abs(feet - f.y) <= 3 && player.vy >= 0;
        } else {
          trigger = Math.abs((player.x + PW / 2) - (f.x + f.w / 2)) < f.w / 2 + f.near &&
            Math.abs(feet - f.y) < 80;
        }
        if (trigger) {
          if (f.slideTo !== undefined) {
            f.state = "slide";
          } else {
            f.state = "shake";
            f.timer = f.delay;
          }
        }
      } else if (f.state === "slide") {
        // הבור "מחליק" הצידה ומשאיר חור איפה שעמדת לנחות
        f.x += f.slideTo > f.x ? f.slideSpeed : -f.slideSpeed;
        if (Math.abs(f.slideTo - f.x) < f.slideSpeed) {
          f.x = f.slideTo;
          f.vy = 0;
          f.state = "fall";
        }
      } else if (f.state === "shake") {
        f.shake = Math.sin(frame * 0.9) * 2.5;
        f.timer--;
        if (f.timer <= 0) f.state = "fall";
      } else if (f.state === "fall") {
        f.shake = 0;
        f.vy += 0.55;
        f.y += f.vy;
        if (f.y > H + 60) f.state = "gone";
      }
    }

    // כפתור: פותח את הדלת, מהפך את המקשים לתמיד ומפיל את הרצפות המסומנות
    for (const b of level.buttons) {
      if (b.pressed || !overlap(player, b)) continue;
      b.pressed = true;
      if (b.action === "reverse") {
        level.buttonReverse = true;
        level.flash = { text: "המקשים התהפכו.", timer: 120 };
      } else if (b.action === "saw") {
        level.downpour = true;
        level.flash = { text: "מסורים מהתקרה.", timer: 120 };
      } else if (b.action === "ceil") {
        if (level.ceil) level.ceil.on = true;
        level.flash = { text: "התקרה יורדת.", timer: 120 };
      } else if (b.action === "trap") {
        level.buttonReverse = true;
        level.goal.hidden = false;
        if (b.goalTo) {
          level.goal.x = b.goalTo[0];
          level.goal.y = b.goalTo[1];
        }
        level.flash = { text: b.text || "פספסת!", timer: 160 };
      } else {
        level.buttonReverse = true;
        level.goal.hidden = false;
        level.flash = { text: "הדלת נפתחה. גם הראש שלך.", timer: 120 };
        for (const f of level.fakes) {
          if (f.when !== "button" || f.state !== "idle") continue;
          f.state = "shake";
          f.timer = f.delay;
        }
      }
      if (level.def.boss && level.buttons.every(x => x.pressed)) {
        level.goal.hidden = false;
        level.flash = { text: "הדלת יצאה לדרך.", timer: 140 };
      }
    }

    // היפוך מקשים: נדלק בכניסה לאזור, כבה ביציאה מצדו הימני
    if (!level.reverseZone) {
      for (const z of level.zones) {
        if (z.kind === "reverse" && overlap(player, z)) {
          level.reverseZone = z;
          break;
        }
      }
    } else if (player.x > level.reverseZone.x + level.reverseZone.w - 4) {
      level.reverseZone = null;
    }

    // קיר רודף
    for (const c of level.chases) {
      if (!c.go) {
        if (c.side === "right") c.go = player.x < c.tx;
        else c.go = player.x + PW > c.tx;
      }
      if (c.go) c.x += c.speed * (c.side === "right" ? -1 : 1);
    }

    // דלת מזויפת
    for (const d of level.decoys) {
      if (d.gone || !overlap(player, d)) continue;
      d.gone = true;
      foundDecoys.add(levelIndex);
      level.revealed = true;
      level.goal.hidden = false;
      level.flash = { text: "זו לא הדלת.", timer: 110 };
      for (const s of level.spikes) {
        if (s.dormant) {
          s.dormant = false;
          s.armed = true;
          s.wait = s.delay;
        }
      }
      kill();
    }

    // מסור נע שקופץ כשהשחק כופץ לידו
    for (const s of level.saws) {
      s.x += s.speed * s.dir;
      if (s.x > s.x0 + s.range) { s.x = s.x0 + s.range; s.dir = -1; }
      if (s.x < s.x0 - s.range) { s.x = s.x0 - s.range; s.dir = 1; }
      if (s.air) {
        s.vy += 0.55;
        s.y += s.vy;
        if (s.y >= s.baseY) { s.y = s.baseY; s.vy = 0; s.air = false; }
      }
    }

    // מסורים שנופלים מהתקרה אחרי השהיה
    for (const f of level.fallsaws) {
      if (f.wait === -1 && !f.falling && f.y === f.y0 && player.x + PW > f.tx) f.wait = 15;
      if (f.wait > 0) f.wait--;
      else if (f.wait === 0) { f.wait = -2; f.falling = true; }
      if (f.falling) {
        f.y += 8;
        if (f.y >= f.y1) { f.y = f.y1; f.falling = false; }
      }
    }
    if (level.downpour && frame % 90 === 0) {
      level.fallsaws.push({
        x: 48 + (Math.floor(frame / 90) % 15) * 38, y: -50, y0: -50, y1: 300,
        w: 40, h: 40, tx: 1e9, wait: -2, falling: true
      });
    }

    // כדור דוקרנים
    for (const b of level.balls) {
      b.x += b.speed;
      if (b.x > W + b.r * 2) b.x = b.start - W * 0.5;
    }

    // קירות מספריים
    for (const g of level.gates) {
      if (g.fastX !== undefined && player.x > g.fastX) g.boost = g.fast;
      g.phase += (Math.PI * 2 / g.period) * g.boost;
      g.open = Math.sin(g.phase) > 0;
    }

    // רצפה שמתכווצת
    if (level.melt && level.moved) {
      level.melt.x += level.melt.speed;
      level.melt.w -= level.melt.speed;
      if (level.melt.w < 0) level.melt.w = 0;
    }

    // תקרה יורדת
    if (level.ceil && level.ceil.on && level.ceil.y < H) level.ceil.y += level.ceil.speed;

    // קפיצים שמחליקים
    for (const s of level.springs) {
      if (!s.sliding) continue;
      s.x += s.slideTo > s.x ? 4 : -4;
      if (Math.abs(s.slideTo - s.x) < 4) { s.x = s.slideTo; s.sliding = false; }
    }
  }

  /* ---------- עדכון ראשי ---------- */

  function update() {
    frame++;
    if (level.flash.timer > 0) level.flash.timer--;
    if (blinkShow > 0) blinkShow--;

    // החלפת המצב נדחית: הספירה מתחילה ברגע הקפיצה
    if (level.toggleTimer > 0) {
      level.toggleTimer--;
      if (level.toggleTimer === 0) level.toggleGroup = level.toggleGroup === "a" ? "b" : "a";
    }

    const gdir = gravityDir();
    updateTraps(gdir);

    const reversed = reversedControls();
    const dir = ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * (reversed ? -1 : 1) * (jumpFlip ? -1 : 1);
    if (dir) player.face = dir;
    if (keys.left || keys.right) level.moved = true;

    // רוח: דחיפה מחזורית, או אזור שמהפך את כיוונה
    let windX = 0;
    if (level.def.wind) {
      const w = level.def.wind;
      const cycle = (frame + (w.phase || 0)) % ((w.period || 120) + (w.dur || 60));
      if (cycle >= (w.period || 120)) windX = w.force || 0;
      if (w.zone && player.x < w.zone[0] + w.zone[2] && player.x + PW > w.zone[0] &&
        player.y < w.zone[1] + w.zone[3] && player.y + PH > w.zone[1]) {
        windX = w.zoneForce || 0;
      }
    }

    // קרח: תאוצה וחיכוך במקום עצירה מיידית
    let onIce = !!level.def.friction;
    if (!onIce) {
      for (const z of level.ice) {
        if (overlap(player, z)) { onIce = true; break; }
      }
    }
    if (onIce) {
      const fr = level.def.friction || 0.96;
      player.vx = clamp(player.vx * fr + dir * 0.45, -RUN, RUN) + windX;
    } else {
      player.vx = dir * RUN + windX;
    }

    player.x += player.vx;
    if (level.def.wrap) {
      if (player.x < -PW) player.x = W - 1;
      if (player.x > W - 1) player.x = -PW + 1;
    } else {
      if (player.x < 0) player.x = 0;
      if (player.x + PW > W) player.x = W - PW;
    }

    let boxes = solidsNow();
    for (const p of boxes) {
      if (player.vx > 0 && overlap(player, p)) player.x = p.x - PW;
      else if (player.vx < 0 && overlap(player, p)) player.x = p.x + p.w;
    }

    if (player.onGround) player.coyote = COYOTE;
    else player.coyote = Math.max(0, player.coyote - 1);

    if (level.def.patience) {
      const anyInput = keys.left || keys.right || jumpBuffer > 0;
      level.quiet = anyInput ? 0 : level.quiet + 1;
      if (!level.patienceDone && level.quiet >= level.def.patience.frames) {
        level.patienceDone = true;
        for (const w of level.walls) if (w.patience) w.gone = true;
        level.goal.hidden = false;
        level.goal.x = clamp(player.x + 70, 0, W - level.goal.w);
        level.goal.y = clamp(player.y - 18, 0, H - level.goal.h);
        level.flash = { text: "הקיר ויתר.", timer: 150 };
      }
    }

    if (jumpBuffer > 0) {
      jumpBuffer--;
      let blocked = false;
      for (const z of level.noJump) {
        if (overlap(player, z)) { blocked = true; break; }
      }
      if (player.coyote > 0 && !blocked) {
        player.vy = JUMP * gdir;
        player.onGround = false;
        player.coyote = 0;
        jumpBuffer = 0;
        player.jumping = true;
        blinkShow = 26;
        if (level.def.flipOnJump) jumpFlip = !jumpFlip;
        if (level.def.toggleOnJump) {
          const delay = level.def.toggleDelay || 0;
          if (delay > 0) level.toggleTimer = delay;
          else level.toggleGroup = level.toggleGroup === "a" ? "b" : "a";
        }
        for (const s of level.saws) {
          if (!s.air && Math.abs((player.x + PW / 2) - s.x) < 128) { s.air = true; s.vy = -12; }
        }
      }
    }

    // גובה קפיצה משתנה: שחרור המקש בשלב העלייה חותך אותה
    if (player.jumping) {
      if (!jumpHeld && player.vy < JUMP_CUT) player.vy = JUMP_CUT;
      if (player.vy >= 0 || player.onGround) player.jumping = false;
    }

    // מהירות הנפילה חסומה, אבל שיגור מלמטה לא נחתך בתקרת המהירות
    const nextVy = player.vy + GRAV * gdir;
    player.vy = gdir > 0 ? Math.min(nextVy, MAXFALL) : Math.max(nextVy, -MAXFALL);
    player.y += player.vy;
    player.onGround = false;
    player.standing = null;

    for (const p of boxes) {
      if (!overlap(player, p)) continue;
      if (player.vy > 0) {
        player.y = p.y - PH;
        player.vy = 0;
        if (gdir > 0) {
          player.onGround = true;
          player.standing = p;
        }
      } else if (player.vy < 0) {
        player.y = p.y + p.h;
        player.vy = 0;
        if (gdir < 0) {
          player.onGround = true;
          player.standing = p;
        }
      }
    }

    // קפיצה אוטומטית: כל נחיתה מדרדרת קפיצה
    if (level.def.autoJump && player.onGround && gdir > 0) {
      player.vy = -11;
      player.onGround = false;
      player.standing = null;
      player.jumping = false;
    }

    // קפיצים
    let touchedSpring = -1;
    for (let i = 0; i < level.springs.length; i++) {
      const s = level.springs[i];
      if (s.appearAt && frame < s.appearAt) continue;
      if (!overlap(player, s)) continue;
      s.seen = true;
      touchedSpring = i;
      launch(s.power, gdir);
    }
    if (level.lastSpring >= 0 && touchedSpring !== level.lastSpring) {
      for (const s of level.springs) {
        if (s.slideWhenLeave === level.lastSpring) s.sliding = true;
      }
    }
    level.lastSpring = touchedSpring;

    // דוקרנים: קטלניים, מקפיצים, או תפאורה
    for (const s of level.spikes) {
      const box = spikeBox(s);
      if (!box || !overlap(player, box)) continue;
      if (s.mode === "bounce") launch(s.power, gdir);
      else if (s.mode === "real") kill();
    }

    for (const c of level.crushers) {
      if (c.state === "rise") continue;
      if (overlap(player, { x: c.x, y: c.y, w: c.w, h: c.h })) kill();
    }

    for (const t of level.toggles) {
      if (t.group !== level.toggleGroup) continue;
      if (overlap(player, { x: t.x, y: t.y - t.h, w: t.w, h: t.h })) { kill(); break; }
    }

    for (const k of level.keys) {
      if (k.got) continue;
      if (!k.fled && k.fleeTo && player.x > k.fleeX) {
        k.fled = true;
        k.x = k.fleeTo[0];
        k.y = k.fleeTo[1];
        level.flash = { text: "המפתח ברח.", timer: 110 };
        continue;
      }
      if (!overlap(player, k)) continue;
      k.got = true;
      level.hasKey = true;
      level.flash = { text: "המפתח ביד.", timer: 100 };
      for (const f of level.fakes) {
        if (f.when !== "key" || f.state !== "idle") continue;
        f.state = "shake";
        f.timer = 6;
      }
    }

    for (const g of level.gates) {
      if (g.open) continue;
      if (overlap(player, { x: g.x, y: g.y, w: g.w, h: g.h })) { kill(); break; }
    }

    for (const s of level.saws) {
      if (overlap(player, { x: s.x - s.w / 2, y: s.y - s.h / 2, w: s.w, h: s.h })) { kill(); break; }
    }

    for (const b of level.balls) {
      if (overlap(player, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) { kill(); break; }
    }

    for (const f of level.fallsaws) {
      if (overlap(player, { x: f.x, y: f.y, w: f.w, h: f.h })) { kill(); break; }
    }

    if (level.clone) {
      const ghost = { x: player.x, y: player.y + level.clone.dy, w: PW, h: PH };
      for (const s of level.spikes) {
        const box = spikeBox(s);
        if (box && overlap(ghost, box)) { kill(); break; }
      }
    }

    if (level.ceil && level.ceil.on && player.y < level.ceil.y) kill();

    for (const c of level.chases) {
      const box = c.side === "right"
        ? { x: c.x, y: 0, w: 42, h: H }
        : { x: c.x - 42, y: 0, w: 42, h: H };
      if (overlap(player, box)) kill();
    }

    if (player.y > H + 40 || player.y < -220) kill();

    if (level.goal.hidden && level.goal.appearAt && frame >= level.goal.appearAt) {
      level.goal.hidden = false;
      level.flash = { text: "הדלת הופיעה.", timer: 100 };
    }

    goalStep(gdir);

    const gateOpen = !level.goal.locked || level.hasKey;
    if (state === "play" && overlap(player, level.goal) && !level.goal.hidden && gateOpen) complete();
  }

  function goalStep(gdir) {
    const g = level.goal;
    if (g.hidden) return;
    const cx = player.x + PW / 2;
    if (g.flee) {
      const dist = Math.abs(cx - (g.x + g.w / 2));
      if (dist < g.flee.dist) {
        g.fleeRight = cx < g.x + g.w / 2;
        const step = g.flee.force === "left" ? -g.flee.speed
          : g.flee.force === "right" ? g.flee.speed
            : g.flee.speed * (g.fleeRight ? 1 : -1);
        g.x = clamp(g.x + step, 0, g.flee.maxX);
      }
    }
    if (g.hops > 0) {
      const dist = Math.abs(cx - (g.x + g.w / 2));
      if (dist < 90) {
        g.x = cx < W / 2 ? g.hopX : 60;
        g.hops--;
        level.flash = { text: "היא ברחה.", timer: 90 };
      }
    }
    void gdir;
  }

  /* ---------- ציור ---------- */

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSlab(x, y, w, h) {
    ctx.fillStyle = "#1f6f5b";
    roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    roundRect(x + 6, y + 3, Math.max(4, w - 12), 3, 2);
    ctx.fill();
  }

  function drawSpikes(s) {
    if (s.up <= 0.02) {
      ctx.fillStyle = "rgba(28, 36, 48, 0.14)";
      ctx.fillRect(s.x, s.dir === "down" ? s.y : s.y - 3, s.w, 3);
      return;
    }
    const len = s.h * s.up;
    const teeth = Math.max(2, Math.round(s.w / 16));
    const tw = s.w / teeth;
    const base = s.dir === "down" ? s.y : s.y;
    const tip = s.dir === "down" ? s.y + len : s.y - len;
    ctx.fillStyle = "#b4483c";
    for (let i = 0; i < teeth; i++) {
      ctx.beginPath();
      ctx.moveTo(s.x + i * tw, base);
      ctx.lineTo(s.x + i * tw + tw / 2, tip);
      ctx.lineTo(s.x + (i + 1) * tw, base);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    const sign = s.dir === "down" ? 1 : -1;
    for (let i = 0; i < teeth; i++) {
      ctx.beginPath();
      ctx.moveTo(s.x + i * tw + tw / 2, tip);
      ctx.lineTo(s.x + i * tw + tw / 2 + tw * 0.16, base + sign * 0);
      ctx.lineTo(s.x + i * tw + tw / 2 + tw * 0.34, base);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCrusher(c) {
    ctx.fillStyle = "#8a5a44";
    roundRect(c.x, c.y, c.w, c.h, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    roundRect(c.x + 6, c.y + 5, c.w - 12, 4, 2);
    ctx.fill();
    if (c.look === "spike") {
      const teeth = Math.max(2, Math.round(c.w / 14));
      const tw = c.w / teeth;
      ctx.fillStyle = "#b4483c";
      for (let i = 0; i < teeth; i++) {
        ctx.beginPath();
        ctx.moveTo(c.x + i * tw, c.y + c.h);
        ctx.lineTo(c.x + i * tw + tw / 2, c.y + c.h + 12);
        ctx.lineTo(c.x + (i + 1) * tw, c.y + c.h);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = "#b4483c";
      ctx.beginPath();
      ctx.moveTo(c.x + c.w / 2 - 9, c.y + c.h);
      ctx.lineTo(c.x + c.w / 2 + 9, c.y + c.h);
      ctx.lineTo(c.x + c.w / 2, c.y + c.h - 10);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawDoor(g) {
    ctx.fillStyle = "#c9a24a";
    roundRect(g.x - 4, g.y - 4, g.w + 8, g.h + 4, 8);
    ctx.fill();
    ctx.fillStyle = "#21372f";
    roundRect(g.x, g.y, g.w, g.h, 5);
    ctx.fill();
    ctx.fillStyle = "#c9a24a";
    ctx.beginPath();
    ctx.arc(g.x + g.w * 0.72, g.y + g.h * 0.55, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawChase(c) {
    if (c.x > 0) {
      ctx.fillStyle = "rgba(28, 36, 48, 0.13)";
      ctx.fillRect(0, 0, Math.max(0, c.x - 34), H);
    }
    const teeth = 16;
    const th = H / teeth;
    ctx.fillStyle = "#8a5a44";
    ctx.fillRect(c.x - 44, 0, 10, H);
    ctx.fillStyle = "#b4483c";
    for (let i = 0; i < teeth; i++) {
      ctx.beginPath();
      ctx.moveTo(c.x - 36, i * th);
      ctx.lineTo(c.x, i * th + th / 2);
      ctx.lineTo(c.x - 36, (i + 1) * th);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawSpring(s) {
    if (s.hidden && !s.seen) return;
    ctx.fillStyle = "#c9a24a";
    roundRect(s.x, s.y - 6, s.w, 10, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(28, 36, 48, 0.25)";
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(s.x + 3 + i * (s.w / 3), s.y - 4, s.w / 6, 2);
    }
  }

  function drawButton(b) {
    ctx.fillStyle = b.pressed ? "#1f6f5b" : "#c9a24a";
    roundRect(b.x, b.y, b.w, b.h, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    roundRect(b.x + 4, b.y + 3, Math.max(4, b.w - 8), 3, 2);
    ctx.fill();
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#fbf8f2");
    bg.addColorStop(1, "#ece2d1");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(28, 36, 48, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    for (const s of level.solids) drawSlab(s.x, s.y, s.w, s.h);
    for (const m of level.movers) drawSlab(m.x, m.y, m.w, m.h);
    for (const f of level.fakes) {
      if (f.state === "gone") continue;
      drawSlab(f.x + f.shake, f.y, f.w, f.h);
    }

    // פלטפורמות זיכרון: נראות בעמידה וברגעים שאחרי קפיצה
    if (!level.moved || blinkShow > 0) {
      for (const b of level.blink) drawSlab(b.x, b.y, b.w, b.h);
    }

    for (const s of level.spikes) drawSpikes(s);
    for (const c of level.crushers) drawCrusher(c);
    for (const s of level.springs) drawSpring(s);
    for (const b of level.buttons) drawButton(b);
    for (const c of level.chases) drawChase(c);

    for (const t of level.toggles) {
      drawSpikes({ x: t.x, y: t.y, w: t.w, h: t.h, dir: "up", up: t.group === level.toggleGroup ? 1 : 0 });
    }
    for (const g of level.gates) {
      ctx.fillStyle = g.open ? "rgba(180, 72, 60, 0.16)" : "#b4483c";
      ctx.fillRect(g.x, g.y, g.w, g.h);
    }
    for (const b of level.balls) {
      ctx.fillStyle = "#5c6778";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b4483c";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + frame * 0.18;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r);
        ctx.lineTo(b.x + Math.cos(a + 0.16) * (b.r + 9), b.y + Math.sin(a + 0.16) * (b.r + 9));
        ctx.lineTo(b.x + Math.cos(a + 0.32) * b.r, b.y + Math.sin(a + 0.32) * b.r);
        ctx.closePath();
        ctx.fill();
      }
    }
    for (const s of level.saws) {
      ctx.fillStyle = "#5c6778";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b4483c";
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * (s.w / 2), s.y + Math.sin(a) * (s.w / 2));
        ctx.lineTo(s.x + Math.cos(a + 0.25) * (s.w / 2 + 8), s.y + Math.sin(a + 0.25) * (s.w / 2 + 8));
        ctx.lineTo(s.x + Math.cos(a + 0.5) * (s.w / 2), s.y + Math.sin(a + 0.5) * (s.w / 2));
        ctx.closePath();
        ctx.fill();
      }
    }
    for (const f of level.fallsaws) {
      ctx.fillStyle = "#5c6778";
      ctx.fillRect(f.x + 6, f.y, f.w - 12, 8);
      ctx.fillStyle = "#b4483c";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(f.x + i * (f.w / 3), f.y + 8);
        ctx.lineTo(f.x + (i + 0.5) * (f.w / 3), f.y + f.h);
        ctx.lineTo(f.x + (i + 1) * (f.w / 3), f.y + 8);
        ctx.closePath();
        ctx.fill();
      }
    }
    for (const k of level.keys) {
      if (k.got) continue;
      ctx.fillStyle = "#c9a24a";
      ctx.beginPath();
      ctx.arc(k.x + 6, k.y + k.h / 2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(k.x + 10, k.y + k.h / 2 - 3, k.w - 8, 6);
    }
    for (const s of level.signs) {
      ctx.fillStyle = "rgba(28, 36, 48, 0.75)";
      ctx.font = "700 18px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.text, s.x, s.y);
      ctx.textAlign = "start";
    }
    if (level.melt) drawSlab(level.melt.x, level.melt.y, level.melt.w, level.melt.h);
    if (level.ceil && level.ceil.y > 0) {
      ctx.fillStyle = "#21372f";
      ctx.fillRect(0, 0, W, level.ceil.y);
      ctx.fillStyle = "#b4483c";
      for (let i = 0; i < 20; i++) ctx.fillRect(i * 32 + 8, level.ceil.y - 10, 16, 10);
    }
    if (level.clone && player) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = "#5c6778";
      roundRect(player.x, player.y + level.clone.dy, PW, PH, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (!level.goal.hidden) drawDoor(level.goal);
    for (const d of level.decoys) if (!d.gone) drawDoor(d);

    // שחקן
    if (player) {
      if (state === "dead") {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#b4483c";
        roundRect(player.x, player.y + 18, PW, 12, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (face.complete && face.naturalWidth) {
        ctx.save();
        const bob = player.onGround ? Math.sin(frame * 0.16) * 1.4 : 0;
        ctx.translate(player.x + PW / 2, player.y + PH / 2 + bob);
        ctx.scale(player.face, 1);
        const hh = PH + 5;
        const ww = hh * (face.naturalWidth / face.naturalHeight);
        ctx.drawImage(face, -ww / 2, -hh / 2, ww, hh);
        ctx.restore();
      } else {
        ctx.fillStyle = "#c5d7e6";
        roundRect(player.x, player.y, PW, PH, 8);
        ctx.fill();
      }
    }

    // חושך: עיגול אור סביב השחקן
    if (level.def.dark && player) {
      const px = player.x + PW / 2;
      const py = player.y + PH / 2;
      const grad = ctx.createRadialGradient(px, py, 8, px, py, 110);
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(0.5, "rgba(0, 0, 0, 0.55)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0.985)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    // הודעת מלכודת
    if (level.flash.timer > 0) {
      ctx.globalAlpha = Math.min(1, level.flash.timer / 45);
      ctx.fillStyle = "#21372f";
      ctx.font = "700 22px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(level.flash.text, W / 2, 62);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
    }

    // רמז פתיחה
    if (hintTimer > 0) {
      ctx.globalAlpha = Math.min(1, hintTimer / 40) * 0.75;
      ctx.fillStyle = "#5c6778";
      ctx.font = "600 15px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(LEVELS[levelIndex].hint, W / 2, 26);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
    }

    if (state === "clear") {
      ctx.globalAlpha = Math.min(1, stateTimer / 12);
      ctx.fillStyle = "#1f6f5b";
      ctx.font = "700 26px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("עברת!", W / 2, H / 2 - 40);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
    }

    if (state === "dead") {
      ctx.fillStyle = `rgba(180, 72, 60, ${0.1 * (stateTimer / RESPAWN)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- לופ ---------- */

  let lastTime = 0;
  let acc = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    if (!lastTime) lastTime = now;
    let dt = (now - lastTime) / 16.6667;
    lastTime = now;
    if (dt > 3) dt = 3;
    acc += dt;

    while (acc >= 1) {
      acc -= 1;
      step();
    }

    if (level) draw();
  }

  function step() {
    if (state === "play") {
      update();
      return;
    }
    if (state === "dead") {
      stateTimer--;
      if (stateTimer <= 0) {
        const index = levelIndex;
        loadLevel(index);
      }
      return;
    }
    if (state === "clear") {
      stateTimer--;
      if (stateTimer <= 0) {
        if (levelIndex + 1 >= LEVELS.length) {
          state = "finished";
          emit();
        } else {
          loadLevel(levelIndex + 1);
        }
      }
    }
  }

  /* ---------- קלט ---------- */

  function keyName(event) {
    return event.key;
  }

  function press(event) {
    const key = keyName(event);
    const left = key === "ArrowLeft" || key === "a" || key === "A";
    const right = key === "ArrowRight" || key === "d" || key === "D";
    const jump = key === "ArrowUp" || key === " " || key === "Spacebar" || key === "w" || key === "W";
    if (!left && !right && !jump) return;
    event.preventDefault();
    if (left) keys.left = true;
    if (right) keys.right = true;
    if (jump) {
      jumpBuffer = BUFFER;
      jumpHeld = true;
    }
  }

  function release(event) {
    const key = keyName(event);
    if (key === "ArrowLeft" || key === "a" || key === "A") keys.left = false;
    if (key === "ArrowRight" || key === "d" || key === "D") keys.right = false;
    if (key === "ArrowUp" || key === " " || key === "Spacebar" || key === "w" || key === "W") jumpHeld = false;
  }

  document.addEventListener("keydown", event => {
    if (event.key === "r" || event.key === "R") {
      loadLevel(levelIndex);
      return;
    }
    if (event.key === "Escape") {
      window.dispatchEvent(new CustomEvent("maze:menu"));
      return;
    }
    press(event);
  });
  document.addEventListener("keyup", release);

  document.querySelectorAll(".pad button").forEach(btn => {
    const act = btn.dataset.act;
    const down = () => {
      if (act === "left") keys.left = true;
      if (act === "right") keys.right = true;
      if (act === "jump") {
        jumpBuffer = BUFFER;
        jumpHeld = true;
      }
    };
    const up = () => {
      if (act === "left") keys.left = false;
      if (act === "right") keys.right = false;
      if (act === "jump") jumpHeld = false;
    };
    btn.addEventListener("pointerdown", event => { event.preventDefault(); down(); });
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
  });

  face.addEventListener("load", () => { if (level) draw(); });

  /* ---------- API ---------- */

  window.MazeGame = {
    start(index) {
      loadOnline();
      loadLevel(index || 0);
      if (!started) {
        started = true;
        requestAnimationFrame(loop);
      }
    },
    goto(index) {
      loadLevel(index);
    },
    restart() {
      loadLevel(levelIndex);
    },
    snapshot() {
      return {
        stage: levelIndex + 1, total: LEVELS.length, deaths: totalDeaths,
        best: bestStage, unlocked, state,
        x: Math.round(player.x), y: Math.round(player.y), frame
      };
    }
  };
})();
