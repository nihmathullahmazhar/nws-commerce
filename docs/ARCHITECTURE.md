# Architecture

## What this is

NWS Commerce is a **retail commerce template/platform** that NWS deploys and
customises per client. It is not built for one industry. SimplyTek and OTC.lk were
only references for how modern e-commerce behaves. The core has to fit an
electronics shop, a boutique, a supermarket, a cosmetics counter, a furniture
showroom, a hardware store or a pharmacy-style retailer equally well.

The rule that follows from that:

> **The core knows about products, variants, locations, stock, customers and
> orders. Anything only some trades need is a module.**

## One backend, many surfaces

```
  Storefront (Next.js)   POS (PWA)   Admin (SPA)   Mobile app (Expo, later)
           \                 |            |              /
            '------- typed client (supabase-js + generated types) -------'
                                   |
                  Supabase: Auth · PostgREST · RPC · Realtime · Storage
                                   |
                PostgreSQL: one catalogue, ONE stock ledger, one order model
```

- A counter sale, an online order, an app order, a phone order and an order keyed
  in by admin are all rows in `orders`. Only `channel` differs. Reports add up
  across channels without any syncing.
- Stock exists once, per location and variant. There is nothing to synchronise
  between the website and the POS; they read the same row.
- Realtime (`stock_levels`, `orders` are published) tells staff screens to
  refresh. It is never the source of truth: the check happens inside the
  transaction.

## Modules

Plans are presets. Vertical add-ons are switched on per client whatever the plan.

| Module | Plan | Used by |
|---|---|---|
| `storefront`, `reviews`, `promotions` | E-Commerce and up | everyone online |
| `purchasing`, `returns` | E-Commerce Pro and up | |
| `pos` | Retail and up | anyone with a counter |
| `multi_location`, `transfers`, `loyalty` | Omnichannel and up | chains, shops with a warehouse |
| `wholesale`, `mobile_app` | Enterprise | |
| `serial_tracking` | add-on | electronics, appliances, vehicles, tools with serials |
| `batch_tracking` | add-on | pharmacy, cosmetics, grocery: lots and expiry |
| `warranty` | add-on | electronics, appliances, furniture |

Modules are enforced **in the database**. For example, a serial-tracked product
cannot be created, a POS sale cannot be placed, and a second location cannot be
opened unless the module is on. The UI hiding a feature is a convenience, not the
control.

## How a product is counted

`products.tracking_mode` is one of:

- `none`: counted stock (T-shirts, cables, furniture).
- `serial`: every unit has an identifier (IMEI, serial, chassis number). A sale
  must name the unit at the counter; online orders are allocated the oldest unit.
- `batch`: stock is held in lots with optional expiry. It is sold
  first-expiry-first-out, and expired lots are never sold.

Independently, `allow_fractional` with `unit_of_measure` covers goods sold by
weight or length (loose rice by the kg, cable by the metre).

Once stock has moved, how a product is counted is frozen, because the ledger was
written in that shape.

## Why overselling cannot happen

1. `inventory_movements` is the only way stock changes. A trigger applies each
   movement to `stock_levels` inside the same transaction.
2. Before applying a movement, the trigger takes a row lock on that
   `stock_levels` row (`SELECT ... FOR UPDATE`). A second counter or shopper
   trying for the same item waits. Once the first commits, the second reads the
   new quantity and is refused with `OUT_OF_STOCK`.
3. CHECK constraints (`on_hand >= 0`, `0 <= reserved <= on_hand`) back this up
   even for a caller with a bug.
4. Serial units are claimed with a conditional update
   (`... where status = 'available'`), so two counters scanning the same unit
   cannot both win.
5. Every function takes locks in one order: the order row, then `stock_levels`
   in variant order, then lot or serial rows. This is why the race suite reports
   no deadlocks.
6. Idempotency keys make a retried or double-clicked sale return the original
   order instead of selling twice.

`db/tests/race.sh` proves each of these properties with real concurrent sessions.

## Online checkout

`start_checkout` reserves stock for a configurable hold (`settings.checkout_hold_minutes`,
default 15) and caps each line (`settings.checkout_max_line_quantity`, default 20).
Then there are three possible outcomes:

- **Payment arrives:** `confirm_order` (called by the gateway webhook with the service
  role) turns the holds into sales.
- **Checkout is abandoned:** `expire_reservations` (run every minute) releases the stock.
- **Payment arrives after the hold lapsed:** the order takes the stock again if it is
  still there. If not, the order becomes `stock_conflict` for a refund or backorder.
  It is never oversold.

## Money

- **Tax.** Rates are stored as percentages. A product uses its own rate, else the
  organisation's default; `tax_exempt` means none. `organizations.prices_include_tax`
  decides whether shelf prices include tax (typical retail) or have it added on top.
  Tax is worked out per line after discounts and snapshotted on the line.
- **Discounts.** Discounts can be per line or for the whole order (a percentage or
  an amount). An order discount is spread across the lines in proportion to their
  value, so tax stays correct. Online checkout accepts none; promotions come later.
- **Role limits.** Each role has a discount limit, overridable in
  `settings.discount_limits`. The defaults are owner/admin 100%, manager 50% and
  everyone else 0%. Going beyond your limit needs `request_override`: a manager's
  PIN, checked against a bcrypt hash, issues a one-time approval that lasts 5
  minutes and is tied to the sale it's used on. Five wrong PINs lock the approver
  for 15 minutes.
- **Tender.** Card, bank transfer, QR and store credit can't exceed what's due.
  Cash can, and the excess is recorded as change. The counter must be paid in full;
  phone and admin orders can be paid later (`record_payment`, e.g. cash on delivery).
- **Online payments.** `record_gateway_payment` (service role only) is idempotent on
  (provider, reference) and confirms the order once it's fully paid. If the stock
  has gone by then, the payment is kept against a `stock_conflict` order and
  refunded with `refund_payment`.
- **Store credit.** Store credit is an append-only ledger. The balance lives on the
  customer, is changed only by a trigger under a row lock, and can never go
  negative, so two tills can't spend the same credit (the race suite proves this).
  Staff can edit a customer's contact details but not the balance or the login
  link; that's enforced with column-level privileges, because RLS decides rows,
  not columns.

## Tenancy

Every business table carries `organization_id`. Composite foreign keys
(`(organization_id, x_id)`) make it impossible to link one client's rows to
another's. RLS keys on membership. NWS can run one Supabase project per client
now, and move to a shared multi-tenant deployment later without a schema rewrite.

Provisioning (`create_organization`, `apply_plan`, `set_organization_module`,
`expire_reservations`) is platform-only: the service role, or a direct database
session with no JWT.

## Error codes

Commands raise these SQLSTATEs; frontends switch on them:

| Code | Meaning |
|---|---|
| `NC001` | OUT_OF_STOCK: detail is JSON with `available` and `requested` |
| `NC002` | MODULE_DISABLED: detail names the module |
| `NC003` | INVALID_INPUT |
| `NC004` | SERIAL_UNAVAILABLE |
| `NC005` | NOT_FOUND |
| `NC006` | INVALID_STATE / APPEND_ONLY |
| `NC007` | PAYMENT_INCOMPLETE / INSUFFICIENT_STORE_CREDIT |
| `NC008` | APPROVAL_REQUIRED: detail has the discount %, your limit, and what was approved |
| `42501` | PERMISSION_DENIED |

## Phases

1. **Commerce core database** ✅: tenancy, plans and modules, staff and roles,
   locations, catalogue, stock ledger, holds, serial and batch modules, the unified
   order model, row-level security, audit log. Verified locally.
2. **Money** ✅: tax, discounts with role limits and PIN approval, split tender
   and change, pay-later, gateway webhooks, refunds, store credit.
3. **Admin app** ✅: dashboard with a first-run checklist, products with options and
   variants (saved atomically by `save_product`), categories, brands, specifications,
   stock overview, receiving, adjustments, ledger history, orders, payments, refunds,
   customers, store credit, and settings for tax, locations, staff and PINs. Cost is
   shown only to roles with `reports.view`: it's hidden at column level and served
   through functions.
4. **Storefront** ✅ (Next.js 16): category pages with brand, price, stock and
   specification filters (a plain GET form, so it works without JavaScript, and every
   filtered view is a crawlable URL), search by name, SKU or barcode, product pages
   with structured data and live availability, a server-side cart keyed by a secret
   token (the app will share it), and checkout with delivery or pickup and pay on
   delivery or bank transfer. `quote_order` prices a basket by running the real
   checkout code in a rolled-back draft, so the quote and the charge can never differ.
   Guests reach their order page with a private token; accounts list their orders.
5. **POS** ✅: tills, and cashier shifts opened with a counted float. A shift closes
   with expected cash (float + cash taken + paid in - paid out/drops), the counted
   amount and the variance, which needs a note if the drawer doesn't balance.
   `pos_sale` rings up on the caller's own open shift. `place_order` refuses a
   counter sale unless the transaction was marked by `pos_sale`, and API clients
   cannot set that marker, so no cash can bypass a shift. `pos_quote` gives live
   ticket totals through the real pricing code. The screen supports keyboard or
   scanner input: barcode, then Enter, adds the item. It also covers serial capture
   checked against stock at that till, park/resume, manager PIN approval, split
   tender with change, 80 mm receipts, and X/Z reports.
6. **Returns and warranty** ✅:
   - **Where:** returns at the till (`pos_return`), in the admin (`create_return`) and
     online (`request_return` by the customer, `receive_return` by staff).
   - **Refund amount:** the refund is the line's paid value pro rata (discount and tax
     included), with rounding settled on the last unit, and never more than was paid.
     `preview_return` shows it before anything is taken.
   - **Inspection:** returned goods go to **inspection**. Serial units become
     `inspection`, and nothing re-enters stock until `inspect_return_line` restocks
     them at their original cost, or marks them damaged, service or write-off.
     Cashiers cannot restock directly.
   - **Exchanges:** `pos_exchange` returns items and uses the value toward a new sale
     in one transaction, with any left-over value paid back. The `return_credit`
     tender only works inside an exchange.
   - **Return period:** `settings.return_days` limits cashiers; managers can still
     take a return after it.
   - **Warranty (module):** `warranty_months` is snapshotted on each sold line.
     `warranty_lookup` finds purchases by serial/IMEI, order number or phone across
     every channel. Claims keep an append-only status history.
   - **Function grants:** grants are now maintained by rule (`_regrant_api`).
     Internal `_` functions and platform-only functions are never granted.
7. **Purchasing and transfers** ✅:
   - **Purchase orders:** suppliers, and purchase orders (draft → ordered → part
     received → received, or closed short or cancelled). `receive_purchase_order`
     takes deliveries against a PO at its cost, or the delivery's cost if it
     differs. It cannot over-receive, and it captures serials, lots and expiry
     through the same `_stock_in_line` as ordinary receiving.
   - **Reorder:** `reorder_suggestions` lists what's under its low-stock level,
     allowing for stock already on order, with the last supplier and cost.
   - **Transfers:** requested → approved, which holds the stock at the source →
     dispatched (`transfer_out`, serial units `in_transit`) → received
     (`transfer_in` at the destination, at the same cost and in the same lot). A
     shortfall needs a note; missing serial units are written off.
   - **Permissions:** `purchasing.manage`, `transfers.request` and
     `transfers.approve` are role permissions. Dispatching needs `inventory.adjust`
     at the source, and receiving needs `inventory.receive` at the destination.
8. **Promotions, loyalty, gift cards** ✅:
   - **Promotions** (module `promotions`): percent off, amount off, or buy X get Y
     free, on products, categories or brands, or on the whole order with a minimum
     spend. Each can be automatic or need a coupon code, and can be limited to
     channels, a date window and a use count. The same `_write_order_lines` prices
     the till, the storefront and later the app. The best offer per line wins,
     and a manual discount replaces a promotion rather than stacking with it.
     Usage counts go up under a row lock, so two tills cannot overshoot a limit.
     Promotions never count against a cashier's discount limit.
   - **Non-stock products** (`tracking_mode = non_stock`): services, fees and gift
     cards. They are always available and never touch the stock ledger.
   - **Gift cards** (module `loyalty`): a non-stock product flagged `is_gift_card`
     issues one card per unit when the sale is confirmed. The card is tax-exempt
     and gets a 16-character code with no look-alike characters. Its balance is a
     ledger. A card can pay at the till, part-pay, and be looked up, given away or
     voided in the admin. The buyer sees the code on the receipt, or on the order
     page when bought online. Gift cards are money, so no discount, promotion or
     minimum spend ever includes them, and a sold card cannot be returned for cash.
   - **Loyalty points:** customers earn on what they actually pay: not delivery,
     not gift cards, and not what points paid. The rate is set per business. Points
     spend at the till, with a minimum per redemption. A return takes back what that
     part of the sale earned (never below zero). Staff can adjust points with a
     reason. Balances are ledgers, append-only like every other ledger.
9. **Analytics** ✅ (`0015_analytics.sql`, admin **Reports**):
   - **Live reports.** Reports read the same ledgers the tills and the store
     write. There are no copies or nightly jobs, so a report always agrees with
     the orders behind it. They cover:
     - sales, against the previous period of the same length, by day, week or month
     - channel, location and payment method
     - a weekday-by-hour grid
     - products, variants, categories and brands
     - stock value, days of cover and dead stock
     - new, returning and top customers
     - promotions against staff discounts
     - sales, discounts and returns per person
   - **Definitions.** Net sales exclude tax and are net of discounts and returns
     (on the day of the return). Gift cards sold are money held for the customer,
     so they are not a sale. Cost of goods is the cost recorded on each unit as it
     left stock. A return put back on sale gives that cost back, and a damaged one
     does not. Days are counted in the business's time zone.
   - **Access.** Needs `reports.view`. A manager limited to some locations sees only
     those. The `_report_*` building blocks are never exposed.
   - **Exports.** Every table exports to CSV (Excel-safe: UTF-8 BOM, formula-injection guard).
   - **Load.** Measured on 20,000 sales (40,000 lines) over a year on a laptop:
     every report returns in well under a second.
10. **Customer app** ✅ (`apps/mobile`, Expo 57 / React Native, `0016_mobile_app.sql`):
   - **What it does:** shop, search, category and product screens with live
     stock. The cart is kept on the phone, and its totals are priced by the
     database. Checkout supports delivery or pickup, cash on delivery or bank
     transfer, and coupons. Orders can be tracked, and an account shows loyalty
     points, store credit and every order in any channel, including the counter.
   - **Same API:** app orders use `checkout(..., p_channel => 'mobile_app')`, and
     `quote_order` takes the channel so app-only promotions price correctly. The
     store lookups answer when either the website or the app module is on, so a
     client can have the app without the website. `my_account` returns the
     signed-in shopper's profile, points and orders in one call.
   - **White-label:** one build per client from environment variables (shop,
     brand colour, store-listing identity). See `apps/mobile/README.md`.

## Known limits so far

- The POS needs a connection. An offline mode (queue non-serialised sales and
  flag conflicts on sync) is a later addition; serialised sales will always need
  a live check.
- Returns at the counter come with the returns module.

- An online order is fulfilled from **one** location. The storefront shows stock
  summed across online locations, so an order that would need two locations is
  refused. Split fulfilment comes with the fulfilment phase.
- Refunds move money only. Putting goods back on the shelf is the returns module (phase 6).
- The gateway integration itself (PayHere/Koko/Mintpay signature checks) is an
  Edge Function still to be written; the database side it calls is done, and online
  card payment stays switched off until then.
- Product photos: the storefront shows them from Supabase Storage (`products`
  bucket) and falls back to a plain initials tile. The admin can't upload yet;
  that arrives with the hosted project, since Storage isn't emulated locally.
- No emails or SMS yet (order confirmations, transfer reminders).
- A sign-up doesn't attach to an existing in-store customer with the same phone
  number. Doing that safely needs SMS verification.
- The app has no push notifications yet (order ready, delivery on its way).
  They need the hosted project, plus Expo push tokens or Firebase.
- Points and gift cards are spent at the till only. The storefront takes coupons,
  but not gift cards or points yet; that needs the payment step to support split
  tender online.
- Reports are computed live. Past a few hundred thousand orders a year, add a
  daily roll-up table fed by the same definitions; the report functions can
  switch to it without changing their output.
- A return still awaiting inspection hasn't given its cost back yet, so profit
  for that day reads slightly low until it is inspected.
- Gift cards have no expiry by default (`expires_on` exists but nothing sets it yet).
- Negative stock is never allowed. Some supermarkets sell before a delivery is
  booked in; if a client needs that, it becomes an explicit per-location setting.
- Stock written off or damaged cannot be taken from units that are currently on hold.
