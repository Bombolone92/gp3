#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""iCam365 (TAS-Tech 系) 摄像头本地网页控制台 — 基于本地 RTSP 取流。

后端: 两条独立 ffmpeg 进程拉 rtsp://admin:@CAMERA_IP:8001/0/av0
      视频: HEVC 1920x1080@13fps -> MJPEG (默认 1280 宽) -> multipart /video
      音频: pcm_alaw 8kHz -> s16le 8kHz -> WebSocket /ws
控制: PTZ 走 SSH root@CAMERA_IP:2222 的 ptz.sh (全向点动, 动作后自动停)
      灯光走 8001 CGI whitelight?mode=off|on|2
HTTP: GET /  /video  /snapshot  /status  /ws, POST /ptz  /lights
运行: uv run console.py [--port 8765] [--width 1280]
"""

import argparse
import asyncio
import subprocess
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path

from aiohttp import web

RTSP_URL = "rtsp://admin:@CAMERA_IP:8001/0/av0"
CAM_HTTP = "http://CAMERA_IP:8001"
CAM_SSH = [
    "ssh", "-i", str(Path.home() / ".ssh" / "id_ed25519"),
    "-p", "2222",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=4",
    "-o", "LogLevel=ERROR",
    "root@CAMERA_IP",
]
CAM_PTZ_SH = "/tmp/mnt/mmc01/0/tangecam/ptz.sh"

HERE = Path(__file__).resolve().parent

HTTP_HOST = "0.0.0.0"
HTTP_PORT = 8765

VIDEO_STALL = 6.0      # 视频无帧超过该秒数 -> 重启进程
AUDIO_STALL = 4.0      # 音频无数据超过该秒数 -> 重启进程
RESTART_SLEEP = 1.5    # 进程退出后重启前的间隔


class CamEngine:
    """基于本地 RTSP 的取流引擎: 视频/音频各自守护线程, 断流自动重启。"""

    def __init__(self, width: int):
        self.width = width

        self.state = "idle"
        self.last_error = ""
        self.peer = "CAMERA_IP:8001"
        self.started_at = time.time()

        self.rtsp_url = RTSP_URL

        self._stop = threading.Event()
        self._vproc: subprocess.Popen | None = None
        self._aproc: subprocess.Popen | None = None
        self._proc_lock = threading.Lock()

        self.snapshot: bytes | None = None
        self._frame_times = deque(maxlen=300)
        self.video_frames = 0
        self.audio_frames = 0
        self.video_bytes = 0
        self.lights = 0
        self.last_media_rx = 0.0
        self.last_audio_rx = 0.0

        self.loop: asyncio.AbstractEventLoop | None = None
        self._sub_lock = threading.Lock()
        self.video_subscribers = set()
        self.audio_subscribers = set()

        self._cmd_lock = threading.Lock()   # PTZ 串行化 (设备侧 /dev/ptz 独占)

    # ---------- 视频管道 ----------

    def _video_cmd(self) -> list[str]:
        return [
            "ffmpeg", "-nostdin", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", self.rtsp_url,
            "-an",
            "-vf", f"scale={self.width}:-1",
            "-c:v", "mjpeg", "-q:v", "5",
            "-f", "mjpeg", "-",
        ]

    def _spawn_video(self) -> subprocess.Popen:
        with self._proc_lock:
            self._vproc = subprocess.Popen(
                self._video_cmd(),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            return self._vproc

    def _kill_proc(self, proc: subprocess.Popen | None):
        if proc is None:
            return
        try:
            proc.kill()
            proc.wait(timeout=3)
        except Exception:
            pass

    def _read_jpegs(self, proc: subprocess.Popen):
        buf = b""
        while not self._stop.is_set():
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            buf += chunk
            while True:
                start = buf.find(b"\xff\xd8")
                if start < 0:
                    buf = buf[-3:]
                    break
                end = buf.find(b"\xff\xd9", start + 2)
                if end < 0:
                    buf = buf[start:]
                    break
                frame = buf[start:end + 2]
                buf = buf[end + 2:]
                self._publish_frame(frame)

    def _publish_frame(self, jpg: bytes):
        self.snapshot = jpg
        self.state = "streaming"
        self.last_error = ""
        self.video_frames += 1
        self.video_bytes += len(jpg)
        self.last_media_rx = time.time()
        self._frame_times.append(time.time())
        loop = self.loop
        if loop is None:
            return
        with self._sub_lock:
            subs = list(self.video_subscribers)
        for q in subs:
            loop.call_soon_threadsafe(q.put_nowait, jpg)

    def _video_worker(self):
        """守护视频: spawn -> 读帧 -> 进程退出/停滞 -> 重启, 循环直到 stop。"""
        while not self._stop.is_set():
            self.state = "connecting"
            proc = self._spawn_video()
            self.last_media_rx = time.time()
            first_frame = self.video_frames
            reader = threading.Thread(target=self._read_jpegs, args=(proc,), daemon=True)
            reader.start()

            # 监控: 进程退出或超过 VIDEO_STALL 无帧 -> 打掉重启
            # (启动后的首帧宽限更长, 避免 ffmpeg/RTSP 握手慢被误杀)
            stall = VIDEO_STALL + 8.0 if self.video_frames == first_frame else VIDEO_STALL
            while not self._stop.is_set():
                time.sleep(0.5)
                rc = proc.poll()
                if rc is not None:
                    self.last_error = f"ffmpeg 视频退出 rc={rc}"
                    break
                if time.time() - self.last_media_rx > stall:
                    self.last_error = "视频流停滞"
                    self._kill_proc(proc)
                    break

            reader.join(timeout=2)
            self.state = "reconnecting"
            if not self._stop.is_set():
                time.sleep(RESTART_SLEEP)

    # ---------- 音频管道 ----------

    def _audio_cmd(self) -> list[str]:
        return [
            "ffmpeg", "-nostdin", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", self.rtsp_url,
            "-vn",
            "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le",
            "-f", "s16le", "-",
        ]

    def _spawn_audio(self) -> subprocess.Popen:
        with self._proc_lock:
            self._aproc = subprocess.Popen(
                self._audio_cmd(),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            return self._aproc

    def _push_audio(self, chunk: bytes):
        self.last_audio_rx = time.time()
        self.audio_frames += 1
        loop = self.loop
        if loop is None:
            return
        with self._sub_lock:
            subs = list(self.audio_subscribers)
        for q in subs:
            loop.call_soon_threadsafe(q.put_nowait, chunk)

    def _audio_worker(self):
        """守护音频: spawn -> 读块 -> 进程退出/停滞 -> 重启。"""
        while not self._stop.is_set():
            proc = self._spawn_audio()
            self.last_audio_rx = time.time()
            reader = threading.Thread(target=self._read_audio, args=(proc,), daemon=True)
            reader.start()

            while not self._stop.is_set():
                time.sleep(0.5)
                rc = proc.poll()
                if rc is not None:
                    self.last_error = f"ffmpeg 音频退出 rc={rc}"
                    break
                if time.time() - self.last_audio_rx > AUDIO_STALL:
                    self.last_error = "音频流停滞"
                    self._kill_proc(proc)
                    break

            reader.join(timeout=2)
            if not self._stop.is_set():
                time.sleep(RESTART_SLEEP)

    def _read_audio(self, proc: subprocess.Popen):
        while not self._stop.is_set():
            chunk = proc.stdout.read(2048)
            if not chunk:
                break
            self._push_audio(chunk)

    # ---------- 生命周期 ----------

    def start(self):
        threading.Thread(target=self._video_worker, daemon=True).start()
        threading.Thread(target=self._audio_worker, daemon=True).start()

    def stop(self):
        self._stop.set()
        with self._proc_lock:
            self._kill_proc(self._vproc)
            self._kill_proc(self._aproc)

    # ---------- 控制 ----------

    def ptz(self, direction: str) -> bool:
        """通过 SSH 调设备 ptz.sh (点动模式, 方向后自动 stop)。串行执行。"""
        if direction not in ("left", "right", "up", "down", "stop"):
            return False
        cmd = CAM_SSH + [f"sh {CAM_PTZ_SH} {direction}"]
        with self._cmd_lock:
            try:
                subprocess.run(cmd, capture_output=True, timeout=15)
                return True
            except (subprocess.TimeoutExpired, OSError) as e:
                self.last_error = f"PTZ {direction}: {e}"
                return False

    def set_lights(self, mode: int) -> bool:
        """8001 CGI: 0=红外(关白光) 1=全彩 2=智能(人形触发)。"""
        if mode not in (0, 1, 2):
            return False
        value = {0: "off", 1: "on", 2: "2"}[mode]
        url = f"{CAM_HTTP}/whitelight?mode={value}"
        try:
            with urllib.request.urlopen(url, timeout=6) as resp:
                if resp.status != 200:
                    raise OSError(f"CGI 返回 {resp.status}")
            self.lights = mode
            return True
        except OSError as e:
            self.last_error = f"灯光 {mode}: {e}"
            return False

    # ---------- 统计 ----------

    def fps(self) -> float:
        ts = list(self._frame_times)
        if len(ts) < 2:
            return 0.0
        span = ts[-1] - ts[0]
        return (len(ts) - 1) / span if span > 0 else 0.0

    def status(self) -> dict:
        return {
            "did": "iCam365",
            "state": self.state,
            "peer": self.peer,
            "fps": round(self.fps(), 1),
            "video_frames": self.video_frames,
            "audio_frames": self.audio_frames,
            "video_bytes": self.video_bytes,
            "lights": self.lights,
            "error": self.last_error,
            "uptime": round(time.time() - self.started_at),
        }


# ---------- HTTP ----------

async def index(request):
    html = Path(request.app["html_path"]).read_text(encoding="utf-8")
    return web.Response(text=html, content_type="text/html")


async def video_handler(request):
    engine: CamEngine = request.app["engine"]
    q: asyncio.Queue = asyncio.Queue(maxsize=2)
    with engine._sub_lock:
        engine.video_subscribers.add(q)
    resp = web.StreamResponse(headers={
        "Content-Type": "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    })
    await resp.prepare(request)
    try:
        while True:
            frame = await asyncio.wait_for(q.get(), timeout=30)
            if frame is None:
                break
            await resp.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(frame) + frame)
    except (asyncio.TimeoutError, ConnectionResetError):
        pass
    finally:
        with engine._sub_lock:
            engine.video_subscribers.discard(q)
    return resp


async def snapshot_handler(request):
    engine: CamEngine = request.app["engine"]
    if engine.snapshot is None:
        return web.Response(status=503, text="no frame yet")
    return web.Response(body=engine.snapshot, content_type="image/jpeg")


async def ptz_handler(request):
    engine: CamEngine = request.app["engine"]
    data = await request.json()
    ok = await asyncio.to_thread(engine.ptz, str(data.get("dir", "stop")))
    return web.json_response({"ok": ok})


async def lights_handler(request):
    engine: CamEngine = request.app["engine"]
    data = await request.json()
    ok = await asyncio.to_thread(engine.set_lights, int(data.get("mode", 0)))
    return web.json_response({"ok": ok})


async def status_handler(request):
    engine: CamEngine = request.app["engine"]
    return web.json_response(engine.status())


async def ws_handler(request):
    engine: CamEngine = request.app["engine"]
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    q: asyncio.Queue = asyncio.Queue()
    with engine._sub_lock:
        engine.audio_subscribers.add(q)

    async def _reader():
        """消费客户端帧, 让 close 及时被处理。"""
        async for _ in ws:
            pass

    reader_task = asyncio.create_task(_reader())
    try:
        while True:
            try:
                pcm = await asyncio.wait_for(q.get(), timeout=2.0)
                await ws.send_bytes(pcm)
            except asyncio.TimeoutError:
                if ws.closed:
                    break
            except (ConnectionResetError, RuntimeError):
                break
    finally:
        reader_task.cancel()
        with engine._sub_lock:
            engine.audio_subscribers.discard(q)
    return ws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=HTTP_PORT)
    ap.add_argument("--width", type=int, default=1280,
                    help="MJPEG 输出宽度 (源为 1920)"
                    )
    args = ap.parse_args()

    engine = CamEngine(width=args.width)
    engine.start()

    app = web.Application()
    app["engine"] = engine
    app["html_path"] = HERE / "index.html"

    async def _on_startup(app):
        engine.loop = asyncio.get_running_loop()

    app.on_startup.append(_on_startup)
    app.router.add_get("/", index)
    app.router.add_get("/video", video_handler)
    app.router.add_get("/snapshot", snapshot_handler)
    app.router.add_get("/status", status_handler)
    app.router.add_get("/ws", ws_handler)
    app.router.add_post("/ptz", ptz_handler)
    app.router.add_post("/lights", lights_handler)

    web.run_app(app, host=HTTP_HOST, port=args.port)


if __name__ == "__main__":
    main()
