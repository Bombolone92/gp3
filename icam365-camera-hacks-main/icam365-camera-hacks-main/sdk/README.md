# tangecam

探鸽(iCam365/Wosee)系摄像头**本地 SDK**——唤醒、拉流、控制全链路，无云、无 App、无订阅。

2026-08-21 逆向实测成果沉淀（协议细节见 NAS `docs/08-调研与资讯.md`）。

## 能力

| 能力 | 说明 |
|---|---|
| 视频 | 明文 **HEVC 1080p**，DRW ch2 分片流 → 连续 NAL 流（ffmpeg/go2rtc 直接消费） |
| 音频 | 明文 **G.711 A-law 8kHz**，DRW ch1 帧（16B SFrameInfo + 320B/40ms 采样） |
| PTZ | `0x1001` 方向控制（0停/1上/2下/3左/6右/8右下…） |
| 灯光 | `0x8014` 白光（0红外/1全彩/2智能） |
| 夜视 | `0x8018` 日夜（0自动/1日/2夜） |
| 对讲 | `0x0332` START_TALK（通道 5, A-law 上行） |
| 更多 | `0x0330` DEVINFO、`0x8024` GET_FEATURE、`0x0310` 录像、`0x031A` 回放、`0x8000` LISTEVENT…（命令表见 `commands.py` 与官网 SDK 文档） |

## 安装与使用

```bash
cd ~/Repos/tangecam
uv sync                       # 或 pip install -e .
```

### 最小示例：连接并转存视频流

```python
import threading
from tangecam import Camera, CameraConfig

cam = Camera(CameraConfig(did="CNAD-XXXXXXXX-XXXXXX"))
cam.open()                     # P2P_REQ 唤醒 -> 打洞直连（无需手机/云）
print("已唤醒:", cam.session.peer)

def on_video(chunk: bytes):
    sys.stdout.buffer.write(chunk)     # HEVC 裸流 -> 可接 ffmpeg -f hevc -i -

threading.Thread(target=cam.start_stream, kwargs=dict(on_video=on_video), daemon=True).start()
time.sleep(60)
cam.close()
```

### 直接观看（配 ffmpeg）

```bash
uv run python3 -c "
import sys, threading, time
from tangecam import Camera, CameraConfig
cam = Camera(CameraConfig(did='CNAD-XXXXXXXX-XXXXXX'))
cam.open()
threading.Thread(target=cam.start_stream, kwargs=dict(on_video=sys.stdout.buffer.write), daemon=True).start()
time.sleep(120); cam.close()
" | ffplay -f hevc -
```

### 控制

```python
from tangecam.commands import PTZ_RIGHT, LIGHT_SMART, DAYNIGHT_AUTO
cam.ptz(PTZ_RIGHT)          # 右转
cam.ptz(0)                  # 停止
cam.light(LIGHT_SMART)      # 智能白光
cam.daynight(DAYNIGHT_AUTO) # 日夜自动
```

## 目录结构

```
src/tangecam/
  session.py   唤醒+直连+开流序列（WakeSession）
  frames.py    H265Assembler / AlawDecoder / AudioFrame
  commands.py  命令构造（CommandSender + 快捷函数）
  camera.py    Camera 高层封装
libPPCS_API.so 含 prop_table 的 SDK 库（协议表提取源）
examples/      示例脚本
tools/         新机诊断、抓包提取与 Ts300/QV 设备脚本
```

`tools/` 中与新机接入直接相关的文件：

- `debug_cmd.sh`：最小诊断卡入口，采集平台、MTD、SD 路径和 BusyBox 能力。
- `fleet-debug_cmd.sh`：当前设备 SD 卡上的完整 fleet card，支持 marker 驱动的备份与持久化。
- `extract_start_frames.py`：通过必填 `--device-ip` 从对应设备抓包提取开流帧。
- `device/ptz.sh`：当前 Ts300/QV 实测的八方向点动脚本。
- `device/custom_init.ts300.sh`：当前 Ts300/QV 的持久 SSH 启动脚本；原厂版本保存在同目录的 `.orig.sh` 文件。

## 注意

- DID 从机身码/App 设备详情获取；目录服务器默认探鸽三台（tange365），同型号通用
- **设备重启后会话密钥刷新**：登录帧（`0x8002`）内的 base64 密钥会变，SDK 内嵌的是某次抓包值——重启后需用 PCAPdroid 抓一轮（手机+设备同 WiFi、进画面 10 秒）然后：
  ```bash
  uv run python3 tools/extract_start_frames.py /path/to/capture.pcap \
    --device-ip CAMERA_IP --apply
  ```
  工具自动提取开流四帧（登录/GET_FEATURE/参数/VIDEOSTART）并写回 `session.py`
- 开流序列语义（实测还原）：`0x8002` 登录(含密钥) → `0x8024` GET_FEATURE → `0x0428` 参数 → `0x01FF` VIDEOSTART（缺任一帧设备不推流；缺 0x8024 设备会直接 CLOSE 会话）
- **优雅关闭**：`Camera.close()` 会自动发 `VIDEOSTOP+AUDIOSTOP+CLOSE`（App 的退场纪律）——**直接拔线会让设备会话悬挂，多次后设备卡死**，务必走 close()
- **花屏/丢块**：UDP 打洞通道无重传，摄像头 WiFi 弱时 HEVC 会丢块花屏；App 用 TCP 通道（`media over TCP`），SDK 的 TCP 通道适配在开发中
- 设备默认只允许单一会话；多客户端请经 go2rtc 单一入口转发

## 生产定位

当前设备已通过 8001 提供稳定的本地 RTSP。生产监控使用 Frigate 内置 go2rtc
直接拉取 `/0/av0` 与 `/0/av1`；本项目继续保留 PPPP 协议、命令码、抓包与恢复
研究能力。完整新机流程见
`~/Repos/camera-monitoring/docs/新摄像头接入SOP.md`。
