// Framework-free error types + the ONLY place an admin error becomes text a
// browser sees. Raw Supabase/driver errors are never rendered: they can carry
// connection details, and the panel runs with a service-role key. The detail
// goes to the server log; the browser gets a fixed, safe sentence.

export class AdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminConfigError';
  }
}

export class AdminDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminDataError';
  }
}

export function toDisplayMessage(error: unknown): string {
  if (error instanceof AdminConfigError) {
    return 'This admin panel is not configured yet. See apps/admin/README.md for the server environment it needs.';
  }
  if (error instanceof AdminDataError) {
    return 'Could not load data from Supabase. The server log has the details.';
  }
  return 'Something went wrong loading this page. The server log has the details.';
}
