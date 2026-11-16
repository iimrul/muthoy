// The eight panel write forms post here. HTTP wiring only: the decisions live
// in lib/adminFormRoute.ts (and the write modules it calls), where Vitest can
// execute them. Same split as app/api/admin/session/route.ts.
//
// Unlike the session route this path is NOT exempt from middleware.ts, so a
// request without a valid session never reaches the handler.

import { handleAdminFormAction } from '../../../../../lib/adminFormRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  return handleAdminFormAction(request, action);
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
