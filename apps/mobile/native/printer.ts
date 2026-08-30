import { PermissionsAndroid, Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { printBleBytesNative, scanBlePrintersNative, type NativeBlePrinterDevice } from '../modules/muthoy-ble-printer';
import { bytesToBase64 } from '../domain/escpos';

export type PrinterErrorCode = 'out-of-range' | 'disconnected' | 'send-failed' | 'no-device' | 'unsupported' | 'permission-denied' | 'unknown';
export class PrinterError extends Error {
  constructor(readonly code: PrinterErrorCode, message: string) { super(message); this.name = 'PrinterError'; }
}
export interface PairedPrinter { id: string; name: string; pairedAt: string; validatedAt?: string; }
export type DiscoveredPrinter = NativeBlePrinterDevice;
const storage = createMMKV({ id: 'muthoy-printer' }); const KEY = 'paired-printer';

export function getPairedPrinter(): PairedPrinter | null {
  const value = storage.getString(KEY); if (!value) return null;
  try { const parsed = JSON.parse(value) as PairedPrinter; return parsed.id && parsed.name && parsed.pairedAt ? parsed : null; } catch { return null; }
}
export function savePairedPrinter(device: DiscoveredPrinter): PairedPrinter {
  const paired = { id: device.id, name: device.name, pairedAt: new Date().toISOString() };
  storage.set(KEY, JSON.stringify(paired)); return paired;
}
export function removePairedPrinter(): void { storage.remove(KEY); }
function markValidated(printer: PairedPrinter): void {
  storage.set(KEY, JSON.stringify({ ...printer, validatedAt: new Date().toISOString() } satisfies PairedPrinter));
}

async function requestPermissions(): Promise<void> {
  if (Platform.OS !== 'android') throw new PrinterError('unsupported', 'BLE thermal printing is Android-only in Beta');
  const permissions = Platform.Version >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new PrinterError('permission-denied', 'Bluetooth permission was denied');
  }
}
function mapNativeError(error: unknown): PrinterError {
  if (error instanceof PrinterError) return error;
  const value = error as { code?: string; message?: string }; const code = value.code?.toUpperCase() ?? '';
  const mapped: PrinterErrorCode = code.includes('OUT_OF_RANGE') || code.includes('TIMEOUT') || code.includes('CONNECTION_FAILED') ? 'out-of-range'
    : code.includes('DISCONNECTED') ? 'disconnected' : code.includes('SEND_FAILED') ? 'send-failed'
      : code.includes('UNSUPPORTED') ? 'unsupported' : code.includes('PERMISSION') ? 'permission-denied' : 'unknown';
  return new PrinterError(mapped, value.message ?? 'Printer operation failed');
}
export async function scanBlePrinters(): Promise<DiscoveredPrinter[]> {
  await requestPermissions();
  try { return await scanBlePrintersNative(5_000); } catch (error) { throw mapNativeError(error); }
}
export async function printEscPos(bytes: Uint8Array, printer: PairedPrinter | null = getPairedPrinter()): Promise<void> {
  if (!printer) throw new PrinterError('no-device', 'No printer paired');
  await requestPermissions();
  const payload = bytesToBase64(bytes); let lastError: PrinterError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await printBleBytesNative(printer.id, payload); markValidated(printer); return; }
    catch (error) {
      lastError = mapNativeError(error);
      if (!['out-of-range','disconnected','send-failed'].includes(lastError.code) || attempt === 1) throw lastError;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError ?? new PrinterError('unknown', 'Printer operation failed');
}
