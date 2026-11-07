# tangecam-control

运行在 iCam365/Wosee 同源摄像头内的轻量 HTTP 控制服务。服务直接调用设备上的
`ptz.sh`，并通过环回地址访问白光灯 CGI；Home Assistant 只需发送普通 HTTP
请求，不再为每次操作建立 SSH 连接。

- 单个无共享库依赖的静态 ARMv7 ELF
- 默认监听 `0.0.0.0:8080`
- PTZ 动作严格使用白名单，可选参数具有固定 JSON 类型与数量
- 请求串行执行，避免多个 `ptz.sh` 同时操作设备 PTZ
- 所有 API 响应均为 JSON，失败时返回对应的 4xx/5xx 状态
- 请求体上限 2048 字节，PTZ 与灯光调用默认超时 5 秒

## API

### 健康状态

```http
GET /health
```

```json
{
  "ok": true,
  "service": "tangecam-control",
  "version": "0.1.0",
  "uptime_seconds": 12,
  "ptz_ready": true
}
```

当 `ptz.sh` 不可读时，接口返回 `503`，同时 `ok` 和 `ptz_ready` 均为
`false`。

### PTZ

```http
POST /ptz
Content-Type: application/json

{"action":"left"}
```

允许的 `action`：

```text
left right up down lu ru ld rd stop zoom-in zoom-out
cruise scan speed pos reset
```

八个方向动作默认沿用 `ptz.sh` 的 1 秒点动模式。需要持续运动时传入 JSON
布尔值 `hold: true`，服务会将其转换为脚本的 `--hold` 参数；随后必须另发
`stop`：

```json
{"action":"left","hold":true}
{"action":"stop"}
```

动作会以独立参数执行：

```text
/bin/sh /tmp/mnt/mmc01/0/tangecam/ptz.sh <action> [argument]
```

`speed` 是底层 `ptz_test` 的双轴速度设置，必须提供 x/y 两个有符号 32 位
整数。服务将两个数合并为 `ptz.sh` 所需的单个第二参数；其他动作（包括显示
位置的 `pos`）不接受 `args`：

```json
{"action":"speed","args":[6,6]}
{"action":"pos"}
```

服务始终通过独立的进程参数调用脚本，不会将请求内容拼接为 shell 命令。脚本有
输出时，响应包含 `output`：

```json
{"ok":true,"action":"pos","output":"done"}
```

当前 `ptz.sh` 会将 `ptz_test` 的底层输出重定向，因此 `pos` 的 HTTP 响应只能
返回脚本自身打印的 `done`；服务不会伪造坐标。

### 白光灯

```http
POST /light
Content-Type: application/json

{"mode":"off"}
```

`mode` 只能是 `off`、`on` 或 `2`，分别原样映射至：

```text
http://127.0.0.1:8001/whitelight?mode=off
http://127.0.0.1:8001/whitelight?mode=on
http://127.0.0.1:8001/whitelight?mode=2
```

成功响应示例：

```json
{"ok":true,"mode":"2","upstream_status":200}
```

### 状态码

| 状态 | 含义 |
| --- | --- |
| `200` | 操作成功 |
| `400` | HTTP 或 JSON 格式错误、字段未知、字段类型错误 |
| `404` | 路径不存在 |
| `405` | HTTP 方法错误，响应带 `Allow` |
| `408` | 读取 HTTP 请求超时 |
| `411` | POST 缺少 `Content-Length` |
| `413` | 请求体超过 2048 字节 |
| `415` | POST 不是 `application/json` |
| `422` | PTZ 动作、动作参数、`hold` 用法或灯光模式无效 |
| `431` | 请求头超过 8192 字节 |
| `502` | `ptz.sh` 返回非零值，或灯光 CGI 连接/响应失败 |
| `503` | `ptz.sh` 不可读 |
| `504` | PTZ 或灯光 CGI 调用超时 |

错误响应使用统一结构：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_action",
    "message": "unsupported PTZ action"
  }
}
```

## 构建

开发机需要 Zig；目标程序只使用 libc/POSIX，不依赖设备上的共享库。

```bash
cd /home/<user>/Repos/tangecam-control
make armv7
file build/tangecam-control-armv7
```

产物是与设备原生程序一致的 ARMv7 EABI5 hard-float ABI，并使用 musl 静态
链接：

```text
build/tangecam-control-armv7
```

## 本机测试

测试会构建 amd64 本机程序，启动模拟 `ptz.sh` 与模拟灯光 CGI，然后验证健康
状态、合法控制、参数透传、输入拒绝和上游失败响应：

```bash
make test
```

测试只使用 Python 标准库，通过 `uv run` 执行。

## 设备运行

将 ARMv7 产物放到 SD 卡持久目录，并赋予执行权限：

```bash
chmod 755 /tmp/mnt/mmc01/0/tangecam/tangecam-control
/tmp/mnt/mmc01/0/tangecam/tangecam-control
```

服务保持前台运行。仓库中的 `device/run-control.sh` 负责后台监督：服务退出后
3 秒重启，运行日志写入设备 RAM 中的 `/tmp/tangecam-control.log`。完整参数如下：

```text
--bind ADDRESS       监听 IPv4 地址，默认 0.0.0.0
--port PORT          监听端口，默认 8080
--ptz-script PATH    PTZ 脚本，默认 /tmp/mnt/mmc01/0/tangecam/ptz.sh
--light-host HOST    灯光 CGI 主机，默认 127.0.0.1
--light-port PORT    灯光 CGI 端口，默认 8001
--timeout-ms MS      PTZ/CGI 超时，默认 5000，范围 100..60000
```

本机调用示例：

```bash
curl -sS http://CAMERA_IP:8080/health
curl -sS -X POST http://CAMERA_IP:8080/ptz \
  -H 'Content-Type: application/json' -d '{"action":"right","hold":true}'
curl -sS -X POST http://CAMERA_IP:8080/ptz \
  -H 'Content-Type: application/json' -d '{"action":"stop"}'
curl -sS -X POST http://CAMERA_IP:8080/light \
  -H 'Content-Type: application/json' -d '{"mode":"2"}'
```

### 开机启动

将二进制与监督脚本固化到机身可写分区 `/bak`（控制服务仅 ~87KB，无需 SD 卡）：

```bash
mkdir -p /bak/tangecam
cp build/tangecam-control-armv7 /bak/tangecam/tangecam-control
cp device/ptz.sh /bak/tangecam/ptz.sh
cp device/run-control.sh /bak/tangecam/run-control.sh
chmod 755 /bak/tangecam/tangecam-control /bak/tangecam/ptz.sh /bak/tangecam/run-control.sh
```

将 `device/custom_init.snippet.sh` 追加到该设备自己的 `/bak/custom_init.sh`。
Ts300/QV 固件会在每次启动时调用该文件；片段从 `/bak` 启动监督脚本。
监督脚本使用 `/tmp/tangecam-control-supervisor.lock` 防止重复实例。部署后验证：

```bash
curl -fsS http://CAMERA_IP:8080/health
```

## Home Assistant

`configuration.yaml` 中可直接定义 REST action：

```yaml
rest_command:
  tangecam_ptz:
    url: "http://CAMERA_IP:8080/ptz"
    method: POST
    content_type: "application/json"
    payload: '{"action":"{{ action }}"}'

  tangecam_ptz_hold:
    url: "http://CAMERA_IP:8080/ptz"
    method: POST
    content_type: "application/json"
    payload: '{"action":"{{ action }}","hold":true}'

  tangecam_light:
    url: "http://CAMERA_IP:8080/light"
    method: POST
    content_type: "application/json"
    payload: '{"mode":"{{ mode }}"}'
```

调用示例：

```yaml
action: rest_command.tangecam_ptz
data:
  action: left
```

`tangecam_ptz` 使用点动模式。持续移动时调用 `tangecam_ptz_hold`，并由 HA
在按键释放或延时结束后再调用一次 `tangecam_ptz`，传入 `action: stop`。
