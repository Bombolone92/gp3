#!/bin/sh
# debug_cmd.sh — iCam365/Wosee 同系摄像头诊断入口
# 已在 Ts300/QV 固件验证；其他平台必须先确认 start.sh 会以 root 调用 SD 卡根目录中的本文件。

# 开 telnetd（root shell）
telnetd -l /bin/sh -p 2323 &

# 收集平台信息（审计用）
{
    echo "=== boot/version ==="
    cat /proc/version
    uname -a
    hostname
    cat /home/firmware_id /bak/firmware_id 2>/dev/null
    echo "=== cpu ==="
    cat /proc/cpuinfo | head -20
    echo "=== mem ==="
    cat /proc/meminfo | head -5
    echo "=== mounts ==="
    mount
    echo "=== sd candidates ==="
    ls -ld /tmp/mnt/mmc* /mnt/mmc* /media/mmc* 2>/dev/null
    echo "=== mtd ==="
    cat /proc/mtd
    echo "=== net ==="
    ifconfig
    echo "=== p2pcam ==="
    ls -la /bin/p2pcam /tmp/p2pcam /home/eye.conf /bak/eye.conf /bak/p2pcam.sqfs 2>/dev/null
    hexdump -C /home/eye.conf 2>/dev/null | head -4
    hexdump -C /bak/eye.conf 2>/dev/null | head -4
    echo "=== cfg ==="
    ls -la /home/config* 2>/dev/null
    cat /home/eye.conf 2>/dev/null | head -2
    echo "=== busybox applets ==="
    busybox --list 2>/dev/null | grep -E '^(httpd|telnetd|nc|wget|sha256sum|md5sum)$'
    echo "=== hook evidence ==="
    grep -n 'debug_cmd\|custom_init' /bak/start.sh /home/start.sh 2>/dev/null
    echo "=== done ==="
} > /tmp/cam_diag.txt 2>&1

# 保持存储可审计
sync
