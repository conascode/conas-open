# CONAS — FINANCIAL VELOCITY

15-second cinematic brand film for CONAS: a flight through a three-dimensional financial data universe that ends in the CONAS wordmark.

| | |
|---|---|
| Final film | `output/CONAS_FINANCIAL_VELOCITY_4K60.mp4` (82.5 MB) |
| Duration | 15.000 s (900 frames) |
| Resolution / rate | 3840 × 2160 (16:9), 60 fps |
| Video | H.264 High @ L5.2, two-pass 44 Mb/s, yuv420p, BT.709 |
| Audio | AAC 320 kbps, 48 kHz stereo, fully synthesized; −18.8 LUFS integrated, peak −1 dBFS |
| Master | `output/CONAS_FINANCIAL_VELOCITY_4K60_master.mp4`, CRF 14 (855 MB): produced by `tools/encode.sh`, not committed because GitHub limits files to 100 MB |

## Sequence

| Time | Scene | What happens |
|---|---|---|
| 00:00–03:00 | 01 The Data Universe | Already at speed. ~42 live financial panels, ~170 floating numbers, Korean/English micro-type, 3D candlestick formations, line charts, histograms, wireframe cubes, metal frames and rings, red/white light trails, coordinate grids. Extruded **2026 · 98.42 · +12.8% · 145.82** fly past the lens, partly cropped. Ends at a massive octagonal gate with counter-rotating rings. |
| 03:00–06:00 | 02 The Velocity Tunnel | 19 ring stations (outer ring with mechanical teeth, inner arc lights, tilted interlocking rings, 45° square frames, rectangular data frames) on 8 static longitudinal rails, wall-mounted panels, candlestick clusters, 110 numbers, 12 suspended Korean words and extruded 3D **자본 · 혁신 · 연결 · 미래**. The camera accelerates and rolls ~55°; every element rotates at its own speed. |
| 06:00–09:00 | 03 Financial Collision | Burst of ~280 objects (panels, numbers, Hangul jamo ㅈ ㅏ ㅂ ㅗ ㄴ…, 3D words and numbers, cubes, prisms, charts) plus 1,400 fragments. Hard cuts at 6.75 / 7.45 / 8.2 s: braking exit → lateral track → macro typography → wide shot. |
| 09:00–12:00 | 04 The Convergence | Sudden calm. Nine toothed rings contract and spin up, panels orbit and turn to the centre, fragments spiral inward, red/white spiral trails draw around the core, then a rapid push-in. |
| 12:00–15:00 | 05 CONAS Reveal | White flash; the five extruded metallic letters arrive from different directions, rotate, decelerate and lock (staggered 75 ms). Red streak travels behind the wordmark, a red hairline draws, then **BEYOND THE CONVENTIONAL** / **GLOBAL HOLDING GROUP**. Everything settles by 13.95 s: **1.05 s clean hold**. |

## How it is made

```
index.html            film page (fonts via @font-face)
src/film.js           world, choreography, camera, post-processing, frame-accurate renderFrame(t)
src/textures.js       canvas-drawn panels (12 kinds), text, grids, streaks — all text uses Pretendard
src/glyphs.json       real glyph outlines from Pretendard Black for extruded 3D type
lib/vendor.js         three.js r170 + post-processing modules (bundled)
fonts/                Pretendard Black / ExtraBold / SemiBold / Medium (woff2) + Black.otf
tools/build-glyphs.mjs  extracts glyph outlines from the OTF (opentype.js)
tools/render.cjs      headless frame renderer (Playwright + Chromium), resumable, splittable across workers
tools/sound.py        sound design synthesizer (numpy + scipy)
tools/encode.sh       frames + soundtrack → MP4 (FFmpeg)
tools/stills.cjs      quick still frames for review
```

**Deterministic rendering.** Every frame is a pure function of time: `FILM.renderFrame(t)` sets all object transforms, camera, lights and grading for `t` and renders. Nothing depends on wall-clock time, so frames can be rendered in any order, by several workers, and re-rendered identically. This is a real offline render, not a screen recording of a web page.

**Camera.** A choreographed virtual camera: continuous high-speed dolly (scene 1), accelerating tunnel penetration with orbit and roll (scene 2), four hard-cut shots (braking exit, lateral track, macro at 38° FOV, 78° wide) in scene 3, slow drift then exponential push-in (scene 4), deceleration and lock for the reveal. Deterministic camera shake scales with speed.

**Typography.** All text is rendered from actual font files, never generated: flat text through the Canvas 2D API with Pretendard loaded by `@font-face` (verified with `document.fonts.check` before rendering), 3D type as `ExtrudeGeometry` built from Pretendard Black glyph outlines (`tools/build-glyphs.mjs`, which fails if a glyph is missing). Logo letters are spaced by their actual outlines and share one baseline.

**Look.** ACES filmic tone mapping, PMREM room environment for metal reflections, key directional light + red rim light + camera-following red point lights, exponential fog for depth, restrained bloom (strength 0.34, threshold 0.9), vignette, speed-dependent chromatic aberration, fine grain. Palette #050505 / #F5F5F5 / #E5242B with silver and charcoal.

**Motion blur and anti-aliasing.** Each output frame averages 2–4 sub-frames (4 in the tunnel, where the camera is fastest) spread over a 180° shutter (1/120 s). Sub-frames never cross a hard cut. Each sub-frame also gets a sub-pixel (Halton) camera jitter, so the same accumulation anti-aliases the image.

**Object counts** (from `FILM.stats()`): ~1,600 meshes, ~5,100 instanced elements (ring teeth, candlesticks, histogram bars), ~770 text planes, ~220 line objects, 6,600 particles; ~110 data panels (42 in the universe, 38 in the tunnel, 36 in the swarm, 14 in the core); ~35 rings; ~25 floating chart objects; 15+ large 3D type objects.

## Sound design (`tools/sound.py`)

Synthesized from scratch, synchronized to the same timeline (the script reproduces the camera path to time each pass):

- sub drone and air bed that brighten with speed; high-frequency data clicks and stepped data-transmission tones
- fly-by whooshes timed to the four giant numbers passing the lens
- mechanical acceleration riser into the tunnel and an entrance hit at 3.0 s
- one metallic swish per tunnel ring passing the camera (tempo accelerates with the camera)
- collision: a heavy impact at 6.0 s plus synchronized impacts on each cut (6.75 / 7.45 / 8.2 s) and metallic debris
- convergence: sudden calm at 9.0 s, rising detuned saw tone, accelerating ratchet, sub-bass pulses, push-in riser, a short breath of silence before the flash
- logo: one clean low impact with a bright shimmer at 12.0 s, soft lock ticks as the letters seat, a quiet streak swoosh, then a smooth decay to silence by 15.0 s
- master: convolution reverb, high-pass, soft bus compression, peak normalized to −1 dBFS

## Assets and fonts

| Asset | Source | Licence |
|---|---|---|
| Pretendard Black, ExtraBold, SemiBold, Medium (woff2) and Black (otf) | `pretendard` npm package 1.3.9 (orioncactus/pretendard) | SIL Open Font License 1.1 |
| three.js r170 (+ EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, RoomEnvironment) | npm `three@0.170.0`, bundled into `lib/vendor.js` | MIT |
| opentype.js 1.3.4 | npm, build-time only (`tools/build-glyphs.mjs`) | MIT |
| All panels, charts, numbers, textures, geometry | generated procedurally in `src/` | — |
| All audio | synthesized in `tools/sound.py` | — |

No stock footage, images or audio samples are used.

## Render configuration

| Setting | Value |
|---|---|
| Renderer | three.js WebGL 2 in headless Chromium (Playwright), ANGLE + SwiftShader (CPU) |
| Resolution | 3840 × 2160, pixel ratio 1 |
| Frames | 900 at 60 fps (t = frame / 60) |
| Samples per frame | 2 (3 between 3.0 and 6.8 s), 180° shutter, Halton sub-pixel jitter |
| MSAA | off (replaced by jittered accumulation) |
| Frame capture | JPEG quality 95 (intermediate) |
| Workers | 3 in parallel (`--from k --step 3`) |
| Samples per frame (final) | 4 in the tunnel (3.0–6.8 s); 3 in scene 1, the collision, the push-in and the letter flight; 2 elsewhere |
| Render time | ≈ 60 min for 900 frames (3 workers, ~12 s per frame each, CPU-only SwiftShader) |
| Encode | `tools/encode.sh`: master x264 CRF 14; delivery x264 two-pass 44 Mb/s (max 60), preset slow, High@5.2, yuv420p, BT.709, GOP 60, faststart; AAC 320k 48 kHz |

### Reproduce

```bash
cd work/FINANCIAL_VELOCITY
python3 -m http.server 8790 &
node tools/render.cjs --out frames --w 3840 --h 2160 --blur 2 --from 0 --step 3 &
node tools/render.cjs --out frames --w 3840 --h 2160 --blur 2 --from 1 --step 3 &
node tools/render.cjs --out frames --w 3840 --h 2160 --blur 2 --from 2 --step 3 &
wait
tools/encode.sh frames
```

Real-time preview in a browser: `http://localhost:8790/?preview=1&w=1280&h=720` (lower resolution recommended).

## Quality control (final render)

| Check | Result |
|---|---|
| Duration | 15.000 s, exactly 900 frames at 60 fps |
| Wordmark | reads CONAS; extruded from the Pretendard Black glyphs, outline-spaced, shared baseline |
| Korean text | rendered from the Pretendard font files; `document.fonts.check` gates rendering; glyph extraction fails on any missing glyph |
| Missing fonts | none (all four weights load before the first frame) |
| Density / camera / tunnel / data variety | see sequence and object counts above; reviewed on contact sheets of every scene |
| Logo hold | everything settles by 13.95 s; 1.05 s clean hold, no other objects |
| Playback | full decode with FFmpeg reports no errors |

Bug found and fixed during QC: the first 4K render came out at half brightness with no motion blur, because the accumulation buffer was auto-cleared before every sub-frame. It was fixed and the film was fully re-rendered.
