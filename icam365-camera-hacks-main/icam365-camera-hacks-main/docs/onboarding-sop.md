# iCam365/Wosee 同系新摄像头接入 SOP

## 1. 适用范围与目标

本 SOP 面向 iCam365、Wosee、Tange/Closeli 同源摄像头。已经实测的平台为 Ts300/QV、`aj_ipc_qv_004`。其他 SoC 或固件先完成诊断门禁，再决定能否复用 SD 启动钩子、Dropbear 和本地模式方法。

最终状态：

1. 摄像头完成 2.4GHz Wi-Fi 配网并取得固定 DHCP 地址。
2. 原机固件与身份数据完成逐机备份。
3. SD 卡提供持久 SSH、PTZ 脚本和 HTTP 控制服务。
4. 摄像头在本地模式提供 RTSP 主流、子流和 PCMA 音频。
5. Frigate 只拉取一组主/子流，录像写入 NAS。
6. Home Assistant 提供直播、Review、回放、检测、PTZ 和灯光控制。

## 2. 每台设备必须建立的参数表

复制 `devices/device.example.yml`，逐项填写：

- 资产：名称、机身型号、App、MAC、DID、UUID。
- 网络：当前 IP、DHCP 保留 IP。
- 固件：firmware_id、版本、架构、内核、SD 挂载点。
- 服务：RTSP 用户与密码位置、SSH 端口与主机指纹。
- Frigate：稳定 camera slug、主流名、子流名。
- 备份：NAS 设备专属目录。

当前设备的 DID、UUID、会话密钥、MTD 镜像、`eye.conf` 和 Dropbear 主机密钥都不能复制给新机。

## 3. 拆箱、恢复出厂与 App 配网

### 3.1 硬件验收

1. 记录机身标签、二维码、型号和电源规格。
2. 不插诊断 SD 卡，通电等待约 1 分钟。
3. 长按 Reset 约 5 秒，听到恢复成功或等待配网语音后松开。
4. App 中先验证实时画面、拾音、云台和白光灯，确认镜头与电机完好。

### 3.2 配网

1. 安装机身二维码指定的 Wosee 或 iCam365 App。
2. 手机连接 2.4GHz Wi-Fi；此系列通常不支持 5GHz 和 WPA Enterprise。
3. App 选择「添加设备」→「Wi-Fi 摄像机」。
4. 优先扫描机身二维码；选择 Wi-Fi 并输入密码。
5. App 生成二维码后，将手机放在镜头前约 10–30cm；听到识别成功语音后继续。
6. 二维码方式失败时，选择「快速添加/AP 热点」，连接 `AICAM_xxxxxxxxxxx` 后返回 App。
7. 设备添加完成后命名，进入实时画面完成硬件验收。
8. App 独有功能（人形/人脸自动追踪等）须在 App 内开启一次：开关由 App 经云端下发，开启后持久化在设备本地（机身 jffs2），本地模式与缺卡状态下均不受影响；当前无免 App 的直接配置方法（未逆向，2026-08-22）。

### 3.3 网络身份

在路由器 DHCP 租约中以新设备 MAC 确认 IP。建立 DHCP 保留后断电重启一次，确认地址不再变化。不能依据相邻地址猜测设备身份。

验收：App 功能正常；重启后 MAC 与保留地址对应。

## 4. 制作诊断 SD 卡

将 microSD 格式化为摄像头能识别的 FAT32。复制：

```bash
cp ~/Repos/tangecam/tools/debug_cmd.sh <SD_ROOT>/debug_cmd.sh
sync
```

已验证固件会在启动 `p2pcam` 前以 root 执行 SD 根目录的 `debug_cmd.sh`。其他固件若 2323 未出现，应先检查启动脚本是否引用该文件。

插卡冷启动，等待 20–60 秒：

```bash
nc -vz CAMERA_IP 2323
telnet CAMERA_IP 2323
id
cat /tmp/cam_diag.txt
```

验收：`id` 为 root；诊断文件包含内核、CPU、MTD、挂载、SD 候选路径、固件标识、BusyBox applet 和启动钩子证据。

若 2323 未开放：检查 SD 文件系统、文件名、LF 换行、根目录位置和该固件的 `start.sh`。此阶段未通过时停止后续写入。

## 5. 原机备份

在 telnet root 中先读取真实布局：

```sh
uname -a
hostname
mount
cat /proc/mtd
grep 'tcGetP2pToken' /tmp/icam365.log
```

从 `mount` 结果取得 `SD`。按 `/proc/mtd` 中实际分区逐项执行，不能固定假设只有 mtd0–4：

```sh
SD=/tmp/mnt/mmc01/0
mkdir -p "$SD/tangecam/flash"
dd if=/dev/mtd0 of="$SD/tangecam/flash/mtd0.bin" bs=64k
# 对该机列出的其余 mtdN 重复
md5sum "$SD"/tangecam/flash/mtd*.bin > "$SD/tangecam/flash/md5sum.txt"
cp /bak/eye.conf "$SD/tangecam/flash/eye.conf.bak"
cp /bak/start.sh "$SD/tangecam/flash/start.sh.bak"
sync
```

将整个 `flash/` 复制到 NAS 的该设备专属目录，核对每个镜像长度与 `/proc/mtd` 一致。

## 6. 持久 SSH

需要以下逐机文件：

- 与 `CAM_ARCH` 匹配的静态 `dropbear`、`dropbearkey`。
- 操作者公钥 `authorized_keys`。
- 新机单独生成的 `dbkey_ed25519`；禁止复制其他摄像头的主机私钥。
- 已审阅的 `custom_init.sh`。

推荐 SD 布局：

```text
tangecam/
  dropbear
  dropbearkey
  dbkey_ed25519
  authorized_keys
  custom_init.sh
  ptz.sh
  tangecam-control
  flash/
```

启动逻辑需等待 SD 挂载、将 `/bak` remount 为可写、准备 `/bak/root/.ssh/authorized_keys`，随后使用 IPv4 显式监听：

```sh
dropbear -p 0.0.0.0:2222 -r "$SD/tangecam/dbkey_ed25519"
```

完成两次断电启动验收：

```bash
ssh -i ~/.ssh/<operator_key> -p 2222 root@CAMERA_IP \
  'id; uname -a; ps | grep "[d]ropbear"; mount'
```

记录 SSH 主机指纹。若重启后 SSH 消失，检查启动钩子是否早于 SD 挂载，并在脚本中增加等待和启动日志。

## 7. PTZ 标定

先在设备端运行 `/bin/ptz_test`，逐项记录菜单编号与实际方向。再安装权威 `ptz.sh`，验证：

```bash
ssh -p 2222 root@CAMERA_IP 'sh SD_MOUNT/tangecam/ptz.sh left'
ssh -p 2222 root@CAMERA_IP 'sh SD_MOUNT/tangecam/ptz.sh stop'
```

验收左、右、上、下、四个对角和 stop。方向命令属于持续运动模型时，每次动作必须显式 stop；生产脚本默认采用短点动。

## 8. 切换本地模式

先保存新机自己的 `eye.conf`：

```sh
SD=/tmp/mnt/mmc01/0
cp /bak/eye.conf "$SD/tangecam/flash/eye.conf.original"
: > /home/eye.conf
wc -c /home/eye.conf
sync
reboot
```

`wc -c` 必须为 `0`。已有非空文件时，单独执行 `touch` 不会截断。

回退云模式：

```sh
rm -f /home/eye.conf
sync
reboot
```

验收：重启和再次断电后 8001 均自动监听。554 不作为接入条件。

## 9. RTSP、音频和 CGI 验证

主、子流都必须以 TCP 探测：

```bash
ffprobe -v error -rtsp_transport tcp \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of json 'rtsp://USER:PASSWORD@CAMERA_IP:8001/0/av0'

ffprobe -v error -rtsp_transport tcp \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of json 'rtsp://USER:PASSWORD@CAMERA_IP:8001/0/av1'
```

连续保存 5 分钟：

```bash
ffmpeg -nostdin -loglevel warning -rtsp_transport tcp \
  -i 'rtsp://USER:PASSWORD@CAMERA_IP:8001/0/av0' \
  -t 300 -map 0 -c copy CAMERA_NAME-main.mkv
```

灯光：

```bash
curl -f 'http://CAMERA_IP:8001/whitelight?mode=off'
curl -f 'http://CAMERA_IP:8001/whitelight?mode=on'
curl -f 'http://CAMERA_IP:8001/whitelight?mode=2'
```

将实际 codec、分辨率、帧率、采样率与三种灯光语义写入设备清单。子流可能是 640x360 或 640x368，以该机 `ffprobe` 为准。

## 10. 安装机内 HTTP 控制服务

构建并固化 ARMv7 静态服务与监督脚本到机身可写分区 `/bak`（控制服务约 87KB，
无需 SD 卡；SD 卡仅承载 dropbear 载荷，拔卡不影响 PTZ/灯光）：

```bash
cd ~/Repos/tangecam-control
make test
make armv7
mkdir -p /bak/tangecam
cp build/tangecam-control-armv7 /bak/tangecam/tangecam-control
cp device/ptz.sh /bak/tangecam/ptz.sh
cp device/run-control.sh /bak/tangecam/run-control.sh
chmod 755 /bak/tangecam/tangecam-control /bak/tangecam/ptz.sh /bak/tangecam/run-control.sh
```

将 `device/custom_init.snippet.sh`（/bak 固化版）追加到该机自己的 `/bak/custom_init.sh`。
修改前把原文件另存到 SD 卡和设备专属归档（本仓库 `device/camera-94/`）；
不能用其他设备的完整 `custom_init.sh` 覆盖。服务负责：

- `GET /health`：版本、运行时间和 PTZ 脚本状态。
- PTZ 方向与 stop，内部调用该机 `ptz.sh`。
- 白光模式，内部调用本机 8001 CGI。

接口为 `POST /ptz` 与 `POST /light`。验收：控制调用不再建立 SSH 会话；非法
方向返回 4xx；脚本或 CGI 失败返回 5xx；主动结束服务进程后监督脚本会重新拉起；
断电重启后服务自动恢复。

## 11. Frigate 与 NAS

### 11.1 HAOS 网络存储

建立 NAS 专用目录，并在 HAOS 中添加名称为 `frigate`、用途为 `media` 的网络存储。验证：

```bash
ha mounts info
df -h /media/frigate
```

Frigate 自动使用 `/media/frigate/recordings`、`clips` 和 `exports`。SQLite 数据库保留在 `/config/frigate.db`，不能放在 NFS/CIFS。

### 11.2 Frigate 配置

复制 `frigate/config.example.yml`，替换设备参数。原则：

- go2rtc 对摄像头只建立一条主流和一条子流连接。
- Frigate 的 record/audio/detect 均消费 `127.0.0.1:8554` restream。
- HEVC 视频原码录像，PCMA 使用 `preset-record-generic-audio-aac` 转 AAC。
- 当前客户端支持 HEVC+PCMA 时不配置常驻 H.264 转码。
- HAOS 未看到 `/dev/dri/renderD128` 时保持 `hwaccel_args: []`。

启动后验证：

```bash
curl http://HA_IP:1984/api/streams
ffprobe -rtsp_transport tcp rtsp://HA_IP:8554/CAMERA_SLUG
```

Frigate 配置通过、Live 可看、录像与快照进入 NAS、摄像头重启后自动重连，才算通过。

## 12. Home Assistant

1. 安装 Mosquitto并完成 MQTT 集成。
2. 安装 Frigate HA integration，地址填写 `http://ccab4aaf-frigate:5000`。
3. 安装 Advanced Camera Card。
4. 将 `home-assistant/rest_commands.yaml` 接入 `configuration.yaml`，用 HA REST action 调用摄像头机内控制 API。
5. 在独立仪表盘组合直播、Review、录像开关、PTZ 和灯光按钮。

本工程中的 `home-assistant/dashboard-camera-monitor.yml` 是完整仪表盘配置；
`scripts/deploy-ha-dashboard.py` 使用 `HA_TOKEN` 经 WebSocket API 创建或更新页面。

逐机记录实际生成的 `camera.*`、`switch.*`、`sensor.*` 与 `binary_sensor.*` 实体 ID。

## 13. 端到端交付验收

- 完全断电后，SSH、控制 API、RTSP 和灯光自动恢复。
- 主流、子流连续运行，音频可听。
- Frigate Live、Review、录像、快照和对象检测可用。
- 录像真实写入 NAS并可回放。
- HA 网页和移动端可查看、回放和控制。
- 每次 PTZ 动作会停止，不会持续运动到机械限位。
- HAOS、Frigate 和摄像头分别重启后均无需人工修复。
- 云模式回退命令与该机备份位置已有记录。
- 旧 PPPP 媒体进程和 `ipcam-console` ffmpeg 均未常驻。

## 14. 常见失败分支

| 现象 | 处理 |
| --- | --- |
| 不知道新机 IP | 以路由器 DHCP 租约和机身 MAC 为准 |
| 2323 未开放 | 检查 SD 格式、钩子路径、文件名、LF 换行和 `start.sh` 引用 |
| telnet 可用、SSH 不起 | 检查架构、主机密钥、`authorized_keys`、`/bak` 可写、IPv4 监听 |
| `/home/eye.conf` 存在但 8001 不开 | 确认文件为 0 字节，回退后分析该机自己的 SONG TOOL 分支 |
| RTSP 花屏或断流 | 强制 TCP，随后处理摄像头 Wi-Fi 信号与供电 |
| Frigate 404 restream | 先看 go2rtc `/api/streams` 中上游连接错误 |
| 录像可用、浏览器无直播 | 识别为客户端 HEVC 兼容问题，再增加按需 H.264 流 |
| HA 控制显示成功但设备不动 | 控制 API 必须把脚本/CGI 非零结果映射为非 2xx |
| NAS 无录像 | 核对 HA 网络存储名称 `frigate` 与 `/media/frigate` 实际挂载 |

## 15. 参考

- iCam365 配网 FAQ：<https://icam365.app/connecting-icam365-camera-faq/>
- Frigate HAOS 网络存储：<https://docs.frigate.video/guides/ha_network_storage>
- Frigate go2rtc：<https://docs.frigate.video/guides/configuring_go2rtc/>
- Frigate HA 集成：<https://docs.frigate.video/integrations/home-assistant/>
- Advanced Camera Card：<https://card.camera/>
