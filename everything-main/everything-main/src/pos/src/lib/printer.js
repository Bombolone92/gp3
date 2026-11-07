/**
 * Talking to the printer on the counter.
 *
 * A receipt printer is a property of *this device*, not of the shop: two
 * tablets behind one counter have one printer each, and a phone that walks
 * around has none. So the choice lives in localStorage, like the theme, and
 * never in the shop's cloud settings.
 *
 * Browser hardware access is uneven and an iPad will do none of this. Every
 * function here is honest about that: `printerSupport()` says what this
 * browser can reach, nothing throws on a device with no support, and the
 * browser's own print dialog stays the default and the fallback everywhere.
 * Nothing about selling depends on a printer being present.
 */

import { escposReceipt, escposReport, drawerKickBytes, PAPER_WIDTHS } from './escpos.js';

export { PAPER_WIDTHS };

/** Per-device, because the printer is. */
const CONFIG_KEY = 'pos:printer:v1';

export const TRANSPORTS = [
  { value: 'bluetooth', label: 'Bluetooth' },
  { value: 'serial', label: 'USB / serial' },
  { value: 'usb', label: 'USB (direct)' },
];

/**
 * GATT services the common Bluetooth thermal printers expose a writable
 * characteristic on. Requested as optional services so a printer that
 * advertises any of them can be talked to; the write target is discovered
 * rather than assumed, since the pairing of service and characteristic
 * differs between the cheap clones.
 */
const BT_SERVICES = [
  0x18f0,                                   // common on ESC/POS BLE printers
  0xff00,
  0xffe0,
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',   // Microchip transparent UART
];

/** What this browser, on this device, can actually reach. */
export function printerSupport() {
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  // Every one of these needs a secure context; without one the API objects
  // simply aren't there, which this reads as "not supported" - the honest
  // answer for the device in front of the shopkeeper.
  const support = {
    bluetooth: typeof nav.bluetooth?.requestDevice === 'function',
    serial: typeof nav.serial?.requestPort === 'function',
    usb: typeof nav.usb?.requestDevice === 'function',
  };
  support.any = support.bluetooth || support.serial || support.usb;
  return support;
}

/** The saved choice, or null. Never throws: storage can be unavailable. */
export function printerConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY));
    if (!saved || !TRANSPORTS.some((t) => t.value === saved.transport)) return null;
    return {
      transport: saved.transport,
      name: String(saved.name || '').slice(0, 60),
      columns: PAPER_WIDTHS.some((w) => w.columns === saved.columns) ? saved.columns : 48,
      autoPrint: !!saved.autoPrint,
      kickOnCash: !!saved.kickOnCash,
    };
  } catch {
    return null;
  }
}

/** Save (or, with null, forget) this device's printer. */
export function setPrinterConfig(config) {
  try {
    if (!config) localStorage.removeItem(CONFIG_KEY);
    else localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch { /* the printer is then simply not remembered */ }
  // A forgotten printer must not keep a live connection behind it.
  if (!config) disconnectPrinter();
  return printerConfig();
}

/** True when this device has a printer set up to print to. */
export const hasPrinter = () => !!printerConfig();

/* ---------- The live connection ---------- */

/**
 * One connection per device, kept open between jobs: a counter prints a
 * receipt every minute, and re-pairing each time is both slow and (on
 * Bluetooth) a permission prompt.
 */
let live = null;

export function disconnectPrinter() {
  const held = live;
  live = null;
  held?.close?.().catch?.(() => {});
}

/**
 * 'The printer didn’t answer' - a printer failure as the first half of a
 * sentence, so callers can add what they did instead without two full stops
 * colliding in the middle of it.
 */
export function printerSaid(err) {
  return String(err?.message || 'The printer didn’t answer').replace(/\.$/, '');
}

/** A message the shopkeeper can act on, rather than a DOMException. */
export class PrinterError extends Error {
  constructor(message, { cancelled = false } = {}) {
    super(message);
    this.name = 'PrinterError';
    /** True when the *user* dismissed the browser's device picker. */
    this.cancelled = cancelled;
  }
}

const cancelled = (err) => err?.name === 'NotFoundError' || /cancel|dismiss/i.test(err?.message || '');

/* ---------- Bluetooth ---------- */

async function openBluetooth({ pick = false, name = '' } = {}) {
  const bt = navigator.bluetooth;
  let device = null;
  if (!pick && typeof bt.getDevices === 'function') {
    // Already granted on this device: reconnect without a prompt.
    const known = await bt.getDevices().catch(() => []);
    device = known.find((d) => !name || d.name === name) || null;
  }
  if (!device) {
    if (!pick) throw new PrinterError('The printer needs to be chosen again on this device.');
    device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  }
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const chars = await service.getCharacteristics().catch(() => []);
    const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (!writable) continue;
    return {
      transport: 'bluetooth',
      name: device.name || 'Bluetooth printer',
      // BLE writes are capped per packet; 180 bytes is inside every
      // implementation's MTU and a receipt is only a few kilobytes.
      chunk: 180,
      write: (bytes) => (writable.properties.write
        ? writable.writeValueWithResponse?.(bytes) ?? writable.writeValue(bytes)
        : writable.writeValueWithoutResponse?.(bytes) ?? writable.writeValue(bytes)),
      close: async () => device.gatt?.disconnect(),
    };
  }
  throw new PrinterError('That Bluetooth device has nothing this app can print to.');
}

/* ---------- Web Serial ---------- */

async function openSerial({ pick = false } = {}) {
  const serial = navigator.serial;
  let port = null;
  if (!pick) {
    const known = await serial.getPorts().catch(() => []);
    port = known[0] || null;
    if (!port) throw new PrinterError('The printer needs to be chosen again on this device.');
  } else {
    port = await serial.requestPort();
  }
  await port.open({ baudRate: 9600 });
  const writer = port.writable.getWriter();
  return {
    transport: 'serial',
    name: 'Serial printer',
    chunk: 0,
    write: (bytes) => writer.write(bytes),
    close: async () => {
      try {
        await writer.close();
      } finally {
        await port.close().catch(() => {});
      }
    },
  };
}

/* ---------- WebUSB ---------- */

async function openUsb({ pick = false } = {}) {
  const usb = navigator.usb;
  let device = null;
  if (!pick) {
    const known = await usb.getDevices().catch(() => []);
    device = known[0] || null;
    if (!device) throw new PrinterError('The printer needs to be chosen again on this device.');
  } else {
    // Class 7 is the USB printer class - what a till printer presents.
    device = await usb.requestDevice({ filters: [{ classCode: 7 }] });
  }
  await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find((i) => i.alternates
    .some((a) => a.interfaceClass === 7));
  if (!iface) throw new PrinterError('That USB device isn’t a printer this app can use.');
  await device.claimInterface(iface.interfaceNumber);
  const alternate = iface.alternates.find((a) => a.interfaceClass === 7);
  const endpoint = alternate.endpoints.find((e) => e.direction === 'out');
  if (!endpoint) throw new PrinterError('That printer has no channel to send to.');
  return {
    transport: 'usb',
    name: device.productName || 'USB printer',
    chunk: 0,
    write: (bytes) => device.transferOut(endpoint.endpointNumber, bytes),
    close: async () => {
      await device.releaseInterface(iface.interfaceNumber).catch(() => {});
      await device.close().catch(() => {});
    },
  };
}

const OPENERS = { bluetooth: openBluetooth, serial: openSerial, usb: openUsb };

/**
 * Get a connection, reusing the open one. `pick: true` shows the browser's
 * device picker - which only a user gesture is allowed to do, so it is only
 * ever passed from the Settings button that says so.
 */
async function connection({ transport, name = '', pick = false } = {}) {
  if (live && !pick && live.transport === transport) return live;
  if (pick) disconnectPrinter();
  const open = OPENERS[transport];
  if (!open) throw new PrinterError('This device can’t reach that kind of printer.');
  if (!printerSupport()[transport]) {
    throw new PrinterError('This browser can’t reach that kind of printer.');
  }
  try {
    live = await open({ pick, name });
  } catch (err) {
    live = null;
    if (err instanceof PrinterError) throw err;
    if (cancelled(err)) throw new PrinterError('No printer chosen.', { cancelled: true });
    console.error(err);
    throw new PrinterError('Couldn’t reach the printer. Check it’s on and paired.');
  }
  return live;
}

/**
 * Choose a printer: the one moment the browser will show its picker. Returns
 * the saved config, keeping whatever settings a previous choice had.
 */
export async function choosePrinter(transport) {
  const held = await connection({ transport, pick: true });
  const before = printerConfig();
  return setPrinterConfig({
    transport: held.transport,
    name: held.name,
    columns: before?.columns ?? 48,
    autoPrint: before?.autoPrint ?? false,
    kickOnCash: before?.kickOnCash ?? false,
  });
}

/**
 * Send bytes to the configured printer.
 *
 * A dropped connection is retried once from scratch: a Bluetooth printer that
 * went to sleep between customers is the normal case, not an error worth
 * showing anybody.
 */
export async function sendToPrinter(bytes) {
  const config = printerConfig();
  if (!config) throw new PrinterError('No printer is set up on this device.');
  let held;
  try {
    held = await connection({ transport: config.transport, name: config.name });
  } catch (err) {
    disconnectPrinter();
    held = await connection({ transport: config.transport, name: config.name });
    if (!held) throw err;
  }
  try {
    await writeAll(held, bytes);
  } catch (err) {
    // One retry on a fresh connection, then it is a real failure.
    disconnectPrinter();
    const again = await connection({ transport: config.transport, name: config.name });
    try {
      await writeAll(again, bytes);
    } catch {
      console.error(err);
      throw new PrinterError('The printer didn’t take the job. Check paper and power.');
    }
  }
}

/** Some transports cap a write; the rest take the whole slip at once. */
async function writeAll(held, bytes) {
  if (!held.chunk) {
    await held.write(bytes);
    return;
  }
  for (let at = 0; at < bytes.length; at += held.chunk) {
    await held.write(bytes.slice(at, at + held.chunk));
  }
}

/** Print a receiptDoc. `kick` opens the drawer once the slip is out. */
export async function printDocBytes(doc, { kick = false } = {}) {
  const config = printerConfig();
  await sendToPrinter(escposReceipt(doc, { columns: config?.columns ?? 48, kick }));
}

/** Print a Z-report-shaped document (see escposReport). */
export async function printReportBytes(head, rows) {
  const config = printerConfig();
  await sendToPrinter(escposReport(head, rows, { columns: config?.columns ?? 48 }));
}

/** Open the drawer, with nothing printed - "no sale", and making change. */
export async function kickDrawer() {
  await sendToPrinter(drawerKickBytes());
}

/**
 * A test print: enough to prove the paper, the width, and the drawer wiring
 * without pretending to be a sale.
 */
export function testDoc(storeName, columns) {
  return {
    storeName: storeName || 'Point of Sale',
    address: '',
    registrations: [],
    kind: 'TEST PRINT',
    meta: [`${columns} characters per line`, 'If this reads straight, the width is right'],
    items: [
      { qty: '1', name: 'Sample item', amount: '9.99', subs: [{ text: 'a note under the item', kind: 'note' }] },
      { qty: '2', name: 'A name long enough to need shortening on narrow paper', amount: '24.00', subs: [] },
    ],
    totals: [
      { label: 'Subtotal', value: '33.99' },
      { label: 'Total', value: '33.99', strong: true },
    ],
    payments: [{ label: 'Cash', value: '40.00' }, { label: 'Change', value: '6.01' }],
    note: '',
    loyalty: '',
    reward: '',
    footer: 'Test print · nothing was recorded',
  };
}
