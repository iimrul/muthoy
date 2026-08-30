import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ print: vi.fn(), scan: vi.fn() }));
vi.mock('react-native', () => ({
  Platform: { OS:'android', Version:35 },
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

const { getPairedPrinter, printEscPos, removePairedPrinter, savePairedPrinter } = await import('./printer');

beforeEach(() => { native.print.mockReset(); native.scan.mockReset(); removePairedPrinter(); });

describe('BLE printer connection truth and bounded retry', () => {
  it('keeps discovery selected-but-unvalidated until a real write completes', async () => {
    const selected = savePairedPrinter({ id:'AA:BB',name:'Printer',rssi:-40 });
    expect(selected.validatedAt).toBeUndefined();
    native.print.mockResolvedValue(undefined);
    await printEscPos(new Uint8Array([1,2,3]),selected);
    expect(native.print).toHaveBeenCalledTimes(1);
    expect(getPairedPrinter()?.validatedAt).toEqual(expect.any(String));
  });

  it('reconnects once for a transient disconnect, then succeeds', async () => {
    const selected = savePairedPrinter({ id:'AA:BB',name:'Printer',rssi:-40 });
    native.print.mockRejectedValueOnce({ code:'DISCONNECTED',message:'lost' }).mockResolvedValueOnce(undefined);
    await printEscPos(new Uint8Array([1]),selected);
    expect(native.print).toHaveBeenCalledTimes(2);
  });

  it('stops after the bounded retry and never invents paper status', async () => {
    const selected = savePairedPrinter({ id:'AA:BB',name:'Printer',rssi:-40 });
    native.print.mockRejectedValue({ code:'SEND_FAILED',message:'failed' });
    await expect(printEscPos(new Uint8Array([1]),selected)).rejects.toMatchObject({ code:'send-failed' });
    expect(native.print).toHaveBeenCalledTimes(2);
    native.print.mockReset(); native.print.mockRejectedValue({ code:'OUT_OF_PAPER',message:'unverified' });
    await expect(printEscPos(new Uint8Array([1]),selected)).rejects.toEqual(expect.objectContaining({ code:'unknown' }));
    expect(native.print).toHaveBeenCalledTimes(1);
  });
});
