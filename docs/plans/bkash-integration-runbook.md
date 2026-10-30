# Direct bKash integration — runbook for a BLOCKED feature

**Status: BLOCKED (gate E8). Owner: Batch 6, deliverable B6-02** (founder
decision 2026-10-23). W4-09 is **NOT implemented and no part of it ships**;
delivering it is B6-02, where bKash is the ONLY approved subscription gateway
and SSLCommerz is never reactivated for new subscription payments. The verified
contract, the three undocumented surfaces and the identifier analysis below are
unchanged — only the delivery ownership moved.
Batch 2 shipped only the *refusal* side: W4-10 retires SSLCommerz, and the
provider seam refuses every environment, so subscription payments **fail
closed**.

This document exists so that whoever picks the work up starts from the verified
contract rather than from a guess, and so the three things that are **not**
documented by bKash stay visible. **Nothing here is inferred.** Every endpoint,
field and rule below was read from bKash's own developer documentation
(`developer.bka.sh`) and its S3-hosted *Tokenized Checkout — API Integration
Guide*. Where the documentation is silent, this document says so instead of
filling the gap.

---

## 1. Why this is blocked rather than merely unfinished

Three surfaces of the contract are undocumented, and all three are
security-relevant. Building around any of them would mean inventing payment
authentication.

1. **The callback request contract.** The documentation covers the
   server-to-server calls, but not what bKash sends **to** `callbackURL`: not
   its method, not its parameters, and not how the payment identifier and the
   success / failure / cancel outcome are recovered from it. An implementer
   would have to invent the parsing at exactly the point where payment
   authentication happens.
2. **The `Authorization` header's value format.** The header is named and the
   token response carries `token_type: "Bearer"`, but the exact value the
   business APIs expect is not stated in the material read.
3. **`/payment/create` returns a `signature` field with no documented
   verification procedure.** An unverifiable signature must be ignored, not
   trusted: a check that cannot be performed reads in code like a check that
   was.

**IPN is not trusted either.** bKash's IPN is an SNS-style signed POST carrying
`Signature`, `SignatureVersion` and `SigningCertURL`, but bKash does not
document the verification procedure. An unverified webhook must never grant an
entitlement.

E8 is closed only when bKash's onboarding material supplies: the callback
request contract, the `Authorization` value format, and the signature/IPN
verification procedures.

---

## 2. The verified contract

Flow: **Tokenized Checkout without agreement**. A subscription charge is a
one-off payment, and the agreement flow would force every owner through a
wallet-registration ceremony first.

Sandbox base: `https://tokenized.sandbox.bka.sh/v2/tokenized-checkout`

**The live base URL is not published** — bKash supplies it at merchant
on-boarding. It is therefore configuration with **no default**, and an unset
value must fail closed.

| Operation | Method + path | Request body | Response fields used |
|---|---|---|---|
| Grant token | `POST /auth/grant-token` | `app_key`, `app_secret` | `id_token`, `refresh_token`, `expires_in` (3600), `token_type` |
| Refresh token | `POST /auth/refresh-token` | `app_key`, `app_secret`, `refresh_token` | same |
| Create payment | `POST /payment/create` | `payerReference`, `callbackURL`, `amount`, `currency`, `intent`, `merchantInvoiceNumber` | `paymentId`, `bKashURL`, `transactionStatus`, the three callback URLs, `signature` (ignored) |
| Execute payment | `POST /payment/execute` | `paymentId` | `trxId`, `transactionStatus` (`Completed`), `amount`, `currency`, `payerAccount`, `merchantInvoiceNumber`, `maxRefundableAmount` |
| Query payment | `POST /query/payment` | `paymentId` | `transactionStatus`, `verificationStatus`, `trxId`, `amount`, `currency`, `merchantInvoice` |
| Search transaction | `POST /general/search-transaction` | `trxId` | `transactionStatus`, `amount`, `currency`, `completedTime`, `payerAccount` |
| Refund | `POST /refund/payment/transaction` | `paymentId`, `refundAmount`, `sku`, `reason`, `trxId` | `refundTrxId`, `refundTransactionStatus`, `originalTrxId` |

Headers: `Content-Type`, `Accept`, `username`, `password` on the token calls;
`X-App-Key`, `Authorization`, `Content-Type` on the business calls.

Error shapes: `externalCode` + `errorMessageEn` on business APIs; `statusCode` +
`statusMessage` on the token APIs.

**Token rules, documented and binding:** refresh at the 50–55-minute mark, and
**at most two refreshes per hour** — exceeding it blocks the app for an hour. So
a client must refresh on a margin and fall back to a fresh grant rather than
retrying a refresh.

---

## 3. The identifier problem that killed the first design

This is the single most important thing to carry forward, because it made an
earlier revision of the plan unimplementable.

`b4_apply_verified_payment` raises `MU031` unless the stored
`provider_transaction_id` equals the argument it is given. For SSLCommerz that
value **is** the merchant-generated `tran_id`, so it round-trips. For bKash
there are **two different identifiers**:

- `merchantInvoiceNumber` — the value the merchant generates and sends;
- `trxId` — bKash's own transaction id, returned at execute time.

Passing `trxId` rejects **every** payment; passing the invoice loses `trxId`.
The design therefore needs **three identifiers kept separate** — the merchant
invoice, bKash's `trxId`, and the `paymentId` handle used for execute and query
— with the invoice used for order matching and `trxId` preserved as the
provider's own reference. Plan §7.2 and §7.3 hold the full design.

---

## 4. The fail-closed matrix as it ships today

With W4-10 in place and no provider implemented, this is the whole of the
current behaviour. It is the safe posture, and it is also the honest one: there
is **no active subscription payment path at all**.

| Situation | Server (`billing-init`) | Device (`initiatePlanPayment`) | Screen |
|---|---|---|---|
| `PAYMENT_PROVIDER` unset | 503 `payment_not_configured` | refuses before any write | payment-unavailable card, Pay disabled |
| `PAYMENT_PROVIDER=sslcommerz` | 503 — retired, named as retired | same | same |
| `PAYMENT_PROVIDER=bkash` | 503 — no implementation exists | same | same |
| anything else | 503 | same | same |
| a historical order passed to the screen | still polled and verified | reconciled as before | pending / failed states still render |
| a late SSLCommerz callback | `payment-webhook/handler.ts` verifies and applies it, unchanged | — | — |

No database privilege was revoked, no payment function dropped, no migration
added, and `_shared/sslcommerz.ts` plus its 47 tests remain in place. Retirement
stops NEW initiation; it does not stop settlement of what already exists.

---

## 5. The four gates before any live bKash activation

None of these is a code task, and none can be closed from inside the
repository.

1. **E8 — the contract.** The callback request contract, the `Authorization`
   value format, and the signature/IPN verification procedures, from bKash's
   onboarding material.
2. **Merchant credentials and the live base URL.** Supplied at on-boarding;
   configuration with no default, failing closed when unset.
3. **E4 — the migration seal.** The Postgres work bKash needs is a migration,
   and the chain is sealed (adding one breaks three H-9 gates including a
   hash-pinned check file). It is a Batch 3 sequencing dependency.
4. **The phased function rollout.** Database SQL and Edge Functions do not
   deploy atomically. A DB-first change breaks the live caller; an Edge-first
   change breaks against the old database. The staged plan is: phase 1 additive
   (create and grant the new function signature, leave the old one untouched),
   phase 2 deploy the callers and verify, **phase 3 as a separate later change**
   revoke and drop the old signature. Each phase is one transaction. Plan §7.3
   holds the SQL.

---

## 6. What the next implementer should NOT do

- **Do not write a bKash callback handler.** Its contract is undocumented;
  `payment-webhook/handler.ts` stays SSLCommerz-only on purpose, and a comment
  in it records why.
- **Do not trust the `signature` field or IPN.** Ignore both until a
  verification procedure exists. A test should assert no code path reads
  `signature`.
- **Do not relax the `payment_attempts` provider CHECK or the
  `payment_orders` provider default** to make room for `'bkash'` before there
  is a provider. Nothing writes that value, so changing the schema would be
  dead scope on a money table — and it is the CHECK that makes the local
  refusal ordering (refuse before the row is written) the right design.
- **Do not describe the product as payment-ready** at any point before a real
  payment has completed end to end against live bKash with real money, and that
  run has been recorded.
