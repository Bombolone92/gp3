#!/bin/sh
# One command: The Last Night Train 末班夜车 (Paper-cut Lightbox demo), 51 s, 1920×1080, 30 fps
#   sh demo/build.sh            fonts if missing, voice if missing + speech check, timeline + subtitles, picture, mix, master,
#                               poster and the gallery style frame
#   sh demo/build.sh 25 30      only a span of the film (film seconds) → demo/out/cut_25-30.mp4
# Needs the voice tier (Kokoro model, faster-whisper) and the VSCO 2 CE, VCSL and Salamander sample libraries:
#   sh plugin/skills/lemo-opuscar/scripts/setup.sh deps voice
#   sh tools/fetch.sh instruments vsco2ce; sh tools/fetch.sh instruments vcsl; sh tools/fetch.sh instruments salamander
set -e
HERE=$(cd "$(dirname "$0")" && pwd)                  # .../styles/paper-lantern/demo
FILM=$(cd "$HERE/.." && pwd)                          # .../styles/paper-lantern
LIB=${LIB:-$(cd "$HERE/../../.." && pwd)}             # library root
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the library folder"; exit 1; }
PY="$LIB/.venv/bin/python"; FPS=30; WORKERS=${WORKERS:-2}
cd "$LIB"
"$PY" "$HERE/tools/fonts.py"
if [ ! -f "$HERE/voices/L8.wav" ]; then
  "$PY" core/tts/tts.py "$HERE/voices/lines.json" "$HERE/voices"
  "$PY" core/tts/asr_check.py "$HERE/voices/lines.json" "$HERE/voices" --lang en
fi
python3 "$HERE/tools/timeline.py" "$FILM/paper-lantern.srt"           # → demo/timeline.json and the film's subtitles
if [ -n "$1" ]; then
  A=$1; B=$2; OUT="$HERE/out/cut_${A}-${B}.mp4"
  node core/render/video.mjs "$HERE" --fps $FPS --workers $WORKERS --q "from=$A&to=$B" --out "$HERE/out/cut.mp4"
  "$PY" "$HERE/mix.py" "$A" "$B"
  sh core/render/mux.sh "$HERE/out/cut.mp4" "$HERE/out/mix.wav" "$OUT" $FPS 0
  echo "→ $OUT"; exit 0
fi
node core/render/video.mjs "$HERE" --fps $FPS --workers $WORKERS --out "$HERE/out/video.mp4"
"$PY" "$HERE/mix.py"
sh core/render/mux.sh "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$FILM/paper-lantern.mp4" $FPS 0
# poster and style frame: the train on the curved viaduct over the snowy valley, no subtitles
node core/render/still.mjs "$HERE" 9.6 --q "nosub=1" --out "$HERE/out/stills"
ffmpeg -loglevel error -y -i "$HERE/out/stills/t_9.6.jpg" -q:v 3 "$FILM/poster.jpg"
ffmpeg -loglevel error -y -i "$HERE/out/stills/t_9.6.jpg" -vf scale=1280:-2 -q:v 4 "$HERE/stills/styleframe.jpg"
"$PY" "$HERE/tools/subcheck.py" "$FILM/paper-lantern.mp4" | tail -1
echo "→ $FILM/paper-lantern.mp4  $FILM/paper-lantern.srt  $FILM/poster.jpg"
