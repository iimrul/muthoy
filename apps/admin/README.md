# apps/admin/

Next.js admin panel. Intentionally empty until Day 14 (Basic Admin Panel,
P0) — see `docs/playbook/00-execution-roadmap.md`'s Day 14 and
`05-admin.md`. Do not scaffold a real Next.js app here before then (Volume
2's folder creation order).

When built: server components/API routes only talk to Supabase via the
service-role key — that key must never reach this app's client bundle.
