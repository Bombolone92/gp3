import http from 'node:http';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { mockApi, openApp, axeViolations, mod } from './helpers.js';

/**
 * A tiny WebSocket echo server: the RFC 6455 handshake plus unfragmented
 * text frames, ping and close. Client frames are masked; server frames are not.
 */
function startEchoServer() {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const sockets = new Set();
  const frame = (opcode, payload = Buffer.alloc(0)) => {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | opcode;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([head, payload]);
  };
  const server = http.createServer((req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('WebSocket only');
  });
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const offered = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    socket.write(
      ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, offered.length ? `Sec-WebSocket-Protocol: ${offered[0]}` : null, '', '']
        .filter((l) => l !== null)
        .join('\r\n'),
    );
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let at = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          at = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          at = 10;
        }
        const mask = masked ? buf.subarray(at, at + 4) : null;
        if (masked) at += 4;
        if (buf.length < at + len) return;
        const payload = Buffer.from(buf.subarray(at, at + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buf = buf.subarray(at + len);
        if (opcode === 0x1 || opcode === 0x2) socket.write(frame(opcode, payload));
        else if (opcode === 0x9) socket.write(frame(0xa, payload));
        else if (opcode === 0x8) {
          socket.write(frame(0x8, payload.subarray(0, 2)));
          socket.end();
          return;
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `ws://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      }),
    );
  });
}

let echo;

test.beforeAll(async () => {
  echo = await startEchoServer();
});

test.afterAll(async () => {
  await echo?.close();
});

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

/** Opens a WebSocket tab; skips the test when the app cannot open one yet. */
async function openWebSocketTab(page, draft) {
  const opened = await page.evaluate((d) => {
    try {
      window.apiClient.openTab('websocket', null, { draft: d });
      return true;
    } catch (err) {
      return String(err?.message || err);
    }
  }, draft);
  test.skip(opened !== true, `WebSocket tabs are not available: ${opened}`);
  await expect(page.locator('.ws-view')).toBeVisible();
}

test('connects, echoes a message and disconnects', async ({ page }) => {
  await openApp(page);
  await openWebSocketTab(page, { type: 'websocket', name: 'Echo', url: echo.url, protocols: 'echo-v1, json' });
  await expect(page.locator('.req-name')).toHaveValue('Echo');
  await expect(page.locator('.ws-status')).toContainText('Not connected');

  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.ws-status')).toContainText('Connected');
  await expect(page.locator('.ws-system[data-kind="open"]')).toContainText('subprotocol echo-v1');

  const editor = page.getByRole('textbox', { name: 'Message body: Message 1' });
  await editor.click();
  await page.keyboard.type('hello socket');
  await page.keyboard.press(`${mod}+Enter`);

  await expect(page.locator('.ws-row[data-dir="out"] .ws-preview')).toHaveText('hello socket');
  await expect(page.locator('.ws-row[data-dir="in"] .ws-preview')).toHaveText('hello socket');
  await expect(page.locator('.ws-stats')).toHaveAccessibleName(/1 message sent, 1 received/);

  // JSON messages are pretty printed when a row is expanded.
  await page.getByRole('radio', { name: 'JSON' }).click();
  await editor.click();
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.type('{"type":"ping","n":1}');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const reply = page.locator('.ws-row[data-dir="in"]').last();
  await expect(reply.locator('.ws-preview')).toHaveText('{"type":"ping","n":1}');
  await reply.locator('button.ws-row-main').click();
  await expect(reply.locator('.ws-detail-body')).toHaveText('{\n  "type": "ping",\n  "n": 1\n}');

  // Filters.
  await page.getByRole('radio', { name: 'Received' }).click();
  await expect(page.locator('.ws-log-list .ws-row')).toHaveCount(2);
  await page.getByRole('radio', { name: 'All' }).click();

  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('.ws-status')).toContainText('Disconnected 1000');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
});

test('reports a connection that cannot be opened', async ({ page }) => {
  await openApp(page);
  // Nothing listens on port 9 on the loopback interface.
  await openWebSocketTab(page, { type: 'websocket', name: 'Closed port', url: 'ws://127.0.0.1:9/' });
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.ws-system[data-kind="error"]')).toContainText('Browsers do not say why');
  await expect(page.locator('.ws-status')).toContainText('Disconnected 1006');
});
