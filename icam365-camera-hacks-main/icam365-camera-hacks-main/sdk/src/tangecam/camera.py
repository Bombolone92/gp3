"""Camera —— 高层封装: 一键 连接->开流->回调收帧。"""

from __future__ import annotations

import struct
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from .commands import CommandSender
from .frames import AlawDecoder, AudioFrame, H265Assembler
from .session import WakeSession


@dataclass
class CameraConfig:
    did: str                                   # 如 "CNAD-XXXXXXXX-XXXXXX"
    servers: tuple = ("8.133.176.72", "47.106.109.158", "8.140.211.129")
    dir_port: int = 32100
    wake_timeout: float = 40.0
    prefer: str = "direct"                     # direct=局域网直连 / relay=中继


@dataclass
class VideoPacket:
    """HEVC 裸流分片。"""
    data: bytes


@dataclass
class AudioPacket:
    """音频帧（G.711 A-law）。"""
    frame: AudioFrame
    pcm: bytes = field(default=b"")            # 已解码 s16le（可选）


VideoCallback = Callable[[bytes], None]       # 参数为 HEVC 流字节
AudioCallback = Callable[[AudioPacket], None]


class Camera:
    """一台探鸽系摄像头的本地控制柄。

    用法:
        cam = Camera(CameraConfig(did="CNAD-XXXXXXXX-XXXXXX"))
        cam.open()
        cam.start_stream(on_video=..., on_audio=...)
        cam.ptz(PTZ_RIGHT);  cam.light(LIGHT_SMART)
        cam.close()
    """

    def __init__(self, config: CameraConfig):
        self.config = config
        self.session: Optional[WakeSession] = None
        self.cmd: Optional[CommandSender] = None
        self.video_asm: Optional[H265Assembler] = None

    # ---- 生命周期 ----
    def open(self) -> "Camera":
        self.session = WakeSession(
            self.config.did, self.config.servers, self.config.dir_port,
            timeout=self.config.wake_timeout,
        ).open(prefer=self.config.prefer)
        self.cmd = CommandSender(self.session.send)
        return self

    def start_stream(
        self,
        on_video: Optional[VideoCallback] = None,
        on_audio: Optional[AudioCallback] = None,
        decode_audio: bool = True,
        inter_frame: float = 1.2,
    ) -> "Camera":
        """发开流序列并开始 read() 循环（阻塞）。建议放独立线程调用。"""
        assert self.session is not None
        self.video_asm = H265Assembler()
        self.session.start_stream(inter_frame=inter_frame)
        self.read_loop(on_video, on_audio, decode_audio)
        return self

    def read_loop(
        self,
        on_video: Optional[VideoCallback] = None,
        on_audio: Optional[AudioCallback] = None,
        decode_audio: bool = True,
        idle_sleep: float = 0.2,
    ) -> None:
        """持续接收并派发帧, 直到 close()。可在线程中运行。"""
        assert self.session is not None
        while True:
            for data, _addr in self.session.recv(0.5):
                if len(data) < 8 or data[0] != 0xF1:
                    continue
                if data[1] == 0xD0:
                    ln = struct.unpack(">H", data[2:4])[0]
                    body = data[4:4 + ln]
                    if len(body) < 4:
                        continue
                    ch = body[1]
                    rest = body[4:]
                    if ch == 1 and on_audio is not None:
                        f = AudioFrame.parse(rest)
                        if f is not None and f.payload:
                            pcm = AlawDecoder.decode(f.payload) if decode_audio else b""
                            on_audio(AudioPacket(frame=f, pcm=pcm))
                    elif ch == 2 and on_video is not None and self.video_asm is not None:
                        out = self.video_asm.feed(rest)
                        if out:
                            on_video(out)
                elif data[1] == 0xE0:
                    pass  # ALIVE 保活
                elif data[1] == 0xF0:
                    return  # CLOSE

    # ---- 控制 ----
    def ptz(self, control: int, speed: int = 6) -> None:
        assert self.cmd is not None
        self.cmd.ptz(control, speed)

    def light(self, mode: int) -> None:
        assert self.cmd is not None
        self.cmd.light(mode)

    def daynight(self, mode: int) -> None:
        assert self.cmd is not None
        self.cmd.daynight(mode)

    def get_info(self) -> None:
        assert self.cmd is not None
        self.cmd.dev_info()

    # ---- 结束 ----
    def close(self) -> None:
        """优雅关闭: VIDEOSTOP → AUDIOSTOP → CLOSE 帧 → 释放连接。

        App 的退场纪律（抓包实测: 0x02FF + 0x0301 + CLOSE）；不这样做设备侧媒体
        会话会悬挂, 后续会话被拒甚至设备卡死。
        """
        if self.cmd is not None and self.session is not None:
            try:
                self.cmd.audio_stop()
                time.sleep(0.2)
                self.cmd.send(0x02FF, struct.pack("<II", 1, 0))
                time.sleep(0.2)
            except Exception:
                pass
        if self.session is not None:
            try:
                self.session.send_frame(b"\xf1\xf0\x00\x00")
                time.sleep(0.1)
            except Exception:
                pass
            self.session.close()
