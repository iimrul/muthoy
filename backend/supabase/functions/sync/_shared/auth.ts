import type { User } from "npm:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabaseAdmin.ts";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function verifyCallerJwt(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Missing bearer token");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired token");
  return data.user;
}

export function callerShopId(user: User): string | null {
  const value = user.app_metadata?.shop_id;
  return typeof value === "string" ? value : null;
}

export function requireCallerShop(user: User, requestedShopId: string): string {
  const linkedShopId = callerShopId(user);
  if (!linkedShopId || linkedShopId !== requestedShopId) {
    throw new HttpError(403, "Shop does not match authenticated user");
  }
  return linkedShopId;
}
