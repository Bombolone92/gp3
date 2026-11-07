#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6", "websockets>=15"]
# ///
import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import websockets
import yaml


def websocket_url(http_url: str) -> str:
    parsed = urlsplit(http_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunsplit((scheme, parsed.netloc, "/api/websocket", "", ""))


async def command(ws, message_id: int, command_type: str, **data):
    await ws.send(json.dumps({"id": message_id, "type": command_type, **data}))
    response = json.loads(await ws.recv())
    if not response.get("success"):
        raise RuntimeError(response)
    return response.get("result")


async def deploy(ha_url: str, token: str, config_path: Path, url_path: str) -> None:
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    async with websockets.connect(websocket_url(ha_url)) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth = json.loads(await ws.recv())
        if auth.get("type") != "auth_ok":
            raise RuntimeError(auth)

        dashboards = await command(ws, 1, "lovelace/dashboards/list")
        if not any(item.get("url_path") == url_path for item in dashboards):
            await command(
                ws,
                2,
                "lovelace/dashboards/create",
                url_path=url_path,
                title=config["title"],
                icon="mdi:cctv",
                show_in_sidebar=True,
                require_admin=False,
            )
        await command(ws, 3, "lovelace/config/save", url_path=url_path, config=config)
        saved = await command(ws, 4, "lovelace/config", url_path=url_path, force=True)
        print(f"saved {url_path}: {len(saved.get('views', []))} view(s)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ha-url", default="http://HA_IP:8123")
    parser.add_argument("--url-path", default="camera-monitor")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parent.parent
        / "home-assistant"
        / "dashboard-camera-monitor.yml",
    )
    args = parser.parse_args()
    token = os.environ.get("HA_TOKEN")
    if not token:
        raise SystemExit("HA_TOKEN is required")
    asyncio.run(deploy(args.ha_url, token, args.config, args.url_path))


if __name__ == "__main__":
    main()
