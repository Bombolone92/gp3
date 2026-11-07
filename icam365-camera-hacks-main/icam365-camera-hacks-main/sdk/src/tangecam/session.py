"""会话层: 唤醒 + 直连 + 开流。

封装 cs2pppp 的 PpppSession，自动注入 prop_table（从随包的 libPPCS_API.so 提取），
并处理 CNAD 前缀被 cs2pppp 误转的问题（直接构造 PpppSession 绕过 to_real）。
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Sequence, Tuple

from cs2pppp import PpppSession, configure_tables

# 探鸽 tange365 目录服务器（UDP 32100）
DEFAULT_SERVERS = ("8.133.176.72", "47.106.109.158", "8.140.211.129")
DIR_PORT = 32100

# prop_table(256B S-box) 在 libPPCS_API.so 中的偏移（2026-08-21 实测定位）
PROP_TABLE_OFFSET = 0x10838

# 开流序列: 会话语义 = 登录(含会话密钥) -> 0x0124 -> 0x0228(时间) -> 0x03ff(VIDEOSTART)
# 字节来自手机 App 抓包实测重放（详见 docs/08）。顺序发送, 帧间 sleep 1.2s。
OPEN_START_FRAMES = (
    # login (76B)
    bytes.fromhex("f1d00048d1000000028000003c00000000000000000000006246636378635433455564364648454a" \
    "666e317a586f47556a6d676f4a624d750000000000000000000000000000000000000000"),
    # feature (16B)
    bytes.fromhex("f1d0000cd10000012480000000000000"),
    # params (45B)
    bytes.fromhex("f1d00029d10000022804000001000000001203000008000000000000000000000088030000040000" \
    "0000000000"),
    # vstart (81B)
    bytes.fromhex("f1d0004dd1000003ff01000008000000020000000000000000030000080000000100000000000000" \
    "20030000080000000000000005000000200300000800000000000000010000002804000001000000" \
    "00"),
)


_HAS_TABLE = False


def _ensure_table() -> None:
    """从随包 so 注入 prop_table（只做一次）。"""
    global _HAS_TABLE
    if _HAS_TABLE:
        return
    so_path = Path(__file__).resolve().parent.parent.parent / "libPPCS_API.so"
    if not so_path.exists():
        so_path = Path(__file__).resolve().parent / "libPPCS_API.so"
    if so_path.exists():
        blob = so_path.read_bytes()
        table = blob[PROP_TABLE_OFFSET : PROP_TABLE_OFFSET + 256]
        configure_tables(prop_table=table)
    else:
        # 兜底: 允许调用方自行 configure_tables；此处只标记并继续
        pass
    _HAS_TABLE = True


class WakeSession:
    """一条到摄像头的唤醒+直连会话。"""

    def __init__(
        self,
        did: str,
        servers: Sequence[str] = DEFAULT_SERVERS,
        port: int = DIR_PORT,
        timeout: float = 40.0,
    ) -> None:
        self.did = did
        self.servers = tuple(servers)
        self.port = port
        self.timeout = timeout
        self._sess: PpppSession | None = None

    @property
    def peer(self):
        """设备局域网地址 (ip, port)——会话建立后有效。"""
        if self._sess is None or self._sess.peer is None:
            return None
        return (self._sess.peer.ip, self._sess.peer.port)

    @property
    def sock(self):
        """底层 UDP socket（需要直接收发时用）。"""
        return self._sess.sock if self._sess is not None else None

    def open(self, prefer: str = "direct") -> "WakeSession":
        """唤醒+建会话。prefer='direct' 走局域网打洞直连；'relay' 走厂商中继。"""
        _ensure_table()
        self._sess = PpppSession(
            real_did=self.did, servers=self.servers, port=self.port
        )
        self._sess.open(timeout=self.timeout, prefer=prefer)
        return self

    def start_stream(self, inter_frame: float = 1.2) -> None:
        """发送开流序列（需先 open()）。之后设备开始推 ch1 音频 + ch2 视频。"""
        assert self._sess is not None and self._sess.peer is not None
        for i, frame in enumerate(OPEN_START_FRAMES):
            self._sess.sock.sendto(frame, (self._sess.peer.ip, self._sess.peer.port))
            time.sleep(inter_frame)

    def recv(self, timeout: float = 0.5):
        """接收未解析帧, 返回 (data, addr) 列表。"""
        assert self._sess is not None
        return self._sess._recv(timeout)

    def send(self, data: bytes) -> None:
        """向设备发送原始帧（命令帧请用 commands 模块构造）。"""
        assert self._sess is not None and self._sess.peer is not None
        self._sess.sock.sendto(data, (self._sess.peer.ip, self._sess.peer.port))

    def send_frame(self, pkt: bytes) -> None:
        self.send(pkt)

    def close(self) -> None:
        if self._sess is not None:
            try:
                self._sess.close()
            except Exception:
                pass
            self._sess = None

    def __enter__(self) -> "WakeSession":
        return self.open()

    def __exit__(self, *exc) -> None:
        self.close()