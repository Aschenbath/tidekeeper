#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
FFMPEG="${TIDEKEEPER_FFMPEG:-/d/WeFlow/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe}"
[[ -x "$FFMPEG" ]] || { echo "Missing ffmpeg: $FFMPEG" >&2; exit 1; }
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync('capture-manifest.json', 'utf8'));
for (const name of ['cards', 'flow', 'aground', 'crossing', 'map', 'finale', 'daily']) {
  if (!report.stages[name]?.complete) throw Error(`Capture stage incomplete: ${name}. Rerun trailer.mjs --only=${name}`);
}
NODE
# Bounded timeline, silent. Source files are raw emulator footage or local palette cards.
files=(card-title.png card-place.png 01-pinch-carry.webm 02-first-delivery.webm card-preview.png 03-scrub-tide-ring.webm 04-tide-aground-preview.png card-launch.png 04-launch-matches-preview.webm 05-crossing-collision-ghosts.png card-campaign.png 06-archipelago-map.png 05-m09-finale.webm 07-lighthouse-finale.png card-daily.png 06-daily-tide.webm 08-daily-tide-streak.png card-accessibility.png card-closing.png)
times=(7 6 8 8 6 9 4 6 8 5 6 6 14 4 6 12 4 10 13)
for file in "${files[@]}"; do [[ -s "$file" ]] || { echo "Missing capture: $file" >&2; exit 1; }; done
total=0
for seconds in "${times[@]}"; do total=$((total + seconds)); done
((total >= 90 && total <= 150 && total < 180)) || { echo "Invalid runtime: $total" >&2; exit 1; }
mkdir -p .assemble-work
trap 'rm -f -- .assemble-work/segment-*.mp4 .assemble-work/concat.txt; rmdir .assemble-work 2>/dev/null || true' EXIT
: > .assemble-work/concat.txt
for i in "${!files[@]}"; do
  printf -v part 'segment-%02d.mp4' "$i"
  input=()
  if [[ ${files[$i]} == *.png ]]; then input=(-loop 1 -framerate 30); fi
  crop=''
  if [[ ${files[$i]} == 03-scrub-tide-ring.webm ]]; then crop='crop=832:468:608:580,'; fi
  "$FFMPEG" -hide_banner -loglevel error -nostdin -y "${input[@]}" -i "${files[$i]}" \
    -vf "${crop}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=20" \
    -t "${times[$i]}" -an -c:v libx264 -threads 2 -preset medium -crf 18 -pix_fmt yuv420p \
    -video_track_timescale 30000 ".assemble-work/$part"
  printf "file '%s'\n" "$part" >> .assemble-work/concat.txt
  printf 'Encoded %s (%s s)\n' "${files[$i]}" "${times[$i]}"
done
"$FFMPEG" -hide_banner -loglevel error -nostdin -y -f concat -safe 0 -i .assemble-work/concat.txt \
  -c copy -an -movflags +faststart tidekeeper-video.partial.mp4
"$FFMPEG" -hide_banner -loglevel error -nostdin -i tidekeeper-video.partial.mp4 -f null -
mv -f -- tidekeeper-video.partial.mp4 tidekeeper-video.mp4
printf 'SAVED tidekeeper-video.mp4 — %s seconds, 1920x1080, H.264, silent\n' "$total"
