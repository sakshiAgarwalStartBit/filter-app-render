# Collection Filter App — Implemented Features

Backend (Admin App) and Frontend (Storefront Widget) — as of current build.

## Backend (Shopify Admin App)

- Filterable field selection: choose which product fields shoppers can filter by — Price, Availability, Vendor, Tag, Product type, Product category, product variant options (e.g. Size, Color), and product metafields.
- Field ordering: admin can reorder enabled filters (move up/down) to control the display order on the storefront.
- "Title" excluded automatically from variant-option filters (not a meaningful filter for shoppers).
- Filter layout picker: Vertical (sidebar), Horizontal (filter bar with dropdown pills above the grid), or Drawer (slide-out panel via toggle button).
- Device visibility toggles: independently show/hide the entire filter widget on desktop and on mobile.
- Products per page (pagination size) configured only in the admin dashboard (removed from theme customizer to avoid duplicate settings).
- Dedicated Style page separate from the Filters page, covering:
  - Filter panel sidebar background color
  - Filter value text styling (font size, weight, text transform, color)
  - Filter heading/group label styling (font size, weight, text transform, color)
  - Clear-all button styling (font size, weight, border radius, text transform, text/border/background color)
  - Filters toggle button styling (font size, weight, border radius, text transform, text/border/background color)
- All Shopify Admin API access (metafield definitions, variant option discovery, product/collection queries) kept fully server-side — no Storefront API token or client-exposed credentials.
- Public config API endpoint (`/api/filter-config`) serving enabled filters + all style/layout/visibility settings to the storefront widget, with no-store caching to avoid stale settings.
- Public products API endpoint (`/api/collection-products`) serving filtered/sorted product data for a given collection, the all-products page, or a search query — resolved server-side via the Admin API so no storefront token is required.
- MySQL database (Prisma ORM) storing `FilterConfig` (per-shop enabled fields, type, label, position) and `ShopSettings` (layout, pagination, styling, visibility) per shop.

## Frontend (Storefront Widget)

- Custom theme app block ("Collection filters") addable to any section via the theme editor, with Heading and App URL settings.
- Works on specific collection pages, the all-products page (`/collections/all`), and the search results page.
- Search page support: reads the shopper's search terms and filters/searches products via the Admin API (case-insensitive multi-field search), applying the same admin-configured filters as collection pages.
- Native theme search-results grid (`.template-search__results`) automatically hidden when the widget is active on the search page and visible for the current device — the search input box itself is left untouched.
- Dynamic filter rendering based on admin-selected fields: standard fields (price range, availability, vendor, tag, product type, category), variant options, and metafields (including color swatches with a striped fallback for unresolvable color names).
- Product counts shown next to each filter value.
- Three responsive layouts: Vertical sidebar, Horizontal dropdown filter bar (with "Sort by" pinned to the top-right and filter pills wrapping independently), and Drawer (slide-out panel with overlay, toggle button, and close button).
- On mobile, filters always behave as a Drawer (slide-out panel) regardless of the desktop layout chosen in the admin, with a working toggle button in all layout modes.
- Sort-by dropdown (Featured, Best selling, Price low-high/high-low, Title A-Z/Z-A) — for the all-products and search contexts, price sorting falls back to client-side sorting since the shop-wide product query has no native price sort key.
- Infinite scroll product loading (replaces click-based pagination) — loads additional products as the shopper scrolls, driven by manual scroll/resize position checks rather than IntersectionObserver for reliability inside the embedded theme context.
- Clear All filters button.
- Device-based show/hide of the entire widget, respecting the admin's desktop/mobile visibility toggles.
- All visual styling (colors, fonts, weights, text transform, border radius) driven live from the admin's Style page settings via CSS custom properties — no code edits needed to restyle.
- Loading skeleton placeholders shown while the initial product fetch is in progress.
- Empty-state messaging when no products match the active filters (or when a search page loads with no query yet).
