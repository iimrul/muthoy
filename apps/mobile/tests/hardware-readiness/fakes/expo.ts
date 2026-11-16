// Off-device stand-in for `expo`'s requireNativeModule, which the real
// modules/muthoy-ble-printer/src/index.ts bridge calls lazily. Any other
// native module name fails exactly like a build without that module linked.
import { fakeBle } from "./fake-ble-printer";

export function requireNativeModule<T>(name: string): T {
  if (name === "MuthoyBlePrinter" && !fakeBle.moduleMissing) return fakeBle as unknown as T;
  throw new Error(`Cannot find native module '${name}'`);
}
