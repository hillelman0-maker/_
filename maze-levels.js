/*
 * שלבי המבוך — נתונים בלבד. אין כאן שום לוגיקה: מנוע המשחק (maze-engine.js)
 * קורא את המערך הזה ובונה ממנו שלב חי.
 *
 * פורמט שלב:
 *   name    — שם השלב (מוצג בראש המשחק)
 *   hint    — שורה קצרה שמופיעה על המסך בכניסה לשלב (לא חובה)
 *   world   — 1..5, רק בשביל חלוקה לתפריט בחירת השלבים
 *   flipOnJump — true ⇒ כל קפיצה מחליפה בין שמאל לימין
 *   spawn   — [x, y] הפינה השמאלית־עליונה של השחקן (רצפה בגובה 360 ⇒ y=328)
 *   solid   — מערך של [x, y, w, h] משטחים מוצקים
 *   traps   — מערך מלכודות, כל אחת עם t (סוג) והשדות שלה
 *   goal    — הדלת: { x, y, w, h, hidden, appear, flee, hops, hopX }
 *             appear — מספר פריימים עד שהדלת מופיעה (אם hidden)
 *             flee   — { speed, dist, maxX, force:"left" } דלת בורחת
 *
 * סוגי מלכודות:
 *   fake    { x,y,w,h, when:"step"|"near"|"button", near, delay,
 *             slideTo, slideSpeed }  רצפה שנראית מוצקה ונעלמת (או מחליקה הצידה).
 *   spike   { x,y,w,h, dir:"up"|"down", mode:"real"|"fake"|"bounce", power,
 *             tx, zone, delay, dormant }  דוקרנים; fake = לא מזיקים, bounce = טרמפולינה.
 *   crusher { x,y0,y1,w,h, tx, rest, look:"spike" }  תקרה/פטיש שנופל.
 *   spring  { x,y,w,h, power, hidden }  קפיץ שמעיף את השחקן.
 *   reverse { x,y,w,h }  אזור שהופך שמאל/ימין כל עוד נמצאים בתוכו.
 *   grav    { x,y,w,h }  אזור שהופך את כיוון הכבידה כל עוד נמצאים בתוכו.
 *   wall    { x,y,w,h }  קיר בלתי נראה שאפשר לעבור מתחתיו או לקפוץ מעליו.
 *   mover   { x,y,w,h, range, speed, axis:"x"|"y", phase }  משטח נע (סוחב את השחקן).
 *   chase   { x, speed, tx }  קיר דוקרנים שרודף אחרי השחקן.
 *   decoy   { x,y,w,h }  דלת מזויפת שנראית כמו היציאה, הורגת וחושפת את הדלת האמיתית.
 *   button  { x,y,w,h }  כפתור: פותח את הדלת, הופך את המקשים לתמיד ומפיל את
 *                        כל רצפות ה־fake שמסומנות when:"button".
 *   blink   { x,y,w,h }  פלטפורמה מוצקה שנעלמת ברגע שזזים ומופיעה שוב בקפיצה.
 *
 * חוקי המידה של השחקן (26×32, קפיצה ≈116px גובה, ≈150px מרחק, קפיצה קצרה ~58):
 *   עלייה מקסימלית בטוחה 80, רוחב פער בטוח עד 100, קיר לחצייה עד 90 גובה.
 *

 */
// אריח = 32px. שלבי העולמות 6–10 נכתבו בקואורדינטות אריחים כמו במפרט.
const tile = n => n * 32;

window.MazeLevels = [
  /* ===== עולם 1 — בורות ורצפה בוגדנית ===== */
  {
    name: "הבור הקלאסי",
    hint: "הרצפה כאן תפתח בור. תעצור בזמן.",
    world: 1,
    spawn: [40, 328],
    solid: [[0, 360, 330, 40], [410, 360, 230, 40]],
    traps: [{ t: "fake", x: 330, y: 360, w: 80, h: 40, when: "near", near: 40, delay: 8 }],
    goal: { x: 560, y: 310, w: 38, h: 50 }
  },
  {
    name: "הבור המתרחב",
    hint: "פתחתם בור אחד? הוא הביא חבר.",
    world: 1,
    spawn: [40, 328],
    solid: [[0, 360, 240, 40], [340, 360, 300, 40]],
    traps: [
      { t: "fake", x: 240, y: 360, w: 50, h: 40, when: "near", near: 20, delay: 4 },
      { t: "fake", x: 290, y: 360, w: 50, h: 40, when: "near", near: 70, delay: 26 }
    ],
    goal: { x: 560, y: 310, w: 38, h: 50 }
  },
  {
    name: "הבור הזז",
    hint: "הבור לא מחכה לך. הוא מחליף מקום.",
    world: 1,
    spawn: [40, 328],
    solid: [[0, 360, 260, 40], [360, 360, 280, 40]],
    traps: [{ t: "fake", x: 300, y: 360, w: 60, h: 40, when: "near", near: 40, slideTo: 340, slideSpeed: 1.4 }],
    goal: { x: 560, y: 310, w: 38, h: 50 }
  },
  {
    name: "הגשר הקורס",
    hint: "שש פלטפורמות. הרביעית לא מחכה בכלל.",
    world: 1,
    spawn: [30, 328],
    solid: [[0, 360, 130, 40], [520, 360, 120, 40]],
    traps: [
      { t: "fake", x: 150, y: 360, w: 52, h: 40, when: "step", delay: 26 },
      { t: "fake", x: 222, y: 360, w: 52, h: 40, when: "step", delay: 26 },
      { t: "fake", x: 294, y: 360, w: 52, h: 40, when: "step", delay: 26 },
      { t: "fake", x: 366, y: 360, w: 52, h: 40, when: "near", near: 55, delay: 16 },
      { t: "fake", x: 438, y: 360, w: 52, h: 40, when: "step", delay: 26 }
    ],
    goal: { x: 570, y: 310, w: 38, h: 50 }
  },
  {
    name: "רצפת הזיגזג",
    hint: "התקרה כאן נמוכה. גם הסבלנות.",
    world: 1,
    spawn: [40, 328],
    solid: [[0, 360, 190, 40], [230, 360, 50, 40], [330, 360, 50, 40], [430, 360, 50, 40], [530, 360, 110, 40], [180, 250, 370, 16]],
    traps: [
      { t: "fake", x: 190, y: 360, w: 40, h: 40, when: "near", near: 25, delay: 10 },
      { t: "fake", x: 280, y: 360, w: 50, h: 40, when: "near", near: 25, delay: 10 },
      { t: "fake", x: 380, y: 360, w: 50, h: 40, when: "near", near: 25, delay: 10 },
      { t: "fake", x: 480, y: 360, w: 50, h: 40, when: "near", near: 25, delay: 10 }
    ],
    goal: { x: 570, y: 310, w: 38, h: 50 }
  },

  /* ===== עולם 2 — דוקרנים, מסורים וקירות ===== */
  {
    name: "דוקרני השהיה",
    hint: "נחתת? תמשיך. יש לך רגע.",
    world: 2,
    spawn: [40, 328],
    solid: [[0, 360, 220, 40], [270, 360, 150, 40], [460, 360, 180, 40]],
    traps: [
      { t: "spike", x: 300, y: 360, w: 40, h: 26, tx: 270, delay: 24 },
      { t: "spike", x: 510, y: 360, w: 40, h: 26, tx: 480, delay: 24 }
    ],
    goal: { x: 570, y: 310, w: 38, h: 50 }
  },
  {
    name: "התקרה הנופלת",
    hint: "אל תעצור. אין לך איפה.",
    world: 2,
    spawn: [30, 328],
    solid: [[0, 360, 640, 40]],
    traps: [
      { t: "crusher", x: 150, y0: -180, y1: 296, w: 120, h: 60, tx: 90, rest: 24, look: "spike" },
      { t: "crusher", x: 330, y0: -180, y1: 296, w: 110, h: 60, tx: 290, rest: 24, look: "spike" },
      { t: "crusher", x: 470, y0: -180, y1: 296, w: 100, h: 60, tx: 450, rest: 24, look: "spike" }
    ],
    goal: { x: 594, y: 310, w: 38, h: 50 }
  },
  {
    name: "הקיר הבלתי נראה",
    hint: "משהו באוויר לא מרשה לך לקפוץ גבוה.",
    world: 2,
    spawn: [40, 328],
    solid: [[0, 360, 640, 40], [280, 300, 70, 16]],
    traps: [
      { t: "spike", x: 240, y: 360, w: 180, h: 26 },
      { t: "wall", x: 290, y: 176, w: 24, h: 56 }
    ],
    goal: { x: 560, y: 310, w: 38, h: 50 }
  },
  {
    name: "המסור הרודף",
    hint: "מאחוריך משהו. הוא לא מתעייף.",
    world: 2,
    spawn: [30, 328],
    solid: [[0, 360, 300, 40], [380, 360, 260, 40], [120, 320, 80, 16], [230, 290, 70, 16]],
    traps: [
      { t: "chase", x: -80, speed: 0.95, tx: 90 },
      { t: "fake", x: 300, y: 360, w: 80, h: 40, when: "near", near: 30, delay: 6 }
    ],
    goal: { x: 580, y: 310, w: 38, h: 50 }
  },
  {
    name: "דוקרנים שהם טרמפולינה",
    hint: "הדרך היחידה היא דרך מה שמפחיד.",
    world: 2,
    spawn: [30, 328],
    solid: [[0, 360, 640, 40], [420, 240, 60, 120]],
    traps: [{ t: "spike", x: 340, y: 360, w: 70, h: 26, mode: "bounce", power: 14 }],
    goal: { x: 570, y: 310, w: 38, h: 50 }
  },

  /* ===== עולם 3 — דלתות מתעללות ושיגורים ===== */
  {
    name: "הדלת הבורחת",
    hint: "היא לא מחכה לך. והיא משאירה חור.",
    world: 3,
    spawn: [40, 328],
    solid: [[0, 360, 272, 40], [332, 360, 308, 40]],
    traps: [{ t: "fake", x: 272, y: 360, w: 60, h: 40, when: "near", near: 60, delay: 6 }],
    goal: { x: 280, y: 310, w: 38, h: 50, flee: { speed: 2.8, dist: 100, maxX: 598 } }
  },
  {
    name: "מלכודת השיגור",
    hint: "יש משטח שאוהב את התקרה.",
    world: 3,
    spawn: [40, 328],
    solid: [[0, 360, 640, 40]],
    traps: [
      { t: "spring", x: 296, y: 356, w: 44, h: 8, power: 20 },
      { t: "spike", x: 270, y: 0, w: 120, h: 70, dir: "down" }
    ],
    goal: { x: 560, y: 310, w: 38, h: 50 }
  },
  {
    name: "הדלת המזויפת",
    hint: "הדלת בסוף נראית מושלמת. בדיוק בגלל זה.",
    world: 3,
    spawn: [40, 328],
    solid: [[0, 360, 640, 40], [0, 280, 110, 16], [520, 300, 120, 40]],
    traps: [
      { t: "decoy", x: 566, y: 250, w: 38, h: 50 },
      { t: "spike", x: 300, y: 360, w: 72, h: 26, dormant: true }
    ],
    goal: { x: 30, y: 230, w: 38, h: 50, hidden: true }
  },
  {
    name: "מעלית הבגידה",
    hint: "המעלית יודעת בדיוק מתי לעצור. לא.",
    world: 3,
    spawn: [30, 328],
    solid: [[0, 360, 200, 40], [340, 240, 300, 40]],
    traps: [
      { t: "mover", x: 220, y: 270, w: 90, h: 14, range: 70, speed: 1.1, axis: "y" },
      { t: "spike", x: 210, y: 110, w: 130, h: 70, dir: "down" }
    ],
    goal: { x: 560, y: 190, w: 38, h: 50 }
  },
  {
    name: "שתי הדרכים",
    hint: "הקצרה היא בדיוק מה שאתה חושב.",
    world: 3,
    spawn: [30, 328],
    solid: [[0, 360, 640, 40], [130, 306, 60, 16], [392, 240, 84, 16], [560, 190, 78, 16]],
    traps: [
      { t: "spike", x: 262, y: 360, w: 60, h: 26 },
      { t: "spike", x: 392, y: 240, w: 16, h: 26 },
      { t: "mover", x: 250, y: 266, w: 64, h: 14, range: 56, speed: 1.25, axis: "x" },
      { t: "decoy", x: 566, y: 310, w: 38, h: 50 }
    ],
    goal: { x: 566, y: 140, w: 38, h: 50 }
  },

  /* ===== עולם 4 — שבירת חוקים והיפוכים ===== */
  {
    name: "היפוך מקשים",
    hint: "הקו הזה לא מבקש רשות.",
    world: 4,
    spawn: [30, 328],
    solid: [[0, 360, 260, 40], [320, 360, 140, 40], [520, 360, 120, 40]],
    traps: [{ t: "reverse", x: 340, y: 0, w: 220, h: 400 }],
    goal: { x: 580, y: 310, w: 38, h: 50 }
  },
  {
    name: "היפוך כבידה",
    hint: "התקרה היא רצפה. רק באמצע.",
    world: 4,
    spawn: [30, 328],
    solid: [[0, 360, 220, 40], [420, 360, 220, 40], [0, 0, 640, 24]],
    traps: [{ t: "grav", x: 220, y: 0, w: 200, h: 400 }],
    goal: { x: 570, y: 310, w: 38, h: 50 }
  },
  {
    name: "היפוך בכל קפיצה",
    hint: "כל קפיצה מחליפה צד. תספור.",
    world: 4,
    spawn: [30, 328],
    flipOnJump: true,
    solid: [[0, 360, 640, 40]],
    traps: [
      { t: "spike", x: 250, y: 360, w: 60, h: 26 },
      { t: "spike", x: 390, y: 360, w: 60, h: 26 },
      { t: "spike", x: 520, y: 360, w: 60, h: 26 }
    ],
    goal: { x: 600, y: 310, w: 38, h: 50 }
  },
  {
    name: "כפתור הפיתיון",
    hint: "הכפתור לא משקר. הוא פשוט עוזר לדלת.",
    world: 4,
    spawn: [40, 328],
    solid: [[0, 280, 110, 16], [0, 360, 250, 40], [320, 360, 100, 40], [490, 360, 150, 40]],
    traps: [
      { t: "button", x: 560, y: 344, w: 44, h: 16 },
      { t: "fake", x: 250, y: 360, w: 70, h: 40, when: "button", delay: 8 },
      { t: "fake", x: 420, y: 360, w: 70, h: 40, when: "button", delay: 8 }
    ],
    goal: { x: 30, y: 230, w: 38, h: 50, hidden: true }
  },
  {
    name: "רצפת האשליה",
    hint: "כל מה שמחודד כאן הוא הצגה.",
    world: 4,
    spawn: [30, 328],
    solid: [[0, 360, 640, 40]],
    traps: [
      { t: "spike", x: 150, y: 360, w: 450, h: 26, mode: "fake" },
      { t: "fake", x: 220, y: 300, w: 80, h: 16, when: "step", delay: 14 },
      { t: "fake", x: 390, y: 270, w: 80, h: 16, when: "step", delay: 14 }
    ],
    goal: { x: 570, y: 310, w: 38, h: 50 }
  },

  /* ===== עולם 5 — כאוס משולב ===== */
  {
    name: "פלטפורמות זיכרון",
    hint: "הן שם. פשוט לא רואים אותן.",
    world: 5,
    spawn: [30, 328],
    solid: [[0, 360, 150, 40], [540, 360, 100, 40]],
    traps: [
      { t: "blink", x: 190, y: 320, w: 70, h: 14 },
      { t: "blink", x: 300, y: 320, w: 70, h: 14 },
      { t: "blink", x: 410, y: 320, w: 70, h: 14 }
    ],
    goal: { x: 578, y: 310, w: 38, h: 50 }
  },
  {
    name: "הדלת שרודפת אחריך",
    hint: "אל תעצור. הבורות לא מחכים.",
    world: 5,
    spawn: [30, 328],
    solid: [[0, 360, 200, 40], [270, 360, 70, 40], [410, 360, 70, 40], [550, 360, 90, 40]],
    traps: [
      { t: "chase", x: -70, speed: 0.85, tx: 70 },
      { t: "fake", x: 200, y: 360, w: 70, h: 40, when: "near", near: 30, delay: 3 },
      { t: "fake", x: 340, y: 360, w: 70, h: 40, when: "near", near: 30, delay: 3 },
      { t: "fake", x: 480, y: 360, w: 70, h: 40, when: "near", near: 30, delay: 3 }
    ],
    goal: { x: 578, y: 310, w: 38, h: 50 }
  },
  {
    name: "שיגור לתוך היפוך",
    hint: "בשיא הגובה, הכיוון הוא הצגה.",
    world: 5,
    spawn: [30, 328],
    solid: [[0, 360, 280, 40], [360, 240, 280, 40]],
    traps: [
      { t: "spike", x: 200, y: 360, w: 80, h: 26, mode: "bounce", power: 18 },
      { t: "reverse", x: 270, y: 60, w: 80, h: 300 }
    ],
    goal: { x: 560, y: 190, w: 38, h: 50 }
  },
  {
    name: "החדר המתכווץ",
    hint: "הקירות מתקרבים. הדלת מגיעה אחרונה.",
    world: 5,
    spawn: [30, 328],
    solid: [[190, 360, 260, 40]],
    traps: [
      { t: "fake", x: 0, y: 360, w: 190, h: 40, when: "near", near: 400, delay: 70 },
      { t: "fake", x: 450, y: 360, w: 190, h: 40, when: "near", near: 400, delay: 70 },
      { t: "crusher", x: 110, y0: -200, y1: 296, w: 100, h: 60, tx: 1, rest: 600, look: "spike" },
      { t: "crusher", x: 430, y0: -200, y1: 296, w: 100, h: 60, tx: 1, rest: 600, look: "spike" }
    ],
    goal: { x: 300, y: 310, w: 38, h: 50, hidden: true, appear: 160 }
  },
  {
    name: "הגמר הגדול",
    hint: "כל מה שלמדת. ואז הדלת בורחת הביתה.",
    world: 5,
    spawn: [30, 328],
    solid: [[0, 360, 140, 40], [210, 360, 430, 40], [320, 240, 40, 120]],
    traps: [
      { t: "fake", x: 140, y: 360, w: 70, h: 40, when: "near", near: 25, delay: 4 },
      { t: "spike", x: 240, y: 360, w: 70, h: 26, mode: "bounce", power: 14 },
      { t: "wall", x: 420, y: 210, w: 16, h: 60 },
      { t: "crusher", x: 460, y0: -200, y1: 296, w: 50, h: 60, tx: 500, rest: 40, look: "spike" },
      { t: "crusher", x: 340, y0: -200, y1: 296, w: 50, h: 60, tx: 520, rest: 40 },
      { t: "crusher", x: 220, y0: -200, y1: 296, w: 50, h: 60, tx: 540, rest: 40 }
    ],
    goal: { x: 590, y: 310, w: 38, h: 50, flee: { speed: 3.15, dist: 130, maxX: 598, force: "left" } }
  },

  /* ===== עולם 6 — מנגנוני קפיצה ושינוי מצב ===== */
  {
    name: "דוקרני מתג",
    hint: "כל קפיצה מחליפה איזו קבוצה חיה.",
    world: 6,
    spawn: [40, 320],
    toggleOnJump: true,
    toggleDelay: 9, // 0.15 שניות (60 פריימים לשנייה)
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "toggle", group: "a", x: tile(4), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "a", x: tile(10), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "a", x: tile(16), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "b", x: tile(7), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "b", x: tile(13), y: tile(11), w: 64, h: 28 }
    ],
    goal: { x: 594, y: 302, w: 38, h: 50 }
  },
  {
    name: "קפיצה אוטומטית",
    hint: "אתה קופץ לבד. רק תכוון את השיא.",
    world: 6,
    spawn: [40, 320],
    autoJump: true,
    solid: [[0, tile(11), tile(6), 48], [tile(7), tile(11), tile(5), 48], [tile(13), tile(11), tile(7), 48]],
    traps: [
      { t: "spike", x: 0, y: tile(7), w: 128, h: 34, dir: "down" },
      { t: "spike", x: 192, y: tile(7), w: 96, h: 34, dir: "down" },
      { t: "spike", x: 352, y: tile(7), w: 96, h: 34, dir: "down" },
      { t: "spike", x: 512, y: tile(7), w: 128, h: 34, dir: "down" }
    ],
    goal: { x: 600, y: 302, w: 38, h: 50 }
  },
  {
    name: "קפיצים זזים",
    hint: "הקפיץ האחרון לא מחכה לך איפה שהשארת אותו.",
    world: 6,
    spawn: [40, 320],
    solid: [[0, tile(11), 96, 48], [tile(16), tile(11), 128, 48],
      [tile(5), tile(10), 40, 16], [tile(9), tile(10), 40, 16], [tile(13), tile(10), 40, 16]],
    traps: [
      { t: "spring", x: 164, y: 312, w: 32, h: 8, power: 16 },
      { t: "spring", x: 292, y: 312, w: 32, h: 8, power: 16 },
      { t: "spring", x: 420, y: 312, w: 32, h: 8, power: 16, slideTo: tile(15), slideWhenLeave: 1 }
    ],
    goal: { x: 570, y: 302, w: 38, h: 50 }
  },
  {
    name: "רצפת קרח",
    hint: "כאן אי אפשר לעצור. רק להחליט מוקדם.",
    world: 6,
    spawn: [40, 320],
    friction: 0.96,
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "fake", x: tile(6), y: tile(11), w: 64, h: 48, when: "near", near: 64, delay: 6 },
      { t: "fake", x: tile(13), y: tile(11), w: 64, h: 48, when: "near", near: 64, delay: 6 }
    ],
    goal: { x: 594, y: 302, w: 38, h: 50 }
  },
  {
    name: "הקפיצה המושבתת",
    hint: "כאן הקפיצה לא עובדת. שם למטה — כן.",
    world: 6,
    spawn: [40, 320],
    solid: [[tile(4), tile(9), 128, 16], [tile(8), tile(7), 160, 16], [tile(13), tile(5), 224, 16]],
    traps: [
      { t: "nojump", x: tile(9), y: 192, w: 64, h: 96 },
      { t: "spring", x: tile(8), y: 216, w: 32, h: 8, power: 17, hidden: true }
    ],
    goal: { x: 580, y: 110, w: 38, h: 50 }
  },

  /* ===== עולם 7 — מסורים, כדורים וקירות מוחצים ===== */
  {
    name: "המסור הקופץ",
    hint: "תקפוץ לידו — והוא יקפוץ איתך.",
    world: 7,
    spawn: [40, 320],
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "saw", x: tile(10), y: 326, w: 48, h: 48, range: 224, speed: 3 }
    ],
    goal: { x: 594, y: 302, w: 38, h: 50 }
  },
  {
    name: "מסורים מהתקרה",
    hint: "כל צעד מפיל משהו. אל תעצור.",
    world: 7,
    spawn: [32, 320],
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "fallsaw", x: tile(4), tx: tile(4), w: 44, h: 44, y1: 300 },
      { t: "fallsaw", x: tile(7), tx: tile(7), w: 44, h: 44, y1: 300 },
      { t: "fallsaw", x: tile(10), tx: tile(10), w: 44, h: 44, y1: 300 },
      { t: "fallsaw", x: tile(13), tx: tile(13), w: 44, h: 44, y1: 300 },
      { t: "fallsaw", x: tile(16), tx: tile(16), w: 44, h: 44, y1: 300 }
    ],
    goal: { x: 600, y: 302, w: 38, h: 50 }
  },
  {
    name: "כדור הדוקרנים",
    hint: "הכדור מהיר ממך. השקע לא.",
    world: 7,
    spawn: [40, 320],
    solid: [[0, tile(11), tile(8), 48], [tile(9), tile(11), tile(5), 48], [tile(15), tile(11), tile(5), 48],
      [tile(8), 384, 32, 16], [tile(14), 384, 32, 16]],
    traps: [
      { t: "ball", x: -700, y: 318, r: 34, speed: 6 },
      { t: "spike", x: tile(14), y: 384, w: 32, h: 26 }
    ],
    goal: { x: 600, y: 302, w: 38, h: 50 }
  },
  {
    name: "קירות המספריים",
    hint: "הזוג השלישי נסגר פעמיים מהר.",
    world: 7,
    spawn: [40, 320],
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "gate", x: tile(5), w: 30, period: 90, phase: 0 },
      { t: "gate", x: tile(8), w: 30, period: 90, phase: 1.57 },
      { t: "gate", x: tile(11), w: 30, period: 90, phase: 3.14, fastX: tile(10), fast: 2 },
      { t: "gate", x: tile(14), w: 30, period: 90, phase: 4.71 },
      { t: "fake", x: tile(12), y: tile(11), w: 32, h: 48, when: "near", near: 50, delay: 4 }
    ],
    goal: { x: 600, y: 302, w: 38, h: 50 }
  },
  {
    name: "המגרסה הכפולה",
    hint: "הקירות מתקרבים. משהו יופיע ביניהם.",
    world: 7,
    spawn: [tile(9), 320],
    solid: [[0, tile(11), 640, 48], [tile(9), tile(4), 96, 16]],
    traps: [
      { t: "chase", x: -120, speed: 1.5, tx: 0 },
      { t: "chase", x: 760, speed: 1.5, tx: 1e9, side: "right" },
      { t: "spring", x: tile(9), y: 342, w: 44, h: 10, power: 17, appearAt: 240 }
    ],
    goal: { x: tile(9) + 10, y: 78, w: 38, h: 50 }
  },

  /* ===== עולם 8 — מפתחות וטריקים פסיכולוגיים ===== */
  {
    name: "המפתח שבורח",
    hint: "הוא לא רוצה שתיקח אותו.",
    world: 8,
    spawn: [40, 320],
    solid: [[0, tile(11), 352, 48], [448, tile(11), 192, 48], [64, 288, 64, 16]],
    traps: [
      { t: "key", x: tile(9), y: 276, w: 22, h: 22, fleeX: tile(8), fleeTo: [72, 240] }
    ],
    goal: { x: 576, y: 302, w: 38, h: 50, locked: true }
  },
  {
    name: "המפתח המפוצץ",
    hint: "ברגע שתקח אותו, הרצפה תיפול.",
    world: 8,
    spawn: [40, 320],
    solid: [[32, tile(11), 48, 48], [192, tile(11), 48, 48], [352, tile(11), 48, 48],
      [480, tile(11), 48, 48], [576, tile(11), 48, 48]],
    traps: [
      { t: "key", x: 584, y: 306, w: 22, h: 22 },
      { t: "fake", x: 80, y: tile(11), w: 112, h: 48, when: "key", delay: 4 },
      { t: "fake", x: 240, y: tile(11), w: 112, h: 48, when: "key", delay: 4 },
      { t: "fake", x: 400, y: tile(11), w: 80, h: 48, when: "key", delay: 4 },
      { t: "fake", x: 528, y: tile(11), w: 48, h: 48, when: "key", delay: 4 }
    ],
    goal: { x: 36, y: 302, w: 38, h: 50, locked: true }
  },
  {
    name: "מבחן הסבלנות",
    hint: "הקיר לא זז. אתה כן.",
    world: 8,
    spawn: [40, 320],
    patience: { frames: 240 },
    solid: [[0, tile(11), 640, 48]],
    traps: [{ t: "wall", x: tile(6), y: 0, w: 24, h: 400, patience: true }],
    goal: { x: 576, y: 302, w: 38, h: 50 }
  },
  {
    name: "שבירת המסך",
    hint: "כאן אין קיר שמאלי.",
    world: 8,
    spawn: [32, 320],
    wrap: true,
    solid: [[0, tile(11), 640, 48]],
    traps: [{ t: "wall", x: tile(14), y: 0, w: 24, h: 400 }],
    goal: { x: 544, y: 302, w: 38, h: 50 }
  },
  {
    name: "שלט ההטעיה",
    hint: "השלט לא משקר. הוא פשוט עובד בשביל הדלת.",
    world: 8,
    spawn: [32, 320],
    solid: [[0, tile(11), 640, 48], [96, 192, 448, 16], [64, 288, 80, 16]],
    traps: [
      { t: "fake", x: 400, y: 192, w: 96, h: 16, when: "step", delay: 12 },
      { t: "spike", x: 496, y: 192, w: 48, h: 26 },
      { t: "sign", x: 300, y: 170, text: "לכאן →" },
      { t: "sign", x: 240, y: 330, text: "סכנה ☠" },
      { t: "decoy", x: 512, y: 302, w: 38, h: 50 }
    ],
    goal: { x: 596, y: 302, w: 38, h: 50, hidden: true }
  },

  /* ===== עולם 9 — חושך, רוח וכפילים ===== */
  {
    name: "כיבוי אורות",
    hint: "תשנן את המפה לפני הלחיצה הראשונה.",
    world: 9,
    spawn: [40, 320],
    dark: true,
    solid: [[0, tile(11), 160, 48], [224, tile(11), 96, 48], [384, tile(11), 96, 48], [512, tile(11), 128, 48]],
    traps: [
      { t: "spike", x: tile(8), y: tile(11), w: 32, h: 26 },
      { t: "spike", x: tile(13), y: tile(11), w: 32, h: 26 }
    ],
    goal: { x: 600, y: 302, w: 38, h: 50 }
  },
  {
    name: "מכת רוח",
    hint: "הרוח דוחפת שמאלה. על הפלטפורמה השלישית היא דוחפת אחרת.",
    world: 9,
    spawn: [40, 320],
    wind: { period: 120, dur: 60, force: -2.5, zone: [384, 240, 64, 120], zoneForce: 3.5 },
    solid: [[0, tile(11), 96, 48], [tile(4), tile(10), 64, 16], [tile(8), tile(10), 64, 16],
      [tile(12), tile(10), 64, 16], [tile(16), tile(10), 128, 16]],
    traps: [{ t: "spike", x: tile(16), y: tile(10), w: 32, h: 26 }],
    goal: { x: 576, y: 270, w: 38, h: 50 }
  },
  {
    name: "הכפיל",
    hint: "הוא זז איתך. הוא לא יכול לקפוץ איתך.",
    world: 9,
    spawn: [32, 320],
    clone: { dy: -96 },
    solid: [[0, tile(11), 192, 48], [256, tile(11), 128, 48], [448, tile(11), 192, 48]],
    traps: [
      { t: "spike", x: 192, y: 256, w: 64, h: 26, dir: "down" },
      { t: "spike", x: 384, y: 64, w: 64, h: 60, dir: "down" }
    ],
    goal: { x: 600, y: 302, w: 38, h: 50 }
  },
  {
    name: "הרצפה שמתכווצת",
    hint: "היא נמחקת מאחוריך. לא לחכות לה.",
    world: 9,
    spawn: [40, 320],
    melt: [32, tile(11), 544, 48, 3.5],
    solid: [[576, tile(11), 64, 48]],
    traps: [{ t: "wall", x: tile(10), y: 288, w: 32, h: 64 }],
    goal: { x: 590, y: 302, w: 38, h: 50 }
  },
  {
    name: "מגדל השיגור",
    hint: "כאן לא מטפסים. משוגרים.",
    world: 9,
    spawn: [40, 320],
    solid: [[0, tile(11), 640, 48], [96, 320, 72, 16], [256, 224, 72, 16], [416, 128, 72, 16], [288, 64, 120, 16]],
    traps: [
      { t: "spring", x: 108, y: 312, w: 40, h: 8, power: 14 },
      { t: "spring", x: 268, y: 216, w: 40, h: 8, power: 14 },
      { t: "spring", x: 428, y: 120, w: 40, h: 8, power: 14 },
      { t: "spike", x: 96, y: 320, w: 16, h: 20 },
      { t: "spike", x: 568, y: 128, w: 16, h: 20 }
    ],
    goal: { x: 330, y: 14, w: 38, h: 50 }
  },

  /* ===== עולם 10 — גיהנום מוחלט ===== */
  {
    name: "היפוך ומסור",
    hint: "המקשים מתהפכים בדיוק באמצע.",
    world: 10,
    spawn: [32, 320],
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "saw", x: tile(7), y: 326, w: 48, h: 48, range: 64, speed: 3 },
      { t: "reverse", x: tile(10), y: 0, w: 64, h: 400 },
      { t: "saw", x: tile(14), y: 326, w: 48, h: 48, range: 80, speed: 3 }
    ],
    goal: { x: 596, y: 302, w: 38, h: 50 }
  },
  {
    name: "דוקרני מתג בחושך",
    hint: "כל קפיצה מחליפה את המצב — וגם מכבה את האור.",
    world: 10,
    spawn: [40, 320],
    dark: true,
    toggleOnJump: true,
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "toggle", group: "a", x: tile(4), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "a", x: tile(10), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "a", x: tile(16), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "b", x: tile(7), y: tile(11), w: 64, h: 28 },
      { t: "toggle", group: "b", x: tile(13), y: tile(11), w: 64, h: 28 }
    ],
    goal: { x: 594, y: 302, w: 38, h: 50 }
  },
  {
    name: "מרוץ הדלת הבורחת",
    hint: "היא לא מחכה. הטרמפולינה כן.",
    world: 10,
    spawn: [32, 320],
    solid: [[0, tile(11), 96, 48], [tile(8), tile(11), 384, 48]],
    traps: [
      { t: "fake", x: 96, y: tile(11), w: 160, h: 48, when: "step", delay: 20 },
      { t: "spike", x: tile(9), y: tile(11), w: 64, h: 26, mode: "bounce", power: 18 },
      { t: "wall", x: tile(11), y: 0, w: 24, h: 400 }
    ],
    goal: { x: tile(8), y: 302, w: 38, h: 50, flee: { speed: 3.8, dist: 240, maxX: 596, force: "right" } }
  },
  {
    name: "המסדרון הבלתי אפשרי",
    hint: "הדלת בסוף היא רק ההתחלה.",
    world: 10,
    spawn: [32, 320],
    ceil: [0, 0.8, true],
    solid: [[0, tile(11), 640, 48]],
    traps: [
      { t: "fake", x: tile(5), y: tile(11), w: 32, h: 48, when: "near", near: 60, delay: 2 },
      { t: "fake", x: tile(11), y: tile(11), w: 32, h: 48, when: "near", near: 60, delay: 2 },
      { t: "saw", x: tile(14), y: 326, w: 44, h: 44, range: 64, speed: 3 },
      { t: "button", x: 576, y: 302, w: 38, h: 50, action: "trap", goalTo: [36, 302], text: "פספסת!" }
    ],
    goal: { x: 576, y: 302, w: 38, h: 50 }
  },
  {
    name: "הבוס האחרון",
    hint: "שלושה כפתורים. סדר אחד נכון.",
    world: 10,
    spawn: [tile(6), 320],
    boss: true,
    ceil: [0, 0.7, false],
    solid: [[0, tile(11), 640, 48], [0, 288, 96, 16], [544, 288, 96, 16],
      [32, 224, 128, 16], [480, 224, 128, 16]],
    traps: [
      { t: "button", x: 74, y: 208, w: 44, h: 16, action: "saw" },
      { t: "button", x: 522, y: 208, w: 44, h: 16, action: "reverse" },
      { t: "button", x: 288, y: 336, w: 44, h: 16, action: "ceil" }
    ],
    goal: { x: 300, y: 302, w: 38, h: 50, hidden: true, flee: { speed: 3.5, dist: 240, maxX: 596, force: "right" } }
  }
];
