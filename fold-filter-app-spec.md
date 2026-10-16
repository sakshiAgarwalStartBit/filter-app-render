# Collection Filter App — Build Spec

A single reference document covering product scope, backend rules, frontend rules, and security requirements for the multi-tenant Shopify collection filter app (React Router admin app + storefront widget, MySQL backend).

---

## 0. Stack (as actually scaffolded in this repo)

- **Admin app**: React Router 7 (`@react-router/dev`, `@react-router/fs-routes`) + Vite, embedded via `@shopify/shopify-app-react-router` + `@shopify/app-bridge-react`
- **ORM**: Prisma, targeting **MySQL** (`localhost`, user `root`, no password, database `collection_filter_app` — dev environment)
- **Session storage**: `@shopify/shopify-app-session-storage-prisma` (`PrismaSessionStorage`) — already generic across DB providers, no MySQL-specific package needed
- **Storefront delivery**: Theme App Extension (Liquid/OS 2.0 app block) wrapping a framework-agnostic widget

> Note: earlier drafts of this spec assumed a Remix template and left the datasource unspecified. This app is built on **React Router 7** (already scaffolded) and MySQL (per explicit decision) — corrected throughout below.

---

## 1. Product Scope Summary

**What the app does:**
A merchant installs the app, opens the embedded admin dashboard, and selects which of their store's available filterable fields (metafields, variant options, standard fields) to expose as a collection filter widget on their storefront. The widget renders live, faceted filtering powered directly by the Shopify **Storefront API**, scoped to only the fields the merchant enabled, and shows a live product count next to each filter option.

**Core behavior:**
- Merchant picks which fields are filterable, from an admin dashboard (backend-controlled)
- Storefront filter UI displays only the enabled fields, each option showing a live product count
- Product grid defaults to **10 products**; pagination respects whatever filters are currently active
- All secrets (API keys, tokens, DB credentials) stored securely — never exposed to the frontend or logs

**What it does NOT do:**
- Does not mutate orders, products, or inventory (read-only against Storefront API)
- Does not store product data, prices, or filter values in the app's own DB — only merchant *configuration*
- Does not require the shopper to log in

---

## 2. Backend Rules (React Router Admin App)

### 2.1 Data model (Prisma / MySQL)

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model FilterConfig {
  id        String   @id @default(cuid())
  shop      String   // e.g. my-store.myshopify.com
  fieldKey  String   // "metafield:custom.fabric" | "variantOption:Size" | "price" | "available" | "tag" | "vendor"
  fieldType String   // "metafield" | "variantOption" | "standard"
  label     String   // merchant-editable display label
  enabled   Boolean  @default(true)
  position  Int      // display order
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([shop])
  @@unique([shop, fieldKey])
}

model ShopSettings {
  shop        String   @id
  plan        String   @default("free")
  maxFilters  Int      @default(5)
  pageSize    Int      @default(10)
  installedAt DateTime @default(now())
}
```

### 2.2 Route rules

| Route | Auth | Rule |
|---|---|---|
| `app/routes/app.*` (dashboard) | `authenticate.admin(request)` on every route | Never trust `shop` from the client — always derive from the authenticated session |
| `app/routes/api.filter-config.jsx` | None (public) | Read-only; returns only enabled filter config for a validated shop domain |
| `app/routes/webhooks.app.uninstalled.jsx` | HMAC-verified (already scaffolded) | Deletes `FilterConfig` + `ShopSettings` rows for the shop |
| GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) | HMAC-verified | Required for Shopify app approval even without stored customer PII |

### 2.3 Admin dashboard logic (`app.filters.jsx`)
1. On load, call Admin GraphQL for `metafieldDefinitions`, plus hardcoded standard fields (price, availability, vendor, tag) and variant option names, to build the full selectable-field list
2. Render as a checklist with drag-to-reorder (Polaris)
3. Enforce `maxFilters` from `ShopSettings` — disable further selection once the cap is hit
4. On save: upsert `FilterConfig` rows for the shop (diff-and-update to preserve `id` stability)
5. `pageSize` (default 10) editable in the same settings screen

### 2.4 Public config endpoint logic (`api.filter-config.jsx`)
1. Validate `shop` query param against `/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/`
2. Confirm the shop has an active session (app still installed) — return 404 otherwise
3. Query `FilterConfig` where `shop = X AND enabled = true`, ordered by `position`
4. Return minimal JSON: `[{fieldKey, fieldType, label, position}]` plus `pageSize` from `ShopSettings`
5. `Cache-Control: public, max-age=300`; `Access-Control-Allow-Origin: *` (safe — non-sensitive, public read-only payload)

### 2.5 MySQL / local dev connection
- `DATABASE_URL="mysql://root:@localhost:3306/collection_filter_app"`
- Dev-only credentials (`root`, no password) — **must** be replaced with a scoped, credentialed user before any staging/production deployment
- Migrations via `prisma migrate dev` locally, `prisma migrate deploy` in CI/CD — never manual schema edits against a live DB

---

## 3. Frontend Rules (Storefront Widget) — Implemented

### 3.1 Stack (as built)
- **Delivery**: Shopify Theme App Extension (`extensions/collection-filters`), app block type, rendered inside any Online Store 2.0 section via `{"type": "@app"}`
- **Connectivity**: manual **App URL** block setting (an absolute URL to the app's backend), set by the merchant in the theme editor. The widget calls `{app_url}/api/filter-config` and `{app_url}/api/collection-products` directly.
- **Filtering engine**: products are fetched **server-side by the app backend via the Admin API**; the widget calls the app's own `/api/*` routes (no Shopify API token of any kind reaches the browser). Filter values, counts, and pagination are computed client-side in JS from that response.
- **Assets**: `assets/collection-filters.css` + `assets/collection-filters.js`, loaded via `stylesheet_tag` / a deferred `<script>` tag (app extension blocks cannot use inline `{% stylesheet %}` / `{% javascript %}` tags — theme-check enforces this)

### 3.2 Architecture history (five iterations; the app proxy attempt was reverted after testing)
1. **Original plan**: client-side Storefront API widget computing its own filters/counts.
2. **First revision**: switched to Shopify's native Liquid filtering (`collection.filters`, `{% paginate %}`) — simpler, free counts/pagination. **Reverted** after discovering in testing that `collection.filters` (and the Storefront API's `ProductFilter` beyond `available`/`price`) only returns data when the **Search & Discovery app is installed** — confirmed via Storefront API docs: "By default, the available and price filters are enabled. Filters are customized with the Shopify Search & Discovery app." The merchant did not want to install Search & Discovery.
3. **Second revision**: back to client-side Storefront API (matching the original plan) — required a public Storefront access token pasted into the block settings.
4. **Third revision**: moved product fetching server-side through the app's own `/api/*` backend routes, using the Admin API (via `unauthenticated.admin(shop)`). Removed the Storefront token requirement, but still required merchants to manually paste the app's URL (`app_url` block setting).
5. **Fourth revision (attempted, reverted)**: replaced `app_url` and the open `/api/*` routes with **Shopify's App Proxy** (`[app_proxy]` in `shopify.app.toml`, `authenticate.public.appProxy`), so the widget could call fixed relative paths with zero merchant configuration. In testing, requests through the proxy consistently failed (JSON-parse errors from an HTML response) even after confirming the dev tunnel was live and the app proxy signature/routing were technically correct — root cause not conclusively isolated in the time available (the dev store's storefront password-protection was one contributing factor ruled in/out along the way, but the failure persisted after that was accounted for). **Reverted** to unblock testing.
6. **Current (final) approach**: back to revision 4 — server-side Admin API fetching via `/api/*`, gated by a manually-entered `app_url` block setting. Known to work; verified end-to-end with real store data (Color swatches, Product type, Availability, pagination, price range all confirmed rendering correctly).

### 3.3 Backend routes (as built)
- `app/routes/api.filter-config.jsx` — public, open CORS; validates `shop` query param via regex, confirms an offline session exists for that shop, returns enabled filters + page size
- `app/routes/api.collection-products.jsx` — public, open CORS; validates `shop` and `collection` query params, resolves an Admin client via `unauthenticated.admin(shop)`, queries `collectionByIdentifier` for up to 250 products
- Shared query/formatting logic lives in `app/collection-filters.server.js` (`getFilterConfig`, `getCollectionProducts`) — kept factored out from the app-proxy experiment since it's auth-mechanism-agnostic and would let a future app-proxy retry reuse it directly

### 3.4 Widget behavior (as built)
1. On mount, `collection-filters-app` custom element (`assets/collection-filters.js`) reads `data-shop`, `data-collection-handle`, `data-app-url`, `data-page-size` from block settings
2. Fetches `{app_url}/api/filter-config?shop={shop}` — determines which fields are enabled and their labels
3. Fetches `{app_url}/api/collection-products?shop={shop}&collection={handle}` — the backend queries the Admin API (`collectionByIdentifier`) server-side for up to 250 products, requesting `vendor`, `tags`, `productType`, `category`, `priceRangeV2`, `options` (variant options), `totalInventory`/`tracksInventory` (derives availability), and one aliased `metafield(namespace, key)` per enabled metafield filter
4. Filter option values and **counts are computed entirely in JS** (`getFilterableValues`/`readProductValues`) — counting is done against the product set filtered by every *other* active filter, so counts stay accurate as selections change
5. Selecting a checkbox or applying a price range re-filters the in-memory product list and re-renders — no additional network round-trip per filter change
6. Products load via **infinite scroll**, not click-through pagination: `renderResults()` computes the full filtered array (`filteredCache`) and renders the first `pageSize` chunk (`appendNextChunk`); an `IntersectionObserver` watches a 1px sentinel element below the grid, and each time it scrolls into view (400px `rootMargin` lookahead, so the next chunk loads slightly before the user hits the literal bottom) the next `pageSize` chunk is appended to the existing grid — no page reset, no re-render of already-loaded cards. A status line ("Showing 10 of 34 products" / "Showing all 34 products") sits below the grid; the sentinel is removed once every product has loaded. This replaced an earlier click-through Previous/Next implementation entirely (not kept as a fallback), per explicit preference for scroll-based loading.
7. "Clear all" resets `activeFilters` and re-renders (which now means: recompute `filteredCache`, reset `loadedCount` to 0, reload the first chunk)
8. A **Sort by** dropdown (Featured, Best selling, Price low-high/high-low, Alphabetical A-Z/Z-A) sits above the product grid; changing it triggers a fresh `fetchProducts()` call with the new `sort` param — this is a real server round-trip (via `Collection.products(sortKey:, reverse:)` on the Admin API), not client-side reordering, since Shopify's "Best selling"/"Featured" ordering can't be replicated from data already in the browser
9. On mount, before any network request resolves, a **skeleton grid** (shimmering placeholder cards matching `page_size`) renders immediately via `renderSkeleton()` so the page never shows a blank area while `/api/filter-config` and `/api/collection-products` are in flight — replaced once real products arrive

### 3.4a Filter panel layout (admin-controlled)
- Merchant picks **Vertical**, **Horizontal**, or **Drawer** in `/app/filters` → "Filter layout" section (`s-select` — initially built with `s-choice-list`, which turned out to require a `selected` boolean per `<s-choice>` rather than a controlled `value` on the list, so nothing was reliably read/saved; switched to `s-select` which fixed it), persisted as `ShopSettings.filterLayout` (default `"vertical"`)
- `/api/filter-config` cache lowered from `max-age=300` to `max-age=30` after this bug investigation — the layout was actually saving/switching correctly, but a 5-minute browser cache made it look broken while testing quick changes
- Returned from `/api/filter-config` alongside `filters`/`pageSize`; the widget applies it as a CSS modifier class (`collection-filters-app__layout--{vertical|horizontal|drawer}`) on the layout root once config loads — no block setting or Liquid-time knowledge needed, since it's decided per-shop by the merchant in the admin, not per-block-instance by whoever edits the theme
- **Vertical** (default): sidebar next to the product grid — original layout, unchanged
- **Horizontal**: filter groups render in a wrapped row above the grid, with a bottom border separating them from results
- **Drawer**: filters panel is off-canvas by default; a "Filters" toggle button (hidden in the other two modes) slides it in from the left with a dimmed overlay and a close (×) button; closes on overlay click or the close button
- Same filter logic, counts, and product data apply regardless of layout — only the CSS/DOM presentation changes
- `/api/filter-config` cache further changed from `max-age=30` to **`Cache-Control: no-store`** — merchants were still seeing a delay between saving in the admin and the storefront reflecting it. Rather than add a "Clear cache" button (which would only mask the issue), removed the HTTP cache entirely for this endpoint so admin changes are reflected on the very next storefront page load. `api.collection-products` (the expensive Admin-API-backed product query) keeps its `max-age=120` cache, since that endpoint wasn't the source of the complaint and caching it is important for cost/performance.
- **Mobile override**: regardless of the desktop layout choice (Vertical/Horizontal/Drawer), viewports ≤749px always render as Drawer — implemented purely in CSS via a `@media (max-width: 749px)` block that unconditionally applies the drawer positioning/toggle/overlay rules, rather than a separate mobile-layout setting. This matches the common pattern of "sidebar filters don't work well on small screens."
- **Per-device visibility**: `/app/filters` → "Visibility" section has "Show on desktop" / "Show on mobile" switches (`ShopSettings.showOnDesktop`, `showOnMobile`, both default `true`). The widget sets `data-hide-on-desktop`/`data-hide-on-mobile` attributes on the host element based on the fetched config, and matching CSS media queries hide the entire widget on the relevant breakpoint via `display: none` — not just the filter panel, the whole block including the product grid.

### 3.4b All visual styling moved to a dedicated admin page: `/app/style`
Originally the "Filter values"/"Filter headings" typography lived in the **theme editor block schema** (Liquid `settings`), and the "Clear all" button styling lived inline on the `/app/filters` page. Both were consolidated into a new `/app/style` admin page (new nav item, separate from `/app/filters`) so all visual/CSS controls for the widget live in one place:

- **Filter panel** — background color for the filter panel/sidebar itself (`sidebarBackgroundColor`, default light grey `#F5F5F5`), so it visually separates from the page's white background — this is distinct from any individual filter's text/heading color
- **Filter values** — font size/weight/transform/color for filter checkboxes and value lists
- **Filter headings** — font size/weight/transform/color for each filter group's title
- **Clear all button** — font size/weight/border radius/transform/text color/border color/background color
- **Filters toggle button** — same properties as Clear all, but for the Drawer-layout "Filters" toggle button (this button previously had no styling controls at all and was hardcoded — its font size being too small was reported and fixed as part of this change)

`/app/filters` now only handles: which fields are filterable, the layout mode (Vertical/Horizontal/Drawer), per-device visibility (Show on desktop/Show on mobile), and pagination page size — no styling.

**Data flow**: all eight groups of properties persist to `ShopSettings` (e.g. `valueFontSize`, `headingTextColor`, `buttonBorderRadius`, `toggleBackgroundColor`, etc. — 28 style columns total across 4 groups × 7 properties, though value/heading groups don't have border radius/color since they're text-only). `getFilterConfig` in `collection-filters.server.js` returns four style objects (`valueStyle`, `headingStyle`, `buttonStyle`, `toggleStyle`) from `/api/filter-config`. The widget's `applyStyleVars(prefix, style)` helper (generalized from the earlier button-only version) sets CSS custom properties per group (`--collection-filters-value-*`, `--collection-filters-heading-*`, `--collection-filters-clear-*`, `--collection-filters-toggle-*`) on the host element once config loads — the stylesheet consumes these with sensible fallback defaults so the widget still looks reasonable even if the API call fails.

The Liquid block's `{% schema %}` no longer has any font/color settings — only `heading` (text), `page_size`, and `app_url` remain as theme-editor-configurable, since those are content/connectivity, not styling.

### 3.5 Trade-offs of the current (app_url) approach
- No token of any kind — Storefront or Admin — is ever present in browser JS or view-source. The widget only ever talks to the app's own domain, which the merchant supplies.
- Requires the merchant to correctly copy/paste the app's live URL into the block setting, and to update it if the app's URL changes (e.g., dev tunnel restarts, or a production redeploy to a new domain) — the main remaining rough edge, and the reason the app-proxy revision was attempted.
- The widget depends on the app server being up and responsive for every collection page load — mitigated by `Cache-Control` response caching (`max-age=300` for config, `max-age=120` for products).
- Still fetches up to 250 products per collection load — collections larger than that are only filtered/counted within the first 250 returned. Revisit with real pagination if that becomes a constraint.

### 3.6 Known follow-ups (not yet built)
- Re-attempting the app proxy approach (§3.2 revision 5) is worth revisiting later with more time to isolate the failure — likely candidates not yet fully ruled out: theme-editor preview caching an old bundle, `authenticate.public.appProxy`'s HMAC validation behaving differently than expected for GET requests without an `index` param, or an interaction with the dev store's password protection at the storefront-routing layer specifically for proxy paths (as opposed to the root URL, which was directly confirmed blocked)
- No loading/skeleton state while data is in flight — filters area is simply empty until resolved
- Not yet load-tested for Admin API rate-limit behavior under concurrent storefront traffic

---

## 4. Security Rules

### 4.1 OAuth & session tokens
- Access tokens stored only via `PrismaSessionStorage` — never logged, never returned in any client-visible response
- Verify HMAC on every webhook and OAuth callback — never disable this check
- All `app/routes/app.*` routes require `authenticate.admin(request)`, no exceptions

### 4.2 Secrets management
- `.env` never committed to git (already in `.gitignore` from template)
- Separate DB credentials and Shopify API keys per environment (dev/staging/prod) — the `root`/no-password MySQL setup is **dev-only**
- Rotate any secret immediately if ever exposed in git history, logs, or error messages

### 4.3 Database
- Prisma's parameterized queries only — avoid `$queryRawUnsafe` with string concatenation
- Production: least-privilege DB user scoped to its own schema, TLS-enforced connection, no public `0.0.0.0/0` exposure, encrypted automated backups
- Local dev (`root`/no password/localhost) is acceptable only because it's not network-reachable outside the dev machine

### 4.4 Public endpoints (`api.filter-config`, `api.collection-products`)
- Strict `shop` (and, for `collection-products`, `collection` handle) param validation before querying — regex-checked before touching the DB or Admin API
- Rate-limit per shop/IP (not yet implemented — flagged as a follow-up; matters more now that `collection-products` triggers a real Admin API call per uncached request)
- Return only non-sensitive, already-public data — no internal IDs, install metadata, or anything beyond what a shopper could already see on the storefront
- Open CORS is acceptable here specifically because the payload is non-sensitive and the routes are read-only; don't extend that to any other route
- `api.collection-products` uses `unauthenticated.admin(shop)` — this looks up the shop's *offline* Admin session from the app's own session storage; it never accepts or forwards a token from the client. If the shop has no stored session (app not installed / uninstalled), the route returns 404 rather than leaking that ambiguously.

### 4.4a No client-side Shopify API tokens (widget)
- The widget calls **only the app's own backend** (`api.filter-config`, `api.collection-products`, reached via the merchant-supplied `app_url`) — no Shopify Storefront or Admin API token is ever present in browser JS, view-source, or network requests to `myshopify.com`
- The app's Admin API access token (from OAuth) never leaves the server — it's used only inside `api.collection-products`'s server-side `admin.graphql()` call
- The `shop` value IS supplied by the client (read from `shop.permanent_domain` in Liquid, passed as a query param) — unlike an app-proxy-based design, this app trusts the theme-rendered value rather than an independently-signed one; this is a lower assurance level than app proxy would provide, acceptable here since the endpoints are read-only and return no sensitive data regardless of which shop is queried

### 4.5 Input handling
- Escape merchant-supplied filter labels before rendering in the widget (stored-XSS prevention)
- Validate all admin form input server-side, not just client-side

### 4.6 Compliance
- Implement mandatory GDPR webhooks even without stored customer PII
- CSP headers for embedded apps (`frame-ancestors https://*.myshopify.com https://admin.shopify.com`)
- Request only the minimum Admin API scopes actually used

---

## 5. Build Order

1. Switch Prisma datasource to MySQL, create `.env` with dev `DATABASE_URL`, confirm `prisma migrate dev` runs against `collection_filter_app`
2. Add `FilterConfig` + `ShopSettings` models, generate migration
3. Admin dashboard: field discovery → selection/reorder UI → save
4. Public `api.filter-config` endpoint with validation, caching, rate limiting
5. Web component: config fetch → Storefront API fetch → basic filter render with counts, 10-product default page
6. Theme App Extension wrapping the widget
7. UX polish: URL sync, debounce, optimistic counts, empty states, chip removal
8. GDPR webhooks + CSP headers + scope minimization pass
9. Security review against §4 before any production traffic; replace dev DB credentials with scoped production ones
