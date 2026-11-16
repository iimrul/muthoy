// Off-device stand-in for the two `react-native` exports native/printer.ts
// uses. State lives on globalThis so it survives vi.resetModules().
//
// Permission names are the real Android strings, so a test can assert the
// exact permission set the app would request on a given API level.

interface RnState {
  os: string;
  version: number;
  answers: Record<string, string>;
  requests: string[][];
}

const globalKey = "__hwReactNativeState";
const holder = globalThis as unknown as Record<string, RnState | undefined>;
const state: RnState = (holder[globalKey] ??= {
  os: "android",
  version: 35,
  answers: {},
  requests: [],
});

export const Platform = {
  get OS(): string {
    return state.os;
  },
  get Version(): number {
    return state.version;
  },
};

export const PermissionsAndroid = {
  PERMISSIONS: {
    BLUETOOTH_SCAN: "android.permission.BLUETOOTH_SCAN",
    BLUETOOTH_CONNECT: "android.permission.BLUETOOTH_CONNECT",
    ACCESS_FINE_LOCATION: "android.permission.ACCESS_FINE_LOCATION",
  },
  RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
  async requestMultiple(permissions: string[]): Promise<Record<string, string>> {
    state.requests.push([...permissions]);
    return Object.fromEntries(permissions.map((permission) => [permission, state.answers[permission] ?? "granted"]));
  },
};

/** Test control surface — not part of react-native. */
export const rnControl = {
  reset(): void {
    state.os = "android";
    state.version = 35;
    state.answers = {};
    state.requests = [];
  },
  setPlatform(os: string, version: number): void {
    state.os = os;
    state.version = version;
  },
  answer(permission: string, result: string): void {
    state.answers[permission] = result;
  },
  get requests(): readonly string[][] {
    return state.requests;
  },
};
