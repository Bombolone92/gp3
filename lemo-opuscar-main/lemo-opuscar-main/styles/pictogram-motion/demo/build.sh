#!/bin/sh
# One command: LEFT BEHIND 被落下的伞 (Pictogram Motion demo), 50 s, 1920×1080, 24 fps
#   sh demo/build.sh            fonts if missing, voice if missing + speech check, captions, events, picture, mix, master,
#                               subtitles, readcheck, poster and the gallery style frame
#   VOICE=1 sh demo/build.sh    regenerate the narration before the check
#   WORKERS=3 sh demo/build.sh  more render workers (default 2)
#   sh demo/build.sh 28 36      only a span of the film (film seconds) → demo/out/film-28-36.mp4
# Needs the voice tier (Kokoro model, faster-whisper) and the VCSL, VSCO 2 CE and FreePats sample libraries:
#   sh plugin/skills/lemo-opuscar/scripts/setup.sh deps voice
#   sh tools/fetch.sh instruments vcsl; sh tools/fetch.sh instruments vsco2ce; sh tools/fetch.sh instruments freepats
set -e
HERE=$(cd "$(dirname "$0")" && pwd)                  # .../styles/pictogram-motion/demo
FILM=$(cd "$HERE/.." && pwd)                          # .../styles/pictogram-motion
LIB=${LIB:-$(cd "$HERE/../../.." && pwd)}             # library root
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the library folder"; exit 1; }
PY=${PY:-"$LIB/.venv/bin/python"}
NAME=pictogram-motion
WORKERS=${WORKERS:-2}
A=${1:-0}; B=${2:-50}
cd "$LIB"
mkdir -p "$HERE/out/voice" "$HERE/stills"
sh "$HERE/tools/fetch_fonts.sh"

# narration: Kokoro bf_emma, one clip per line; every clip must pass the speech-to-text check
if [ "${VOICE:-0}" = "1" ] || [ ! -f "$HERE/out/voice/L8.wav" ]; then
  "$PY" core/tts/tts.py "$HERE/voice/lines.json" "$HERE/out/voice"
fi
"$PY" core/tts/asr_check.py "$HERE/voice/lines.json" "$HERE/out/voice" --lang en

if [ "$A" != 0 ] || [ "$B" != 50 ]; then                                     # a span, for checking a part of the film
  "$PY" "$HERE/tools/cues.py" "$A" "$B" "$HERE/out/film-$A-$B.srt"
  node core/render/events.mjs "$HERE" --q "a=0&b=50"
  node core/render/video.mjs "$HERE" --q "a=$A&b=$B" --fps 24 --workers "$WORKERS" --out "$HERE/out/video-$A-$B.mp4"
  "$PY" "$HERE/mix.py" "$A" "$B"
  sh core/render/mux.sh "$HERE/out/video-$A-$B.mp4" "$HERE/out/mix.wav" "$HERE/out/film-$A-$B.mp4" 24 0
  echo "done: $HERE/out/film-$A-$B.mp4"; exit 0
fi

"$PY" "$HERE/tools/cues.py"                                                  # voice/cues.js + ../pictogram-motion.srt
node core/render/events.mjs "$HERE"                                           # → events.json (film times)
node core/render/video.mjs "$HERE" --fps 24 --workers "$WORKERS" --out "$HERE/out/video.mp4"
"$PY" "$HERE/mix.py"                                                         # → out/mix.wav
sh core/render/mux.sh "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$FILM/$NAME.mp4" 24 0

# checks, poster and the gallery style frame (the title card, without captions)
node core/render/readcheck.mjs "$HERE" --step 0.1 > "$HERE/out/readcheck.txt" && echo "readcheck ok" || { grep -v '^OK' "$HERE/out/readcheck.txt" | tail -8; echo "readcheck: see DEMO.md for the known entries"; }
node core/render/still.mjs "$HERE" 9.2 --q nocap=1 --out "$HERE/out/poster" > /dev/null
ffmpeg -v error -y -i "$HERE/out/poster/t_9.2.jpg" -q:v 3 "$FILM/poster.jpg"
cp "$FILM/poster.jpg" "$HERE/stills/styleframe.jpg"
echo "done: $FILM/$NAME.mp4"
