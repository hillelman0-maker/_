/*
 * api/scores.js — השיאים והטבלה היומית של המשחקים, אונליין.
 *
 * רץ כ־Serverless Function בפרויקט Vercel (התיקייה api/ מזוהה אוטומטית,
 * הכתובת: /api/scores) ואין בו תלויות חיצוניות — רק fetch.
 *
 * אחסון: Upstash Redis דרך ה־REST API, אחרי חיבור Redis מתוך ה־Marketplace
 * של Vercel. משתני הסביבה (אחד מהזוגות, לפי איך שהחיבור מייצר אותם):
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL + KV_REST_API_TOKEN
 * בלי משתנים אלה ה־API מחזיר 503, והמשחקים ממשיכים לעבוד מהאחסון המקומי.
 *
 * מבנה הנתונים ב־Redis:
 *   lb:<game>:<bucket>:<day>  sorted set — שלושת השיאים של היום (member=שם, score=ניקוד)
 *   best:<game>:<bucket>      sorted set — השיא האישי (member=מזהה שחקן, score=ניקוד)
 * ה־bucket בסנייק הוא המהירות ("160" וכו'), כדי שלכל מהירות שיא נפרד.
 *
 * API:
 *   GET  /api/scores?game=snake&board=160&buckets=230,160,110,70&player=p1
 *   POST /api/scores  {game, board, name?, score, player}
 * התשובה: {ok, day, top:[{name, score}], rank, bests:{bucket: score}}
 */

const GAMES = ["snake", "tetris", "doodle", "runner", "maze"];
const MAX_SCORE = 10000000;
const MAX_NAME = 14;
const BOARD_TTL = 60 * 60 * 24 * 3;

// היום לפי שעון ישראל — כדי שהטבלה תתחלף בחצות אצל השחקנים ולא לפי UTC
function dayKey() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  } catch (error) {
    return new Date().toISOString().slice(0, 10);
  }
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME);
}

// ה־bucket הוא מהירות בסנייק ("160") או שם שחקן בראנר, ולכן אותיות עבריות מותרות;
// אסורים רווח ונקודתיים (המפרידים במפתח של Redis) ואורך מעל 24 תווים
function cleanBucket(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 24) return "";
  return /^[\p{L}\p{N}_-]+$/u.test(trimmed) ? trimmed : "";
}

function cleanPlayer(value) {
  if (typeof value !== "string") return "";
  return /^[a-zA-Z0-9_-]{6,40}$/.test(value) ? value : "";
}

function cleanScore(value) {
  const score = Math.round(Number(value));
  if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) return 0;
  return score;
}

function redisConfig() {
  const env = process.env || {};
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "";
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "";
  return url && token ? { url: String(url).replace(/\/+$/, ""), token: String(token) } : null;
}

async function redis(config, commands) {
  const response = await fetch(config.url + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands)
  });
  if (!response.ok) throw new Error("redis " + response.status);
  const data = await response.json();
  return data.map(item => (item && item.error ? null : item ? item.result : null));
}

function queryOf(req) {
  const out = {};
  if (req.query && typeof req.query === "object") {
    Object.keys(req.query).forEach(key => {
      const value = req.query[key];
      out[key] = Array.isArray(value) ? value[0] : value;
    });
    return out;
  }
  const url = new URL(req.url || "/", "http://localhost");
  url.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return {};
}

// "a,b,c" → מערך bucket-ים נקיים, כשהבקשה עצמה תמיד נכללת
function bucketsOf(source, board) {
  const raw = typeof source.buckets === "string" ? source.buckets : "";
  const list = [];
  raw.split(",").forEach(part => {
    const bucket = cleanBucket(part);
    if (bucket && list.indexOf(bucket) < 0) list.push(bucket);
  });
  if (list.indexOf(board) < 0) list.unshift(board);
  return list.slice(0, 6);
}

// WITHSCORES מגיע כמערך שטוח: [שם, ניקוד, שם, ניקוד...]
function toTop(result) {
  if (!Array.isArray(result)) return [];
  const list = [];
  for (let i = 0; i + 1 < result.length; i += 2) {
    const score = Number(result[i + 1]);
    if (!Number.isFinite(score)) continue;
    list.push({ name: String(result[i]), score });
  }
  return list.slice(0, 3);
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(payload === null ? "" : JSON.stringify(payload));
}

function boardKey(game, bucket, day) {
  return "lb:" + game + ":" + bucket + ":" + day;
}

function bestKey(game, bucket) {
  return "best:" + game + ":" + bucket;
}

module.exports = async function handler(req, res) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, { ok: false, error: "method" });
    }

    const config = redisConfig();
    if (!config) return send(res, 503, { ok: false, error: "storage" });

    // ה־player תמיד מגיע ב־query, גם ב־POST, ולכן מאחדים את שניהם
    const query = queryOf(req);
    const source = method === "POST" ? Object.assign(query, bodyOf(req)) : query;
    const game = String(source.game || "").trim();
    if (GAMES.indexOf(game) < 0) return send(res, 400, { ok: false, error: "game" });

    const board = cleanBucket(source.board || "default");
    if (!board) return send(res, 400, { ok: false, error: "board" });

    const player = cleanPlayer(source.player || "");
    const day = dayKey();
    const commands = [];
    const wanted = method === "POST" ? [board] : bucketsOf(source, board);
    let rankAt = -1;

    if (method === "POST") {
      const score = cleanScore(source.score);
      if (!score) return send(res, 400, { ok: false, error: "score" });
      const name = cleanName(source.name);

      // GT = רק שיא גבוה יותר מחליף את הקודם, כך אותו שם לא תופס שני מקומות
      if (player) commands.push(["ZADD", bestKey(game, board), "GT", "CH", String(score), player]);
      if (name) {
        commands.push(["ZADD", boardKey(game, board, day), "GT", "CH", String(score), name]);
        rankAt = commands.length;
        commands.push(["ZREVRANK", boardKey(game, board, day), name]);
        // נשארים רק שלושת הראשונים
        commands.push(["ZREMRANGEBYRANK", boardKey(game, board, day), "0", "-4"]);
        commands.push(["EXPIRE", boardKey(game, board, day), String(BOARD_TTL)]);
      }
    }

    const bestReads = [];
    if (player) {
      wanted.forEach(bucket => {
        bestReads.push([bucket, commands.length]);
        commands.push(["ZSCORE", bestKey(game, bucket), player]);
      });
    }

    const topAt = commands.length;
    commands.push(["ZREVRANGE", boardKey(game, board, day), "0", "2", "WITHSCORES"]);

    const results = await redis(config, commands);

    const bests = {};
    bestReads.forEach(entry => {
      const value = Number(results[entry[1]]);
      if (Number.isFinite(value) && value > 0) bests[entry[0]] = value;
    });

    const rankValue = rankAt >= 0 ? Number(results[rankAt]) : NaN;

    return send(res, 200, {
      ok: true,
      day,
      top: toTop(results[topAt]),
      rank: Number.isFinite(rankValue) ? rankValue + 1 : null,
      bests
    });
  } catch (error) {
    return send(res, 500, { ok: false, error: "server" });
  }
};
