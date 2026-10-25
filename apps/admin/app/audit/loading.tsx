import PageSkeleton from '../../components/PageSkeleton';

// Batch 3 §8 — the route's loading state. Next renders this while the server
// component awaits its query, so the shell stays on screen and the region says
// what it is waiting for rather than going blank.

export default function Loading() {
  return <PageSkeleton label="the audit log" />;
}
