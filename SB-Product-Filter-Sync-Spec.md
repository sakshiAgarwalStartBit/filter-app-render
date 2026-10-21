# SB Product Filter: Product Sync Specification

**Status:** Draft for team review. Nothing in this document has been implemented.
**Stack today:** React Router 7 (the successor of Remix), Prisma, PostgreSQL, hosted on Render. Shopify API version in code: `2026-07`.
**Hosting assumption:** paid Render services only. No free plans.

---

## 1. Purpose

Today the storefront filter reads a collection's products from Shopify on a cache miss and stores the result in Postgres for 10 minutes. This breaks down for large catalogs and for many visitors at once (see section 2).

This change adds a **local copy of every store's products** in our own database, kept up to date automatically, with a manual refresh and a safety pause for abnormal change volume. Storefront requests then read only our database and never call Shopify.

### Goals

- Products sync automatically after install, with visible progress.
- Shopify changes reach the storefront within seconds to about two minutes.
- A **Sync now** button gives merchants an immediate refresh.
- Auto-sync pauses for a store that makes an abnormally large number of changes, and the dashboard tells the merchant.
- Bulk uploads (for example 5,000 products) do not overload the app or the database.
- Each store's data stays isolated from every other store.

### Non-goals (this phase)

- Replacing Shopify as the source of truth. Shopify stays authoritative.
- Syncing customers, orders or any data other than products, variants, collections and the metafields that filters use.
- Supporting more than one web instance (a shared cache service is a later step).

---

## 2. Current state and problems found

Found by reading `app/collection-filters.server.js` and the proxy routes. Not load-tested.

| # | Problem | Effect |
|---|---|---|
| 1 | `MAX_PRODUCTS = 2000`. Collections above 2,000 products are cut off. | Products after the 2,000th never appear in filters or counts. Wrong results with no error. |
| 2 | The `product_update` webhook clears the shop's whole cache (`clearProductCache`). | During a bulk update the cache is cleared constantly, so most visitor requests refetch the full catalog from Shopify. |
| 3 | No protection when many visitors hit an empty cache at once. | Each visitor starts the same full Shopify fetch (up to 8 pages of 250). They compete for the store's API allowance and some get throttled or a 502. |
| 4 | Each request returns the whole collection (up to 2,000 products) as one JSON response. The browser filters and pages it. | Large responses and large cache rows. Heavy on CPU and memory when requests overlap. Slow on phones. |
| 5 | Every new search term costs a full catalog fetch. | Limited to 60 uncached searches per minute per shop, but a burst still loads Shopify and the database. |
| 6 | About 5 database reads per request (session, billing/trial, filter config, shop settings, cache row). The config route is `no-store`. | Queries queue when Prisma's small default pool is busy. |
| 7 | (Hosting) free web services sleep. | Not applicable once we use paid plans. |

What already works: data is scoped by `shop`, Shopify throttling is retried, inputs are validated, and the cache key changes when filter configuration changes.

---

## 3. Scope

### In scope

1. New database tables holding each store's products, variants, collection membership and filter metafields.
2. Initial import on install (automatic).
3. Continuous sync: webhooks, a 2-minute incremental check, and a nightly full re-index.
4. Manual sync from the dashboard: **Sync now** and **Full re-sync**.
5. Circuit breaker: pause auto-sync for abnormal change volume, with a dashboard banner (banner only, no email).
6. Storefront endpoints reading from the new tables, behind a per-shop feature flag, with fallback to the current live fetch.
7. A separate background worker service on Render.
8. Cleanup on uninstall and redact requests.
9. Monitoring and a test checklist.

### Out of scope (later)

- Server-side filtering and paging of the storefront response (phase 5, needs theme extension changes, see 7.2).
- Redis/Key Value shared cache.
- Read replicas.

### 3.1 Product limit per store (10,000) and support upgrade

**Policy**

- **Default limit: 10,000 products per store.** Design capacity: **500 stores**.
- The limit is part of the plan and is stated to merchants: "Up to 10,000 products per store. For more than 10,000 products, contact support."
- The limit is stored per shop in `SyncState.productLimit`. The default comes from the environment variable `SYNC_DEFAULT_PRODUCT_LIMIT`.
- **Only active products count.** The storefront only shows active, published products, so the sync stores only products with status `ACTIVE`. Draft and archived products are not stored and do not count toward the limit. If a product becomes draft or archived, it is removed from our tables; if it becomes active again, it is added.

**What happens at install and afterwards (Option B)**

1. At install the app reads Shopify's active product count and stores it in `SyncState.shopifyProductCount`.
2. The import stops reading after the limit is reached. The **first 10,000 active products, in Shopify's export order (by product ID, oldest first), are synced**. The rest are not stored.
3. If the store has more than its limit, `SyncState.limitReached = true` and `skippedProductCount` holds the number not synced. The merchant is notified (below). The synced products work normally in filters and search.
4. After that, new products that would exceed the limit are skipped and counted in `skippedProductCount`. Deleting or deactivating a product frees a slot, and the nightly job fills freed slots with skipped products in the same order.
5. The count is re-checked at install, in the nightly job, and at each manual sync. If a store drops below its limit, `limitReached` clears and the next sync completes the import.

**Notification when the limit is reached**

- A **dashboard banner**: "Your store has N products. Only the first 10,000 are included in filters and search. To include all products, contact support to upgrade your plan."
- A **one-time email** to the store owner's address, through the existing `resend` dependency. `notifiedAt` prevents repeats. Another email is sent only if the situation changes, for example the count falls below the limit and later passes it again. (The email can be dropped if the team decides the banner is enough.)
- The store owner's email address comes from the shop data in Shopify. Confirm during the build that this needs no extra scope.

**Raising the limit for a specific store (support process)**

1. A merchant contacts support (and upgrades to a higher plan if plans are tied to limits).
2. Support sets that store's `productLimit` to the new value. This must be done through an internal, access-controlled admin page or a script run against the database. It must never be exposed to merchants.
3. Support triggers a **Full re-sync** for the store (or waits for the nightly job). The skipped products are imported and `limitReached` clears.
4. Other stores keep the default limit.
5. A larger limit means more database storage, so the plan price for larger catalogs should cover that growth. The app already has plan and trial logic in `billing.server.js` that the limit can be tied to.

**The 2,000-product cap**

- Today's live-fetch code stops at 2,000 products (`MAX_PRODUCTS`). That cap is **removed for the synced path**: storefront requests served from our database have no 2,000 cap. The only limit in the synced design is the per-store product limit, which exists for capacity and cost reasons.
- The old live-fetch path remains only as a temporary fallback (before a store's first import finishes). Its cap is raised from 2,000 to the store's product limit (10,000) so it stays bounded. An unbounded live fetch could use up a store's Shopify API allowance (risk R27).

---

## 4. Data model

New Prisma models. All rows carry `shop`, and every query filters on it. Names and types are a proposal for review.

```prisma
model SyncProduct {
  shop          String
  productId     String            // Shopify GID, e.g. gid://shopify/Product/123
  handle        String
  title         String
  vendor        String
  productType   String
  category      String?
  status        String            // ACTIVE / DRAFT / ARCHIVED
  publishedAt   DateTime?         // evaluated at query time, see risk R12
  tags          String[]
  minPrice      Decimal
  maxPrice      Decimal
  currencyCode  String
  available     Boolean
  featuredImage Json?
  secondImage   Json?
  ratingValue   Decimal?          // from the configured review metafields
  ratingCount   Int?
  metafields    Json              // values for every configured metafield filter
  shopifyUpdatedAt DateTime       // Shopify's updatedAt, used to ignore stale events
  syncedAt      DateTime @default(now())

  @@id([shop, productId])
  @@index([shop, vendor])
  @@index([shop, productType])
  @@index([shop, minPrice])
  @@index([shop, shopifyUpdatedAt])
}

model SyncVariant {
  shop        String
  variantId   String
  productId   String
  title       String
  price       Decimal
  available   Boolean
  sku         String?
  options     Json              // [{name, value}] used for option and swatch filters
  position    Int

  @@id([shop, variantId])
  @@index([shop, productId])
}

model SyncCollectionProduct {
  shop         String
  collectionId String
  productId    String
  position     Int              // manual sort order inside the collection
  bestSellingPosition Int?      // Shopify's best-selling rank inside this collection, see 5.7

  @@id([shop, collectionId, productId])
  @@index([shop, productId])
}

model SyncCollection {
  shop         String
  collectionId String
  handle       String
  title        String
  updatedAt    DateTime
  bestSellingRequestedAt DateTime?   // last time a shopper used the best-selling sort here
  bestSellingRefreshedAt DateTime?   // last time the ranking was refreshed from Shopify

  @@id([shop, collectionId])
  @@index([shop, handle])
}

model SyncState {
  shop                 String   @id
  status               String   // NOT_STARTED, IMPORTING, READY, ERROR, PAUSED_HIGH_VOLUME
  useSyncedData        Boolean  @default(false)   // per-shop feature flag, see 7.1
  productLimit         Int      @default(10000)   // per-shop product limit, see section 3.1
  shopifyProductCount  Int?                       // active products in Shopify, checked at install, nightly and on manual sync
  limitReached         Boolean  @default(false)   // true when active products exceed productLimit
  skippedProductCount  Int      @default(0)       // active products not synced because of the limit
  importStartedAt      DateTime?
  importProgress       Int      @default(0)       // products imported
  importTotal          Int?
  lastFullSyncAt       DateTime?
  lastIncrementalAt    DateTime?
  incrementalCursor    DateTime?                  // updated_at watermark
  productCount         Int      @default(0)
  lastError            String?
  pausedAt             DateTime?
  pauseReason          String?
  notifiedAt           DateTime?
  nextFullSyncAt       DateTime?                  // staggered per shop
  updatedAt            DateTime @updatedAt
}

model SyncQueue {
  id          BigInt   @id @default(autoincrement())
  shop        String
  kind        String   // PRODUCT, COLLECTION, SHOP_INCREMENTAL, SHOP_FULL
  entityId    String?  // product or collection GID
  action      String?  // upsert or delete
  receivedAt  DateTime @default(now())
  lockedAt    DateTime?
  attempts    Int      @default(0)
  lastError   String?

  @@index([shop, kind, entityId])
  @@index([lockedAt, receivedAt])
}

model SyncEventCounter {
  shop    String
  bucket  DateTime        // start of the hour
  count   Int      @default(0)

  @@id([shop, bucket])
}
```

Notes:

- Only products with status `ACTIVE` are stored. A product that becomes draft or archived is deleted from our tables.
- Migrations are additive: no existing table changes, so deploying them is low risk.
- `SyncProduct.metafields` stores values for **every configured metafield filter, enabled or not**, so turning a filter on needs no re-import. A newly added metafield filter needs a back-fill (section 5.6).
- The existing `ProductCache` table stays until the synced path is proven, then is removed in a later migration.

---

## 5. Sync design

### 5.1 Initial import (automatic, on install)

1. After authentication, create/refresh `SyncState` with `status = IMPORTING` and enqueue a `SHOP_FULL` job.
2. The worker first reads Shopify's active product count and stores it. If it is above `productLimit`, it sets `limitReached` and notifies the merchant (section 3.1). It then starts a Shopify **Bulk Operation** (`bulkOperationRunQuery`) that exports active products, variants, collection membership and the needed metafields.
3. When Shopify finishes (`bulk_operations/finish` webhook, with polling as a fallback), the worker streams the result file line by line and upserts in batches of about 500. The file is never loaded into memory whole. Reading stops once the store's `productLimit` is reached; the remainder is counted in `skippedProductCount`.
4. Progress is written to `SyncState.importProgress` and shown on the dashboard.
5. On completion: `status = READY`, `lastFullSyncAt`, `incrementalCursor` set to the export start time, and `useSyncedData = true`.
6. Until `READY`, the storefront keeps using the current live-fetch path.

Check before building: how many bulk operations Shopify allows per store at once for API version 2026-07. If only one, a second job for the same shop must wait.

### 5.2 Webhooks (automatic, seconds)

Topics to subscribe:

| Topic | Action |
|---|---|
| `products/create`, `products/update` | enqueue `PRODUCT` upsert |
| `products/delete` | enqueue `PRODUCT` delete |
| `collections/create`, `collections/update`, `collections/delete` | enqueue `COLLECTION` refresh (re-fetch membership) |
| `bulk_operations/finish` | resume the import job |
| `inventory_levels/update` | enqueue `PRODUCT` upsert (decision D3: included). Requires the `read_inventory` scope. |

Handler rules:

- Verify the HMAC (`authenticate.webhook`), increment `SyncEventCounter`, insert into `SyncQueue`, return **200 immediately**. No Shopify calls inside the handler.
- If the shop is `PAUSED_HIGH_VOLUME`, count the event and return 200 but do not enqueue.
- When the worker processes a product that is not `ACTIVE`, it deletes the product from our tables. When it processes a new active product and the shop is at its limit, it skips it and increments `skippedProductCount`.
- The existing `webhooks.app.product_update.jsx` stops clearing the whole cache and is replaced by this behaviour. During the transition, the legacy cache is still cleared per shop.

### 5.3 Queue worker

- Runs continuously in the background worker service.
- Claims jobs with `SELECT ... FOR UPDATE SKIP LOCKED` so two workers never take the same job. A job locked for longer than a timeout (for example 5 minutes) is treated as abandoned and retried.
- **Deduplicates:** many events for the same product become one fetch.
- **Batches:** fetches up to 250 products per GraphQL call (`nodes(ids:)`) and upserts in one transaction per batch.
- **Ignores stale events:** an upsert only applies when the incoming `updatedAt` is newer than the stored `shopifyUpdatedAt`.
- **Retries:** exponential backoff, up to a maximum number of attempts, then the error is stored in `lastError` and the shop's status shows `ERROR` if repeated.
- **Fairness:** takes jobs in rotation across shops, so one large store cannot starve others.
- Rate limits: reuses the existing throttle-aware retry logic (`graphqlWithRetry`).

### 5.4 Incremental check (every 2 minutes, safety net for missed webhooks)

- For each active shop (staggered, not all at once), query products with `updated_at:>` the shop's `incrementalCursor`, minus a small overlap (for example 2 minutes) to avoid gaps from clock differences.
- Upsert what comes back and move the cursor forward.
- This costs almost nothing when nothing changed.
- It cannot see deletions or collection membership changes. Those are covered by the delete/collection webhooks and the nightly re-index.

### 5.5 Nightly full re-index

- Runs once a day per shop in a quiet window, **staggered by shop** (spread across a few hours using `nextFullSyncAt`) so 50 stores do not all start together.
- Re-exports everything via a bulk operation, then compares:
  - IDs in our table but not in Shopify are deleted.
  - Differences in `updatedAt` are corrected.
  - Collection membership is replaced from the export.
- This is what catches bulk and CSV import tools that do not always fire webhooks, and any webhook that was lost.
- After it finishes, compare our `productCount` with Shopify's `productsCount`; a mismatch is logged and re-queued once.

### 5.6 Back-fill when filter config changes

When a merchant adds a metafield filter (or changes the review metafield keys), enqueue a back-fill job for that shop that fetches only those metafields for all products. The filter shows as "preparing" on the storefront until it completes, or the storefront falls back to live fetch for that shop.

### 5.7 Best-selling sort (decision D4: keep best selling)

Shopify decides the best-selling order from sales, and changing a product does not change it, so webhooks and the incremental check never see it. Our copy therefore stores the ranking separately and refreshes it on a schedule:

- For each collection, a job reads the collection's products sorted by Shopify's `BEST_SELLING` key and stores each product's position in `SyncCollectionProduct.bestSellingPosition`.
- It refreshes **only collections where shoppers have used the best-selling sort recently** (tracked with `bestSellingRequestedAt`), to save Shopify API calls. A collection never used that way costs nothing.
- Refresh interval: proposed every 30–60 minutes for active collections, plus a refresh during the nightly full re-index. The interval is a setting (`SYNC_BEST_SELLING_REFRESH_MINUTES`).
- The first time a collection is requested with best-selling and has no stored ranking, the request falls back to a live fetch for that collection (as today) and queues the refresh.
- The ranking can be up to the refresh interval behind Shopify. Sales change slowly, so this is acceptable, but it is a known difference.
- The all-products and search views already do not use true best-selling today (the code falls back to ID order because Shopify's product list has no such sort key). That behaviour stays unchanged.

---

## 6. Manual sync and large-change pause

### 6.1 Manual sync (dashboard)

| Button | Does | Typical time |
|---|---|---|
| **Sync now** | Incremental sync of products changed since the last sync, then clears that shop's cached results. | Seconds |
| **Full re-sync** | Re-runs the bulk export for the shop (like the nightly job). | Minutes, depends on catalog size |

Rules:

- Always allowed, including while auto-sync is paused.
- A cooldown (for example one per minute per shop) prevents button spamming.
- The existing **Clear cache** button keeps working during the transition.

### 6.2 Circuit breaker (large-scale changes)

Two separate protections:

1. **Burst handling (no pause):** if more than a threshold of events arrive in a short window (for example 500 in 5 minutes), the worker stops processing them one by one and runs one coalesced incremental sync instead. Nothing is dropped.
2. **Daily pause:** if a shop exceeds a daily event limit (rolling 24 hours, summed from `SyncEventCounter`), auto-sync is paused for that shop only:
   - `SyncState.status = PAUSED_HIGH_VOLUME`, with `pausedAt` and `pauseReason`.
   - Webhooks are still acknowledged and counted, but not queued. The 2-minute check skips the shop.
   - The dashboard shows a warning banner (section 6.3). No email is sent (decision D8).
   - **Sync now** keeps working and always recovers the data using the `updated_at` cursor.
   - Auto-sync resumes automatically when the rolling count drops below the limit, or when the merchant clicks **Resume auto-sync**.

Thresholds are **configurable through environment variables** and start as proposals to be tuned with real data:

| Variable | Proposed default | Meaning |
|---|---|---|
| `SYNC_BURST_EVENTS` | 500 | events in the burst window that trigger coalescing |
| `SYNC_BURST_WINDOW_MINUTES` | 5 | burst window |
| `SYNC_DAILY_EVENT_LIMIT` | 20000 | events per rolling 24 hours before pausing |
| `SYNC_MANUAL_COOLDOWN_SECONDS` | 60 | minimum time between manual syncs |
| `SYNC_INCREMENTAL_INTERVAL_SECONDS` | 120 | incremental check interval |
| `SYNC_BATCH_SIZE` | 250 | products per upsert batch |

### 6.3 Dashboard notification bar

On the app dashboard (`app/routes/app._index.jsx`), a Polaris banner shows the sync state:

| State | Banner | Action |
|---|---|---|
| `IMPORTING` | Info: "Importing your products… X of Y" | none |
| `READY` | Subtle line: "Products synced, last update HH:MM" | **Sync now** |
| Limit reached (`limitReached`) | Warning: "Your store has N products. Only the first 10,000 are included in filters and search. Contact support to upgrade your plan." | **Contact support** |
| `ERROR` | Critical: "Sync failed: <short reason>" | **Sync now**, **Full re-sync** |
| `PAUSED_HIGH_VOLUME` | Warning: "Auto-sync paused because of a very large number of product changes today. Your storefront may show older data." | **Sync now**, **Resume auto-sync** |
| Stale (no successful sync for more than N minutes) | Warning: "Sync is delayed" | **Sync now** |

---

## 7. Storefront changes

### 7.1 Reading from the synced tables

- `proxy.collection-products.jsx` and `proxy.wishlist-products.jsx` read from the new tables when `SyncState.useSyncedData` is true and status is `READY` (or `PAUSED_HIGH_VOLUME`, which still serves data). Otherwise they use the current live-fetch path.
- Result for one collection: products joined through `SyncCollectionProduct`, visibility evaluated at query time (`status = ACTIVE` and `publishedAt <= now()`), same response shape as today, so the theme extension keeps working.
- A short in-memory cache (30–60 seconds, keyed by shop, collection, sort and search) sits in front of the database. It is cleared per shop when that shop's data changes.
- `proxy.filter-config.jsx` may use a short browser cache (`private, max-age=60`) instead of `no-store`.
- There is no 2,000-product cap on the synced path. The only limit is the per-store product limit (section 3.1).

### 7.2 Server-side filtering and paging (phase 5)

Sending the whole collection to the browser is still heavy. Phase 5 returns one page of products plus filter counts per request. This changes the response contract and **requires changes in the theme extension JavaScript** (`extensions/collection-filters`), which has not been reviewed yet. It is a separate, later step so the first release carries less risk.

### 7.3 Behaviour differences to accept or fix

- **Search:** today it uses Shopify's product search. Synced search will use Postgres (full-text or `ILIKE`), so result ordering can differ.
- **Sorting:** `featured` uses the stored collection `position`. `best_selling` uses the ranking stored from Shopify and refreshed on a schedule (section 5.7). It can lag Shopify by the refresh interval.
- **Prices:** shown in the shop currency, as today.

---

## 8. Infrastructure on Render (paid)

### 8.1 Services

| Service | Purpose | Minimum plan |
|---|---|---|
| Web service (existing) | Admin UI, storefront proxy, webhook receiver | At least the **$7 plan (0.5 CPU, 512 MB)**. Recommended for production: the **$25 plan (1 CPU, 2 GB)**. |
| **Background Worker (new)** | Import, queue, schedulers, circuit breaker | **$7 plan (0.5 CPU, 512 MB)** to start. Move up if imports are slow. |
| PostgreSQL (upgrade the existing database) | Stores everything | See 8.2. |

The worker is a separate service, with the same repository and the same database, started with its own command (for example `npm run worker`). Earlier I suggested running the worker inside the web service to save cost. Because paid services are acceptable, a separate worker is more stable: a web deploy or restart no longer interrupts sync jobs, and imports cannot slow storefront responses.

Key Value (Redis) is **not** required now.

### 8.2 Database plan (minimum)

Plan names and prices change, so check the current list on Render's pricing page.

Storage estimate (rough, plus or minus a factor of two; measure after the first real imports):

- about 4.5 KB per product including variants, collection rows and indexes.

| Scenario | Products stored | Approx. size |
|---|---|---|
| 10 stores × 2,000 products | 20,000 | about 0.1 GB |
| 50 stores × 2,000 products | 100,000 | about 0.5 GB |
| 50 stores × 10,000 products | 500,000 | about 2.3 GB |
| 500 stores × 1,000 products (typical mix) | 500,000 | about 2.3 GB |
| 500 stores × 10,000 products (every store at the limit) | 5,000,000 | **about 22 GB** |

The 500-store, every-store-at-the-limit case is the worst case. Real catalogs vary, so the database should **grow in steps with installs**, not be sized for the worst case on day one.

Recommendation:

- **Start (up to about 50 stores):** at least **1 GB RAM**, a disk of **at least 10 GB**, **Storage Autoscaling on**, **Connection Pool on**. Do not use the smallest 256 MB RAM tier for production.
- **Growing (about 100 to 300 stores):** move to a plan with **4 GB RAM** or more when Render Metrics show high memory or CPU, and watch disk growth.
- **At 500 stores:** expect a larger plan (more RAM and a disk in the tens of GB if many stores are near the limit). Size it from the real average catalog by then, and review index sizes.
- Check which backup and point-in-time recovery option the chosen plan includes.
- Upgrade the **existing** database from its **Plan** page before **November 15, 2026**, when the free instance expires. Confirm in Render's docs that your instance keeps its data and URL through the upgrade.
- Plan names and prices change, so check Render's pricing page.

### 8.3 Connections

- Keep Prisma's pool small and explicit: for example `connection_limit=10` on the web service and `connection_limit=5` on the worker (set in each service's `DATABASE_URL`).
- Make sure the total across all services stays below the database plan's maximum connections. Check that number for the chosen plan.

### 8.4 Deploy changes

- `render.yaml`: add the worker service and keep the existing web service and database.
- Run `prisma migrate deploy` before the new code starts, not at the start of each service. Use Render's pre-deploy command if it is available on the plan; otherwise keep it in the web service start command and make the worker wait for the tables (retry on start).
- `.env.example` gets the `SYNC_*` variables above.
- `package.json` gets a `worker` script.

---

## 9. Shopify configuration changes

| Item | Change |
|---|---|
| Webhooks in `shopify.app.toml` | Add product, collection and `bulk_operations/finish` subscriptions. Keep the existing `app/uninstalled`, `app/scopes_update`, billing and the three compliance topics. |
| Existing `[events]` product-updates subscription | Replaced by standard webhooks (decision D5). Remove the `[events]` block and its `product-updates` subscription. |
| Scopes | Current: `read_themes, write_metaobject_definitions, write_metaobjects, write_products`. Add **`read_inventory`** (decision D3). Update it in three places: `shopify.app.toml`, `.env.example`/`render.yaml`, and the `SCOPES` variable in Render. Merchants approve the new scope when they install or update. |
| Webhook API version | Align the `[webhooks] api_version` in the toml with the version used in code (`2026-07`). They currently differ in the main folder's toml. |
| Offline tokens | The app uses expiring offline access tokens (`expiringOfflineAccessTokens: true`). The worker must obtain its Admin client through `unauthenticated.admin(shop)` so tokens are refreshed (see risk R6). |

---

## 10. Cleanup and compliance

- `app/uninstalled`: delete the shop's rows from all `Sync*` tables, along with the session as today.
- `shop/redact` (and `customers/redact` where relevant): delete the shop's rows from the new tables (extend `webhooks.shop.redact.jsx`).
- Reinstall: a fresh `SyncState` starts a new import.
- Queue and counter housekeeping: delete `SyncQueue` rows older than a retention period and `SyncEventCounter` rows older than a few days.

---

## 11. Risks and how we detect them

| ID | Risk | Impact | How we detect it | Mitigation |
|---|---|---|---|---|
| R1 | Webhooks delayed, duplicated or lost | Stale or missing products | Incremental lag metric; nightly count comparison | 2-minute incremental check; nightly re-index; idempotent upserts |
| R2 | Out-of-order events | Old data overwrites new | Tests with shuffled events | Apply an upsert only if `updatedAt` is newer |
| R3 | Bulk and CSV imports that skip webhooks | Products not updated until the nightly job | Nightly diff count | Nightly re-index; Sync now; dashboard banner |
| R4 | Deletions not visible to the `updated_at` query | Deleted products linger | Nightly ID-set comparison | `products/delete` webhook; nightly reconcile |
| R5 | Shopify API throttling or bulk operation failures or timeouts | Import stalls or errors | `lastError`, import progress not moving | Throttle-aware retry; poll and resume; retry limit; `ERROR` banner |
| R6 | Expired or revoked offline token in the worker | Sync fails for a shop | Repeated auth errors in `lastError` | `unauthenticated.admin(shop)` refresh; mark shop `ERROR`; stop retrying after uninstall |
| R7 | App uninstalled during an import | Orphan rows and wasted calls | Job fails with auth error | Check the session before each batch; purge data on uninstall |
| R8 | Worker crash or restart mid-job | Half-done batch | Locked jobs older than timeout | Lock timeout and retry; transactional batches; idempotent upserts |
| R9 | Queue growth faster than processing | Increasing delay | Queue depth and oldest event age | Dedupe; coalesce on burst; scale the worker |
| R10 | Database load or index cost during bulk writes | Slower storefront queries | Render Metrics (CPU, memory, connections); slow query log | Batching; sized plan; connection limits; separate worker |
| R11 | Migration deploys while the worker starts | Worker errors on missing tables | Worker startup errors | Pre-deploy migration; worker retries on start |
| R12 | Scheduled publishing: a product becomes visible later with no event | Product missing from storefront | Test case | Store `publishedAt` and evaluate visibility at query time |
| R13 | Search and sort behave differently from Shopify | Merchants notice different ordering | Side-by-side comparison tests | Decide D4; document differences |
| R14 | New metafield filter has no stored values yet | Filter shows nothing | Filter config change event | Back-fill job; fall back to live fetch until done |
| R15 | Circuit breaker thresholds wrong | Pauses too early or protects too little | Pause count per week; support feedback | Env-configurable thresholds; tune from real data |
| R16 | Pause hides stale data from shoppers | Out-of-date storefront | Banner state; stale lag metric | Prominent banner; Sync now always works; auto-resume |
| R17 | One store floods the worker | Other stores delayed | Per-shop queue age | Fair rotation across shops; per-shop limits |
| R18 | Stale or wrong data served after a bug | Wrong products or counts | Count comparison per shop | Full re-sync; per-shop feature flag to fall back to live fetch |
| R19 | Webhook API version differs from code API version | Payload shape mismatches | Webhook handler errors | Align versions (section 9) |
| R20 | Database size grows faster than estimated | Disk full or slow queries | Storage metrics | Storage autoscaling; alert on usage; measure after the first imports |
| R21 | GDPR or uninstall data left behind | Compliance issue | Periodic orphan check by shop | Purge on uninstall and redact |
| R22 | Store has more than 10,000 active products | The newest products (after the first 10,000 by ID) are missing from filters and search | `limitReached`, `skippedProductCount`, `shopifyProductCount` above `productLimit` | Dashboard banner and one-time email; support raises `productLimit` for that store; Full re-sync |
| R23 | 500 stores near the limit means about 22 GB and about 5 million rows | Slower queries, disk pressure, longer nightly re-index | Storage and query metrics; nightly job duration | Grow the database plan in steps; stagger nightly jobs across hours; review indexes at scale |
| R25 | Partial data for over-limit stores: filter counts and results exclude skipped products | Shoppers may not find skipped products through filters | Banner shown to merchant; `skippedProductCount` | Clear merchant message; support upgrade path; oldest-first order confirmed (D12) |
| R26 | Skipped products are the newest by ID, which may be the products merchants care about most | Merchant dissatisfaction | Support tickets | Oldest-first order is confirmed (D12); prompt notification; revisit the order if merchants complain |
| R27 | The live-fetch fallback cap is raised from 2,000 to 10,000 | More Shopify API usage per fallback request | Shopify throttling in logs | Fallback only until the first import finishes; keep the per-minute search limit; cache the fallback result |
| R24 | Worker throughput at 500 stores (about 250 incremental checks per minute plus nightly bulk operations) | Delayed sync | Queue age; job duration | Stagger per shop; scale the worker plan or run a second worker |

### Monitoring and alerting

- **Per shop (on the dashboard):** status, last sync time, product count, last error.
- **Worker logs:** queue depth, oldest event age, job duration, error rate. Add structured log lines so Render's log search can find them.
- **Render Metrics:** CPU, memory, connections and storage for the web service, worker and database. Set the alerts Render offers for resource limits.
- **Daily check:** compare `SyncState.productCount` to Shopify's `productsCount` per shop; log mismatches.

---

## 12. Delivery phases

Each phase ships behind the per-shop `useSyncedData` flag so it can be switched off per store.

| Phase | Work | Done when |
|---|---|---|
| 1. Schema and import | Prisma models and migration; worker service; bulk import; sync status on the dashboard | A new install imports all products with visible progress; counts match Shopify |
| 2. Webhooks and queue | Product, collection and bulk-finish webhooks; queue; worker processing; dedupe; stale-event guard | Edits, creates and deletes appear in the database within seconds; a 5,000-product bulk update clears without errors |
| 3. Storefront on synced data | Proxy reads from the tables; in-memory cache; fallback to live fetch; 2,000 cap removed on this path | A 2,000+ product collection filters correctly; concurrent visitors do not call Shopify |
| 4. Safety layers | 2-minute incremental check; nightly re-index; Sync now and Full re-sync; circuit breaker; banner (no email); best-selling ranking refresh | Missed webhooks recover; pause and resume work; banner states render correctly |
| 5. Server-side filtering and paging | Paged responses and server-side counts; theme extension changes | Response size and page load drop; behaviour matches the current filters |
| 6. Hardening | Load test; monitoring and alerts; cleanup jobs; retire `ProductCache` | Test checklist below passes |

### Files expected to change or be added

- `prisma/schema.prisma` and a new migration
- new `app/sync/*.server.js` (import, queue, upsert, scheduler, circuit breaker) and a worker entry file
- new routes for product, collection and bulk-finish webhooks; changes to `webhooks.app.product_update.jsx`, `webhooks.app.uninstalled.jsx`, `webhooks.shop.redact.jsx`
- `app/routes/app._index.jsx` (banner and buttons) and an action route for manual sync
- `app/routes/proxy.collection-products.jsx`, `proxy.wishlist-products.jsx`, `proxy.filter-config.jsx`, and `app/collection-filters.server.js`
- `shopify.app.toml`, `render.yaml`, `package.json`, `.env.example`
- phase 5 only: files under `extensions/collection-filters`

---

## 13. Test checklist

1. Fresh install imports all products; progress is shown; counts match Shopify.
2. Create, edit and delete one product; the database matches within seconds.
3. Collection membership change (manual and smart collections).
4. Bulk update of 5,000 products; the queue drains with no errors; the storefront stays responsive.
5. CSV import (may not fire webhooks); the 2-minute check or nightly job corrects it.
6. Shopify event lost on purpose (stop the worker, edit, restart); the incremental check recovers it.
7. Daily limit exceeded; shop is paused; banner appears; Sync now still works; resume works.
8. Uninstall during an import; no errors loop; data is purged; reinstall starts clean.
9. Collection with more than 2,000 products shows every product.
10. Scheduled-publish product appears at the right time.
11. 10 concurrent visitors on one store, and visitors on several stores at once: no Shopify calls, stable response times.
12. Worker restart in the middle of an import resumes correctly.
13. New metafield filter added: back-fill runs, then the filter works.
14. Two stores with overlapping product names or IDs never see each other's data.
15. A store with 12,000 active products: the first 10,000 import, the banner and one-time email appear, and `skippedProductCount` is 2,000.
16. At the limit: a new active product is skipped; deleting one product frees a slot that the nightly job fills.
17. A draft product is not stored; changing it to active adds it; changing it back removes it.
18. Support raises one store's `productLimit`, runs Full re-sync, and the banner clears while other stores keep the default.
19. A product count that drops below the limit clears `limitReached`.

---

## 14. Decisions

| ID | Question | Decision |
|---|---|---|
| D1 | Which filters must work from synced data? | All current filter types, plus configured metafields, enabled or not. |
| D2 | Is up to 2 minutes of delay acceptable? | Yes, with Sync now for urgent cases. Webhooks are faster. |
| D3 | Inventory webhooks and the `read_inventory` scope? | **Yes.** Add `read_inventory` and subscribe to `inventory_levels/update`. |
| D4 | Best-selling sort? | **Keep it.** Store Shopify's ranking per collection and refresh it on a schedule (section 5.7). |
| D5 | Existing `[events]` subscription? | **Replace with standard webhooks.** |
| D6 | Search from synced data | **Search runs on our own database** (Postgres search), not on Shopify's search. Result order and word matching can differ from Shopify's storefront search, and this is accepted. |
| D7 | Pause thresholds | Start with the proposed values (section 6.2) and tune with real data. |
| D8 | Notifications | **Pause for high volume: dashboard banner only.** **Product limit reached: dashboard banner plus a one-time email** to the store owner, with a message to contact support to upgrade. |
| D9 | Catalog size | **10,000 active products per store, designed for 500 stores.** For more than 10,000, merchants contact support to raise the limit for that store (section 3.1). |
| D10 | Move off free plans | Before November 15, 2026. |

| D11 | Storefront behaviour for a store over its limit | **Option B:** import the first 10,000 active products, show the notification, and the rest are not synced until the limit is raised. |
| D12 | Which 10,000 products are kept when a store is over the limit | **Oldest first, by product ID** (the order Shopify's export returns). Confirmed. See risk R26. |
| D13 | 2,000 cap | **Removed** on the synced path. The live fallback is capped at the 10,000 limit instead of being unbounded. |

### Still open

Nothing blocks the start of the build. One item is checked during the build: the store owner's email for the limit notification. The sync counts the store's active products when it runs after install, and sends the banner and one-time email at that point; if the email address cannot be read without a new scope, the banner still works and the email is added once that is resolved.
