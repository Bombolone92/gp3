# iCam365 / Wosee PTZ Camera — Local Control & Reverse Engineering

Full local control for a cheap pan-tilt Wi-Fi camera from the Closeli / Tange365 family
(iCam365, Wosee, Tange apps). No cloud, no vendor app, no vendor server: the camera runs
its own RTSP server, its own PTZ/light HTTP API, persistent root access, and integrates
into Frigate + Home Assistant with NAS recording.

**Tested platform**: Ts300/QV SoC, ARMv7, Linux 4.14.249 (no IPv6), firmware `aj_ipc_qv_004`,
jffs2 layout (`/home`, `/bak`), SD card mounted at `/tmp/mnt/mmc01/0` (vfat).

**Same-family devices (community-confirmed)**: Jalecom AJ HC1703L and most cheap "AI
tracking" PTZ cams sold under iCam365/Wosee/other names on the 2.4GHz-only tier.

---

## What's inside

| Path | What it is |
| --- | --- |
| `docs/reverse-engineering.md` | The full protocol RE record: cloud (PPPP) protocol, command tables, local-mode unlock, root route, and the 4PDA community findings |
| `docs/onboarding-sop.md` | Step-by-step SOP for onboarding a new same-family camera (diagnostic SD card → backup → root → local mode → RTSP → control service → Frigate/HA) |
| `docs/device-notes.md` | Example per-device parameter sheet |
| `sdk/` | Python SDK for the PPPP (cloud P2P) path: session handling, HEVC framer, A-law decoder, PTZ/light command sender — useful for protocol research and debugging |
| `console/` | Minimal local web console (MJPEG + audio + PTZ/light), the earlier stage of the journey; superseded in production by `control/` + Frigate |
| `control/` | `tangecam-control`: ARMv7 static HTTP service running **inside the camera** (`GET /health`, `POST /ptz`, `POST /light`) with a supervisor script; the payload is small enough (~87KB) to be **flashed into `/bak`**, so PTZ/light keep working with no SD card |
| `frigate/` | Frigate 0.17.2 config template (go2rtc one-connection-per-stream rule, HEVC passthrough, PCMA→AAC) |
| `home-assistant/` | HA rest commands + camera dashboard (Advanced Camera Card) |
| `scripts/` | Deployment / verification scripts |
| `devices/` | Per-device parameter template |

---

## Milestones (2026-08-21 → 22)

1. **Cloud protocol reverse engineered** (pcap + crypto analysis): directory servers (UDP 32100), P2P hole punching, `cs2pppp` direct session, DRW start sequence → unencrypted HEVC video + A-law audio, PTZ (`0x1001`) and light (`0x8014`) commands.
2. **Root via SD card hook**: firmware executes `debug_cmd.sh` from SD root as root before `p2pcam` starts → diagnostic telnet on 2323 → full flash backup (5 MTD partitions, 8.4MB) → persistent Dropbear SSH.
3. **Local mode unlock**: zero-length `/home/eye.conf` + reboot makes the firmware skip cloud registration and serve **native RTSP on port 8001** — no cloud, no PPPP.
4. **PTZ via `/dev/ptz` ioctl** (`ptz_test`), wrapped in a move-and-stop (jog) script after the camera twice rotated to its mechanical limit.
5. **On-camera HTTP control service** (`tangecam-control`), supervised, flashed into `/bak`, so SD card is optional.
6. **Production stack**: Frigate 0.17.2 + go2rtc + Home Assistant + NAS recording (HEVC passthrough, PCMA→AAC). Detected at ~5 fps, CPU inference ~18 ms. Verified: full power-off recovery without the SD card.

---

## Key findings

### Cloud protocol (PPPP), for reference

- Directory servers: UDP **32100** × 3; `P2P_REQ` / `PUNCH_TO` / `PunchPkt` → `P2P_RDY`, then a `cs2pppp` **direct** session.
- DID format: `CNAD-XXXXXXXX-XXXXXX`.
- Session start: DRW sequence replay → camera pushes ch1 audio (A-law 8 kHz, 16-byte header + 320-byte frames) and ch2 video (HEVC, 8-byte outer frame header — **strip it** and ffmpeg decodes).
- Commands: PTZ = `0x1001` + control (2/3/6/8 tested); light = `0x8014` mode 0=IR / 1=full-color / 2=smart.
- Pitfalls: session key refreshes on server side; missing `0x8024` frame makes the device close the stream; **send STOP before closing or the camera hangs**; `-90002` ≈ ALIVE heartbeat timeout (15 s).

### Local mode (the important one)

- Create empty `/home/eye.conf` (0 bytes) and reboot → firmware's `is_rtsp_enabled` check passes (port 554 stays closed without the "cloud-registered" flag, but 8001 is easy) → camera serves:
  - `rtsp://admin:@CAMERA_IP:8001/0/av0` — HEVC 1920x1080 @12.5 fps + PCMA 8 kHz mono
  - `rtsp://admin:@CAMERA_IP:8001/0/av1` — HEVC 640x360
  - Light CGI: `http://CAMERA_IP:8001/whitelight?mode=off|on|2`
- Revert to cloud mode: `rm /home/eye.conf` + reboot. The mode flag lives in internal jffs2, survives power loss.
- **Always force TCP** for RTSP: the UDP path drops blocks on weak Wi-Fi → HEVC P-frame loss → green/pink artifacts.

### Root & persistence

- `debug_cmd.sh` on SD card root is executed by firmware as root before `p2pcam` → open 2323 (busybox telnetd). Use it to dump `/proc/mtd` and back up everything.
- Persistent SSH: static armv7 Dropbear on the SD card + a hook appended to `/bak/custom_init.sh` (wait for mmc → `mount -o remount,rw /bak` → bind `/bak/root` over `/root` → `dropbear -p 0.0.0.0:2222`).
- Dropbear + keys (~5.7 MB) do **not** fit in `/bak` (~392 KB free on mtdblock4) — SSH requires the SD card. The small control payload (~87 KB) **does** fit and is flashed there.
- Firmware updates rewrite `/bak` — keep a copy of `custom_init.sh` per device.

### PTZ

- `/bin/ptz_test` menu drives `/dev/ptz` ioctl: 1=left 2=right 3=up 4=down 5-8=diagonals, 9/a=zoom, e=cruise, f=scan, g=speed, p=pos, r=reset.
- The ioctl motions are **continuous** — always send an explicit stop. `ptz.sh` does a jog (motion, 1 s, stop) by default. The camera previously rotated to its mechanical limit twice.

---

## Onboarding a new camera (TL;DR)

1. Onboard with the vendor app (2.4 GHz only; QR scan or `AICAM_xxxx` AP fallback) — **required**, there is no alternative path. Enable App-only features (human/face auto-tracking) in the app once; the setting persists on-device afterwards.
2. Make a diagnostic SD card with `debug_cmd.sh` → telnet 2323 → back up flash.
3. Local mode: empty `/home/eye.conf` + reboot → RTSP on 8001.
4. Flash `tangecam-control` into `/bak`, append the control snippet to `/bak/custom_init.sh` (SSH stays on the SD card).
5. Point Frigate (go2rtc) at the RTSP URLs, mount NAS recording storage, add HA integration + dashboard.

Full details: `docs/onboarding-sop.md`.

---

## Caveats / not covered

- Two-way audio: the A-law uplink protocol is at least partially understood, but no backchannel adapter exists for go2rtc/Frigate.
- ONVIF: not present — Frigate-native PTZ, presets, and auto-tracking would need an ONVIF front-end. PTZ is controlled via HTTP (HA rest commands) instead.
- RTSP credentials are `admin` with an empty password; keep the camera on a trusted LAN.
- This repo contains the findings and our own tooling. The vendor's proprietary `libPPCS_API.so` is **not** included.
