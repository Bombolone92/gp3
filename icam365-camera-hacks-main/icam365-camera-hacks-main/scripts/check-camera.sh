#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
    printf 'Usage: %s CAMERA_IP [RTSP_USER] [RTSP_PASSWORD]\n' "$0" >&2
    exit 2
fi

camera_ip=$1
rtsp_user=${2:-admin}
rtsp_password=${3:-}
base="rtsp://${rtsp_user}:${rtsp_password}@${camera_ip}:8001"

printf '%s\n' '== network =='
ping -c 2 -W 1 "$camera_ip"

printf '%s\n' '== ports =='
for port in 8001 2222; do
    if timeout 2 bash -c "</dev/tcp/${camera_ip}/${port}" 2>/dev/null; then
        printf '%s open\n' "$port"
    else
        printf '%s closed\n' "$port"
    fi
done

for stream in av0 av1; do
    printf '== %s ==\n' "$stream"
    ffprobe -v error -rtsp_transport tcp \
        -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
        -of json "${base}/0/${stream}"
done

printf '%s\n' '== CGI =='
curl -fsS --max-time 5 "http://${camera_ip}:8001/whitelight?mode=2"
printf '\n'
