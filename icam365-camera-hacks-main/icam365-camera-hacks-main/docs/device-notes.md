# tangecam_01

## 资产

| 项 | 值 |
| --- | --- |
| 平台 | Ts300 / ARMv7 / Linux 4.14.249 |
| firmware_id | `aj_ipc_qv_004` |
| App | Wosee (`com.tange365.wosee`) |
| MAC | `XX:XX:XX:XX:XX:XX` |
| 当前地址 | `CAMERA_IP` |
| SSH | `root@CAMERA_IP:2222` |
| 控制 API | `http://CAMERA_IP:8080`，tangecam-control 0.1.0 |
| 主流 | `/0/av0`，HEVC 1920x1080 12.5fps + PCMA 8kHz mono |
| 子流 | `/0/av1`，HEVC 640x360 |
| Frigate 名称 | `tangecam_01` |

DID、UUID、RTSP/PPPP 凭据和设备主机密钥不写入本文件，详见设备私有备份与 NAS 调研手册。

## 已完成

- SD 卡启动钩子、持久 Dropbear SSH 和 flash 备份。
- 零长度 `/home/eye.conf` 固化 SONG TOOL 本地模式。
- RTSP 8001 主流、子流与灯光 CGI 验证。
- `/dev/ptz` 点动脚本验证。
- ARMv7 机内 HTTP 控制服务、监督脚本和 `/bak/custom_init.sh` 开机启动。
- Frigate 0.17.2、Mosquitto、NAS 录像目录、HA 集成和监控仪表盘部署。
- HA `rest_command` 已完成左右往返点动、stop 与智能灯光端到端调用。
- Frigate 主/子 restream、5fps 检测、音频电平、快照及 NAS HEVC+AAC 录像验收。

## 当前状态

2026-08-22 已完成整条生产链路。Frigate 实测 `camera_fps=5.1`、CPU detector
推理约 18ms；NAS 录像为 1920x1080 HEVC 12.5fps + AAC 8kHz 单声道，快照
无花屏。监控仪表盘包含 Advanced Camera Card、九个云台按钮、三个灯光按钮、
状态与录像控制。

部署期间设备发生一次整机重启，未留下可归因日志；`custom_init.sh` 已自动恢复
Dropbear 与 tangecam-control。另主动结束一次控制服务进程，监督脚本在 3 秒后
重启服务，系统未重启，证明服务级恢复链路有效。

设备端部署前启动脚本备份：
`/tmp/mnt/mmc01/0/tangecam/custom_init.sh.before-control-20260822`。

用户于 2026-08-22 完成实际界面与控制验收，当前方案正式投入使用。
