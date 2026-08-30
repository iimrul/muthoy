export interface NativeBlePrinterDevice { id: string; name: string; rssi: number; }
interface NativeModule {
  scanAsync(timeoutMs: number): Promise<NativeBlePrinterDevice[]>;
  printAsync(deviceId: string, base64Payload: string): Promise<void>;
}
let module: NativeModule | null = null;
async function native(): Promise<NativeModule> {
  if (module) return module;
  const { requireNativeModule } = await import('expo');
  module = requireNativeModule<NativeModule>('MuthoyBlePrinter');
  return module;
}
export const scanBlePrintersNative = async (timeoutMs: number) => (await native()).scanAsync(timeoutMs);
export const printBleBytesNative = async (deviceId: string, base64Payload: string) => (await native()).printAsync(deviceId, base64Payload);
