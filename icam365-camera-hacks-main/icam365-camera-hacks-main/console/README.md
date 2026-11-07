# iCam365 摄像头本地网页控制台

浏览器打开即可看实时画面、控制云台/灯光、抓拍、监听拾音。取流走设备本地
RTSP（8001 端口 HEVC 主码流），控制走 8001 HTTP CGI + 设备 SSH 点动模式，
不依赖任何厂商云 App，也不依赖不稳定的 PPPP 会话。

## 启动

```bash
cd ~/Repos/ipcam-console
uv sync        # 首次
uv run console.py
```

浏览器打开 <http://127.0.0.1:8765/>。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--port` | `8765` | 网页端口 |
| `--width` | `1280` | MJPEG 输出宽度（源为 1920，-1 保持源宽） |

## 功能

- **画面**：`/video` = MJPEG 流（RTSP HEVC 1080p@12.5fps 经 ffmpeg 转 1280 宽
  JPEG，帧率与源一致）；`/snapshot` = 当前一帧 JPEG；前端「抓拍」直接下载。
- **云台**：↑↓←→（按住转、松开停）、空格停止；界面按钮为"短转 0.6s 自动停"。
  指令经 SSH 到设备 `ptz.sh`（点动模式，方向动作后自动 stop）。
- **灯光**：红外（关白光）/全彩/智能，对应 8001 CGI `whitelight?mode=off|on|2`，
  当前档位存 localStorage。
- **监听**：`/ws` 推送 G.711 A-law 解码后的 s16le 裸流（8kHz 单声道），
  前端 AudioContext({sampleRate:8000}) 实时播放。
- **状态**：右上角连接状态 / 帧率 / 视频帧数 / 音频帧数（`/status`）。

## 架构

```
后台线程: ffmpeg(视频) ←TCP← rtsp://admin:@CAMERA_IP:8001/0/av0 (HEVC)
          → MJPEG(1280宽,q5) → /video multipart 订阅分发
          ffmpeg(音频) ←TCP← 同源 (pcm_alaw 8kHz)
          → s16le(8kHz) → /ws WebSocket 订阅分发
视频/音频各自守护线程: 进程退出或停滞>6/4s 自动重启, 后端不退出
控制: 云台 SSH root@CAMERA_IP:2222 → sh /tmp/mnt/mmc01/0/tangecam/ptz.sh
      灯光 HTTP GET CAMERA_IP:8001/whitelight?mode=off|on|2
```

## 验证记录（2026-08-22 实测）

```
state: streaming, fps≈12.6 (源 12.5), video_frames 227+/20s, audio_frames 155+
/video 5s 取样 63 帧 JPEG (1280x720); /snapshot -> 200 JPEG
/ws 20s 收 32+ 个 2048B s16le chunk
/ptz {"dir":"right"}、/lights {"mode":1} / {"mode":2} 均 {"ok": true}
kill -9 视频 ffmpeg: 3s 内转 connecting, ~11s 恢复 streaming
```

## 说明

- go2rtc 配置（`go2rtc/go2rtc.yaml`）已同步指向 RTSP 源，可直接被 go2rtc 消费。
- 摄像头侧涉及源/服务：8001 = RTSP + HTTP CGI（SONG TOOL）；2222 = SSH dropbear
  （密钥 `~/.ssh/<operator_key>`，已免密）；8000 端口用途未知，未使用。
- 旧 PPPP 方案（tangecam SDK / libPPCS_API.so / cs2pppp）已废弃，会话 15s 被踢、
  多客户端互斥等问题均不再存在。
