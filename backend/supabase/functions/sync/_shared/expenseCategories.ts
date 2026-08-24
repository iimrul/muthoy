import { HttpError } from "./auth.ts";

const LEGACY_CATEGORIES: Record<string, string> = {
  electricity: "utilities",
  transport: "conveyance",
  staff_salary: "salary",
  supplies: "other",
};

const CANONICAL_CATEGORIES = new Set([
  "rent",
  "salary",
  "utilities",
  "conveyance",
  "other",
]);

/**
 * Keeps both rollout orders safe: a new edge canonicalizes for the old DB,
 * while the PostgreSQL migration independently canonicalizes for an old edge.
 */
export function canonicalizeExpensePayload(
  tableName: unknown,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (tableName !== "expenses" || !("category" in payload)) return payload;
  if (typeof payload.category !== "string") {
    throw new HttpError(400, "Invalid expense category");
  }
  const category = LEGACY_CATEGORIES[payload.category] ?? payload.category;
  if (!CANONICAL_CATEGORIES.has(category)) {
    throw new HttpError(400, "Invalid expense category");
  }
  return { ...payload, category };
}
