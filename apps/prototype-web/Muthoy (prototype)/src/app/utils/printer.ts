// Web Bluetooth ESC/POS printer manager with retry & graceful fallback.
// Works in Chrome/Edge on Android & desktop. On iOS Safari, Web Bluetooth is not available — UI falls back to "demo" mode.

const SERIAL_PORT_SERVICE = 0x18f0; // Common BLE serial service used by many ESC/POS printers
const PRINTER_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHAR_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

export type PrinterError =
  | "unsupported"
  | "no-device"
  | "disconnected"
  | "out-of-paper"
  | "out-of-range"
  | "send-failed"
  | "unknown";

export interface PrinterInfo {
  id: string;
  name: string;
  pairedAt: string;
}

const STORE_KEY = "printerInfo";

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

export function getStoredPrinter(): PrinterInfo | null {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; }
}

export function clearStoredPrinter() {
  localStorage.removeItem(STORE_KEY);
}

let connectedDevice: any = null;
let connectedChar: any = null;

export async function pairPrinter(): Promise<PrinterInfo> {
  if (!isWebBluetoothSupported()) {
    // Demo mode: persist a fake device
    const fake: PrinterInfo = {
      id: `demo-${Date.now()}`,
      name: "Demo ESC/POS Printer",
      pairedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(fake));
    return fake;
  }
  const device = await (navigator as any).bluetooth.requestDevice({
    filters: [{ services: [SERIAL_PORT_SERVICE] }],
    optionalServices: [SERIAL_PORT_SERVICE],
  });
  const info: PrinterInfo = {
    id: device.id || device.name || `bt-${Date.now()}`,
    name: device.name || "ESC/POS Printer",
    pairedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(info));
  connectedDevice = device;
  return info;
}

async function connect(): Promise<void> {
  if (!isWebBluetoothSupported()) throw new Error("unsupported");
  const stored = getStoredPrinter();
  if (!stored) throw new Error("no-device");
  if (!connectedDevice) {
    // Re-prompt — Web Bluetooth doesn't allow silent reconnection without user gesture except via getDevices()
    const navAny = navigator as any;
    const devices = navAny.bluetooth.getDevices ? await navAny.bluetooth.getDevices() : [];
    connectedDevice = devices.find((d: any) => d.id === stored.id) || null;
    if (!connectedDevice) {
      connectedDevice = await navAny.bluetooth.requestDevice({
        filters: [{ services: [SERIAL_PORT_SERVICE] }],
        optionalServices: [SERIAL_PORT_SERVICE],
      });
    }
  }
  const server = await connectedDevice.gatt.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  connectedChar = await service.getCharacteristic(PRINTER_CHAR_UUID);
}

async function writeChunks(data: Uint8Array) {
  // BLE typically supports ~512 bytes per write — chunk to be safe
  const CHUNK = 200;
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, i + CHUNK);
    await connectedChar.writeValueWithoutResponse?.(slice).catch(async () => {
      await connectedChar.writeValue(slice);
    }) ?? await connectedChar.writeValue(slice);
  }
}

export async function printBytes(bytes: Uint8Array, opts?: { retry?: number }): Promise<void> {
  if (!isWebBluetoothSupported()) {
    // Demo mode: log and resolve
    console.log("[Printer demo] would print", bytes.length, "bytes");
    return;
  }
  const retry = opts?.retry ?? 1;
  let lastErr: any;
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      if (!connectedChar || !connectedDevice?.gatt?.connected) {
        await connect();
      }
      await writeChunks(bytes);
      return;
    } catch (e: any) {
      lastErr = e;
      connectedChar = null; // force reconnect on retry
    }
  }
  throw mapError(lastErr);
}

function mapError(e: any): Error & { code: PrinterError } {
  const msg = String(e?.message || e || "").toLowerCase();
  let code: PrinterError = "unknown";
  if (msg.includes("paper")) code = "out-of-paper";
  else if (msg.includes("range") || msg.includes("not found")) code = "out-of-range";
  else if (msg.includes("disconnect") || msg.includes("gatt")) code = "disconnected";
  else if (msg.includes("write") || msg.includes("characteristic")) code = "send-failed";
  else if (msg.includes("no-device")) code = "no-device";
  const err = new Error(msg) as any;
  err.code = code;
  return err;
}
