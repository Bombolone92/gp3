# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class LightHandler(BaseHTTPRequestHandler):
    paths: list[str] = []

    def do_GET(self) -> None:
        type(self).paths.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, _format: str, *args: object) -> None:
        del args


def unused_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def request(
    port: int,
    method: str,
    path: str,
    body: object | bytes | None = None,
    content_type: str = "application/json",
) -> tuple[int, dict[str, object], dict[str, str]]:
    data: bytes | None
    if body is None:
        data = None
    elif isinstance(body, bytes):
        data = body
    else:
        data = json.dumps(body, separators=(",", ":")).encode()
    headers = {"Content-Type": content_type} if data is not None else {}
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as response:
            return (
                response.status,
                json.loads(response.read()),
                dict(response.headers.items()),
            )
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read()), dict(error.headers.items())


def assert_response(
    result: tuple[int, dict[str, object], dict[str, str]],
    status: int,
    ok: bool,
    code: str | None = None,
) -> dict[str, object]:
    actual_status, payload, _headers = result
    assert actual_status == status, (actual_status, payload)
    assert payload["ok"] is ok, payload
    if code is not None:
        error = payload["error"]
        assert isinstance(error, dict)
        assert error["code"] == code, payload
    return payload


def main() -> None:
    executable = Path(sys.argv[1] if len(sys.argv) > 1 else "build/tangecam-control-native")
    if not executable.is_file():
        raise SystemExit(f"service binary not found: {executable}")

    checks = 0
    with tempfile.TemporaryDirectory(prefix="tangecam-control-") as temp:
        temp_path = Path(temp)
        command_log = temp_path / "ptz.log"
        ptz_script = temp_path / "ptz.sh"
        ptz_script.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$*\" >> \"$TANGECAM_TEST_LOG\"\n"
            "if [ \"$2\" = --hold ]; then echo '持续运动'; fi\n"
            "if [ \"$1\" = reset ]; then\n"
            "  echo 'mock reset failure'\n"
            "  exit 7\n"
            "fi\n"
            "if [ \"$1\" = pos ]; then echo 'pan=12 tilt=34'; fi\n",
            encoding="utf-8",
        )
        ptz_script.chmod(0o755)

        light_server = ThreadingHTTPServer(("127.0.0.1", 0), LightHandler)
        light_thread = threading.Thread(target=light_server.serve_forever, daemon=True)
        light_thread.start()

        service_port = unused_port()
        environment = os.environ.copy()
        environment["TANGECAM_TEST_LOG"] = str(command_log)
        service = subprocess.Popen(
            [
                str(executable.resolve()),
                "--bind",
                "127.0.0.1",
                "--port",
                str(service_port),
                "--ptz-script",
                str(ptz_script),
                "--light-host",
                "127.0.0.1",
                "--light-port",
                str(light_server.server_port),
                "--timeout-ms",
                "1000",
            ],
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            deadline = time.monotonic() + 3
            while True:
                try:
                    result = request(service_port, "GET", "/health")
                    break
                except urllib.error.URLError:
                    if service.poll() is not None:
                        stderr = service.stderr.read() if service.stderr else ""
                        raise AssertionError(f"service exited early: {stderr}")
                    if time.monotonic() >= deadline:
                        raise AssertionError("service did not become ready")
                    time.sleep(0.02)

            payload = assert_response(result, 200, True)
            assert payload["ptz_ready"] is True
            checks += 1

            payload = assert_response(
                request(service_port, "POST", "/ptz", {"action": "lu"}),
                200,
                True,
            )
            assert payload["action"] == "lu"
            checks += 1

            payload = assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "rd", "hold": True},
                ),
                200,
                True,
            )
            assert payload["hold"] is True
            assert payload["output"] == "持续运动"
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "speed", "args": [6, 7]},
                ),
                200,
                True,
            )
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "pos", "args": []},
                ),
                422,
                False,
                "invalid_args",
            )
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "stop", "hold": True},
                ),
                422,
                False,
                "invalid_hold",
            )
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "stop", "hold": False},
                ),
                422,
                False,
                "invalid_hold",
            )
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "left", "hold": "true"},
                ),
                400,
                False,
                "invalid_field_type",
            )
            checks += 1

            payload = assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "pos"},
                ),
                200,
                True,
            )
            assert payload["output"] == "pan=12 tilt=34"
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "speed", "args": [6]},
                ),
                422,
                False,
                "invalid_args",
            )
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "pos", "args": [1, 2]},
                ),
                422,
                False,
                "invalid_args",
            )
            checks += 1

            assert_response(
                request(service_port, "POST", "/ptz", {"action": "shell"}),
                422,
                False,
                "invalid_action",
            )
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "left", "args": [1]},
                ),
                422,
                False,
                "invalid_args",
            )
            checks += 1

            assert_response(
                request(service_port, "POST", "/ptz", {"action": "left", "x": 1}),
                400,
                False,
                "unknown_field",
            )
            checks += 1

            assert_response(
                request(service_port, "POST", "/ptz", b"{"),
                400,
                False,
                "invalid_json",
            )
            checks += 1

            assert_response(
                request(
                    service_port,
                    "POST",
                    "/ptz",
                    {"action": "left"},
                    "text/plain",
                ),
                415,
                False,
                "unsupported_media_type",
            )
            checks += 1

            result = request(service_port, "GET", "/ptz")
            assert_response(result, 405, False, "method_not_allowed")
            assert result[2]["Allow"] == "POST"
            checks += 1

            for mode in ("off", "on", "2"):
                payload = assert_response(
                    request(service_port, "POST", "/light", {"mode": mode}),
                    200,
                    True,
                )
                assert payload["mode"] == mode
                checks += 1
            assert LightHandler.paths[-3:] == [
                "/whitelight?mode=off",
                "/whitelight?mode=on",
                "/whitelight?mode=2",
            ]

            assert_response(
                request(service_port, "POST", "/light", {"mode": "auto"}),
                422,
                False,
                "invalid_mode",
            )
            checks += 1

            payload = assert_response(
                request(service_port, "POST", "/ptz", {"action": "reset"}),
                502,
                False,
                "ptz_failed",
            )
            error = payload["error"]
            assert isinstance(error, dict)
            assert error["exit_code"] == 7
            assert error["output"] == "mock reset failure"
            checks += 1

            assert_response(
                request(service_port, "GET", "/missing"),
                404,
                False,
                "not_found",
            )
            checks += 1

            log_lines = command_log.read_text(encoding="ascii").splitlines()
            assert log_lines[:4] == [
                "lu",
                "rd --hold",
                "speed 6 7",
                "pos",
            ]
            checks += 1
        finally:
            service.terminate()
            try:
                service.wait(timeout=2)
            except subprocess.TimeoutExpired:
                service.kill()
                service.wait(timeout=2)
            light_server.shutdown()
            light_server.server_close()
            light_thread.join(timeout=2)

    print(f"ok: {checks} integration checks passed")


if __name__ == "__main__":
    main()
