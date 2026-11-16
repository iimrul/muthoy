// A scripted, byte-recording fake of the `MuthoyBlePrinter` native module
// (scanAsync / printAsync), standing in for the Kotlin / Swift transports.
//
// It models only what the JS layer can observe: a promise that resolves or
// rejects with an Expo-style `{ code, message }` error. `deliverFraction`
// models how much of a job physically reached the printer before a failure,
// so a test can see what a real roll would show after a retry. It does NOT
// model GATT, MTU, chunking, pairing or paper sensors — those need hardware.

export interface FakeDevice {
  id: string;
  name: string;
  rssi: number;
}

export interface NativeFailure {
  code: string;
  message: string;
}

export interface PrintStep {
  /** 0..1 share of the payload that reached the paper before the outcome. Default 1. */
  deliverFraction?: number;
  reject?: NativeFailure;
}

export interface ScanStep {
  devices?: FakeDevice[];
  reject?: NativeFailure;
}

export interface PrintAttempt {
  deviceId: string;
  base64: string;
  bytes: Uint8Array;
  deliveredBytes: number;
  outcome: "resolved" | NativeFailure;
}

function nativeError(failure: NativeFailure): Error & { code: string } {
  return Object.assign(new Error(failure.message), { code: failure.code });
}

export class FakeBlePrinterNative {
  printScript: PrintStep[] = [];
  scanScript: ScanStep[] = [];
  attempts: PrintAttempt[] = [];
  scanCalls: number[] = [];
  /** Every byte that "reached paper", across all attempts, in order. */
  paper: number[] = [];
  moduleMissing = false;
  inFlight = 0;
  maxConcurrent = 0;

  reset(): void {
    this.printScript = [];
    this.scanScript = [];
    this.attempts = [];
    this.scanCalls = [];
    this.paper = [];
    this.moduleMissing = false;
    this.inFlight = 0;
    this.maxConcurrent = 0;
  }

  async scanAsync(timeoutMs: number): Promise<FakeDevice[]> {
    this.scanCalls.push(timeoutMs);
    const step = this.scanScript.shift() ?? { devices: [] };
    if (step.reject) throw nativeError(step.reject);
    return step.devices ?? [];
  }

  async printAsync(deviceId: string, base64: string): Promise<void> {
    this.inFlight += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    try {
      // Yield once so overlapping calls are observable.
      await Promise.resolve();
      const bytes = new Uint8Array(Buffer.from(base64, "base64"));
      const step = this.printScript.shift() ?? {};
      const fraction = Math.min(1, Math.max(0, step.deliverFraction ?? 1));
      const deliveredBytes = Math.floor(bytes.length * fraction);
      for (const byte of bytes.subarray(0, deliveredBytes)) this.paper.push(byte);
      this.attempts.push({ deviceId, base64, bytes, deliveredBytes, outcome: step.reject ?? "resolved" });
      if (step.reject) throw nativeError(step.reject);
    } finally {
      this.inFlight -= 1;
    }
  }
}

const globalKey = "__hwFakeBlePrinter";
const holder = globalThis as unknown as Record<string, FakeBlePrinterNative | undefined>;
export const fakeBle: FakeBlePrinterNative = (holder[globalKey] ??= new FakeBlePrinterNative());
