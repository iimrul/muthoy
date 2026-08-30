# components/

Presentation/interaction layer. Leaf UI receives props; container components
may orchestrate guarded `db/` and state APIs, but no component imports
SQLite/Drizzle or Supabase directly. `ui/` holds generic, screen-agnostic
building blocks (Header, PinPad, PlanBadge...);
`forms/` holds live React Hook Form + Zod form components (schemas live in
`packages/validation`). B1-B3 navigation, dashboard, inventory, scanner,
expense, supplier, report, and shared UI components remain consumers of guarded
`db/`/state services, never direct SQLite or Supabase clients.
