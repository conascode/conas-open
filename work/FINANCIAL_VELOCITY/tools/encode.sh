#!/usr/bin/env bash
# Encode rendered frames + synthesized soundtrack.
#   master   : x264 CRF 14 (archival quality, ~450 MB, not committed)
#   delivery : x264 2-pass 44 Mb/s (4K60, < 100 MB so it fits in the repository)
# Usage: tools/encode.sh <frames_dir>
set -euo pipefail
FRAMES="${1:?frames dir}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/output"
python3 "$ROOT/tools/sound.py" "$OUT/soundtrack.wav"
COMMON=(-framerate 60 -i "$FRAMES/frame_%05d.jpg" -i "$OUT/soundtrack.wav" -map 0:v -map 1:a -frames:v 900 -t 15
  -pix_fmt yuv420p -profile:v high -level 5.2 -color_primaries bt709 -color_trc bt709 -colorspace bt709
  -c:a aac -b:a 320k -ar 48000 -movflags +faststart)

ffmpeg -y -loglevel warning -stats "${COMMON[@]}" -c:v libx264 -preset slow -crf 14 \
  -x264-params "keyint=60:min-keyint=60:aq-mode=3" "$OUT/CONAS_FINANCIAL_VELOCITY_4K60_master.mp4"

cd "$OUT"
ffmpeg -y -loglevel warning -framerate 60 -i "$FRAMES/frame_%05d.jpg" -frames:v 900 -pix_fmt yuv420p -c:v libx264 -preset slow \
  -b:v 44M -maxrate 60M -bufsize 88M -pass 1 -passlogfile x264pass -x264-params "keyint=60:min-keyint=60:aq-mode=3" -an -f null /dev/null
ffmpeg -y -loglevel warning -stats "${COMMON[@]}" -c:v libx264 -preset slow -b:v 44M -maxrate 60M -bufsize 88M \
  -pass 2 -passlogfile x264pass -x264-params "keyint=60:min-keyint=60:aq-mode=3" "$OUT/CONAS_FINANCIAL_VELOCITY_4K60.mp4"
rm -f x264pass*

for f in "$OUT"/CONAS_FINANCIAL_VELOCITY_4K60*.mp4; do
  echo "$(basename "$f")"
  ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,profile,width,height,r_frame_rate,nb_frames -of compact "$f"
done
