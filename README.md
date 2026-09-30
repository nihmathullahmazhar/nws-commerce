# NWS Commerce

A reusable retail commerce platform that NWS deploys and customises for each
client. One backend runs the online store, the in-store POS, the admin, and later
the mobile app. The same core can serve an electronics shop, a fashion store, a
supermarket, a pharmacy-style retailer, a hardware store, or any other retailer.
Features a particular trade needs are modules that get switched on per client.

## Status

**All ten phases are done and verified:** the commerce core database, money, the **admin app**, the **online storefront**, the **POS**, **returns, exchanges and warranty**, **purchasing and transfers**, **promotions, gift cards and loyalty points**, **reports**, and the **customer app** (`apps/mobile`).

| | |
|---|---|
| `db/migrations/` | The schema, in order. This is the source of truth. |
| `database_to_paste.sql` | Generated from the migrations. Paste it into a new Supabase project. |
| `db/tests/` | The verification suites: a local Supabase shim, the core flow, the money flow, and the concurrency race. |
| `apps/admin/` | The admin app (Vite + React + TypeScript + Tailwind): catalogue, stock, orders, customers, settings. |
| `apps/storefront/` | The online store (Next.js 16, server-rendered for SEO): catalogue with filters, product pages, cart, checkout, order pages, accounts. |
| `apps/pos/` | The till (Vite + React): shifts with a float, scan or tap to sell, serial capture, discounts with manager PIN, split tender, park and resume, 80 mm receipts, X and Z reports. |
| `packages/ui/` | Components and theme shared by the staff apps (admin, POS). |
| `packages/db/` | Generated database types, command result shapes and error messages, shared by every app. |
| `dev/` | The local stand-in for Supabase (development only). |
| `docs/ARCHITECTURE.md` | How the pieces fit, the modules, the phases, and known limits. |

## Run it locally

No Supabase project is needed yet. PostgREST plus `dev/server.mjs` stand in for one on this machine.

```bash
brew install postgresql@17 postgrest && brew services start postgresql@17
npm install
npm run dev:setup -- you@example.com 'a-long-password' "Your Business" omnichannel
npm run dev:api      # terminal 1: local Supabase stand-in on :54321
npm run dev:admin    # terminal 2: admin on http://localhost:5173
npm run dev:store    # terminal 3: storefront on http://localhost:3000
npm run dev:pos      # terminal 4: till on http://localhost:5174
```

The business starts empty; the dashboard walks you through the first steps.
To move to a hosted project, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (admin) and the
`NEXT_PUBLIC_*` values in `apps/storefront/.env.example` (storefront, one deployment per client).

## Verify

Needs PostgreSQL 17 locally (`brew install postgresql@17`, `brew services start postgresql@17`).

```bash
npm run db:verify
```

This rebuilds `database_to_paste.sql`, applies it to a throwaway database and runs
326 checks. Among them: 87 concurrent sessions race for the same stock and the same
store credit, and exactly as many succeed as there are units or credit. Run it
after every schema change.

## Set up a Supabase project

1. Create a new Supabase project.
2. Paste `database_to_paste.sql` into the SQL editor and run it once.
3. Provision the client from the SQL editor, which counts as a platform session:

   ```sql
   select public.create_organization('Client Name', 'client-slug', '<owner auth user id>', 'retail');
   -- optional vertical modules
   select public.set_organization_module('<org id>', 'serial_tracking', true);
   ```

4. Schedule `select public.expire_reservations();` every minute (pg_cron), so
   unpaid online checkouts give their stock back.

## Rules the database enforces

- Clients never write stock, orders or the ledger directly. They call the
  commands (`place_order`, `start_checkout`, `confirm_order`, `receive_stock`,
  `adjust_stock`, ...), and row-level security refuses anything else.
- Every stock change is a row in `inventory_movements`, which is append-only.
  Current stock is derived from it in the same transaction, under a row lock.
- Prices come from the catalogue. A client cannot propose a price. Discounts
  beyond the seller's role limit need a manager's one-time PIN approval.
- A counter sale is paid in full before it completes. Phone and admin orders
  can be paid later. Gateway webhooks are recorded once, however many times
  they arrive.
- Payments, store credit and the audit log can't be deleted.
- A product ships empty. There is no demo data: a new client starts with no
  products and no stock.
