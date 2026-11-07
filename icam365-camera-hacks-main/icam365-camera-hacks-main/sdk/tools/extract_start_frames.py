#!/usr/bin/env python3
"""从 PCAPdroid 抓包提取开流序列（含当前会话密钥），自动更新 tangecam。

设备重启后会话密钥刷新（登录帧 0x8002 内的 base64 文本段），需重新提取：

  python3 tools/extract_start_frames.py /path/to/capture.pcap --device-ip 192.168.1.123 [--apply]

输出 OPEN_START_FRAMES 常量块；--apply 时直接写回 session.py。
"""

import argparse
import ipaddress
import struct
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
def extract_frames(pcap: str, device_ip: str):
    """从 pcap 中手机->设备方向提取开流序列四帧。"""
    out = subprocess.run(
        ["tshark", "-r", pcap, "-Y",
         f"udp and ip.dst=={device_ip}",
         "-T", "fields", "-e", "frame.number", "-e", "data.data"],
        capture_output=True, text=True)
    rows = []
    for line in out.stdout.strip().splitlines():
        parts = line.split("\t")
        if len(parts) != 2 or not parts[1]:
            continue
        try:
            pl = bytes.fromhex(parts[1])
        except ValueError:
            continue
        if len(pl) < 5 or pl[0] != 0xF1 or pl[1] != 0xD0:
            continue
        ln = struct.unpack(">H", pl[2:4])[0]
        body = pl[4:4 + ln]
        if len(body) < 4:
            continue
        rows.append((int(parts[0]), pl))

    want = {}  # 命令码 -> 帧
    seq = None
    for fno, pl in rows:
        body = pl[4:4 + struct.unpack(">H", pl[2:4])[0]]
        if len(body) < 4:
            continue
        inner = body[4:]
        if len(inner) < 6:
            continue
        cmd = struct.unpack("<I", inner[:4])[0]
        if cmd == 0x8002 and "login" not in want:
            want["login"] = (fno, pl)
        elif cmd == 0x8024 and "feature" not in want:
            want["feature"] = (fno, pl)
        elif cmd == 0x0428 and "params" not in want:
            want["params"] = (fno, pl)
        elif cmd == 0x01FF and "vstart" not in want:
            want["vstart"] = (fno, pl)
    return want


def render_block(frames: dict) -> str:
    names = ["login", "feature", "params", "vstart"]
    lines = ["OPEN_START_FRAMES = ("]
    missing = []
    for name in names:
        if name not in frames:
            missing.append(name)
            continue
        pl = frames[name][1]
        h = pl.hex()
        chunks = [h[i:i + 80] for i in range(0, len(h), 80)]
        join = ' \\\n    '.join(f'"{c}"' for c in chunks)
        lines.append(f'    # {name} ({len(pl)}B)\n    bytes.fromhex({join}),')
    lines.append(")")
    if missing:
        print("!! 缺失帧:", missing, file=sys.stderr)
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pcap")
    ap.add_argument(
        "--device-ip",
        required=True,
        type=lambda value: str(ipaddress.ip_address(value)),
        help="抓包时摄像头的 IPv4/IPv6 地址",
    )
    ap.add_argument("--apply", action="store_true", help="写回 session.py")
    args = ap.parse_args()

    frames = extract_frames(args.pcap, args.device_ip)
    if not frames:
        print("未找到开流帧（检查 pcap 是否为手机->设备方向的 UDP 抓包）")
        sys.exit(1)
    for k, (fno, pl) in frames.items():
        print(f"{k}: frame {fno}, {len(pl)}B")

    block = render_block(frames)
    print("\n" + block)

    if args.apply:
        p = REPO / "src" / "tangecam" / "session.py"
        src = p.read_text()
        start = src.index("OPEN_START_FRAMES = (")
        end = src.index("_HAS_TABLE")
        src = src[:start] + block + "\n\n" + src[end:]
        p.write_text(src)
        print("\n已写回 session.py")


if __name__ == "__main__":
    main()
