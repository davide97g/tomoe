#!/usr/bin/env python3
"""Rerunnable sprite-sheet processor for Copy. Run from project root."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "sources"
FRAMES = ROOT / "frames"
SPRITES = ROOT / "sprites"
CELL = 320
BASELINE = 278
FPS = {"idle": 8, "walk": 10, "think": 8, "success": 10, "error": 8, "sleep": 5, "jump": 12}
EXPECTED = {"idle": 8, "walk": 8, "think": 8, "success": 8, "error": 6, "sleep": 6, "jump": 8}
PALETTE = np.asarray([
    [17, 17, 17], [51, 51, 51], [119, 119, 119], [190, 184, 173],
    [230, 225, 215], [246, 244, 238], [255, 255, 255],
], dtype=np.float32)


def snap_to_palette(rgb: np.ndarray) -> np.ndarray:
    flat = rgb.reshape(-1, 3).astype(np.float32)
    distances = ((flat[:, None, :] - PALETTE[None, :, :]) ** 2).sum(axis=2)
    return PALETTE[np.argmin(distances, axis=1)].reshape(rgb.shape).astype(np.uint8)


def extract_components(path: Path):
    """Key green, then return ordered cat component crops with soft alpha."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    # Sample the four corners because generated sheets drift from exact #00FF00.
    corner = 24
    samples = np.concatenate([
        rgb[:corner, :corner].reshape(-1, 3), rgb[:corner, -corner:].reshape(-1, 3),
        rgb[-corner:, :corner].reshape(-1, 3), rgb[-corner:, -corner:].reshape(-1, 3),
    ])
    green_pixels = samples[samples[:, 1] - np.maximum(samples[:, 0], samples[:, 2]) > 0.22]
    key = np.median(green_pixels, axis=0) if len(green_pixels) else np.array([0.0, 1.0, 0.0])
    key_strength = max(0.1, float(key[1] - max(key[0], key[2])))
    # Neutral cat colors have little green excess; mixed edge pixels reveal key coverage.
    excess = np.maximum(0.0, rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2]))
    alpha = np.clip(1.0 - excess / key_strength, 0.0, 1.0)
    alpha[alpha < 0.025] = 0.0
    labels, count = ndimage.label(alpha > 0.42)
    objects = ndimage.find_objects(labels)
    candidates = []
    for label_id, bounds in enumerate(objects, 1):
        if bounds is None:
            continue
        region = labels[bounds] == label_id
        area = int(region.sum())
        if area < 8000:
            continue
        ys, xs = bounds
        candidates.append((area, xs.start, xs.stop, ys.start, ys.stop))
    candidates.sort(key=lambda item: item[1])
    if not candidates:
        raise ValueError(f"No cat components found in {path}")
    # Decontaminate edge RGB against known green background before premultiplication.
    safe_alpha = np.maximum(alpha, 1e-5)
    foreground = (rgb - (1.0 - alpha[..., None]) * key) / safe_alpha[..., None]
    foreground = np.clip(foreground, 0.0, 1.0)
    foreground[..., 1] = np.minimum(foreground[..., 1], np.maximum(foreground[..., 0], foreground[..., 2]) + 0.015)
    foreground = snap_to_palette(foreground * 255.0).astype(np.float32) / 255.0
    rgba = np.dstack((foreground, alpha))
    crops = []
    for _, x0, x1, y0, y1 in candidates:
        # Small padding preserves disconnected whisker/outline antialias pixels.
        pad = 3
        x0, x1 = max(0, x0 - pad), min(rgb.shape[1], x1 + pad)
        y0, y1 = max(0, y0 - pad), min(rgb.shape[0], y1 + pad)
        crop = np.clip(rgba[y0:y1, x0:x1] * 255.0 + 0.5, 0, 255).astype(np.uint8)
        crops.append(Image.fromarray(crop, "RGBA"))
    return crops


def body_anchor(image: Image.Image) -> float:
    alpha = np.asarray(image.getchannel("A"), dtype=np.float32) / 255.0
    # The densest vertical column lies in the torso; tail motion does not pull anchor.
    density = (alpha > 0.65).sum(axis=0)
    lo, hi = int(len(density) * 0.22), int(len(density) * 0.84)
    return float(np.argmax(density[lo:hi]) + lo)


def main():
    FRAMES.mkdir(exist_ok=True)
    SPRITES.mkdir(exist_ok=True)
    idle_crops = extract_components(SOURCE / "idle.png")
    if len(idle_crops) != EXPECTED["idle"]:
        raise ValueError(f"idle: found {len(idle_crops)} components, expected 8")
    idle_height = float(np.median([im.getbbox()[3] - im.getbbox()[1] for im in idle_crops]))
    scale = 194.0 / idle_height
    manifest = {}

    for name in FPS:
        crops = extract_components(SOURCE / f"{name}.png")
        if len(crops) != EXPECTED[name]:
            raise ValueError(f"{name}: found {len(crops)} components, expected {EXPECTED[name]}")
        ground_y = max(im.getbbox()[3] for im in crops)
        anchors = np.asarray([body_anchor(im) for im in crops], dtype=np.float32)
        # Circular three-sample smoothing removes tiny anchor wobble without flattening motion.
        smooth = np.array([(anchors[(i - 1) % len(anchors)] + 2 * anchors[i] + anchors[(i + 1) % len(anchors)]) / 4 for i in range(len(anchors))])
        out_dir = FRAMES / name
        if out_dir.exists():
            shutil.rmtree(out_dir)
        out_dir.mkdir(parents=True)
        rendered = []
        for i, crop in enumerate(crops):
            bbox = crop.getbbox()
            left, top, right, bottom = bbox
            frame = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            resized = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.LANCZOS)
            resized_array = np.asarray(resized).copy()
            resized_array[..., :3] = snap_to_palette(resized_array[..., :3])
            resized = Image.fromarray(resized_array, "RGBA")
            # Anchor torso center; preserve source vertical offset from each sheet's ground.
            anchor_scaled = (smooth[i] - left) * scale
            x = round(CELL / 2 - anchor_scaled)
            source_bottom = bottom - top
            y = round(BASELINE - (ground_y - bottom) * scale - source_bottom * scale)
            frame.alpha_composite(resized, (x, y))
            path = out_dir / f"{i + 1:02d}.png"
            frame.save(path)
            rendered.append(frame)

        strip = Image.new("RGBA", (CELL * len(rendered), CELL), (0, 0, 0, 0))
        for i, frame in enumerate(rendered):
            strip.alpha_composite(frame, (i * CELL, 0))
        strip.save(SPRITES / f"{name}.png", optimize=True)
        webp_path = SPRITES / f"{name}.webp"
        # This ffmpeg build has animated-WebP decode support but no WebP encoder.
        # Pillow writes lossless animated WebP; ffmpeg decodes it for a real media pass.
        rendered[0].save(
            webp_path,
            format="WEBP",
            save_all=True,
            append_images=rendered[1:],
            duration=round(1000 / FPS[name]),
            loop=0,
            lossless=True,
            method=6,
        )
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(webp_path),
            "-f", "null", "-",
        ], check=True)
        manifest[name] = {"frames": EXPECTED[name], "fps": FPS[name], "cellWidth": CELL, "cellHeight": CELL, "loop": True}

    (SPRITES / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Processed {len(manifest)} animations; idle body height={idle_height:.1f}px; scale={scale:.4f}; cell={CELL}px")


if __name__ == "__main__":
    main()
