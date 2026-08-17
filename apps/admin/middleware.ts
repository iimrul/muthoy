import { NextResponse, type NextRequest } from 'next/server';
import { evaluateBasicAuth } from './lib/basicAuth';

// Gate for every route in the panel. Fails closed: if ADMIN_BASIC_AUTH_USER /
// ADMIN_BASIC_AUTH_PASSWORD are unset, the panel serves 503 rather than
// publishing the platform's pharmacy list anonymously.
const REALM = 'Muthoy Admin';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(request: NextRequest): NextResponse {
  const outcome = evaluateBasicAuth(request.headers.get('authorization'), {
    user: process.env.ADMIN_BASIC_AUTH_USER,
    password: process.env.ADMIN_BASIC_AUTH_PASSWORD,
  });

  if (outcome === 'authorized') {
    return NextResponse.next();
  }

  if (outcome === 'not-configured') {
    return new NextResponse('Admin panel is not configured.\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new NextResponse('Authentication required.\n', {
    status: 401,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}
