"""控制命令构造层（全部实测/官方表验证的字节）。

DRW 命令帧 = f1 d0 <u16 len> d1 00 00 <u16 seq> <cmd 流>
cmd 流 = cmd(LE u32) / 命令码即 TCI 码十进制
  - 0x1001 PTZ_LONG_COMMAND: {control u32, speed u32, reserved}
  - 0x8014 SET_WHITELIGHT:   {channel+pad 8B, mode u32}
  - 0x8018 SET_DAYNIGHT:     {channel+pad 8B, mode u32}
  - 0x0300/0x0301 AUDIOSTART/STOP: {avIndex u32, channel u32}
  - 0x0332 START_TALK:        {avIndex u32, channel u32}
  - 0x0330 DEVINFO / 0x8024 GET_FEATURE: 空载荷
"""

from __future__ import annotations

import struct
from itertools import count
from typing import Dict, Optional

# ---- PTZ 方向（ENUM_PTZCMD）
PTZ_STOP = 0
PTZ_UP = 1
PTZ_DOWN = 2
PTZ_LEFT = 3
PTZ_LEFT_UP = 4
PTZ_LEFT_DOWN = 5
PTZ_RIGHT = 6
PTZ_RIGHT_UP = 7
PTZ_RIGHT_DOWN = 8
PTZ_AUTO_SCAN = 9
PTZ_GOTO_POINT = 12

# ---- 白光模式（0x8014）
LIGHT_IR = 0        # 红外（关白光）
LIGHT_FULL_COLOR = 1  # 全彩（白光常亮）
LIGHT_SMART = 2     # 智能（侦测联动）

# ---- 日夜模式（0x8018）
DAYNIGHT_AUTO = 0
DAYNIGHT_DAY = 1
DAYNIGHT_NIGHT = 2


def _drw(seq: int, cmd: int, payload: bytes) -> bytes:
    body = bytes([0xd1, 0x00, 0x00]) + struct.pack(">H", seq & 0xFFFF)
    body += struct.pack("<I", cmd) + struct.pack("<I", len(payload)) + payload
    return struct.pack(">BBH", 0xF1, 0xD0, len(body)) + body


class CommandSender:
    """对单个设备的命令发送器（内部管理 seq 递增）。"""

    def __init__(self, send_fn, seq_start: int = 0):
        self._send = send_fn
        self._seq = count(seq_start)

    def send(self, cmd: int, payload: bytes = b"") -> bytes:
        pkt = _drw(next(self._seq), cmd, payload)
        self._send(pkt)
        return pkt

    # ---- 具体命令 ----
    def ptz(self, control: int, speed: int = 6) -> bytes:
        if control < 0 or control > 8:
            raise ValueError("control must be 0-8")
        payload = struct.pack("<III", control, speed, 0)
        return self.send(0x1001, payload)

    def stop_ptz(self) -> bytes:
        return self.ptz(PTZ_STOP, speed=0)

    def light(self, mode: int) -> bytes:
        if mode not in (0, 1, 2):
            raise ValueError("mode must be 0/1/2")
        # 12B 结构体: 8B pad(含 channel) + 4B mode（实测模式在末 4B）
        payload = b"\x00" * 8 + struct.pack("<I", mode)
        return self.send(0x8014, payload)

    def daynight(self, mode: int) -> bytes:
        if mode not in (0, 1, 2):
            raise ValueError("mode must be 0/1/2")
        payload = b"\x00" * 8 + struct.pack("<I", mode)
        return self.send(0x8018, payload)

    def audio_start(self, av_index: int = 1, channel: int = 0) -> bytes:
        return self.send(0x0300, struct.pack("<II", av_index, channel))

    def audio_stop(self, av_index: int = 1, channel: int = 0) -> bytes:
        return self.send(0x0301, struct.pack("<II", av_index, channel))

    def talk_start(self, av_index: int = 5, channel: int = 0) -> bytes:
        """对讲（App 实测通道 5）。"""
        return self.send(0x0332, struct.pack("<II", av_index, channel))

    def dev_info(self) -> bytes:
        return self.send(0x0330)

    def get_feature(self) -> bytes:
        return self.send(0x8024)

    def reboot(self) -> bytes:
        return self.send(0x8010, b"\x00" * 4)


# 快捷函数（一次性发送, 不需维护 sender 时使用）
def ptz_cmd(send_fn, control: int, speed: int = 6) -> bytes:
    return CommandSender(send_fn).ptz(control, speed)


def light_cmd(send_fn, mode: int) -> bytes:
    return CommandSender(send_fn).light(mode)


def daynight_cmd(send_fn, mode: int) -> bytes:
    return CommandSender(send_fn).daynight(mode)
