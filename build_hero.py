"""יצירת תמונת hero.png — הרכבת פנים (snake-head.webp) על גוף בחליפה (suit-source.webp).

מסיר רקע בשיטת flood-fill מהשוליים, מוחק את ראש הדוגמן ומדביק את פני האדם.
הרצה: python build_hero.py (דורש PIL)."""

from PIL import Image, ImageDraw, ImageFilter
from collections import deque

BODY = "assets/suit-source.webp"
FACE_SRC = "assets/snake-head.webp"
OUT = "assets/hero.png"
TOP_MARGIN = 26


def remove_bg(img, bg=None, tol=46, neutral_bright=999):
    """הסרת רקע שמחובר לשוליים בלבד (flood fill), כדי לא למחוק אזורים בהירים בפנים."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    def bgish(x, y):
        r, g, b, a = px[x, y]
        br = bg if bg is not None else bgrow[y]
        d = ((r - br[0]) ** 2 + (g - br[1]) ** 2 + (b - br[2]) ** 2) ** 0.5
        if d < tol:
            return True
        # אפור ניטרלי = רקע (החולצה התכלת, החליפה והעור לא ניטרליים)
        spread = max(r, g, b) - min(r, g, b)
        bright = (r + g + b) / 3
        return spread <= 12 and neutral_bright <= bright <= 235

    bgrow = []
    for y in range(h):
        row = [px[x, y][:3] for x in list(range(0, 5)) + list(range(w - 5, w))]
        bgrow.append((sum(p[0] for p in row) / len(row),
                      sum(p[1] for p in row) / len(row),
                      sum(p[2] for p in row) / len(row)))

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bgish(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if bgish(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and bgish(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))

    mask = Image.frombytes("L", (w, h), bytes(255 if v else 0 for v in seen))
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    r, g, b, a = img.split()
    a = Image.composite(Image.new("L", (w, h), 0), a, mask)
    out = Image.merge("RGBA", (r, g, b, a))

    # ניקוי צבע הרקע משולי האלפא — מונע הילה בהירה סביב הדמות
    op = out.load()
    for y in range(h):
        br = bg if bg is not None else bgrow[y]
        for x in range(w):
            r, g, b, al = op[x, y]
            if 0 < al < 255:
                f = al / 255.0
                nr = (r - (1 - f) * br[0]) / f
                ng = (g - (1 - f) * br[1]) / f
                nb = (b - (1 - f) * br[2]) / f
                op[x, y] = (max(0, min(255, int(nr))), max(0, min(255, int(ng))),
                            max(0, min(255, int(nb))), al)
    return out


# --- הפנים של האדם, כולל כל הזקן ---
face = Image.open(FACE_SRC).convert("RGB").crop((0, 0, 230, 340))
face = remove_bg(face, bg=(157, 188, 205), tol=44, neutral_bright=140)

# --- הגוף בחליפה החומה ---
body = remove_bg(Image.open(BODY), tol=26, neutral_bright=120)
W, H = body.size

# מחיקת הראש של הדוגמן, עד מעל הצווארון
mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).ellipse((148 - 68, 95 - 63, 148 + 68, 95 + 63), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1.5))
r, g, b, a = body.split()
a = Image.composite(Image.new("L", (W, H), 0), a, mask)
body = Image.merge("RGBA", (r, g, b, a))

canvas = Image.new("RGBA", (W, H + TOP_MARGIN), (0, 0, 0, 0))
canvas.alpha_composite(body, (0, TOP_MARGIN))

fw = 128
fh = round(face.height * fw / face.width)
face = face.resize((fw, fh), Image.LANCZOS)
beard_bottom = TOP_MARGIN + 182
top = beard_bottom - fh
left = 148 - fw // 2
canvas.alpha_composite(face, (left, top))

out = canvas.crop(canvas.getbbox())
out.save(OUT)
print("saved", OUT, out.size, "face", (left, top, fw, fh))
