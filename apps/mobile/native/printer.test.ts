import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ print: vi.fn(), scan: vi.fn() }));
const platform = vi.hoisted(() => ({ OS: 'android', Version: 35 }));
vi.mock('react-native', () => ({
  Platform: platform,
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN:'scan',BLUETOOTH_CONNECT:'connect',ACCESS_FINE_LOCATION:'location' },
    RESULTS: { GRANTED:'granted' },
    requestMultiple: vi.fn(async (permissions: string[]) => Object.fromEntries(permissions.map((permission) => [permission,'granted']))),
  },
}));
vi.mock('../modules/muthoy-ble-printer', () => ({
  printBleBytesNative: native.print,
  scanBlePrintersNative: native.scan,
}));

const { getPairedPrinter, printEscPos, removePairedPrinter, savePairedPrinter, scanBlePrinters } = await import('./printer');
const { PermissionsAndroid } = await import('react-native');

beforeEach(() => { platform.OS = 'android'; vi.mocked(PermissionsAndroid.requestMultiple).mockClear(); native.print.mockReset(); native.scan.mockReset(); removePairedPrinter(); });

describe('BLE printer connection truth and single delivery attempt', () => {
  it('keeps discovery selected-but-unvalidated until a real write completes', async () => {
    const selected = savePairedPrinter({ id:'AA:BB',name:'Printer',rssi:-40 });
    expect(selected.validatedAt).toBeUndefined();
    native.print.mockResolvedValue(undefined);
    await printEscPos(new Uint8Array([1,2,3]),selected);
    expect(native.print).toHaveBeenCalledTimes(1);
    expect(getPairedPrinter()?.validatedAt).toEqual(expect.any(String));
  });

  it('surfaces a disconnect once; a new explicit request can succeed', async () => {
    const selected = savePairedPrinter({ id:'AA:BB',name:'Printer',rssi:-40 });
    native.print.mockRejectedValueOnce({ code:'DISCONNECTED',message:'lost' }).mockResolvedValueOnce(undefined);
    await expect(printEscPos(new Uint8Array([1]),selected)).rejects.toMatchObject({ code:'disconnected' });
    expect(native.print).toHaveBeenCalledTimes(1);
    expect(getPairedPrinter()?.validatedAt).toBeUndefined();
    await printEscPos(new Uint8Array([1]),selected);
    expect(native.print).toHaveBeenCalledTimes(2);
  });

  it('never repeats a failed send or invents paper status', async () => {
    const selected = savePairedPrinter({ id:'AA:BB',name:'Printer',rssi:-40 });
    native.print.mockRejectedValue({ code:'SEND_FAILED',message:'failed' });
    await expect(printEscPos(new Uint8Array([1]),selected)).rejects.toMatchObject({ code:'send-failed' });
    expect(native.print).toHaveBeenCalledTimes(1);
    native.print.mockReset(); native.print.mockRejectedValue({ code:'OUT_OF_PAPER',message:'unverified' });
    await expect(printEscPos(new Uint8Array([1]),selected)).rejects.toEqual(expect.objectContaining({ code:'unknown' }));
    expect(native.print).toHaveBeenCalledTimes(1);
  });
});


describe('existing BLE API on iOS', () => {
  it('delegates discovery to CoreBluetooth without Android permission requests', async () => {
    platform.OS='ios';const devices=[{id:'79000000-0000-4000-8000-000000000001',name:'Synthetic BLE',rssi:-40}];native.scan.mockResolvedValue(devices);
    expect(await scanBlePrinters()).toEqual(devices);expect(native.scan).toHaveBeenCalledWith(5000);
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  });
  it('passes the exact existing ESC/POS bytes and validates only transport completion', async () => {
    platform.OS='ios';const printer=savePairedPrinter({id:'79000000-0000-4000-8000-000000000001',name:'Synthetic BLE',rssi:-40});
    native.print.mockResolvedValue(undefined);await printEscPos(new Uint8Array([0x1b,0x40,0x0a]),printer);
    expect(native.print).toHaveBeenCalledWith(printer.id,'G0AK');expect(native.print).toHaveBeenCalledTimes(1);
    expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();expect(getPairedPrinter()?.validatedAt).toEqual(expect.any(String));
  });
  it('keeps denied native authorization unvalidated and does not retry it', async () => {
    platform.OS='ios';const printer=savePairedPrinter({id:'79000000-0000-4000-8000-000000000001',name:'Synthetic BLE',rssi:-40});
    native.print.mockRejectedValue({code:'PERMISSION_DENIED',message:'Bluetooth permission denied'});
    await expect(printEscPos(new Uint8Array([1]),printer)).rejects.toMatchObject({code:'permission-denied'});
    expect(native.print).toHaveBeenCalledTimes(1);expect(getPairedPrinter()?.validatedAt).toBeUndefined();
  });
  it('still refuses unsupported platforms before invoking native transport', async () => {
    platform.OS='web';await expect(scanBlePrinters()).rejects.toMatchObject({code:'unsupported'});expect(native.scan).not.toHaveBeenCalled();
  });
  it('retains the original Android permission path', async () => {
    native.scan.mockResolvedValue([]);await scanBlePrinters();expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith(['scan','connect']);
  });
});
