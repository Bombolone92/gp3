# tangecam-control persistence (from /bak flash)
( i=0; while [ ! -x /bak/tangecam/run-control.sh ]; do
    sleep 3
    i=$((i+1))
    [ "$i" -gt 60 ] && exit 0
  done
  TANGECAM_DIR=/bak/tangecam /bak/tangecam/run-control.sh
) &
