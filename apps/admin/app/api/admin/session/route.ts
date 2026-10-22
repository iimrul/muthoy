// W4-06 — login and logout. The credential boundary's HTTP wiring, and nothing
// else: the decisions all live in lib/adminLogin.ts, where Vitest can execute
// them. Same split as backend/supabase/functions/payment-webhook (wiring in
// index.ts, logic in handler.ts) for the same reason — a credential path with
// no executable test is a credential path nobody has checked.
//
// nodejs runtime, explicitly: PBKDF2 is not available in the Edge runtime.
//
// This route is one of the two paths middleware.ts exempts from the session
// gate, because it is what issues the session. It carries its own protections:
// the Origin check, both throttles, and a response that is byte-identical for
// every failure.

import { handleAdminSessionRequest } from '../../../../lib/adminLogin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleAdminSessionRequest(request);
}

export function GET(): Response {
  return new Response('Method not allowed.\n', {
    status: 405,
    headers: {
      allow: 'POST',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
