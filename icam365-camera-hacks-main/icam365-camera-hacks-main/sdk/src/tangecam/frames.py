"""帧解析层: HEVC 视频流组装器 + G.711 A-law 音频。

DRW 帧布局（实测）:
    f1 d0 <u16 len> d1 <ch> <u16 idx> <rest>
  - ch=1 (音频): rest[0:16] = SFrameInfo(codec_id=0x008a=G711A, frame_size=320, ts), rest[16:] = 320B A-law
  - ch=2 (视频): rest 为 1028B 分片; 流首 32B 为帧头, 之后为 HEVC NAL 流(00 00 00 01 起始码)
N 个分片拼接 = 连续 HEVC 流（无转封装）。验证: ffmpeg -f hevc 可解出 1920x1080 画面。
"""

from __future__ import annotations

import struct
from typing import Iterable, List, Optional

DRW_MAGIC = 0xF1
DRW_TYPE = 0xD0
NAL_START_CODES = (b"\x00\x00\x00\x01", b"\x00\x00\x01")

# SFrameInfo 里的编解码类型
MEDIA_CODEC_AUDIO_G711A = 0x008A


class H265Assembler:
    """把 ch=2 分片组装成连续 HEVC 字节流。

    用法:
        asm = H265Assembler()
        for chunk in chunks:            # 每个 chunk 为 DRW ch2 的 rest
            data = asm.feed(chunk)      # 可能返回 bytes（建议喂给解码器/播放器）
            if data:
                write(data)
    首 32B 帧头与起始码之前的垃圾字节会被自动剥离。
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self._started = False

    def feed(self, chunk: bytes) -> bytes:
        self._buf += chunk
        if not self._started:
            # 找第一个 NAL 起始码, 丢弃之前的一切
            first = -1
            for code in NAL_START_CODES:
                idx = self._buf.find(code)
                if idx >= 0 and (first < 0 or idx < first):
                    first = idx
            if first < 0:
                # 缓冲太短没有起始码——保留后 3B 以处理跨块起始码
                keep = min(3, len(self._buf))
                tail = bytes(self._buf[-keep:])
                del self._buf[:]
                self._buf += tail
                return b""
            del self._buf[:first]
            self._started = True
        out = bytes(self._buf)
        self._buf.clear()
        return out

    @property
    def started(self) -> bool:
        return self._started


class AlawDecoder:
    """G.711 A-law -> 16bit PCM (s16le, 8kHz)。"""

    # A-law -> s16 查找表（按 256 个 A-law 值预计算）
    _table: Optional[List[int]] = None

    @classmethod
    def _build_table(cls) -> List[int]:
        if cls._table is None:
            table = []
            for i in range(256):
                value = i ^ 0x55
                exponent = (value >> 4) & 0x07
                sample = (value & 0x0F) << 4
                if exponent == 0:
                    sample += 8
                elif exponent == 1:
                    sample += 0x108
                else:
                    sample = (sample + 0x108) << (exponent - 1)
                val = sample if value & 0x80 else -sample
                table.append(val)
            cls._table = table
        return cls._table

    @staticmethod
    def decode(alaw: bytes) -> bytes:
        """A-law bytes -> s16le PCM bytes（n 字节 in -> 2n 字节 out）。"""
        tbl = AlawDecoder._build_table()
        out = bytearray(len(alaw) * 2)
        for i, b in enumerate(alaw):
            v = tbl[b]
            out[i * 2] = v & 0xFF
            out[i * 2 + 1] = (v >> 8) & 0xFF
        return bytes(out)


class AudioFrame:
    """ch=1 音频帧解析结果。"""

    def __init__(self, codec_id: int, frame_size: int, ts: int, payload: bytes):
        self.codec_id = codec_id      # 0x008a = G.711 A-law
        self.frame_size = frame_size  # 通常 320 (40ms @ 8kHz)
        self.ts = ts                  # 毫秒级时间戳
        self.payload = payload        # A-law 字节（frame_size 长）

    @classmethod
    def parse(cls, rest: bytes) -> Optional["AudioFrame"]:
        """解析 ch=1 rest；非音频帧/数据不足返回 None。"""
        if len(rest) < 16:
            return None
        codec_id, flags, cam, online = struct.unpack_from("<HBBBB", rest, 0) if False else (None, None, None, None)
        codec_id = struct.unpack_from("<H", rest, 0)[0]
        frame_size = struct.unpack_from("<i", rest, 8)[0]
        ts = struct.unpack_from("<i", rest, 12)[0]
        if codec_id != MEDIA_CODEC_AUDIO_G711A:
            return None
        payload = rest[16:16 + frame_size] if frame_size > 0 else rest[16:]
        return cls(codec_id, frame_size, ts, payload)
