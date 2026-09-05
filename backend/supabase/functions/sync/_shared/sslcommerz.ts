export class PaymentProviderError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

export interface SslCommerzConfig {
  storeId: string;
  storePassword: string;
  mode: "sandbox" | "live";
  callbackBaseUrl: string;
}

export interface SslCommerzValidation {
  status?: unknown;
  tran_id?: unknown;
  val_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  currency_type?: unknown;
  risk_level?: unknown;
  value_a?: unknown;
  [key: string]: unknown;
}

type EnvironmentReader = (name: string) => string | undefined;

export function sslCommerzConfig(read: EnvironmentReader = (name) => Deno.env.get(name)): SslCommerzConfig {
  const storeId = read("SSLCOMMERZ_STORE_ID");
  const storePassword = read("SSLCOMMERZ_STORE_PASSWORD");
  const callbackBaseUrl = read("PAYMENT_CALLBACK_BASE_URL");
  const mode = read("SSLCOMMERZ_MODE") === "live" ? "live" : "sandbox";
  if (!storeId || !storePassword || !callbackBaseUrl) {
    throw new PaymentProviderError(503, "Payment provider is not configured", "payment_not_configured");
  }
  return { storeId, storePassword, callbackBaseUrl, mode };
}

function gatewayOrigin(config: SslCommerzConfig): string {
  return config.mode === "live" ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";
}

export function isAllowedCheckoutUrl(value: string, mode: SslCommerzConfig["mode"]): boolean {
  try {
    const url = new URL(value);
    const expectedHost = mode === "live" ? "securepay.sslcommerz.com" : "sandbox.sslcommerz.com";
    return url.protocol === "https:" && url.hostname === expectedHost && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

// SSLCommerz callback verification uses MD5 by provider contract. This is not
// used for passwords or application cryptography.
function md5(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >>> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const rotate = (word: number, count: number) => ((word << count) | (word >>> (32 - count))) >>> 0;
  for (let offset = 0; offset < paddedLength; offset += 64) {
    let a = a0; let b = b0; let c = c0; let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f: number; let wordIndex: number;
      if (index < 16) { f = (b & c) | (~b & d); wordIndex = index; }
      else if (index < 32) { f = (d & b) | (~d & c); wordIndex = (5 * index + 1) % 16; }
      else if (index < 48) { f = b ^ c ^ d; wordIndex = (3 * index + 5) % 16; }
      else { f = c ^ (b | ~d); wordIndex = (7 * index) % 16; }
      const nextD = c;
      c = b;
      b = (b + rotate((a + f + constants[index]! + view.getUint32(offset + wordIndex * 4, true)) >>> 0, shifts[Math.floor(index / 16) * 4 + (index % 4)]!)) >>> 0;
      a = d;
      d = nextD;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function validCallbackHash(fields: Record<string, string>, storePassword: string): boolean {
  const verifySign = fields.verify_sign?.toLowerCase();
  const keys = fields.verify_key?.split(",").map((key) => key.trim()).filter(Boolean);
  if (!verifySign || !/^[0-9a-f]{32}$/.test(verifySign) || !keys?.length) return false;
  if (keys.some((key) => fields[key] === undefined || key === "store_passwd")) return false;
  const payload = keys.map((key) => `${key}=${fields[key]}`).join("&");
  const expected = md5(`${payload}&store_passwd=${md5(storePassword)}`);
  return constantTimeEqual(verifySign, expected);
}

export function paisaToProviderAmount(amountPaisa: number): string {
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0) throw new Error("Invalid paisa amount");
  return `${Math.trunc(amountPaisa / 100)}.${String(amountPaisa % 100).padStart(2, "0")}`;
}

export function providerAmountToPaisa(amount: unknown): number | null {
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  const normalized = String(amount);
  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const paisa = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(paisa) ? paisa : null;
}

export async function createSslCommerzSession(input: {
  config: SslCommerzConfig;
  transactionId: string;
  orderId: string;
  amountPaisa: number;
  planLabel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  fetcher?: typeof fetch;
}): Promise<{ sessionKey: string; gatewayPageUrl: string }> {
  const fetcher = input.fetcher ?? fetch;
  const callback = input.config.callbackBaseUrl.replace(/\/$/, "");
  const form = new URLSearchParams({
    store_id: input.config.storeId,
    store_passwd: input.config.storePassword,
    total_amount: paisaToProviderAmount(input.amountPaisa),
    currency: "BDT",
    tran_id: input.transactionId,
    success_url: `${callback}?return=success`,
    fail_url: `${callback}?return=fail`,
    cancel_url: `${callback}?return=cancel`,
    ipn_url: callback,
    cus_name: input.customerName.slice(0, 50),
    cus_email: input.customerEmail.slice(0, 50),
    cus_add1: "Dhaka",
    cus_city: "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: input.customerPhone.slice(0, 20),
    shipping_method: "NO",
    product_name: input.planLabel,
    product_category: "software_subscription",
    product_profile: "non-physical-goods",
    value_a: input.orderId,
  });
  const response = await fetcher(`${gatewayOrigin(input.config)}/gwprocess/v4/api.php`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) throw new PaymentProviderError(502, "Payment provider unavailable");
  const result = await response.json() as Record<string, unknown>;
  const gatewayPageUrl = typeof result.GatewayPageURL === "string" ? result.GatewayPageURL : null;
  const sessionKey = typeof result.sessionkey === "string" ? result.sessionkey : null;
  if (!gatewayPageUrl || !sessionKey || !isAllowedCheckoutUrl(gatewayPageUrl, input.config.mode)) {
    throw new PaymentProviderError(502, "Payment provider rejected the order");
  }
  return { sessionKey, gatewayPageUrl };
}

export async function validateSslCommerzPayment(
  config: SslCommerzConfig,
  validationId: string,
  fetcher: typeof fetch = fetch,
): Promise<SslCommerzValidation> {
  const url = new URL(`${gatewayOrigin(config)}/validator/api/validationserverAPI.php`);
  url.searchParams.set("val_id", validationId);
  url.searchParams.set("store_id", config.storeId);
  url.searchParams.set("store_passwd", config.storePassword);
  url.searchParams.set("v", "1");
  url.searchParams.set("format", "json");
  const response = await fetcher(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new PaymentProviderError(502, "Payment verification unavailable");
  return await response.json() as SslCommerzValidation;
}

export function verificationMatchesOrder(
  validation: SslCommerzValidation,
  order: { id: string; transactionId: string; amountPaisa: number },
  requestedValidationId: string,
): boolean {
  const currency = validation.currency ?? validation.currency_type;
  return (validation.status === "VALID" || validation.status === "VALIDATED")
    && validation.tran_id === order.transactionId
    && validation.val_id === requestedValidationId
    && validation.value_a === order.id
    && providerAmountToPaisa(validation.amount) === order.amountPaisa
    && currency === "BDT"
    && String(validation.risk_level ?? "0") === "0";
}
