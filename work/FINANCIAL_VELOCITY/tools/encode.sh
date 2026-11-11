#!/usr/bin/env bash
# Encode rendered frames + synthesized soundtrack into the final MP4.
# Usage: tools/encode.sh <frames_dir> <out.mp4>
set -euo pipefail
FRAMES="${1:?frames dir}"
OUT="${2:?output mp4}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "$ROOT/tools/sound.py" "$ROOT/output/soundtrack.wav"
ffmpeg -y -loglevel warning -stats \
  -framerate 60 -i "$FRAMES/frame_%05d.jpg" \
  -i "$ROOT/output/soundtrack.wav" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 14 -profile:v high -level 5.2 -pix_fmt yuv420p \
  -x264-params "keyint=60:min-keyint=60:aq-mode=3" \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a 320k -ar 48000 \
  -frames:v 900 -t 15 -movflags +faststart \
  "$OUT"
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames -of compact "$OUT"
