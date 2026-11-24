/*
 * scores.js — שכבת השיאים המשותפת לכל המשחקים.
 *
 * כל משחק קורא ל־OnlineScores.get(...) בטעינה, ושולח OnlineScores.submit(...)
 * כששחקן נרשם לטבלה או OnlineScores.best(...) בסוף סיבוב. השרת (api/scores.js)
 * הוא מקור האמת, והתשובה נכתבת חזרה לאחסון המקומי של אותו משחק.
 * אם השרת לא זמין (הרצה מקומית, רשת חסומה, אין Redis מחובר) כל הפונקציות
 * מחזירות null בשקט והמשחק ממשיך לעבוד מהאחסון בדפדפן בלבד.
 */
(function () {
  const ENDPOINT = "api/scores";
  const PLAYER_KEY = "scores:player";
  let cached = "";

  // מזהה קבוע לדפדפן הזה — מזהה את השיא האישי, לא את השם שמוצג בטבלה
  function playerId() {
    if (cached) return cached;
    try {
      cached = localStorage.getItem(PLAYER_KEY) || "";
    } catch (error) {
      cached = "";
    }
    if (!cached) {
      cached = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try {
        localStorage.setItem(PLAYER_KEY, cached);
      } catch (error) {
        /* אין אחסון — המזהה יחזיק עד לרענון */
      }
    }
    return cached;
  }

  function ask(params, body) {
    if (typeof fetch !== "function") return Promise.resolve(null);

    let url;
    try {
      url = new URL(ENDPOINT, document.baseURI);
    } catch (error) {
      return Promise.resolve(null);
    }
    Object.keys(params).forEach(key => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    url.searchParams.set("player", playerId());

    const options = body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      : { method: "GET", cache: "no-store" };

    return fetch(url.toString(), options)
      .then(response => (response.ok ? response.json() : null))
      .then(data => (data && data.ok ? data : null))
      .catch(() => null);
  }

  window.OnlineScores = {
    playerId,
    // טבלה יומית + שיאים אישיים; buckets = רשימת מפתחות השיא (בסנייק: המהירויות)
    get(game, board, buckets) {
      return ask({ game, board, buckets: (buckets || []).join(",") });
    },
    // רישום שם בטבלה היומית (וגם עדכון השיא האישי)
    submit(game, board, name, score) {
      return ask({ game, board }, { game, board, name, score });
    },
    // עדכון השיא האישי בלבד, בלי להיכנס לטבלה
    best(game, board, score) {
      return ask({ game, board }, { game, board, score });
    }
  };
})();
