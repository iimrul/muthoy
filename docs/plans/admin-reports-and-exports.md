# Admin reports and exports

**Batch 3. CODE-COMPLETE and tested locally. No export has been produced from
hosted data.**

## The six reports

| Report id | What it contains | Kind |
|---|---|---|
| `pharmacy_registrations` | registration metadata per pharmacy | registration metadata |
| `subscriptions` | current subscription state | registration metadata |
| `subscription_revenue_and_renewals` | verified payment orders and their renewals | k-suppressed aggregate |
| `plan_distribution` | pharmacies per plan tier | k-suppressed aggregate |
| `activity_summary` | pharmacies and their activity per day | k-suppressed aggregate |
| `refund_net_pharmacy_sales` | W4-04's refund-net totals | k-suppressed aggregate |

**Two kinds only, and the distinction is load-bearing.** Registration metadata
is information about a pharmacy's existence and plan; an aggregate is
information derived from its trade. Only the second needs the k floor, and
`adminReports.test.ts` asserts that registration metadata is **not** suppressed
— §8.10 permits it — while every aggregate is.

## k-anonymity

**k = 5, on the number of distinct contributing shops.** One function,
`suppressBelowK`, and every aggregate passes through it.

- a suppressed cell **exports as empty**, not as a zero or a placeholder: a
  spreadsheet would total a zero;
- a suppressed value **renders as an em dash** on a page and is **absent from a
  chart**, not plotted as zero — plotting a gap as zero draws a cliff that is
  not in the data;
- the **contributor count is still reported** in both branches, because an
  operator legitimately needs to know a bucket exists; the count is not
  identifying, the value is;
- the formatter is **never called** for a suppressed value, so a formatter
  cannot be the thing that leaks one.

`adminSuppression.test.ts` tests the k−1 and k boundary for a bucket, a series
point and an export row, and includes a mutation check that a 4-shop bucket left
visible is caught.

## CSV

`lib/adminCsv.ts`, pure. RFC-4180 quoting, CRLF line endings, a UTF-8 BOM.

**Formula-injection prevention.** Any cell whose first character is `=`, `+`,
`-`, `@`, a tab or a carriage return is prefixed with an apostrophe **inside**
the quoted field. Tested with a planted `=cmd|…` payload, and — the case that
makes the rule non-trivial — with a **legitimate negative number**, which must
survive readable rather than being mangled.

## PDF

`lib/adminPdf.ts`, pure and dependency-free: a valid PDF 1.4 byte stream with
Helvetica, a title, the range, column headers repeated per page, page numbers
and correct `xref` offsets.

Tested by **parsing the output back**, with a corrupted-`xref` mutation check —
so the test measures a readable document rather than a plausible byte count.

## Completeness is asserted, not assumed

Exports page through `readAllPages` with an **explicit cap** and a **hard
assertion that the exported row count equals the counted row count**. A fixture
larger than one page proves it, because a single-page fixture would pass
whatever the pager did.

The count is taken **first** and the rows second. In that order, a row inserted
between the two makes `loaded` exceed `counted`, which the gate refuses — the
opposite order would silently under-report.

`assertCompleteRead` runs **before any table is built**, so an incomplete read
can never reach a rendered report.

## Authorization

`app/api/reports/export/route.ts` **re-checks `reports.export` itself**. It does
not rely on the page having checked:

| Caller | Result |
|---|---|
| no session | **401**, from the middleware |
| `reports.read` only | **403** |
| `reports.export` | the file |

The report id and every filter are parsed by a **shared Zod schema** in
`packages/validation` (`adminReportExportQuery`) before anything is read. The
date range is capped at 400 days.

## What a report never contains

**No cross-pharmacy sensitive financial detail.** Platform reports are
aggregates or registration metadata, and a test asserts **no report row carries
a sale, a customer or a medicine**.

**No per-shop financial export is provided at all.** That is a deliberate
absence, not an oversight: a per-shop export is the owner's own report in the
mobile app, and a platform console exporting one pharmacy's finances to whoever
holds an admin login is a different product with different consent.

## What is NOT claimed

- **No export has been generated from hosted data.** Every assertion above is
  against fixtures.
- **No claim that a particular spreadsheet application opens these files.** The
  CSV rules are RFC-4180 plus the injection prefix, and the PDF is parsed back
  by the test — neither is a claim about Excel or any specific viewer.
- Gate **E15** applies here as everywhere: the deployed download path has not
  been exercised in a browser.
