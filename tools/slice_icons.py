"""Нарезка сетки иконок (webp из Recraft) на отдельные PNG с прозрачным фоном.

Запуск: python -I slice_icons.py <input.webp> <output_dir>
Логика: фон кремовый — удаляем только те кремовые пиксели, что связаны с краем
(flood fill), кремовые заливки внутри иконок сохраняются.
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

INPUT = Path(sys.argv[1])
OUT_DIR = Path(sys.argv[2])
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Имена в порядке чтения сетки: строка за строкой, слева направо
NAMES = [
    "home", "stethoscope", "chart", "profile",        # ряд 1
    "search", "bell", "help",                          # ряд 2
    "pressure", "pulse", "temperature", "lungs",       # ряд 3
    "scale", "sleep", "steps",                         # ряд 4
    "water", "robot", "warning",                       # ряд 5
]

MERGE_GAP = 26      # расстояние слияния компонентов одной иконки, px
ROW_GAP = 115       # порог разбиения на ряды по Y, px
MIN_SIZE = 36       # отсев мелкого шума
PAD = 6             # поля кропа


def main():
    img = Image.open(INPUT).convert("RGB")
    arr = np.asarray(img).astype(np.int16)
    h, w = arr.shape[:2]

    # Цвет фона — медиана углов
    corners = np.concatenate([
        arr[:20, :20].reshape(-1, 3), arr[:20, -20:].reshape(-1, 3),
        arr[-20:, :20].reshape(-1, 3), arr[-20:, -20:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))

    # Компоненты не-фона
    mask = dist > 30
    labels, n = ndimage.label(mask)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        ys, xs = sl
        comp = labels[ys, xs] == i
        if comp.sum() < 40:
            continue
        boxes.append([xs.start, ys.start, xs.stop, ys.stop])

    # Сливаем близкие bbox'ы (части одной иконки: точка колокольчика, ZZZ и т.п.)
    def overlaps(b1, b2, gap=MERGE_GAP):
        return not (b1[2] + gap < b2[0] or b2[2] + gap < b1[0]
                    or b1[3] + gap < b2[1] or b2[3] + gap < b1[1])

    changed = True
    while changed:
        changed = False
        merged = []
        while boxes:
            b = boxes.pop()
            for i, m in enumerate(merged):
                if overlaps(b, m):
                    merged[i] = [min(b[0], m[0]), min(b[1], m[1]),
                                 max(b[2], m[2]), max(b[3], m[3])]
                    changed = True
                    break
            else:
                merged.append(b)
        boxes = merged

    boxes = [b for b in boxes if (b[2] - b[0]) >= MIN_SIZE and (b[3] - b[1]) >= MIN_SIZE]

    # Группировка в ряды по Y, сортировка по X
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows, current = [], [boxes[0]]
    for b in boxes[1:]:
        if (b[1] + b[3]) / 2 - (current[-1][1] + current[-1][3]) / 2 > ROW_GAP:
            rows.append(current)
            current = []
        current.append(b)
    rows.append(current)

    ordered = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda b: b[0]))

    print(f"Компонентов после слияния: {len(boxes)}; ожидается {len(NAMES)}")
    if len(ordered) != len(NAMES):
        for i, b in enumerate(ordered):
            print(i, b)
        raise SystemExit("Число иконок не совпало — скорректируйте пороги")

    # Прозрачность: flood fill кремового от краёв кропа
    def make_transparent(crop_rgb: Image.Image) -> Image.Image:
        c = np.asarray(crop_rgb.convert("RGB")).astype(np.int16)
        ch, cw = c.shape[:2]
        d = np.sqrt(((c - bg) ** 2).sum(axis=2))
        is_bg = d <= 42
        transparent = np.zeros((ch, cw), dtype=bool)
        q = deque()
        for x in range(cw):
            for y in (0, ch - 1):
                if is_bg[y, x] and not transparent[y, x]:
                    transparent[y, x] = True
                    q.append((y, x))
        for y in range(ch):
            for x in (0, cw - 1):
                if is_bg[y, x] and not transparent[y, x]:
                    transparent[y, x] = True
                    q.append((y, x))
        while q:
            y, x = q.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < ch and 0 <= nx < cw and is_bg[ny, nx] and not transparent[ny, nx]:
                    transparent[ny, nx] = True
                    q.append((ny, nx))
        alpha = np.where(transparent, 0, 255).astype(np.uint8)
        out = np.dstack([c.astype(np.uint8), alpha])
        return Image.fromarray(out, "RGBA")

    saved = []
    for name, (x0, y0, x1, y1) in zip(NAMES, ordered):
        x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
        x1, y1 = min(w, x1 + PAD), min(h, y1 + PAD)
        crop = img.crop((x0, y0, x1, y1))
        png = make_transparent(crop)
        path = OUT_DIR / f"{name}.png"
        png.save(path)
        saved.append((name, path.name, png.size))

    # Контрольный лист
    sheet = Image.new("RGBA", (5 * 140, 4 * 140), (255, 255, 255, 255))
    for i, (name, _, _) in enumerate(saved):
        icon = Image.open(OUT_DIR / f"{name}.png")
        icon.thumbnail((110, 110))
        x = (i % 5) * 140 + 15
        y = (i // 5) * 140 + 15
        sheet.alpha_composite(icon, (x, y))
    sheet.convert("RGB").save(OUT_DIR.parent / "debug_sheet.png")

    for s in saved:
        print("saved:", *s)


if __name__ == "__main__":
    main()
