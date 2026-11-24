"""Turn generated sticker art into the screen-sized WebP files the frame ships.

Source PNGs live in assets/art/source (transparent, 1024px singles or 2048x1024
sheets laid out 4x2 in 512px cells). Output goes to assets/art/web.

Backdrops (source bg-*.png, opaque) are cover-scaled to exactly 1920x1080 and
saved as WebP; the frame shows one behind every screen (frame-web backdrop.ts).
A scene ships once its day, dusk and night paintings all exist: the manifest
packages/frame-web/src/backdrops.json lists those scenes with how bright each
painting is behind the header, which picks the header's ink (frame-web sky.ts).

Generated art often leaves faint specks in the transparent gutters, so each
sticker keeps only alpha islands at least 2% the size of its largest one, then
is trimmed to its content, centred on a square canvas and resized.

    python3 -m venv .venv && .venv/bin/pip install pillow numpy scipy
    .venv/bin/python -I scripts/art/prep.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

import json
import re

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/art/source"
OUT = ROOT / "assets/art/web"
MANIFEST = ROOT / "packages/frame-web/src/backdrops.json"
LIGHTS = ("day", "dusk", "night")
# The header's height on the 1920x1080 frame (padding plus the .top row).
HEADER_BAND = 170

# Sheets: file -> (output prefix, names in row-major order, output size).
SHEETS = {
    "stickers.png": ("stk-", ["bus", "soccer", "palette", "house", "school", "cake", "ballet", "star"], 256),
    "chores.png": ("chore-", ["bed", "teeth", "dress", "bag", "fish", "toys", "table", "plants"], 256),
    "activities-1.png": (
        "stk-",
        ["star-of-david", "book", "woodworking", "taekwondo", "music", "dice", "gingerbread", "soup"],
        256,
    ),
    "activities-2.png": (
        "stk-",
        ["car", "turkey", "museum", "dinner", "pencil", "microphone", "medal", "gift"],
        256,
    ),
    "weather.png": (
        "wx-",
        ["sunny", "partly", "cloudy", "rainy", "snowy", "stormy", "foggy", "night"],
        256,
    ),
}
SINGLES = {
    "axolotl.png": 384,
    "seal.png": 384,
    "polarbear-rain.png": 512,
    "polarbear-sun.png": 512,
    "polarbear-cold.png": 512,
    "polarbear-party.png": 512,
    "raincloud.png": 256,
}
CELL = 512
MIN_ISLAND = 0.02
ALPHA_FLOOR = 40


def clean(image: Image.Image) -> Image.Image:
    pixels = np.array(image.convert("RGBA"))
    solid = pixels[..., 3] > ALPHA_FLOOR
    labels, count = ndimage.label(solid)
    if count > 1:
        sizes = ndimage.sum(solid, labels, range(1, count + 1))
        keep_ids = [i + 1 for i, size in enumerate(sizes) if size >= MIN_ISLAND * sizes.max()]
        keep = ndimage.binary_dilation(np.isin(labels, keep_ids), iterations=2)
        pixels[..., 3] = np.where(keep, pixels[..., 3], 0)
    cleaned = Image.fromarray(pixels)
    cleaned = cleaned.crop(cleaned.getbbox())
    side = max(cleaned.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cleaned, ((side - cleaned.width) // 2, (side - cleaned.height) // 2))
    return square


def fresh(source: Path, *names: str) -> bool:
    """Whether every output already exists and is newer than its source, so a run
    only encodes what changed (WebP's slowest method takes a while, and has hung)."""
    outputs = [OUT / f"{name}.webp" for name in names]
    return all(o.exists() and o.stat().st_mtime >= source.stat().st_mtime for o in outputs)


def save(image: Image.Image, name: str, size: int) -> None:
    clean(image).resize((size, size), Image.LANCZOS).save(OUT / f"{name}.webp", "WEBP", quality=90, method=6)


BACKDROP = (1920, 1080)


def header_luminance(full: Image.Image) -> float:
    """Mean WCAG relative luminance (0 black .. 1 white) of the header band."""
    srgb = np.asarray(full.crop((0, 0, BACKDROP[0], HEADER_BAND)), dtype=np.float64) / 255
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    return float((0.2126 * linear[..., 0] + 0.7152 * linear[..., 1] + 0.0722 * linear[..., 2]).mean())


def save_backdrop(source: Path) -> float:
    """Cover-scale (crop the overflow, centred) to the frame's exact size; returns
    the header band's luminance."""
    name = source.stem
    image = Image.open(source).convert("RGB")
    scale = max(BACKDROP[0] / image.width, BACKDROP[1] / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = (resized.width - BACKDROP[0]) // 2
    top = (resized.height - BACKDROP[1]) // 2
    full = resized.crop((left, top, left + BACKDROP[0], top + BACKDROP[1]))
    if fresh(source, name, f"{name}-blur"):
        return header_luminance(full)
    full.save(OUT / f"{name}.webp", "WEBP", quality=82, method=6)
    # The frosted-glass copy shown inside the panels: blurred here, once, because
    # the frame's GPU cannot afford a live backdrop-filter. Half size is plenty
    # for something this soft (CSS scales it back up).
    half = full.resize((BACKDROP[0] // 2, BACKDROP[1] // 2), Image.LANCZOS)
    half.filter(ImageFilter.GaussianBlur(4)).save(OUT / f"{name}-blur.webp", "WEBP", quality=80, method=6)
    return header_luminance(full)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tones: dict[str, dict[str, float]] = {}
    for file in sorted(SOURCE.glob("bg-*.png")):
        match = re.fullmatch(r"bg-(.+?)(?:-(dusk|night))?", file.stem)
        if not match:
            continue
        scene, light = match[1], match[2] or "day"
        tones.setdefault(scene, {})[light] = round(save_backdrop(file), 4)
    complete = {
        scene: {light: lights[light] for light in LIGHTS}
        for scene, lights in sorted(tones.items())
        if all(light in lights for light in LIGHTS)
    }
    for scene in sorted(set(tones) - set(complete)):
        print(f"not shipping {scene}: missing {', '.join(l for l in LIGHTS if l not in tones[scene])}")
    MANIFEST.write_text(json.dumps(complete, indent=2) + "\n")
    for file, (prefix, names, size) in SHEETS.items():
        if fresh(SOURCE / file, *(prefix + name for name in names)):
            continue
        sheet = Image.open(SOURCE / file)
        for index, name in enumerate(names):
            row, col = divmod(index, 4)
            save(sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL)), prefix + name, size)
    for file, size in SINGLES.items():
        if fresh(SOURCE / file, Path(file).stem):
            continue
        save(Image.open(SOURCE / file), Path(file).stem, size)


if __name__ == "__main__":
    main()
