// W4-06 — the login form. One of the two paths exempt from the session gate,
// and safe to be: it renders no platform data and performs no query. Every
// decision happens in POST /api/admin/session.
//
// The error message is deliberately the same for an unknown username and a
// wrong password, matching the route's byte-identical responses. Telling the
// visitor which one was wrong is a username oracle with a nicer font.

export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const failed = params.error === 'invalid';
  const signedOut = params.signedOut === '1';

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-xl font-semibold">Muthoy Admin</h1>
      <p className="mt-1 text-sm text-midGray">Sign in to the platform console.</p>

      {failed ? (
        <p
          role="alert"
          className="mt-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
        >
          Those credentials were not accepted.
        </p>
      ) : null}
      {signedOut ? (
        <p role="status" className="mt-4 rounded border border-black/10 px-3 py-2 text-sm text-midGray">
          You have been signed out.
        </p>
      ) : null}

      <form method="post" action="/api/admin/session" className="mt-6 space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            maxLength={256}
            className="mt-1 w-full rounded border border-black/20 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            className="mt-1 w-full rounded border border-black/20 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-brand-deepGreen px-3 py-2 text-sm font-semibold text-white"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
