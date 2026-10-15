"""Pack Copy's app sprites from v2 (smooth rig) and v1 (expressive frames), on one scale and ground.

Usage (from design/mascot): python tools/pack.py [out_dir]   (default: apps/web/public/mascot)
Bakes v2/frames with v2/tools/rig.py first when they are missing.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if not (ROOT / "v2" / "frames").exists():
    subprocess.run([sys.executable, str(ROOT / "v2" / "tools" / "rig.py")], cwd=ROOT, check=True)
sys.path.insert(0, str(ROOT / "v1" / "tools"))
import process as v1  # noqa: E402

v1.SOURCE = ROOT / "v1" / "sources"

SRC = 320          # v2 cell
GROUND = 306       # v2 ground line in a 320 cell
OUT_CELL = 240     # app cell (crisp up to 120 css px at 2x)
COLUMNS = 12

# name -> (version, fps, loop, frames to drop (1-based, v1 only))
PLAN = {
    "idle": ("v2", 24, True, []),
    "think": ("v2", 24, True, []),
    "success": ("v2", 24, False, []),
    "sleep": ("v2", 24, True, []),
    "jump": ("v2", 24, False, []),
    "walk": ("v1", 10, True, []),
    "error": ("v1", 6, False, [4]),  # frame 4 is off-model (patch and ears moved)
}

# Frame order after drops (0-based): error holds the ears-back look, then recovers.
SEQUENCE = {"error": [0, 1, 2, 2, 2, 3, 4]}


def v2_frames(name):
    return [Image.open(p).convert("RGBA") for p in sorted((ROOT / "v2" / "frames" / name).glob("*.png"))]


def head_x(im):
    """x of the alpha centroid of the top 55% of the cat (head and ears): the tail and legs do not move it."""
    l, t, r, b = im.getbbox()
    a = np.asarray(im.getchannel("A"), dtype=np.float32)[t : t + round((b - t) * 0.55), l:r]
    return float((a.sum(axis=0) * np.arange(r - l)).sum() / a.sum()) + l


IDLE = v2_frames("idle")
IDLE_H = float(np.median([im.getbbox()[3] - im.getbbox()[1] for im in IDLE]))
IDLE_X = float(np.median([head_x(im) for im in IDLE]))


def v1_frames(name, drop):
    crops = [c for i, c in enumerate(v1.extract_components(v1.SOURCE / f"{name}.png"), 1) if i not in drop]
    heights = [c.getbbox()[3] - c.getbbox()[1] for c in crops]
    scale = IDLE_H / float(np.median(heights))
    anchors = np.asarray([head_x(c) for c in crops], dtype=np.float32)
    n = len(anchors)
    smooth = [(anchors[(i - 1) % n] + 2 * anchors[i] + anchors[(i + 1) % n]) / 4 for i in range(n)]
    out = []
    for c, a in zip(crops, smooth):
        l, t, r, b = c.getbbox()
        c = c.crop((l, t, r, b))
        c = c.resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.Resampling.LANCZOS)
        frame = Image.new("RGBA", (SRC, SRC), (0, 0, 0, 0))
        frame.alpha_composite(c, (round(IDLE_X - (a - l) * scale), GROUND - c.height))
        out.append(frame)
    return out, scale


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parents[1] / "apps" / "web" / "public" / "mascot"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, (ver, fps, loop, drop) in PLAN.items():
        frames, scale = (v2_frames(name), 1.0) if ver == "v2" else v1_frames(name, drop)
        if name in SEQUENCE:
            frames = [frames[i] for i in SEQUENCE[name]]
        for i, f in enumerate(frames):
            l, t, r, b = f.getbbox()
            if l <= 0 or t <= 0 or r >= SRC or b > SRC:
                raise SystemExit(f"{name} frame {i + 1} touches the cell border: {f.getbbox()}")
        cols = min(COLUMNS, len(frames))
        rows = -(-len(frames) // cols)
        sheet = Image.new("RGBA", (cols * OUT_CELL, rows * OUT_CELL), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            sheet.alpha_composite(f.resize((OUT_CELL, OUT_CELL), Image.Resampling.LANCZOS), ((i % cols) * OUT_CELL, (i // cols) * OUT_CELL))
        sheet.save(out_dir / f"{name}.webp", format="WEBP", quality=90, alpha_quality=100, method=6)
        manifest[name] = {"frames": len(frames), "fps": fps, "cellWidth": OUT_CELL, "cellHeight": OUT_CELL, "columns": cols, "loop": loop}
        heights = [f.getbbox()[3] - f.getbbox()[1] for f in frames]
        print(f"{name:8} {ver} frames={len(frames):3} scale={scale:.3f} height median={np.median(heights):.0f} (idle {IDLE_H:.0f})")
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
