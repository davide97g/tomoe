# Copy, the mascot

Copy is the cat that lives in the web app (`apps/web/src/components/mascot.tsx`). It is drawn in the
monochrome style of the redesign: a round white body, black ears and patches, a black tail tip, and a
square black "page" patch over one eye. `copy-sheet.png` is the model sheet.

The app plays frame-by-frame sprite grids from `apps/web/public/mascot/` (one `.webp` per animation,
plus `manifest.json`). They are built from two sets of sources:

| Animation | From | Frames | fps | Loop |
| --------- | ---- | ------ | --- | ---- |
| idle      | v2   | 72     | 24  | yes  |
| think     | v2   | 48     | 24  | yes  |
| success   | v2   | 29     | 24  | no   |
| sleep     | v2   | 96     | 24  | yes  |
| jump      | v2   | 29     | 24  | no   |
| walk      | v1   | 8      | 10  | yes  |
| error     | v1   | 7      | 6   | no   |

- **v1**: `v1/sources/` holds one image-generated green-screen sheet per animation (each frame drawn
  separately, so the poses are more expressive). `v1/tools/process.py` keys out the green and splits
  the frames.
- **v2**: `v2/sources/` holds two image-generated poses: standing and curled up asleep.
  `v2/tools/rig.py` animates them with eased transforms (breathing, hops, tilts) and face overlays,
  then bakes the frames into `v2/frames/`. The output is ignored by git and rebuilt on demand.
- `tools/pack.py` puts both on one scale and one ground line. It anchors each frame on the head, so
  walk does not jitter, drops v1's off-model error frame and orders the error frames. Then it writes
  the grids and the manifest into `apps/web/public/mascot/`.

The images were generated with Codex image generation. The prompts are in `prompts/`.

## Rebuild

```sh
cd design/mascot
uv run --with pillow --with numpy --with scipy python tools/pack.py
```

`ffmpeg` is needed only by the v2 bake, which checks its animated WebP files. To change which version
an animation comes from, its frame rate, or the frame order, edit `PLAN` and `SEQUENCE` in
`tools/pack.py`.
