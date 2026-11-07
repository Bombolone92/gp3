# iCam365/Wosee 摄像头（CNAD 系）本地协议全链逆解（2026-08-21）

## 结论（已实测）

不依赖手机 App、不依赖云看到的视频拉流，**电脑可直连摄像头**：
1. 目录服务器（UDP 32100）P2P_REQ 唤醒 → PUNCH_TO 下发摄像头 LAN 地址 → PunchPkt 打洞 → 直连会话（已用 cs2pppp 实测 DIRECT OK）
2. 会话后发 DRW 启动序列 → 摄像头推流（DRW ch=1 加密帧 + ch=2 1028B 密文块，实测 872 帧/15s）
3. 视频加密流（ch2 流密码、f0 元帧含格式头）**尚未破解**——需深挖 libInnoSecure/libPPCS_API 加密实现（待续）

## 设备信息

- 摄像头：杂牌单目摇头机，App = Wosee（com.tange365.wosee），后端探鸽智能（Tange）Closeli 系
- 局域网：CAMERA_IP（MAC XX:XX:XX:XX:XX:XX，与配网热点 MAC 一致；随机 MAC 莫认错：.95 是荣耀设备曾误判）
- **设备 ID（DID）**：`CNAD-XXXXXXXX-XXXXXX`（wire 20B = `434e4144000000000001b7a95552435555000000`：8B ASCII prefix + u32 serial + 8B check）
- 目录服务器（UDP 32100）：8.133.176.72 / 47.106.109.158 / 8.140.211.129
- 会话唤醒后 LAN 端口动态段（16643-16649 / 21772-21778 / 21340 / 29652 / 21733 等，每会话变化）；静止时仅 53 端口（TCP 全关）

## 协议（抓包实证，pcap=/tmp/wosee.pcap，PCAPdroid VPN 抓取）

- TCP 通道封装：`u16 len + 68 00 00 00 00 00 + payload`（每段自包含）
- 帧头：`f1 <type> <u16 len> body`
- 类型：0x00 HELLO / 0x01 ACK / 0x20 P2P_REQ（UID+sockaddr=36B）/ 0x21 ACK / 0x40 PUNCH_TO / 0x41 PUNCH_PKT（UID 20B）/ 0x43 RLY_HELLO（含 sockaddr）/ 0x44 P2P_RDY / 0x67 LIST_REQ1 / 0x82 RLY_TO（sockaddr+seq）/ 0xE0 ALIVE / 0xF9 SESSION_RDY（84B，prop_enc 加密）/ 0xD0 DRW / 0xD1 ACK
- sockaddr（目录方言）：`0002 + port LE + IP 反序 + 8B pad`
- **prop_table（256B S-box）**：所有 so 通用，实测在 `libPPCS_API.so @0x10838`，开头 `7c9ce84a13dedc...`（与老 XOR1 表同源）；key=`SSD@cs2-network.` → prop_select4key=(97,105,214,91)
- SESSION_RDY 明文（84B）：UID(20) + [0x28]wan_sockaddr(16) + [0x38]peer_sockaddr(16) + [0x50]ts(4)（cs2pppp 源码）
- DRW JSON 命令：`f1 d0 <len> d1 <ch> <cmd16> <body>`；JSON body：`<cmd 字节> 80 00 00 <u32 len> <json>`；二进制命令 body 按 cmd（0x0228/0x03ff）
- 开流序列（抓包原样重放即可）：f781 登录（含 24B base64 会话密钥 `ShmMWkAkIzmg7TdBw0aoKMKehldCtCJL`）/ f833 0x0124 / f902 0x0228 时间 / f927 0x03ff VIDEOSTART → 设备回 feature JSON（0x0125）→ ch1 336B 加密帧 + ch2 1028B 密文块
- 官方对照：TCI_CMD_VIDEOSTART=0x1ff；REQ 偶/RESP=REQ+1；AICAM_<sn> 热点命名即探鸽 AP 配网

## 工具链（各有坑）

- **cs2pppp**（wmarquardt，pip 包）：完整状态机可用！坑：`to_real` 会把 CNAD 撞 PREFIX_MAP(C→CHCC) 弄坏 DID —— **直接构造 PpppSession(real_did="CNAD-XXXXXXXX-XXXXXX") 绕过**；client.device() 也调 to_real 不能用
- cs2pppp 用法：`configure_tables(prop_table=so[0x10838..])` + `sess.open(prefer="direct")` 即唤醒+直连；`prefer="relay"` 走云中继（不需 LAN 端口）
- aiopppp / 365cam-stream：不兼容（老 DG* 前缀）
- radzki/CloseliStreamServerRemote：Closeli 云账号体系，探鸽账号不互通
- PCAPdroid v2 导出 pcap：PCAPdroid→最近保存→导出选 pcap（csv 无载荷，白抓）

## 后续待办

1. 视频流解密（ch2 流密码；libInnoSecure.so / libPPCS_API.so / libdevInfo.so 深挖，或 Frida hook App 的 FFmpeg avio 层 AVIOContext 缓存）
2. 可写独立 Python 客户端（PpppSession + 开流序列重放），把 ch2 密文 dump 后离线解
3. 若只需快照：可先试 App 的「抓拍」命令是否明文 JPEG（0x0229 类返回）

## 2026-08-21 夜 里程碑补充（全功能解锁实测）

- **视频**: DRW ch=2 (1028B 块) = 明文 HEVC 1920x1080！f0=32B 帧头(ts+len)后 VPS/SPS/PPS+大帧；NAL 起始码重组→ffmpeg -f hevc 直接解码出帧。**无加密**
- **音频**: DRW ch=1 (336B 帧) = 明文 G.711 A-law 8kHz：16B SFrameInfo 头(codec_id=0x008a/frame_size=320/ts) + 320B 采样(40ms)，静音=0xD5。ffmpeg -f alaw 解码成功
- **PTZ 实测字节**: 0x1001 PTZ_LONG_COMMAND {control(2=下/3=左/6=右/8=右下), speed=6}，24B 帧：f1 d0 0014 d1 00 00 <seq> + 01100000 0c000000 0c000000 00000000 (结构体 0x1001/control/speed)
- **灯光实测字节**: 0x8014 SET_WHITELIGHT: f1 d0 0018 d1 00 00 <seq> + 14800000 0c000000 + <12B, mode 在末4B: 0=红外/1=全彩/2=智能>
- **日间/夜间**: 设备自动(DayNight=Auto)；手动 0x8018 {channel, mode 0auto/1day/2night} 备用
- **采集脚本**: 开流序列(f781 登录/0x0124/0x0228/0x03ff)重放 → ch1/ch2 分帧保存 → NAL/a-law 解码（/tmp/capture_full.py 等，正式版待迁 Repos）

### 完整激活链（实测可行）
PpppSession(real_did=CNAD-XXXXXXXX-XXXXXX, servers=三目录, port=32100).open(prefer="direct") → P2P_REQ 唤醒+PUNCH_TO+PunchPkt→P2P_RDY → 重放 4 帧启动序列 → 摄像头推流（ch1 音频 ch2 视频明文）


## 2026-08-22 凌晨 花屏根因与 TCP 通道（待续）

- **花屏根因**：UDP 打洞通道丢块（摄像头弱 WiFi，ping .94 曾 50% 丢包）→ HEVC P 帧缺参考 → 花屏/绿屏（ffmpeg 报 Could not find ref with POC）。首帧正常后续花
- **App 为什么完美**：App 媒体走 **TCP**（昨晚 pcap tcp.stream 32 铁证：手机 40940→16646）→ 重传保证完整
- **TCP 通道规模**：激活态 nmap 发现 **TCP 20202** 开放（ipdtp-port）；App 连的端口=RLY_HELLO(f1 43) body[24:26] 报告值（上一轮=16646）；cs2pppp peer.port 是 UDP 口≠TCP 口
- **未解决**：RLY_HELLO 捕获时机（cs2pppp 打开后没收到 0x43）、TCP 口获取流程、20202 与 RLY 口关系、TCP 会话全流程
- **尝试无效**：SETSTREAMCTRL 0x0320 quality=5 未降码率（块仍 1016B）；TCP 同号端口 refused
- **明日续**：punch 后主动收 RLY_HELLO（或参考 App 全流程重放抓包）→ 定位 TCP 口 → check_user 0x8002 登录 → TCP 收流验证画质
- 补充：console 已修 engine.loop 赋值 bug + ffmpeg writer 独立线程（仍受 UDP 丢包限制）


## 2026-08-22 下午 root 攻坚战报（SD 卡 root / SSH / RTSP 追踪）

### 已定版生产配置
- **SD 卡 root 钩子确认**：设备=Ts300 平台（hostname Ts300, Linux 4.14.249 ARMv7, buildroot 2025-09, **jffs2 分区：home(320K rw)/bak(4.2M ro→可 remount rw)**，**无 IPv6**，firmware_id=`aj_ipc_qv_004`（QV=探头新一代平台，非 Augentix/Goke），UUID=WS227EPJD4SK，P2P DID=CNAD-XXXXXXXX-XXXXXX
- **卡挂载点=/tmp/mnt/mmc01/0**（jphein 脚本 units/ 目录证据）；debug_cmd.sh 钩子=start.sh:66 前调用（start.sh:204-217 eye.conf 逻辑：`-s` 非空才同步）
- **持久 SSH**：dropbear（zig+musl 交叉编译 armv7 静态，3.3MB，dropbearkey 2.4MB）放**卡上**（/tmp/mnt/mmc01/0/tangecam/），custom_init.sh 注入自愈段（while 等 mmc 挂载→remount rw /bak→cp authorized_keys→bind /bak/root→dropbear -p 0.0.0.0:2222 -r dbkey_ed25519）；SSH 登录=~/.ssh/<operator_key>（ssh -i … -p 2222 root@CAMERA_IP）
- **关键坑**：① dropbear 默认双栈在无 IPv6 内核失败→**必须 `-p 0.0.0.0:2222`** ② telnet 传文件 tty 行缓冲 4096 截断→**base64 每行 ≤1000B** ③ ssh/cat 传二进制直接 `ssh root@cam "cat /file" > local`（设备无 sftp/scp）④ /bak remount rw 后 touch 生效
- **flash 全备份**：/tmp/mnt/mmc01/0/tangecam/flash/mtd0-4.bin（5 分区 8.4MB，md5 已记）
- **日志金矿**：/tmp/icam365.log 明文记录 `tcGetP2pToken:<token>, password:<32B base64>`（**密码获取=SSH grep 一行**——根治旧抓包法）；云端 socket.io 链路 cn-reg-node003.tange365.com；user_id=31304408；admin/222222

### RTSP 追踪（未完成，待续）
- p2pcam 内置 RTSP server（RTSP/1.0、x-rtsp-tunnelled、rtspsvc realm），开关逻辑：`support_onvif`（配置）+ `onvifOff already in status` + `setOnvifOff` 字符串
- 已试：touch /home/eye.conf → 8001 开但 554 没开；写 /bak/defalut.config（**错拼，p2pcam 源码 lib）`support_onvif = 1` + hwcfg.ini 追加 → 554 仍关；App 无「NVR Connection」菜单（探鸽新版移除）
- p2pcam 二进制已拉回 **/tmp/p2pcam**（5.35MB, md5 cf84071560f47b1b5f5e8f27e5ac5b18）——字符串 xref 定位未成功（LDR pool/movw-movt/Thumb2 三种模式 capstone 零命中；llvm-objdump 反汇编可用 778K 行 /tmp/p2pcam.asm；objdump 不支持 ARM）
- **续攻方案**：Ghidra headless 分析 is_rtsp_enabled/ctp_server_init 等价函数（参照 Jalecom HC1703 地址 0x2802c 同型）；或 zsgx1hacks #64 先例：p2pcam 字节 patch（0x00035EFC 改快照）后放 /home 生效（**p2pcam 包 /home 优先机制**！）
- p2pcam 登录时序铁律：**每次会话 15 秒后被 -90002 踢**（p2pRecvCmdReq）——密码正确也一样——疑似「只有首个会话能推流」或窗口期，与 App 是否在线无关（用户 App 关+无竞争也失败）

### 本地化现状（可交付）
- ✅ SSH 2222 / telnet 2323 常驻（拔卡/重启均自愈，重启后约 20-60s 恢复）
- ✅ 8001 HTTP PTZ（本地模式）：`ptzctrl?act=1 上 / act=3 下` 实测有效（act=2/4 无效！左右不在此 CGI）；另确认 8000 端口也在 listen
- ✅ **/dev/ptz ioctl PTZ（全功能，推荐通道）**：`/bin/ptz_test` 菜单 1左 2右 3上 4下 5-8对角 9/a变焦 e巡航 f自动扫描 g速度 p位置 r复位（x/y-speed 默认 32）；已封装 **SD 卡 /tmp/mnt/mmc01/0/tangecam/ptz.sh**（用法 `sh ptz.sh <left|right|up|down|lu|ru|ld|rd|stop|zoom-in|zoom-out|cruise|scan|speed|pos|reset> [speed]`），实测 left/right 通
- ✅ **视频流（本地 RTSP，不依赖云/PPP）**：`rtsp://admin:@CAMERA_IP:8001/0/av0` = HEVC 1920x1080 @13fps + pcm_alaw 音频（8kHz 单声道）；`/0/av1` = HEVC 640x360 + pcm_alaw。SONG TOOL 本地模式把 RTSP server 绑在 8001（554 被注册标志卡住但 8001 流不受影响），服务端标识「TAS-Tech Live Cast」（探鸽 TAS 自研 RTSP server，与 Jalecom rtspsvc realm 一致）。验证：ffmpeg -t 5 -rtsp_transport tcp -i ... -c copy → mkv（mp4 不支持 alaw）；mpv --hwdec=auto --rtsp-transport=tcp 直接预览稳定。工具：ffprobe/ffmpeg 均可
- ✅ 本地模式切换固化：`touch /home/eye.conf`（0 字节）→ 重启设备（`kill p2pcam` 会触发 watchdog 自动整机重启，或拔电）→ start.sh 不处理 0 字节文件，p2pcam 读 /home/eye.conf 解码失败 → 走 SONG TOOL 本地路径 → 8001 起。恢复云模式：删 /home/eye.conf 重启（/bak/eye.conf 48B 原文件 + SD 卡 eye.conf.orig.bak 双备份）
- ✅ PPPP 视频（tangecam 控制台 8765）：**仅剩「密码时效+会话窗口」未稳定**（上午多次成功）
- ⏳ 554 RTSP：待 Ghidra patch 或下次固件（注：本地模式下的 8001 RTSP 已解决画面，554 仅剩「ONVIF 标准端口」意义）
- 坑：设备 WiFi 弱会闪断（08-22 下午网络短暂 No route，自动恢复；ARP 观察 MAC 44:90:ba:e5:44:89）；**ptz_test 方向命令=持续运动模型，必须显式发 0(stop)，退出程序不会自动停——曾两次转到机械极限卡死导致整机重启（uptime 归零自愈），ptz.sh v2 已改为动作后自动 stop 的点动模式（--hold 才持续）**；ptz_test 管道路径（printf 管道喂 stdin），设备端无 heredoc 需求但脚本须兼容 busybox sh


## 2026-08-22 社区调研：同型摄像头破解先例（general 子代理）

### 核心结论
- **设备与 Jalecom AJ HC1703L 同源**（Anjvision AJ 家族，`aj_ipc_qv_004` vs `aj_ipc_hc2_001`）：p2pcam 固件结构（/bak/start.sh、p2pcam.sqfs、eye.conf、defalut.config、hardinfo.bin、SONG TOOL INIT 字符串、cxlinux 密码、closeli/tange365 云）完全一致；SoC/内核不同（Augentix/3.18 vs QV/4.14）
- **554 根因（高可信）**：Jalecom 二进制分析：`is_rtsp_enabled()` = `g_onvif_enabled != 0` **且** `g_dev_config[0x3c4] == 0`（未注册云）。我们的相机已注册（UUID/DID）→ 第二条件不满足，554 永不绑。`touch /home/eye.conf` 只让 8001 生效与此吻合
- **社区验证绕过 = patch p2pcam 二进制**：4PDA levantez 教程，已在 HC1703 33.2.0.0920 实测成功（PWLgit 确认 onvif+rtsp 常开）

### p2pcam patch 流程（4PDA levantez，方法通用偏移自找）
1. root 后 p2pcam 在 `/bak/p2pcam.sqfs`，下载解包
2. Binary Ninja/Ghidra 搜字符串 `--------------SONG TOOL INIT------------`（14 个横线），找决定分支的检查函数（该用户固件 0x0002d548）
3. 函数头两行改 `mov r0, #1; bx lr`（强制返回真 → 永远走完整 SONG TOOL 分支）
4. **`mksquashfs ... -comp XZ` 重打包**（默认 gzip 不行，原镜像即 XZ，gzip 会导致相机不挂载/不起机——PWLgit 血泪教训）
5. 改 /bak/start.sh：优先挂载 SD 卡新镜像 `[ -f /mnt/p2pcam_new.sqfs ] && mount ... || mount /bak/p2pcam.sqfs`（拔 SD 即还原）
6. 该帖原话点题：「厂商不是移除了本地广播，而是把它固定死了使它永远不触发」——与 8001 开 554 死也不开完全一致

### 关键参考资料
| 来源 | 摘要 |
|---|---|
| github.com/Jalecom/AJ_HC1703L_Teardown | 同源拆解：UART root、SD debug_cmd.sh 钩子、持久 hack v0.4、p2pcam 二进制分析（554 机制）、`tools/gen_eyeconf.py`（eye.conf LSB-first DES 变体 key "iloveyou"，decode/encode 32B P2P serial）；触发文件表：debug_cmd.sh/firmware.bin/FSRW/rmid(删 /bak/eye.conf)/HARDTEST(工厂 QA：telnetd+置 ONVIF/P2P 标志，副作 RTC 重置 2000 年)/DUMPLOG；API：admin:@IP:554、/0/av0、/0/av1(640x368)、8001 同款 + playaudio/irctrl/whitelight/buleled/redled/ircut_only/redinfra/testdualsensor |
| 4pda.to forum 928641 (st=3100) | Closeli 系大本营（GK7102 + HC1703/探鸽新代）；「ONVIF 只在配置后短暂可用、重启消失」（PWLgit 33.0.0.0426 复现）；Патч#4 3.4.0.1031；ivideon 20-30s 断流 |
| github.com/ant-thomas/zsgx1hacks | ZS-GX1 (GK7102) 415 星；#64 roleo p2pcam 字节 patch 先例（0x00035EFC F0->B4 快照分辨率，patched 在 repository.ilpuntotecnico.com/files/roleo/public/guudgo_gd-sc03/p2pcam.tgz）；#35/#90/#98/#119 support_onvif 键大全与小结论（554/ONVIF 缺失=hwcfg.ini 缺 support_onvif=1，但 QV 代固件追加无效=「固定死」佐证）；#16 rtsp://admin:@IP:554 空密码；#56 **RTSP 试用期机制**（GUUDGO 14 天试用后仍可 hack）；#94 kill p2pcam 换独立 RTSP server（GM8136）；#34 NVR 连 RTSP 每分钟重启相机（防御机制？）；**注意 GK7102 是 /home 优先加载，QV/HC1703 是 /bak/p2pcam.sqfs——#64 放 /home 对我们不适用，正确路径=SD 新 sqfs+start.sh 优先挂载** |
| github.com/DavidVentura/cam-reverse | iLnkP2P/PPPP 协议重实现（Ghidra+Frida，181 星）；会话序列：LanSearch→PunchPkt→P2PRdy→ConnectUser(Ticket)→**每 400-500ms P2PAlive/P2PAliveAck**→StreamStart(Ticket)→DRW 流；#51 停发视频后随机掉线疑缺心跳 |
| github.com/elastic/camera-hacks p2p/p2p_client.py | Wansview PPPP 客户端完整实现：f1e0 ALIVE/f1e1 ALIVE_ACK/f1f0 CLOSE 包格式，可直接对照查控制台心跳 |
| github.com/magicus/pppp-dissector + pmarrapese/iot p2p/dissector | PPPP Wireshark dissector + pppp.fdesc（T_result: 0 OK/0xFF INVALID_UID/0xFE DEVICE_OFFLINE/0xFD INVALID_PREFIX/0xFC INVALID_DSK） |
| github.com/leejansq/p2p Include/IOTCAPIs.h | TUTK IOTC：**`IOTC_SESSION_ALIVE_TIMEOUT 15`**（15 秒！）、-23 超时断连、-18/-45 会话数/多登录 |
| github.com/tasarren/lsc-tuya-toolkit | Anyka 工厂测试标志文件 → RTSP 即开（方法借鉴，与 HARDTEST 同构） |
| device-sdk-docs.tange365.com | **探鸽官方公开 SDK 文档**（Rev.368 简中）：TCE_*/ECP_E_*/ICAM_E_*(-18001…-18108) 均不含 -90002 → 属底层 P2P/会话层；含「远程 telnet」专题；github.com/tangeai 官方账号（openspec、tirtc-server-example） |

### -90002 / 15 秒被踢：根因假设（按可信度）
1. **【高】ALIVE 心跳未维持 → 15 秒超时**：TUTK IOTC_SESSION_ALIVE_TIMEOUT=15 精确吻合；标准要求每 400-500ms 双向 P2PAlive/P2PAliveAck。行动：wireshark 抓 f1e0/f1e1 交换，盯 15 秒前最后包
2. 【中】服务器会话数限制/单流窗口：完全断开 App + 重启相机 + 只跑 tangecam 再试
3. 【中】-90002 私有错误码：`-90002 = 0xFFFFEA0E`，小端 `EA 0E FF FF`，`grep -oba` 在 p2pcam 里找立即数池/xref；并抓包区分设备↔中继↔云哪条路径踢的
4. 【低】试用期/未绑定限制（#56 同族机制）

### 下一步候选
- 最优路线 = 方案 A（p2pcam patch + XZ sqfs + SD 优先挂载，同家族实测 100% 成功，拔 SD 可逆）
- 零成本探测 B：HARDTEST（工厂 QA 置 ONVIF 标志，RTC 重置 2000 副作用）/ FSRW / rmid（删 /bak/eye.conf）
- 备用：先下 Jalecom `tools/gen_eyeconf.py`，确认 mtd 备份里原始 eye.conf 可解回 32B serial（serial = App 设备详情里完整 32 字符，可找回）
- 海外白标版（YCC365 Plus / AJCloud 等）固件可能未做「固定死」，其 p2pcam 可交叉参照；PWLgit 第二台固件 57.0.0.0308 原生支持 onvif+rtsp 是实证


## 2026-08-22 ipcam-console 网页端重构（RTSP 源，general 子代理执行）

- 项目：~/Repos/ipcam-console/（console.py + index.html + go2rtc.yaml + README.md；uv 管理）
- 动机：原视频源走 tangecam.Camera（PPP 会话），15s -90002 被踢 + 密码时效 + 弱 WiFi 不稳；8001 本地 RTSP 实测稳定后切换
- 改造（console.py 重写）：
  - 视频源：rtsp://admin:@CAMERA_IP:8001/0/av0，两个 ffmpeg 进程——视频 `-vf scale=1280:-1 -c:v mjpeg -q:v 5 -f mjpeg -`；音频 `-vn -ac 1 -ar 8000 -c:a pcm_s16le -f s16le -`
  - 断流守护：视频/音频各自线程，进程退出或停滞（视频 6s/音频 4s）自动重启，首帧宽限 14s
  - PTZ：SSH root@CAMERA_IP:2222 → `sh /tmp/mnt/mmc01/0/tangecam/ptz.sh <dir>`（点动；串行锁防 /dev/ptz 竞争；8 方向全功能；每命令约 1.5s，dropbear 有瞬时波动）
  - 灯光：8001 CGI `whitelight?mode=0/1/2`（关/全彩/智能，经画面亮度验证语义）
  - 移除 PPP 路径（tangecam/cs2pppp/libPPCS_API.so、9001 hevc TCP、/stream.hevc），pyproject 收敛纯 aiohttp，go2rtc.yaml + README 同步
- 接口契约不变（前端 index.html 零改动）：GET / /video /snapshot /status /ws；POST /ptz /lights；运行 `uv run console.py`（0.0.0.0:8765）
- 实测：state=streaming；/video 6s 取样 87 帧（1280x720）；/ws 32 chunks/4s（2048B s16le）；/ptz /lights 均 ok；kill -9 视频 ffmpeg 后 ~11s 自动恢复 streaming
- 遗留待查（2026-08-22 下午）：浏览器端 canvas 黑屏——backend 正常（/video 出帧完整 50KB/帧），前端 MJPEG 解析走 latin1→btoa 技巧（理论上无损），无头 chromium 截图 canvas 纯黑；根因未定位（未排除：img.src 高频赋值/解码竞争、@media 大图、服务端 chunked 时序）

## 2026-08-22 成熟开源监控台评估与实施

### 当前项目审计

- 生产媒体入口已经足够标准：`rtsp://admin:@CAMERA_IP:8001/0/av0` 经 `ffprobe` 再次确认是 HEVC 1920x1080 12.5fps + PCMA 8kHz 单声道；端口 8001 不影响任何支持自定义 RTSP URL 的 NVR，继续破解 554 对日常取流没有收益。
- `tangecam` 已完成逆向验证使命，保留作 PPPP 协议、命令表和后续对讲研究资料；生产画面不再经过它。
- `ipcam-console` 当前属于验证原型：媒体侧同时维持两条 RTSP 连接，并用两个 ffmpeg 分别转 MJPEG 与 PCM；审计时视频 ffmpeg 约占 8% CPU、RSS 约 639MiB。项目中的 `go2rtc/go2rtc.yaml` 只有 3 行源地址配置，本机没有正式 go2rtc 服务。
- 浏览器黑屏已复现并确定根因：状态栏显示 12.5fps 且 `/snapshot` 是正常 1280x720 JPEG，canvas 仍为纯黑。前端 `TextDecoder("latin1") -> 字符串查 JPEG 边界 -> btoa()` 会把二进制交给 WHATWG Windows-1252 解码，遇到 0x80-0x9F 会生成 U+20AC 等超出 btoa 单字节范围的字符；Node 最小复现明确得到 `InvalidCharacterError: Invalid character`。同时画面计数会在未成功绘制时隐藏占位层。该媒体前端不宜继续作为生产监控台。
- 状态接口还有陈旧值问题：断流后 `state=connecting`，`fps()` 仍按历史 300 帧计算并长期显示 14.9fps，容易把离线状态误读成有流。
- 控制结果处理有确定错误：PTZ 的 `subprocess.run()` 未检查 SSH 返回码，SSH 返回 255 仍会报告成功；`/ptz`、`/lights` 失败仍返回 HTTP 200，前端只检查 HTTP 状态、不读取 JSON `ok`；灯光高亮来自 localStorage 而非设备状态，已出现后端 `lights=2`、页面高亮「全彩」的不一致。
- 媒体队列与生命周期也不适合长期运行：视频发布端对满队列直接 `put_nowait`，可能在事件循环回调中抛 `QueueFull`；音频队列无上限；WebSocket 不自动重连；`CamEngine.stop()` 未注册 `app.on_cleanup`；视频、音频、PTZ、灯光共用一个 `last_error`，下一视频帧会清除其他子系统错误。
- `tangecam` 的 Python A-law 解码器原有符号与幅值错误：输入 `0xD5` 得到 `-1`、`0x55` 得到 `+1`。2026-08-22 已按 G.711 A-law 标准修复并验证为 `+8/-8`；生产链路始终由 ffmpeg 处理，不受旧实现影响。
- 现有 HAOS VM 114 为 4 vCPU、8GiB RAM、64GiB 系统盘，当前只安装 Advanced SSH App；尚无 MQTT、HACS、Frigate。HAOS 可按官方方式把 NAS 共享挂为名为 `frigate` 的 Media 网络存储。PVE 主机另有 Intel Iris Xe `/dev/dri/renderD128`，NAS 当前约 12TB 可用。
- 本轮首次探测时 RTSP、抓拍与 CGI 均正常；后续设备变为 100% 丢包、ARP failed。平台替换只能改善媒体与管理链路，摄像头本身的 Wi-Fi 闪断仍需单独处理。

### 推荐架构：Frigate 0.17.2 + 内置 go2rtc + Home Assistant

```text
摄像头 /0/av0（HEVC 1080p + PCMA）
              |
              v
        Frigate 内置 go2rtc
          |-- 单次拉流与 RTSP 转发
          |-- MSE/WebRTC 实时观看和监听
          |-- 浏览器不兼容 HEVC 时按需转 H.264
          `-- Frigate 原码录像（视频 copy，PCMA -> AAC）

摄像头 /0/av1（640x360）
              `-- Frigate 移动检测/对象检测

设备控制 HTTP 适配层
          |-- PTZ -> 设备 ptz.sh
          `-- 灯光 -> 8001 whitelight CGI
              |
              v
 Home Assistant Advanced Camera Card
```

- **最直接的部署位置**：先使用现有 HAOS 的官方 Frigate App。单路 1080p 原码录像与低分辨率检测，4C/8G 足够起步；录像目录通过 HAOS「网络存储」挂到 NAS，网络存储名称必须是 `frigate`，Frigate 会使用 `/media/frigate`。安装 Mosquitto、MQTT 集成、Frigate App、HACS Frigate 集成及 Advanced Camera Card 后，直播、回放、录像、抓拍、事件、移动端和 HA 自动化都进入同一套界面。
- **媒体配置原则**：go2rtc 只向摄像头建立一条主流连接；Frigate 的 record/detect 再读取本机 `rtsp://127.0.0.1:8554/...` restream。录像保存 HEVC 原码，输出参数使用 `preset-record-generic-audio-aac` 将 PCMA 转 AAC。Linux 浏览器无法稳定播放 HEVC 时增加 `ffmpeg:<stream>#video=h264#audio=aac#hardware` 兼容流；前期也可用 Frigate 的 jsmpeg 直播，避免持续转码。
- **当前客户端无需转码**：本机 Chrome 146 的 WebRTC 接收能力包含 `video/H265` 与 `audio/PCMA/8000`，当前摄像头的 HEVC+PCMA 可由 go2rtc 原样输出；只有增加不支持 HEVC 的客户端时才配置按需 H.264，不能默认常驻转码。
- **go2rtc 直接接口**：播放器 `http://<host>:1984/stream.html?src=cam1`；RTSP 扇出 `rtsp://<host>:8554/cam1`；抓拍 `http://<host>:1984/api/frame.jpeg?src=cam1`；状态 `/api/streams`。当前仓库只有有效的 3 行 YAML，本机尚无正式二进制、服务或 1984/8554/8555 监听；若使用 Frigate，应直接用其内置 go2rtc，不能再叠一层独立实例。
- **控制配置原则**：Frigate 自身的 PTZ 只认 ONVIF，当前设备没有可用 ONVIF 服务。Advanced Camera Card 支持给上下左右、停止和自定义图标绑定任意 HA action，因此由 HA 调 HTTP 控制接口即可把 PTZ、灯光与 Frigate 录像时间线放进同一张卡片。
- **控制适配层已落地**：摄像头 SD 卡上的 ARMv7 静态服务 `tangecam-control` 直接提供 `GET /health`、`POST /ptz` 和 `POST /light`，内部调用 `ptz.sh` 与环回地址 8001 CGI。Home Assistant 经 `rest_command` 直连，日常控制不再建立 SSH 会话；`ipcam-console` 已退出生产链路。
- **后续扩容位置**：摄像头数量增加、持续 H.264 转码或对象检测负载提高时，将 Frigate 迁到 PVE 独立容器，并映射 Intel `renderD128`、绑定 NAS 录像目录；HA 前端和实体层无需改变。
- **仍未覆盖**：双向对讲已有 `tangecam` 的 A-law 上行协议基础，但 go2rtc/Frigate 尚无该私有 backchannel 适配；Frigate 原生 PTZ、预置位和自动追踪需要 ONVIF 适配层。

### 实施结果

- HAOS 已安装 Mosquitto 7.1.0、Frigate App 0.17.2、Frigate HA integration 5.15.4 和 Advanced Camera Card 7.27.4；MQTT、Frigate config entry 与 43 个摄像头实体均 loaded。
- NAS 目录 `/camera-monitoring/frigate` 以 NFS Network Storage `frigate` 挂载到 `/media/frigate`。Frigate 识别为 nfs4，并持续写入录像。
- go2rtc 对设备保持一条主流和一条子流上游。主流 restream 实测 HEVC 1920x1080@12.5fps + PCMA 8kHz mono；子流为 HEVC 640x360@12.5fps + PCMA。Frigate 检测稳定约 5.1fps，CPU detector 推理约 18ms。
- NAS 录像抽样为 HEVC 1920x1080@12.5fps + AAC 8kHz mono；最新快照完整，无黑屏、花屏或块状损坏。录像、clips、previews 与 exports 目录已实际生成。
- 摄像头侧新建 `/home/<user>/Repos/tangecam-control`：85KB ARMv7 EABI5 hard-float 静态 ELF，提供 `GET /health`、`POST /ptz`、`POST /light`；本机 24 项集成测试通过。设备端路径 `/bak/tangecam/tangecam-control`（2026-08-22 已从 SD 卡固化到机身 /bak，SD 卡仅承载 dropbear 载荷，拔卡不影响 PTZ/灯光；SSH 仍与卡绑定），由 `run-control.sh` 监督并经 `/bak/custom_init.sh` 开机启动。
- HA `/config/rest_commands.yaml` 已注册 `tangecam_01_ptz`、`tangecam_01_ptz_hold`、`tangecam_01_light`。从 HA 内部执行 stop、左右往返点动和智能灯光均返回成功。
- 独立仪表盘 `/camera-monitor/live` 已部署：Advanced Camera Card、九个云台点动按钮、关闭/开启/智能三个灯光按钮、监控状态与录像检测开关。
- 旧 `ipcam-console` 与其两条孤立 ffmpeg 已结束，生产媒体只经过 Frigate/go2rtc。
- 部署期间设备发生一次无持久错误日志的整机重启；`custom_init.sh` 自动恢复 Dropbear 和控制服务。主动结束一次控制服务后，监督脚本在 3 秒内恢复，系统运行时间连续，服务级自愈已验收。
- 用户于 2026-08-22 完成实际界面、直播、录像与控制验收，Frigate + Home Assistant 方案正式投入使用。

### 候选项目结论

| 项目 | 结论 |
|---|---|
| Frigate 0.17.2 | 首选；MIT，现代 Review 时间线、原码录像、go2rtc、音频、PWA、HA 集成和硬件加速完整。非 ONVIF 控制放入 HA 卡片。 |
| Viseron 3.6.0 | MIT，功能接近；PTZ 同样仅支持 ONVIF，HA 集成深度低于 Frigate，对本设备没有额外优势。 |
| ZoneMinder 1.38.4 | GPL-2.0，可用自定义控制脚本直接映射 `ptz.sh`；NVR 内置 PTZ 最灵活，但 HEVC 直播、音频、回放界面和 HA 集成均明显陈旧。只在 PTZ 必须位于 NVR 原生页面时考虑。 |
| Shinobi | 技术上支持自定义 GET/PUT/POST 控制；当前维护版使用自定义限制性许可证，开源 CE 已停止维护，不列为标准 FOSS 方案。 |
| Moonfire NVR 0.7.32 | 资源占用低并支持 HEVC，当前仍无音频录像、成熟时间线和 PTZ，不符合完整监控台目标。 |
| go2rtc 1.9.14 | 最适合充当单文件媒体网关，可立即替代自制 MJPEG/PCM 管道；没有录像时间线和 NVR 管理能力，作为 Frigate 内置组件使用更合适。 |

### 官方资料

- Frigate 0.17.2：<https://github.com/blakeblackshear/frigate/releases/tag/v0.17.2>
- go2rtc 配置：<https://docs.frigate.video/guides/configuring_go2rtc/>
- Live View 与音频编解码：<https://docs.frigate.video/configuration/live/>
- 录像、保留和导出：<https://docs.frigate.video/configuration/record/>
- Home Assistant 集成：<https://docs.frigate.video/integrations/home-assistant/>
- HAOS 网络录像存储：<https://docs.frigate.video/guides/ha_network_storage>
- Advanced Camera Card 自定义 PTZ action：<https://github.com/dermotduffy/advanced-camera-card/blob/main/docs/examples.md>
- ZoneMinder 自定义控制脚本：<https://zoneminder.readthedocs.io/en/stable/userguide/cameracontrol.html>
