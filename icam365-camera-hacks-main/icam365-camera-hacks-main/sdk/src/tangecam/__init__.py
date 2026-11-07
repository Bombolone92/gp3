"""tangecam — 探鸽(iCam365/Wosee)摄像头本地 SDK。

从 2026-08-21 的完整逆向成果沉淀而来（详见 NAS docs/08）：
- 协议: PPPP/CS2 (cs2p2p)，目录服务器 UDP 32100 x3，DID wire = 8B prefix + u32 serial + 8B check
- 唤醒: P2P_REQ -> PUNCH_TO -> PunchPkt -> P2P_RDY (direct 直连)
- 流:   DRW ch=1 = G.711 A-law 8kHz 音频(明文)；ch=2 = HEVC 视频(明文, 1028B 分片 + 32B 帧头)
- 控制: 0x1001 PTZ / 0x8014 白光 / 0x8018 日夜 / 0x0300-0x0301 音频 / 0x0332 对讲 / 0x031A 回放…
"""

from .camera import Camera, CameraConfig
from .session import WakeSession, OPEN_START_FRAMES
from .frames import H265Assembler, AlawDecoder
from .commands import ptz_cmd, light_cmd, daynight_cmd

__version__ = "0.1.0"

__all__ = [
    "Camera",
    "CameraConfig",
    "WakeSession",
    "OPEN_START_FRAMES",
    "H265Assembler",
    "AlawDecoder",
    "ptz_cmd",
    "light_cmd",
    "daynight_cmd",
]
