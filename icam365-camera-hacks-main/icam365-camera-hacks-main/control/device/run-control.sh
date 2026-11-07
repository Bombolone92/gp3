#!/bin/sh

TANGECAM_DIR=${TANGECAM_DIR:-/tmp/mnt/mmc01/0/tangecam}
LOCK_DIR=/tmp/tangecam-control-supervisor.lock
LOG_FILE=/tmp/tangecam-control.log
CHILD_PID=

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    exit 0
fi

cleanup()
{
    if [ -n "$CHILD_PID" ]; then
        kill "$CHILD_PID" 2>/dev/null
        wait "$CHILD_PID" 2>/dev/null
    fi
    rmdir "$LOCK_DIR" 2>/dev/null
    exit 0
}

trap cleanup INT TERM
: > "$LOG_FILE"

while [ ! -x "$TANGECAM_DIR/tangecam-control" ]; do
    sleep 3
done

while true; do
    "$TANGECAM_DIR/tangecam-control" \
        --bind 0.0.0.0 \
        --port 8080 \
        --ptz-script "$TANGECAM_DIR/ptz.sh" \
        --light-host 127.0.0.1 \
        --light-port 8001 \
        --timeout-ms 5000 >> "$LOG_FILE" 2>&1 &
    CHILD_PID=$!
    wait "$CHILD_PID"
    STATUS=$?
    CHILD_PID=
    printf 'service exited with status %s\n' "$STATUS" >> "$LOG_FILE"
    sleep 3
done
