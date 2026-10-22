// W4-10 — the payment-provider seam, with no active provider behind it.
//
// The founder's locked decision (2026-10-21) retires SSLCommerz from active
// selection and routing, and W4-09's direct bKash integration is BLOCKED on E8
// (the callback contract, the Authorization value format and the signature/IPN
// verification procedures are all undocumented). So this module ships the
// refusal path only: resolveProvider() answers every environment with
// 503 payment_not_configured.
//
// It is deliberately NOT a comment-level retirement. No code path here can hand
// back the SSLCommerz implementation — this module never imports
// createSslCommerzSession or sslCommerzConfig, and payment-provider.test.ts
// drives resolveProvider across every PAYMENT_PROVIDER value, 'sslcommerz'
// included, asserting it always throws.
//
// What is NOT retired: payment-webhook/handler.ts still verifies and applies
// historical SSLCommerz callbacks, _shared/sslcommerz.ts and its tests stay in
// place, and no database privilege or payment function is revoked. New
// initiation is what stops; settlement of what already exists does not.
//
// PaymentProviderError is re-exported so callers depend on the seam rather than
// on the retired module. Its definition stays in _shared/sslcommerz.ts
// (retired, not deleted) so that module's own tests keep passing untouched.
import { PaymentProviderError } from "./sslcommerz.ts";

export { PaymentProviderError };

/** Providers that existed and must never be selected again. */
export const RETIRED_PAYMENT_PROVIDERS = ["sslcommerz"] as const;

export interface PaymentSessionRequest {
  transactionId: string;
  orderId: string;
  amountPaisa: number;
  planLabel: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface PaymentSession {
  sessionKey: string;
  gatewayPageUrl: string;
}

/**
 * What initiateBilling needs from a provider. Only the members the shipped
 * caller uses are declared; plan §7.2 holds the verify/matchesOrder design for
 * whichever provider eventually clears E8.
 */
export interface PaymentProvider {
  readonly providerId: string;
  createSession(request: PaymentSessionRequest): Promise<PaymentSession>;
}

type EnvironmentReader = (name: string) => string | undefined;

// The `typeof Deno` guard is for the Node test runner, where the Edge global is
// absent. The value is read so the refusal is demonstrably independent of it,
// not because any value could succeed.
const denoEnvironment: EnvironmentReader = (name) =>
  typeof Deno === "undefined" ? undefined : Deno.env.get(name);

/**
 * Selects the active subscription payment provider. There is none, so this
 * always throws 503 payment_not_configured. A retired provider and an
 * unconfigured one are both refusals and both carry the same code, because the
 * device's handling is identical: no payment may start.
 */
export function resolveProvider(read: EnvironmentReader = denoEnvironment): PaymentProvider {
  const requested = (read("PAYMENT_PROVIDER") ?? "").trim().toLowerCase();
  const retired = (RETIRED_PAYMENT_PROVIDERS as readonly string[]).includes(requested);
  throw new PaymentProviderError(
    503,
    retired
      ? `Payment provider ${requested} is retired and can no longer be selected`
      : "Payment provider is not configured",
    "payment_not_configured",
  );
}
