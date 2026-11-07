#!/bin/sh
# ptz.sh v2 - 本地 PTZ 控制（/dev/ptz via ptz_test ioctl）点动安全版
# 用法: ptz.sh <方向|功能> [速度|--hold]
#   方向: left right up down lu ru ld rd (1-8) —— 默认点动：动作后自动 stop
#   功能: stop zoom-in zoom-out cruise scan speed pos reset
#   --hold: 持续运动（方向后不发 stop，需另行 ptz.sh stop）
[ -n "$1" ] || { echo "usage: ptz.sh <left|right|up|down|lu|ru|ld|rd|stop|zoom-in|zoom-out|cruise|scan|speed|pos|reset> [speed|--hold]"; exit 1; }
case "$1" in
  left)    cmd=1;;
  right)   cmd=2;;
  up)      cmd=3;;
  down)    cmd=4;;
  lu)      cmd=5;;
  ru)      cmd=6;;
  ld)      cmd=7;;
  rd)      cmd=8;;
  stop)    cmd=0;;
  zoom-in) cmd=9;;
  zoom-out)cmd=a;;
  cruise)  cmd=e;;
  scan)    cmd=f;;
  speed)   cmd=g;;
  pos)     cmd=p;;
  reset)   cmd=r;;
  *)       cmd="$1";;
esac
HOLD=0
[ "$2" = "--hold" ] && HOLD=1
if [ "$HOLD" = "1" ]; then
  printf "%s\nq\n" "$cmd" | /bin/ptz_test >/dev/null 2>&1
  echo "HOLD: 持续运动中，用 'ptz.sh stop' 停止"
else
  if [ -n "$2" ] && [ "$2" != "--hold" ]; then
    printf "%s\n%s\nq\n" "$cmd" "$2" | /bin/ptz_test >/dev/null 2>&1
    sleep 1
    printf "0\nq\n" | /bin/ptz_test >/dev/null 2>&1
  else
    printf "%s\nq\n" "$cmd" | /bin/ptz_test >/dev/null 2>&1
    sleep 1
    printf "0\nq\n" | /bin/ptz_test >/dev/null 2>&1
  fi
  echo "done"
fi
