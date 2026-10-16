// All requests go through the app's Shopify App Proxy (registered as
// "/apps/collection-filters" in shopify.app.toml), which Shopify serves
// from the storefront's own domain and forwards to the app's backend with
// a signed request the server verifies (see proxy.*.jsx routes). This
// means requests are always same-origin to the storefront — no app URL,
// CORS, or hardcoded tunnel/production domain is ever needed here.
const PROXY_PATH = "/apps/collection-filters";

// Must match the @container max-width in collection-filters.css — at or
// below this host width the filters collapse into the off-canvas drawer.
const DRAWER_BREAKPOINT = 1150;

class CollectionFiltersApp extends HTMLElement {
  connectedCallback() {
    this.shop = this.dataset.shop;
    this.collectionHandle = this.dataset.collectionHandle;
    this.searchTerms = this.dataset.searchTerms || "";
    this.customerId = this.dataset.customerId || null;
    this.placeholderImage = this.dataset.placeholderImage || "";
    this.wishlistMode = this.hasAttribute("data-wishlist-mode");
    this.showWishlist = false;
    this.wishlistIds = new Set();
    this.pageSize = 10;

    this.activeFilters = {};
    this.allProducts = [];
    this.enabledFields = [];
    this.filteredCache = [];
    this.loadedCount = 0;
    this.sort = "featured";
    this.openDropdown = null;
    this.collapsedGroups = new Set();
    this.productSearchQuery = "";

    this.layoutRoot = this.querySelector("[data-layout-root]");
    this.filtersRoot = this.querySelector("[data-filters-root]");
    this.grid = this.querySelector("[data-product-grid]");
    this.emptyState = this.querySelector("[data-empty-state]");
    this.pagination = this.querySelector("[data-pagination]");
    this.resultCount = this.querySelector("[data-result-count]");
    this.sortControl = this.querySelector("[data-sort-control]");
    this.resultsBar = this.sortControl ? this.sortControl.parentElement : null;
    this.viewToggle = this.querySelector("[data-view-toggle]");
    this.viewMode = "grid";
    this.productSearchRow = this.querySelector("[data-product-search]");
    this.drawerToggle = this.querySelector("[data-drawer-toggle]");
    this.drawerClose = this.querySelector("[data-drawer-close]");
    this.drawerOverlay = this.querySelector("[data-drawer-overlay]");
    this.drawerHeader = this.querySelector("[data-drawer-header]");

    this.filterLayout = "vertical";

    this.handlePopState = () => {
      if (!this.isLoaded) return;
      if (this.wishlistMode) {
        this.renderResults();
        return;
      }
      this.isRestoringFromUrl = true;
      this.restoreFiltersFromUrl();
      this.renderFilters();
      this.renderResults();
      this.isRestoringFromUrl = false;
      this.renderProductSearchBox();
      if (this.sortControl) {
        this.renderSortControl();
      }
    };
    window.addEventListener("popstate", this.handlePopState);

    // The host's width can change without the viewport changing (e.g. a
    // theme cart drawer that pushes the page aside). When it crosses the
    // drawer breakpoint, close any open filters drawer so the panel returns
    // to the sidebar, and re-render horizontal pills vs. vertical groups.
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.isLoaded || this.wishlistMode) return;
      const collapsed = this.isDrawerCollapsed();
      if (collapsed === this.lastCollapsed) return;
      if (!collapsed) this.closeDrawer(true);
      if (this.filterLayout === "horizontal") {
        this.openDropdown = null;
        this.renderFilters();
      }
      this.lastCollapsed = collapsed;
    });
    this.resizeObserver.observe(this);

    this.renderSkeleton();
    this.init();
  }

  disconnectedCallback() {
    if (this.handlePopState) {
      window.removeEventListener("popstate", this.handlePopState);
    }
    this.resizeObserver?.disconnect();
    clearTimeout(this.drawerRestoreTimer);
    this.restoreDrawerHome();
  }

  renderSkeleton() {
    if (this.productSearchRow) {
      this.productSearchRow.innerHTML =
        '<div class="collection-filters-app__skeleton-search"></div>';
    }

    if (!this.grid) return;
    this.grid.innerHTML = "";
    const count = this.pageSize || 10;
    for (let i = 0; i < count; i += 1) {
      const card = document.createElement("div");
      card.className = "collection-filters-app__skeleton-card";
      card.innerHTML =
        '<div class="collection-filters-app__skeleton-image"></div>' +
        '<div class="collection-filters-app__skeleton-line collection-filters-app__skeleton-line--title"></div>' +
        '<div class="collection-filters-app__skeleton-line collection-filters-app__skeleton-line--price"></div>';
      this.grid.appendChild(card);
    }
  }

  async init() {
    if (this.wishlistMode) {
      return this.initWishlistMode();
    }

    this.isSearchMode = this.searchTerms.trim() !== "";

    if (!this.isSearchMode && !this.collectionHandle) {
      console.warn(
        "[collection-filters-app] missing required config",
        { collectionHandle: this.collectionHandle },
      );
      this.filtersRoot.innerHTML = "";
      return;
    }

    // An empty search query (e.g. visiting /search?type=product&q= with no
    // term) falls through to the normal collection fetch path below, which
    // resolves to "all products" since collectionHandle defaults to "all"
    // on the search template — so it behaves like browsing rather than
    // showing an empty state.

    try {
      const config = await this.fetchEnabledFields();
      if (config.trialExpired) {
        this.hidden = true;
        return;
      }
      this.enabledFields = config.filters;
      this.filterLayout = config.filterLayout || "vertical";
      this.pageSize = config.pageSize || 10;
      this.clearAllButtonText = config.clearAllButtonText || "Clear all";
      this.showFilterCounts = config.showFilterCounts !== false;
      this.showWishlist = config.showWishlist === true;
      this.applyLayout();
      this.applyStyleVars("clear", config.buttonStyle);
      this.applyStyleVars("toggle", config.toggleStyle);
      this.applyStyleVars("value", config.valueStyle);
      this.applyStyleVars("heading", config.headingStyle);
      this.applyStyleVars("add-to-cart", config.addToCartStyle);
      this.applyCustomCss(config.customCss);
      this.applySidebarBackground(config.sidebarBackgroundColor);
      this.applyProductGridColumns(config.productGridColumns);
      this.applySwatchShape(config.swatchShape);
      this.applyDeviceVisibility(config.showOnDesktop, config.showOnMobile);
      if (this.isSearchMode) {
        const isMobileViewport = window.matchMedia("(max-width: 749px)").matches;
        const widgetVisibleHere = isMobileViewport
          ? config.showOnMobile !== false
          : config.showOnDesktop !== false;
        if (widgetVisibleHere) {
          this.hideNativeSearchResults();
        }
      }
      this.isRestoringFromUrl = true;
      this.restoreFiltersFromUrl();
      this.allProducts = await this.fetchProducts();
      this.isRestoringFromUrl = false;
      this.isLoaded = true;
      await this.loadWishlist();
      this.renderSortControl();
      this.renderViewToggle();
      this.renderProductSearchBox();
      this.renderFilters();
      this.renderResults();
    } catch (error) {
      console.error("[collection-filters-app] init failed", error);
      this.filtersRoot.innerHTML = `<p style="color:red">Filter widget error: ${error.message}</p>`;
    }
  }

  async initWishlistMode() {
    if (this.filtersRoot) this.filtersRoot.hidden = true;
    if (this.productSearchRow) this.productSearchRow.hidden = true;
    this.applyLayout();

    try {
      const config = await this.fetchEnabledFields();
      if (config.trialExpired) {
        this.hidden = true;
        return;
      }
      this.showWishlist = config.showWishlist === true;

      if (!this.showWishlist) {
        this.grid.innerHTML = "";
        if (this.emptyState) {
          this.emptyState.textContent = "Wishlist is currently unavailable.";
          this.emptyState.hidden = false;
        }
        if (this.resultCount) this.resultCount.hidden = true;
        return;
      }

      await this.loadWishlist();

      if (!this.customerId) {
        this.grid.innerHTML = "";
        if (this.emptyState) {
          this.emptyState.textContent = "Log in to view your wishlist.";
          this.emptyState.hidden = false;
        }
        if (this.resultCount) this.resultCount.hidden = true;
        return;
      }

      this.allProducts = await this.fetchWishlistProducts();
      this.isLoaded = true;
      this.renderViewToggle();
      this.renderResults();
    } catch (error) {
      console.error("[collection-filters-app] wishlist init failed", error);
      this.grid.innerHTML = `<p style="color:red">Wishlist error: ${error.message}</p>`;
    }
  }

  async fetchWishlistProducts() {
    const endpoint = `${PROXY_PATH}/wishlist-products`;
    const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `wishlist-products request failed: ${response.status}`);
    }

    const { products } = await response.json();
    return products || [];
  }

  applyLayout() {
    this.layoutRoot.classList.remove(
      "collection-filters-app__layout--vertical",
      "collection-filters-app__layout--horizontal",
      "collection-filters-app__layout--drawer",
    );

    // Wishlist mode has no filters sidebar, so the results grid should take
    // the full width instead of sharing the two-column filters/results track.
    this.layoutRoot.classList.toggle("collection-filters-app__layout--no-filters", this.wishlistMode);
    if (this.wishlistMode) return;

    this.layoutRoot.classList.add(`collection-filters-app__layout--${this.filterLayout}`);

    const isDrawer = this.filterLayout === "drawer";
    this.drawerToggle.hidden = !isDrawer;
    if (this.drawerHeader) {
      this.drawerHeader.hidden = !isDrawer;
    }
    this.filtersRoot.classList.toggle("collection-filters-app__filters--drawer-mode", isDrawer);

    if (this.filtersRoot.parentElement === document.body) {
      this.closeDrawer(true);
    }

    if (!this.drawerHandlersBound) {
      this.drawerHandlersBound = true;
      this.drawerToggle.addEventListener("click", () => this.openDrawer());
      this.drawerClose.addEventListener("click", () => this.closeDrawer());
      this.drawerOverlay.addEventListener("click", () => this.closeDrawer());
    }
  }

  applyStyleVars(prefix, style) {
    if (!style) return;
    this.style.setProperty(`--collection-filters-${prefix}-font-size`, `${style.fontSize}px`);
    this.style.setProperty(`--collection-filters-${prefix}-font-weight`, style.fontWeight);
    this.style.setProperty(`--collection-filters-${prefix}-text-transform`, style.textTransform);
    this.style.setProperty(`--collection-filters-${prefix}-text-color`, style.textColor);
    this.style.setProperty(`--collection-filters-${prefix}-color`, style.textColor);
    if (style.borderRadius != null) {
      this.style.setProperty(`--collection-filters-${prefix}-border-radius`, `${style.borderRadius}px`);
    }
    if (style.borderColor) {
      this.style.setProperty(`--collection-filters-${prefix}-border-color`, style.borderColor);
    }
    if (style.backgroundColor) {
      this.style.setProperty(`--collection-filters-${prefix}-background`, style.backgroundColor);
    }
  }

  applySidebarBackground(color) {
    if (!color) return;
    this.style.setProperty("--collection-filters-sidebar-background", color);
  }

  applyCustomCss(css) {
    if (!this.customCssTag) {
      this.customCssTag = document.createElement("style");
      this.customCssTag.setAttribute("data-collection-filters-custom-css", "");
      this.appendChild(this.customCssTag);
    }
    // Set as plain CSS text (never innerHTML), so admin-entered CSS can never
    // execute as markup/script — the browser only ever parses it as a
    // stylesheet.
    this.customCssTag.textContent = css || "";
  }

  applyProductGridColumns(columns) {
    const parsed = Number(columns);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    this.style.setProperty("--collection-filters-grid-columns", String(Math.round(parsed)));
  }

  applySwatchShape(shape) {
    this.style.setProperty(
      "--collection-filters-swatch-radius",
      shape === "square" ? "4px" : "50%",
    );
  }

  applyDeviceVisibility(showOnDesktop, showOnMobile) {
    if (showOnDesktop === false) {
      this.setAttribute("data-hide-on-desktop", "");
    } else {
      this.removeAttribute("data-hide-on-desktop");
    }
    if (showOnMobile === false) {
      this.setAttribute("data-hide-on-mobile", "");
    } else {
      this.removeAttribute("data-hide-on-mobile");
    }
  }

  hideNativeSearchResults() {
    const nativeResults = document.querySelector(".template-search__results");
    if (!nativeResults) return;
    nativeResults.setAttribute("data-hidden-by-collection-filters-app", "");
  }

  isDrawerCollapsed() {
    return this.filterLayout === "drawer" || this.clientWidth <= DRAWER_BREAKPOINT;
  }

  openDrawer() {
    clearTimeout(this.drawerRestoreTimer);
    // Move the drawer and overlay to be direct children of <body> while
    // open so their position: fixed is relative to the real viewport. Inside
    // the host they can't be: its container-type (layout containment) makes
    // it the containing block for fixed descendants, and its overflow-x
    // clips them — as does any theme ancestor using transform. Comment
    // placeholders mark where to put them back on close.
    if (this.filtersRoot.parentElement !== document.body) {
      if (!this.filtersHome) {
        this.filtersHome = document.createComment("collection-filters-app filters");
        this.overlayHome = document.createComment("collection-filters-app overlay");
        this.filtersInlineCss = this.filtersRoot.style.cssText;
      }
      this.filtersRoot.before(this.filtersHome);
      this.drawerOverlay.before(this.overlayHome);
      // Outside <collection-filters-app> the panel stops inheriting the CSS
      // custom properties (colors/fonts) set inline on the host — copy them
      // across so merchant styling still applies inside the drawer.
      this.filtersRoot.style.cssText = this.filtersInlineCss + this.style.cssText;
      document.body.append(this.drawerOverlay, this.filtersRoot);
    }

    // The @container drawer rules don't reach the panel under <body>, so
    // always use the standalone drawer-mode styles while it's open.
    this.filtersRoot.classList.add("collection-filters-app__filters--drawer-mode");
    if (this.drawerHeader) this.drawerHeader.hidden = false;
    this.drawerOverlay.hidden = false;
    // Flush styles so the slide-in transition starts from off-canvas.
    void this.filtersRoot.offsetWidth;
    this.filtersRoot.classList.add("collection-filters-app__filters--open");
  }

  closeDrawer(immediate = false) {
    this.filtersRoot.classList.remove("collection-filters-app__filters--open");
    this.drawerOverlay.hidden = true;
    clearTimeout(this.drawerRestoreTimer);
    if (immediate) {
      this.restoreDrawerHome();
    } else {
      // Wait for the 0.25s slide-out transition before moving it back.
      this.drawerRestoreTimer = setTimeout(() => this.restoreDrawerHome(), 250);
    }
  }

  // Put the panel and overlay back in the layout grid (undoing openDrawer),
  // so the sidebar reappears if the host is wide again — e.g. after the
  // theme's cart drawer closes.
  restoreDrawerHome() {
    if (this.filtersHome?.parentNode) this.filtersHome.replaceWith(this.filtersRoot);
    if (this.overlayHome?.parentNode) this.overlayHome.replaceWith(this.drawerOverlay);
    if (this.filtersInlineCss != null) this.filtersRoot.style.cssText = this.filtersInlineCss;
    const isDrawer = this.filterLayout === "drawer";
    this.filtersRoot.classList.toggle("collection-filters-app__filters--drawer-mode", isDrawer);
    if (this.drawerHeader) this.drawerHeader.hidden = !isDrawer;
  }

  async fetchEnabledFields() {
    const context = this.isSearchMode ? "search" : "collection";
    const endpoint = `${PROXY_PATH}/filter-config?context=${context}`;
    const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      throw new Error(`filter-config request failed: ${response.status}`);
    }
    const {
      filters,
      pageSize,
      filterLayout,
      valueStyle,
      headingStyle,
      buttonStyle,
      toggleStyle,
      addToCartStyle,
      sidebarBackgroundColor,
      productGridColumns,
      swatchShape,
      showOnDesktop,
      showOnMobile,
      clearAllButtonText,
      showFilterCounts,
      showWishlist,
      customCss,
      trialExpired,
    } = await response.json();
    return {
      filters: filters || [],
      pageSize,
      filterLayout,
      valueStyle,
      headingStyle,
      buttonStyle,
      toggleStyle,
      addToCartStyle,
      sidebarBackgroundColor,
      productGridColumns,
      swatchShape,
      showOnDesktop,
      showOnMobile,
      clearAllButtonText,
      showFilterCounts,
      showWishlist,
      customCss: customCss || "",
      trialExpired: trialExpired === true,
    };
  }

  async fetchProducts() {
    const params = new URLSearchParams({ sort: this.sort });
    if (this.isSearchMode) {
      params.set("search", this.searchTerms);
    } else {
      params.set("collection", this.collectionHandle);
    }
    const endpoint = `${PROXY_PATH}/collection-products?${params.toString()}`;
    const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `collection-products request failed: ${response.status}`);
    }

    const { products } = await response.json();
    return products || [];
  }

  wishlistStorageKey() {
    return `collection-filters-app__wishlist__${this.shop}`;
  }

  readGuestWishlist() {
    try {
      const raw = window.localStorage.getItem(this.wishlistStorageKey());
      const ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }

  writeGuestWishlist(ids) {
    try {
      window.localStorage.setItem(this.wishlistStorageKey(), JSON.stringify(ids));
    } catch {
      // localStorage unavailable (private browsing, storage disabled) —
      // wishlist state simply won't persist across page loads for this guest.
    }
  }

  async loadWishlist() {
    if (this.customerId) {
      try {
        const endpoint = `${PROXY_PATH}/wishlist`;
        const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
        if (response.ok) {
          const { productIds } = await response.json();
          this.wishlistIds = new Set(productIds || []);
          return;
        }
      } catch (error) {
        console.warn("[collection-filters-app] wishlist load failed", error);
      }
      this.wishlistIds = new Set();
      return;
    }
    this.wishlistIds = new Set(this.readGuestWishlist());
  }

  async toggleWishlist(productId) {
    const isWishlisted = this.wishlistIds.has(productId);

    if (this.customerId) {
      try {
        const endpoint = `${PROXY_PATH}/wishlist`;
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
        if (!response.ok) throw new Error(`wishlist toggle failed: ${response.status}`);
        const { wishlisted } = await response.json();
        if (wishlisted) {
          this.wishlistIds.add(productId);
        } else {
          this.wishlistIds.delete(productId);
        }
      } catch (error) {
        console.error("[collection-filters-app] wishlist toggle failed", error);
      }
      return;
    }

    if (isWishlisted) {
      this.wishlistIds.delete(productId);
    } else {
      this.wishlistIds.add(productId);
    }
    this.writeGuestWishlist([...this.wishlistIds]);
  }

  notifyWishlistChanged() {
    document.dispatchEvent(
      new CustomEvent("collection-filters-app:wishlist-changed", {
        detail: { count: this.wishlistIds.size },
      }),
    );
  }

  getFilterableValues(fieldKey, fieldType, valuePrefix) {
    const counts = new Map();
    for (const product of this.filteredProducts({ excludeKey: fieldKey })) {
      const values = this.readProductValues(product, fieldKey, fieldType, valuePrefix);
      for (const value of values) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    return counts;
  }

  readProductValues(product, fieldKey, fieldType, valuePrefix) {
    if (fieldType === "standard") {
      if (fieldKey === "vendor") return [product.vendor];
      if (fieldKey === "tag" || fieldKey.startsWith("tag:") || fieldKey.startsWith("ordertag:")) {
        const tags = product.tags || [];
        if (!valuePrefix) return tags;
        return tags
          .filter((tag) => tag.startsWith(valuePrefix))
          .map((tag) => tag.slice(valuePrefix.length));
      }
      if (fieldKey === "product_type") return product.productType ? [product.productType] : [];
      if (fieldKey === "category") return product.category?.name ? [product.category.name] : [];
      if (fieldKey === "available") return [product.availableForSale ? "In stock" : "Out of stock"];
      if (fieldKey === "review_rating") {
        if (product.reviewRating == null) return [];
        const floor = Math.max(1, Math.min(5, Math.floor(product.reviewRating)));
        const buckets = [];
        for (let star = floor; star >= 1; star -= 1) {
          buckets.push(String(star));
        }
        return buckets;
      }
      return [];
    }
    if (fieldType === "metafield") {
      const [namespace, key] = fieldKey.replace("metafield:", "").split(".");
      const field = (product.metafields || []).find(
        (m) => m && m.namespace === namespace && m.key === key,
      );
      if (!field?.value) return [];
      return this.formatMetafieldValue(field.value);
    }
    if (fieldType === "variantOption") {
      const optionName = fieldKey.replace("variantOption:", "");
      const option = (product.options || []).find((o) => o.name === optionName);
      return option ? option.optionValues.map((v) => v.name) : [];
    }
    return [];
  }

  formatPriceRange(priceRange) {
    const { minVariantPrice, maxVariantPrice } = priceRange;
    const formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: minVariantPrice.currencyCode,
    });

    if (minVariantPrice.amount === maxVariantPrice.amount) {
      return formatter.format(minVariantPrice.amount);
    }
    return `${formatter.format(minVariantPrice.amount)} – ${formatter.format(maxVariantPrice.amount)}`;
  }

  buildProductRatingRow(product) {
    if (product.reviewRating == null) return null;

    const row = document.createElement("span");
    row.className = "collection-filters-app__product-rating";

    const stars = document.createElement("span");
    stars.className = "collection-filters-app__product-rating-stars";
    stars.innerHTML = this.starIcons(Math.round(product.reviewRating));
    row.appendChild(stars);

    if (product.reviewCount != null) {
      const countText = document.createElement("span");
      countText.className = "collection-filters-app__product-rating-count";
      countText.textContent = `(${product.reviewCount} Review${product.reviewCount === 1 ? "" : "s"})`;
      row.appendChild(countText);
    }

    return row;
  }

  starIcons(count) {
    const star = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .587l3.668 7.431L23.4 9.168l-5.7 5.556L19.335 24 12 19.897 4.665 24l1.635-9.276L.6 9.168l7.732-1.15z"/></svg>`;
    const emptyStar = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 .587l3.668 7.431L23.4 9.168l-5.7 5.556L19.335 24 12 19.897 4.665 24l1.635-9.276L.6 9.168l7.732-1.15z"/></svg>`;
    let html = "";
    for (let i = 1; i <= 5; i += 1) {
      html += `<span class="collection-filters-app__rating-star${i <= count ? " collection-filters-app__rating-star--filled" : ""}">${i <= count ? star : emptyStar}</span>`;
    }
    return html;
  }

  currencySymbol(currencyCode) {
    if (!currencyCode) return "$";
    try {
      const parts = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      }).formatToParts(0);
      const symbolPart = parts.find((part) => part.type === "currency");
      return symbolPart ? symbolPart.value : currencyCode;
    } catch {
      return currencyCode;
    }
  }

  isOnSale(product) {
    const compareAt = product.compareAtPriceRange?.minVariantCompareAtPrice;
    if (!compareAt) return false;
    const compareAmount = Number(compareAt.amount);
    const priceAmount = Number(product.priceRange.minVariantPrice.amount);
    return compareAmount > 0 && compareAmount > priceAmount;
  }

  createVariantOptionsList(product, selectedOptions, onSelect) {
    const options = (product.options || []).filter(
      (option) =>
        option.name.trim().toLowerCase() !== "title" &&
        (option.optionValues || []).length > 0,
    );
    if (options.length === 0 || !(product.variants || []).length) return null;

    const list = document.createElement("div");
    list.className = "collection-filters-app__product-variants";

    const choose = (optionName, value, groupEl) => {
      selectedOptions[optionName] = value;
      const nextVariant = this.findMatchingVariant(product, selectedOptions);
      for (const el of groupEl.children) {
        el.classList.toggle(
          "collection-filters-app__product-variant--selected",
          el.dataset.value === value,
        );
      }
      onSelect(nextVariant);
    };

    const MAX_VISIBLE_VALUES = 4;

    // Product cards show only the primary option type (e.g. Color) to avoid
    // stacking multiple variant rows when a product also has Material, Size,
    // etc. — those remain selectable on the product detail page.
    const option = options[0];
    const group = document.createElement("div");
    const optionLabel = option.name.trim().toLowerCase();
    const isColor = optionLabel.includes("color") || optionLabel.includes("colour");
    group.className = isColor
      ? "collection-filters-app__product-variant-group collection-filters-app__product-variant-group--swatches"
      : "collection-filters-app__product-variant-group";

    const visibleValues = option.optionValues.slice(0, MAX_VISIBLE_VALUES);
    // Overflow combines leftover values within the shown option and any
    // other option types (e.g. Material) hidden from the card entirely, so
    // the "+N" always reflects everything only visible on the product page.
    const hiddenOptionTypeCount = options.length - 1;
    const overflowCount =
      option.optionValues.length - visibleValues.length + hiddenOptionTypeCount;

    for (const value of visibleValues) {
      const isSelected = selectedOptions[option.name] === value.name;
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.value = value.name;

      if (isColor) {
        el.className = "collection-filters-app__product-variant-swatch";
        if (isSelected) el.classList.add("collection-filters-app__product-variant--selected");
        el.title = value.name;
        const swatchImageUrl = this.getSwatchImageUrl(value.name);
        const cssColor = this.colorNameToCss(value.name);
        if (swatchImageUrl) {
          el.style.backgroundImage = `url("${swatchImageUrl}")`;
          el.style.backgroundSize = "cover";
          el.style.backgroundPosition = "center";
        } else if (cssColor && this.isValidCssColor(cssColor)) {
          el.style.backgroundColor = cssColor;
        } else {
          el.classList.add("collection-filters-app__swatch--unresolved");
        }
      } else {
        el.className = "collection-filters-app__product-variant-pill";
        if (isSelected) el.classList.add("collection-filters-app__product-variant--selected");
        el.textContent = value.name;
      }

      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        choose(option.name, value.name, group);
      });

      group.appendChild(el);
    }

    if (overflowCount > 0) {
      const overflowLink = document.createElement("a");
      overflowLink.className = "collection-filters-app__product-variant-overflow";
      overflowLink.href = product.onlineStoreUrl || `/products/${product.handle}`;
      overflowLink.textContent = `+${overflowCount}`;
      overflowLink.title = `${overflowCount} more choice${overflowCount === 1 ? "" : "s"} — view product`;
      group.appendChild(overflowLink);
    }

    list.appendChild(group);

    return list;
  }

  formatMetafieldValue(rawValue) {
    let parsed;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return [rawValue];
    }

    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => this.formatSingleMetafieldValue(item));
    }
    return this.formatSingleMetafieldValue(parsed);
  }

  formatSingleMetafieldValue(value) {
    if (value == null) return [];
    if (typeof value !== "object") return [String(value)];

    if ("value" in value && "unit" in value) {
      const unitLabel = String(value.unit).toLowerCase().replace(/_/g, " ");
      return [`${value.value} ${unitLabel}`];
    }
    if ("amount" in value && "currency_code" in value) {
      return [`${value.amount} ${value.currency_code}`];
    }

    return [JSON.stringify(value)];
  }

  syncFiltersToUrl() {
    if (this.isRestoringFromUrl) return;

    const params = new URLSearchParams(window.location.search);
    for (const key of [...params.keys()]) {
      if (key.startsWith("filter.") || key === "sort") {
        params.delete(key);
      }
    }

    for (const [fieldKey, selected] of Object.entries(this.activeFilters)) {
      if (!selected || selected.length === 0) continue;
      if (fieldKey === "price") {
        const [min, max] = selected;
        if (min != null && max != null) {
          params.set("filter.price", `${min}-${max}`);
        }
        continue;
      }
      params.set(`filter.${fieldKey}`, selected.join(","));
    }

    if (this.sort && this.sort !== "featured") {
      params.set("sort", this.sort);
    }

    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (newUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.pushState(window.history.state, "", newUrl);
    }
  }

  restoreFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const restored = {};

    for (const [key, value] of params.entries()) {
      if (!key.startsWith("filter.")) continue;
      const fieldKey = key.slice("filter.".length);
      if (fieldKey === "price") {
        const [min, max] = value.split("-").map(Number);
        if (!Number.isNaN(min) && !Number.isNaN(max)) {
          restored.price = [min, max];
        }
        continue;
      }
      restored[fieldKey] = value.split(",").filter(Boolean);
    }

    this.activeFilters = restored;

    const sortParam = params.get("sort");
    if (sortParam) {
      this.sort = sortParam;
    }

    const queryParam = params.get("q");
    if (queryParam) {
      this.productSearchQuery = queryParam.trim().toLowerCase();
    }
  }

  filteredProducts({ excludeKey } = {}) {
    return this.allProducts.filter((product) => {
      if (this.productSearchQuery) {
        const haystack = `${product.title} ${product.vendor || ""} ${(product.tags || []).join(" ")}`.toLowerCase();
        if (!haystack.includes(this.productSearchQuery)) return false;
      }
      for (const [fieldKey, selected] of Object.entries(this.activeFilters)) {
        if (fieldKey === excludeKey) continue;
        if (!selected || selected.length === 0) continue;
        if (fieldKey === "price") {
          const amount = Number(product.priceRange.minVariantPrice.amount);
          const [min, max] = selected;
          if (min != null && amount < min) return false;
          if (max != null && amount > max) return false;
          continue;
        }
        const field = this.enabledFields.find((f) => f.fieldKey === fieldKey);
        const values = this.readProductValues(product, fieldKey, field?.fieldType, field?.valuePrefix);
        if (!selected.some((v) => values.includes(v))) return false;
      }
      return true;
    });
  }

  renderFilters() {
    if (this.resultsBar && this.sortControl?.parentElement !== this.resultsBar) {
      this.resultsBar.appendChild(this.sortControl);
    }
    this.filtersRoot.innerHTML = "";
    if (this.drawerHeader) {
      this.filtersRoot.appendChild(this.drawerHeader);
    }
    // At or below the drawer breakpoint (the @container rule in
    // collection-filters.css that forces the filters panel off-canvas
    // regardless of the merchant's chosen desktop layout), always render
    // filter groups in the vertical collapsible style — the horizontal
    // dropdown-pill row doesn't fit inside the narrow drawer panel.
    const isCollapsed = this.isDrawerCollapsed();
    this.lastCollapsed = isCollapsed;
    const isDropdown = this.filterLayout === "horizontal" && !isCollapsed;
    const pillsWrapper = isDropdown ? document.createElement("div") : this.filtersRoot;
    if (isDropdown) {
      pillsWrapper.className = "collection-filters-app__filters-pills";
    }

    for (const field of this.enabledFields) {
      if (this.allProducts.length === 0) continue;

      let content;
      if (field.fieldKey === "price") {
        content = this.buildPriceRangeInput();
      } else {
        const counts = this.getFilterableValues(field.fieldKey, field.fieldType, field.valuePrefix);
        if (counts.size === 0) continue;
        content = this.buildValueList(
          field.fieldKey,
          counts,
          field.displayType === "swatch" || (field.displayType == null && this.isColorField(field)),
          field.fieldKey === "vendor",
          field.fieldKey === "review_rating",
          field.selectMode === "single",
        );
      }

      const group = document.createElement("div");
      group.className = "collection-filters-app__group";

      if (isDropdown) {
        group.classList.add("collection-filters-app__group--dropdown");
        const isOpen = this.openDropdown === field.fieldKey;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "collection-filters-app__group-toggle";
        toggle.setAttribute("aria-expanded", String(isOpen));
        toggle.textContent = field.label;
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          this.openDropdown = isOpen ? null : field.fieldKey;
          this.renderFilters();
        });
        group.appendChild(toggle);

        const panel = document.createElement("div");
        panel.className = "collection-filters-app__group-panel";
        panel.hidden = !isOpen;
        panel.addEventListener("click", (event) => event.stopPropagation());
        panel.appendChild(content);
        group.appendChild(panel);
      } else {
        const isCollapsed = this.collapsedGroups.has(field.fieldKey);
        group.classList.add("collection-filters-app__group--collapsible");
        if (isCollapsed) {
          group.classList.add("collection-filters-app__group--collapsed");
        }

        const label = document.createElement("button");
        label.type = "button";
        label.className = "collection-filters-app__group-label";
        label.setAttribute("aria-expanded", String(!isCollapsed));
        label.textContent = field.label;
        label.addEventListener("click", () => {
          if (this.collapsedGroups.has(field.fieldKey)) {
            this.collapsedGroups.delete(field.fieldKey);
          } else {
            this.collapsedGroups.add(field.fieldKey);
          }
          this.renderFilters();
        });
        group.appendChild(label);

        content.hidden = isCollapsed;
        group.appendChild(content);
      }

      pillsWrapper.appendChild(group);
    }

    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.className = "collection-filters-app__clear-all";
    clearAll.textContent = this.clearAllButtonText || "Clear all";
    clearAll.disabled = !Object.values(this.activeFilters).some(
      (selected) => selected && selected.length > 0,
    );
    clearAll.addEventListener("click", (event) => {
      event.stopPropagation();
      this.activeFilters = {};
      this.openDropdown = null;
      this.renderFilters();
      this.renderResults();
    });
    pillsWrapper.appendChild(clearAll);

    if (isDropdown) {
      this.filtersRoot.appendChild(pillsWrapper);
      if (this.sortControl) {
        this.filtersRoot.appendChild(this.sortControl);
        this.sortControl.classList.add("collection-filters-app__sort--inline");
      }
      this.setupDropdownDismissal();
    }
  }

  setupDropdownDismissal() {
    if (this.handleDocumentDismiss) {
      document.removeEventListener("click", this.handleDocumentDismiss);
      document.removeEventListener("keydown", this.handleDocumentDismiss);
    }
    this.handleDocumentDismiss = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (this.openDropdown == null) return;
      this.openDropdown = null;
      this.renderFilters();
    };
    document.addEventListener("click", this.handleDocumentDismiss);
    document.addEventListener("keydown", this.handleDocumentDismiss);
  }

  isColorField(field) {
    if (field.fieldKey === "variantOption:Color") return true;
    const label = field.label.trim().toLowerCase();
    return label.includes("color") || label.includes("colour");
  }

  // Merchant-configured option-value swatches (Shopify's native "Color"/image
  // swatch picker on product options) take priority over guessing a CSS
  // color from the option value's name, since names like "Ice" or "Dawn"
  // aren't real CSS colors. Lazily indexed from the loaded products and
  // cached until the product list changes.
  getOptionValueSwatch(name) {
    if (this.optionValueSwatchesSource !== this.allProducts) {
      const map = new Map();
      for (const product of this.allProducts || []) {
        for (const option of product.options || []) {
          for (const value of option.optionValues || []) {
            if (value.swatch && !map.has(value.name)) {
              map.set(value.name, value.swatch);
            }
          }
        }
      }
      this.optionValueSwatches = map;
      this.optionValueSwatchesSource = this.allProducts;
    }
    return this.optionValueSwatches.get(name) || null;
  }

  getSwatchImageUrl(name) {
    return this.getOptionValueSwatch(name)?.image?.preview?.image?.url || null;
  }

  colorNameToCss(name) {
    const swatch = this.getOptionValueSwatch(name);
    if (swatch?.color) return swatch.color;

    const known = {
      black: "#000000",
      white: "#ffffff",
      red: "#d32f2f",
      blue: "#1976d2",
      green: "#388e3c",
      yellow: "#fbc02d",
      orange: "#f57c00",
      purple: "#7b1fa2",
      pink: "#ec407a",
      brown: "#795548",
      grey: "#9e9e9e",
      gray: "#9e9e9e",
      navy: "#001f3f",
      beige: "#f5f5dc",
      cream: "#fffdd0",
      gold: "#d4af37",
      silver: "#c0c0c0",
      maroon: "#800000",
      teal: "#008080",
      olive: "#808000",
      tan: "#d2b48c",
    };
    const key = name.trim().toLowerCase();
    return known[key] || key;
  }

  isValidCssColor(value) {
    if (typeof CSS !== "undefined" && CSS.supports) {
      return CSS.supports("color", value);
    }
    const probe = document.createElement("span").style;
    probe.color = "";
    probe.color = value;
    return probe.color !== "";
  }

  renderProductSearchBox() {
    if (!this.productSearchRow) return;
    this.productSearchRow.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "collection-filters-app__product-search";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "collection-filters-app__product-search-input";
    input.placeholder = this.isSearchMode
      ? "Search for products"
      : "Search for products in this collection";
    input.setAttribute("aria-label", input.placeholder);
    input.value = this.productSearchQuery;

    let debounceTimer = null;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.productSearchQuery = input.value.trim().toLowerCase();
        this.renderResults();
      }, 150);
    });

    const icon = document.createElement("span");
    icon.className = "collection-filters-app__product-search-icon";
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

    wrapper.append(input, icon);
    this.productSearchRow.appendChild(wrapper);
  }

  buildValueList(fieldKey, counts, isColor = false, searchable = false, isRating = false, isSingleSelect = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "collection-filters-app__value-list-wrapper";

    let searchInput = null;
    if (searchable) {
      searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.className = "collection-filters-app__value-search";
      searchInput.placeholder = "Search options";
      searchInput.setAttribute("aria-label", "Search options");
      wrapper.appendChild(searchInput);
    }

    const list = document.createElement("ul");
    list.className = isColor
      ? "collection-filters-app__values collection-filters-app__values--swatches"
      : "collection-filters-app__values";

    const entries = isRating
      ? [...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
      : counts;

    for (const [value, count] of entries) {
      const item = document.createElement("li");
      item.className = "collection-filters-app__value";
      item.dataset.searchText = value.toLowerCase();

      const isSelected = (this.activeFilters[fieldKey] || []).includes(value);

      if (isColor) {
        const resolvedColor = this.colorNameToCss(value);
        const isResolvedColor = this.isValidCssColor(resolvedColor);
        const swatchImageUrl = this.getSwatchImageUrl(value);

        const checkbox = document.createElement("input");
        checkbox.type = isSingleSelect ? "radio" : "checkbox";
        if (isSingleSelect) {
          checkbox.name = `collection-filters-app__${fieldKey}`;
        }
        checkbox.className = "collection-filters-app__swatch-input";
        checkbox.checked = isSelected;
        checkbox.addEventListener("change", () => {
          if (isSingleSelect) {
            this.activeFilters[fieldKey] = checkbox.checked ? [value] : [];
          } else {
            const selected = new Set(this.activeFilters[fieldKey] || []);
            if (checkbox.checked) {
              selected.add(value);
            } else {
              selected.delete(value);
            }
            this.activeFilters[fieldKey] = [...selected];
          }
          this.renderFilters();
          this.renderResults();
        });

        const swatchLabel = document.createElement("label");
        swatchLabel.className = "collection-filters-app__swatch-label";
        swatchLabel.title = this.showFilterCounts ? `${value} (${count})` : value;

        const swatch = document.createElement("span");
        swatch.className = "collection-filters-app__swatch";
        if (swatchImageUrl) {
          swatch.style.backgroundImage = `url("${swatchImageUrl}")`;
          swatch.style.backgroundSize = "cover";
          swatch.style.backgroundPosition = "center";
        } else if (isResolvedColor) {
          swatch.style.backgroundColor = resolvedColor;
        } else {
          // No Shopify swatch and no matching known color name (e.g. "Ice") —
          // still render the circle shape, just left blank, instead of
          // falling back to a text pill.
          swatch.classList.add("collection-filters-app__swatch--empty");
        }

        if (this.showFilterCounts) {
          const swatchCount = document.createElement("span");
          swatchCount.className = "collection-filters-app__swatch-count";
          swatchCount.textContent = String(count);
          swatch.appendChild(swatchCount);
        }

        swatchLabel.append(checkbox, swatch);
        item.appendChild(swatchLabel);

        list.appendChild(item);
        continue;
      }

      const labelEl = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = isSingleSelect ? "radio" : "checkbox";
      if (isSingleSelect) {
        checkbox.name = `collection-filters-app__${fieldKey}`;
      }
      checkbox.checked = isSelected;
      checkbox.addEventListener("change", () => {
        if (isSingleSelect) {
          this.activeFilters[fieldKey] = checkbox.checked ? [value] : [];
        } else {
          const selected = new Set(this.activeFilters[fieldKey] || []);
          if (checkbox.checked) {
            selected.add(value);
          } else {
            selected.delete(value);
          }
          this.activeFilters[fieldKey] = [...selected];
        }
        this.renderFilters();
        this.renderResults();
      });

      const valueText = document.createElement("span");
      valueText.className = "collection-filters-app__value-text";
      if (isRating) {
        valueText.classList.add("collection-filters-app__rating-stars");
        valueText.innerHTML = this.starIcons(Number(value));
      } else {
        valueText.textContent = value;
      }

      labelEl.appendChild(checkbox);
      labelEl.appendChild(valueText);
      if (this.showFilterCounts) {
        const countEl = document.createElement("span");
        countEl.className = "collection-filters-app__count";
        countEl.textContent = `(${count})`;
        labelEl.appendChild(countEl);
      }
      item.appendChild(labelEl);
      list.appendChild(item);
    }

    wrapper.appendChild(list);

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLowerCase();
        for (const item of list.children) {
          item.hidden = query !== "" && !item.dataset.searchText.includes(query);
        }
      });
    }

    return wrapper;
  }

  getPriceBounds() {
    const amounts = this.allProducts.map((p) => Number(p.priceRange.minVariantPrice.amount));
    const floor = Math.floor(Math.min(...amounts, 0));
    const ceil = Math.ceil(Math.max(...amounts, 0));
    return [floor, ceil === floor ? floor + 1 : ceil];
  }

  buildPriceRangeInput() {
    const wrapper = document.createElement("div");
    wrapper.className = "collection-filters-app__price-range";

    const [floor, ceil] = this.getPriceBounds();
    const [activeMin, activeMax] = this.activeFilters.price || [floor, ceil];
    const min = activeMin ?? floor;
    const max = activeMax ?? ceil;

    const track = document.createElement("div");
    track.className = "collection-filters-app__price-track";

    const trackLine = document.createElement("div");
    trackLine.className = "collection-filters-app__price-track-line";
    track.appendChild(trackLine);

    const minRange = document.createElement("input");
    minRange.type = "range";
    minRange.className = "collection-filters-app__price-thumb collection-filters-app__price-thumb--min";
    minRange.min = floor;
    minRange.max = ceil;
    minRange.value = min;

    const maxRange = document.createElement("input");
    maxRange.type = "range";
    maxRange.className = "collection-filters-app__price-thumb collection-filters-app__price-thumb--max";
    maxRange.min = floor;
    maxRange.max = ceil;
    maxRange.value = max;

    track.append(minRange, maxRange);

    const currencyCode = this.allProducts[0]?.priceRange?.minVariantPrice?.currencyCode;
    const currencySymbol = this.currencySymbol(currencyCode);

    const labels = document.createElement("div");
    labels.className = "collection-filters-app__price-labels";

    const minLabel = document.createElement("span");
    minLabel.innerHTML = `<span class="collection-filters-app__price-currency">${currencySymbol}</span>${min}`;

    const maxLabel = document.createElement("span");
    maxLabel.innerHTML = `<span class="collection-filters-app__price-currency">${currencySymbol}</span>${max}`;

    labels.append(minLabel, maxLabel);

    const commit = () => {
      const minValue = Number(minRange.value);
      const maxValue = Number(maxRange.value);
      if (minValue > maxValue) {
        minRange.value = maxValue;
      }
      this.activeFilters.price = [Number(minRange.value), maxValue];
      minLabel.innerHTML = `<span class="collection-filters-app__price-currency">${currencySymbol}</span>${minRange.value}`;
      maxLabel.innerHTML = `<span class="collection-filters-app__price-currency">${currencySymbol}</span>${maxRange.value}`;
      this.renderResults();
    };

    minRange.addEventListener("input", () => {
      if (Number(minRange.value) > Number(maxRange.value)) {
        minRange.value = maxRange.value;
      }
      minLabel.innerHTML = `<span class="collection-filters-app__price-currency">${currencySymbol}</span>${minRange.value}`;
    });
    maxRange.addEventListener("input", () => {
      if (Number(maxRange.value) < Number(minRange.value)) {
        maxRange.value = minRange.value;
      }
      maxLabel.innerHTML = `<span class="collection-filters-app__price-currency">${currencySymbol}</span>${maxRange.value}`;
    });
    minRange.addEventListener("change", commit);
    maxRange.addEventListener("change", commit);

    wrapper.append(track, labels);
    return wrapper;
  }

  renderSortControl() {
    if (!this.sortControl) return;
    this.sortControl.innerHTML = "";

    const label = document.createElement("label");
    label.className = "collection-filters-app__sort-label";
    label.textContent = "Sort by:";

    const select = document.createElement("select");
    select.className = "collection-filters-app__sort-select";

    const options = [
      { value: "featured", label: "Featured" },
      { value: "best_selling", label: "Best selling" },
      { value: "price_asc", label: "Price: low to high" },
      { value: "price_desc", label: "Price: high to low" },
      { value: "title_asc", label: "Alphabetically, A-Z" },
      { value: "title_desc", label: "Alphabetically, Z-A" },
    ];

    for (const option of options) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      optionEl.selected = option.value === this.sort;
      select.appendChild(optionEl);
    }

    select.addEventListener("change", async () => {
      this.sort = select.value;
      this.grid.setAttribute("aria-busy", "true");
      const requestToken = (this.sortRequestToken = Symbol());
      const products = await this.fetchProducts();
      if (this.sortRequestToken !== requestToken) return;
      this.allProducts = products;
      this.grid.removeAttribute("aria-busy");
      this.renderFilters();
      this.renderResults();
    });

    label.appendChild(select);
    this.sortControl.appendChild(label);
  }

  renderViewToggle() {
    if (!this.viewToggle) return;
    this.viewToggle.innerHTML = "";
    this.viewToggle.setAttribute("role", "group");
    this.viewToggle.setAttribute("aria-label", "View as");

    const modes = [
      { value: "grid", label: "Grid view" },
      { value: "list", label: "List view" },
    ];

    for (const mode of modes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "collection-filters-app__view-toggle-button";
      button.classList.toggle(
        "collection-filters-app__view-toggle-button--active",
        this.viewMode === mode.value,
      );
      button.dataset.viewMode = mode.value;
      button.setAttribute("aria-pressed", String(this.viewMode === mode.value));
      button.setAttribute("aria-label", mode.label);
      button.innerHTML = this.viewToggleIcon(mode.value);
      button.addEventListener("click", () => {
        if (this.viewMode === mode.value) return;
        this.viewMode = mode.value;
        this.renderViewToggle();
        this.applyViewMode();
      });
      this.viewToggle.appendChild(button);
    }

    this.applyViewMode();
  }

  viewToggleIcon(mode) {
    if (mode === "grid") {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="6.5" height="6.5" rx="1" fill="currentColor"/>
        <rect x="10.5" y="1" width="6.5" height="6.5" rx="1" fill="currentColor"/>
        <rect x="1" y="10.5" width="6.5" height="6.5" rx="1" fill="currentColor"/>
        <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1" fill="currentColor"/>
      </svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="16" height="2.5" rx="1" fill="currentColor"/>
      <rect x="1" y="7.75" width="16" height="2.5" rx="1" fill="currentColor"/>
      <rect x="1" y="13.5" width="16" height="2.5" rx="1" fill="currentColor"/>
    </svg>`;
  }

  applyViewMode() {
    if (!this.grid) return;
    this.grid.classList.toggle(
      "collection-filters-app__grid--list",
      this.viewMode === "list",
    );
  }

  renderResults() {
    this.syncFiltersToUrl();
    this.filteredCache = this.filteredProducts();
    this.loadedCount = 0;

    this.grid.innerHTML = "";
    this.pagination.innerHTML = "";

    if (this.resultCount) {
      this.resultCount.textContent =
        this.filteredCache.length === 1
          ? "1 product"
          : `${this.filteredCache.length} products`;
      this.resultCount.hidden = this.filteredCache.length === 0;
    }

    this.emptyState.hidden = this.filteredCache.length > 0;

    this.appendNextChunk();
    this.renderLoadMoreButton();
  }

  appendNextChunk() {
    const nextItems = this.filteredCache.slice(
      this.loadedCount,
      this.loadedCount + this.pageSize,
    );

    for (const product of nextItems) {
      const card = this.buildProductCard(product);
      this.grid.appendChild(card);
    }

    this.loadedCount += nextItems.length;
    this.renderScrollStatus();
  }

  renderLoadMoreButton() {
    const existing = this.pagination.querySelector(
      ".collection-filters-app__load-more",
    );
    if (existing) existing.remove();

    if (this.loadedCount >= this.filteredCache.length) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "collection-filters-app__load-more";
    button.textContent = "Load more";
    button.addEventListener("click", () => {
      this.appendNextChunk();
      this.renderLoadMoreButton();
    });
    this.pagination.appendChild(button);
  }

  buildWishlistButton(product) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "collection-filters-app__wishlist-button";
    const setState = (active) => {
      button.classList.toggle("collection-filters-app__wishlist-button--active", active);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute(
        "aria-label",
        active ? "Remove from wishlist" : "Add to wishlist",
      );
    };
    setState(this.wishlistIds.has(product.id));
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      await this.toggleWishlist(product.id);
      this.notifyWishlistChanged();
      const stillWishlisted = this.wishlistIds.has(product.id);
      if (this.wishlistMode && !stillWishlisted) {
        this.allProducts = this.allProducts.filter((p) => p.id !== product.id);
        this.renderResults();
        return;
      }
      setState(stillWishlisted);
      button.disabled = false;
    });
    return button;
  }

  buildProductCard(product) {
    const card = document.createElement("div");
    card.className = "collection-filters-app__product";

    const link = document.createElement("a");
    link.href = product.onlineStoreUrl || `/products/${product.handle}`;

    const imageWrapper = document.createElement("div");
    let img = null;
    let hoverImg = null;
    if (product.featuredImage || this.placeholderImage) {
      imageWrapper.className = "collection-filters-app__product-image-wrapper";

      img = document.createElement("img");
      img.className = "collection-filters-app__product-image collection-filters-app__product-image--primary";
      if (product.featuredImage) {
        img.src = product.featuredImage.url;
        img.alt = product.featuredImage.altText || product.title;
      } else {
        img.src = this.placeholderImage;
        img.alt = product.title;
      }
      img.loading = "lazy";
      imageWrapper.appendChild(img);

      if (product.hoverImage) {
        hoverImg = document.createElement("img");
        hoverImg.className = "collection-filters-app__product-image collection-filters-app__product-image--hover";
        hoverImg.src = product.hoverImage.url;
        hoverImg.alt = "";
        hoverImg.loading = "lazy";
        imageWrapper.appendChild(hoverImg);
      }

      if (this.isOnSale(product)) {
        const badge = document.createElement("span");
        badge.className = "collection-filters-app__sale-badge";
        badge.textContent = "Sale";
        imageWrapper.appendChild(badge);
      }

      if (this.showWishlist) {
        imageWrapper.appendChild(this.buildWishlistButton(product));
      }

      link.appendChild(imageWrapper);
    }

    const info = document.createElement("div");
    info.className = "collection-filters-app__product-info";

    const title = document.createElement("span");
    title.className = "collection-filters-app__product-title";
    title.title = product.title;
    title.textContent = product.title;

    const priceWrapper = document.createElement("span");
    priceWrapper.className = "collection-filters-app__product-price-wrapper";

    let compareAtPrice = null;
    if (this.isOnSale(product)) {
      compareAtPrice = document.createElement("span");
      compareAtPrice.className = "collection-filters-app__product-compare-price";
      compareAtPrice.textContent = this.formatPriceRange({
        minVariantPrice: product.compareAtPriceRange.minVariantCompareAtPrice,
        maxVariantPrice: product.compareAtPriceRange.maxVariantCompareAtPrice,
      });
      priceWrapper.appendChild(compareAtPrice);
    }

    const price = document.createElement("span");
    price.className = "collection-filters-app__product-price";
    price.textContent = this.formatPriceRange(product.priceRange);
    priceWrapper.appendChild(price);

    const ratingRow = this.buildProductRatingRow(product);

    info.append(title, priceWrapper);
    if (ratingRow) info.appendChild(ratingRow);
    link.appendChild(info);
    card.appendChild(link);

    const initialVariant = product.firstAvailableVariant
      ? (product.variants || []).find((v) => v.id === product.firstAvailableVariant.id)
      : null;
    const selectedOptions = {};
    for (const opt of initialVariant?.selectedOptions || []) {
      selectedOptions[opt.name] = opt.value;
    }

    const addToCartButton = this.createAddToCartButton(product, initialVariant);
    if (addToCartButton) {
      card.appendChild(addToCartButton);
    }

    const variantOptions = this.createVariantOptionsList(product, selectedOptions, (nextVariant) => {
      if (img && nextVariant?.image) {
        img.src = nextVariant.image.url;
        img.alt = nextVariant.image.altText || product.title;
      }
      if (nextVariant?.price) {
        price.textContent = this.formatMoney(
          Number(nextVariant.price) * 100,
          product.priceRange.minVariantPrice.currencyCode,
        );
      }
      this.updateAddToCartButton(addToCartButton, nextVariant);
    });
    if (variantOptions) {
      info.appendChild(variantOptions);
    }

    return card;
  }

  findMatchingVariant(product, selectedOptions) {
    return (product.variants || []).find((variant) =>
      (variant.selectedOptions || []).every(
        (opt) => selectedOptions[opt.name] === undefined || selectedOptions[opt.name] === opt.value,
      ),
    );
  }

  updateAddToCartButton(button, variant) {
    if (!button) return;
    if (!variant) {
      button.disabled = true;
      button.textContent = "Unavailable";
      button.dataset.variantId = "";
      return;
    }
    button.dataset.variantId = variant.id;
    button.disabled = !variant.availableForSale;
    button.textContent = variant.availableForSale ? "Add to cart" : "Sold out";
  }

  createAddToCartButton(product, initialVariant) {
    const variant = initialVariant || product.firstAvailableVariant;
    if (!variant) return null;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "collection-filters-app__add-to-cart";
    this.updateAddToCartButton(button, variant);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (!button.dataset.variantId) return;
      this.addToCart(button.dataset.variantId, button);
    });

    return button;
  }

  async addToCart(variantId, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Adding…";

    try {
      const sectionId = document.querySelector("cart-drawer")?.dataset.sectionId || "cart-drawer";
      const headerSectionId = document.getElementById("cart-icon-bubble")?.closest("[id^='shopify-section-']")
        ?.id.replace("shopify-section-", "") || "header";

      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ id: Number(variantId), quantity: 1 }],
          sections: `${sectionId},${headerSectionId}`,
          sections_url: window.location.pathname,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.description || body.message || "Add to cart failed");
      }

      const addResult = await response.json();
      button.textContent = "Added";

      const cartDrawer = document.querySelector("cart-drawer");
      const sectionHtml = addResult.sections && addResult.sections[sectionId];

      if (cartDrawer && sectionHtml) {
        // This theme's <cart-drawer> is not Dawn's — it's a custom element
        // whose empty/populated state is toggled by an "is-empty" class on
        // both <cart-drawer> and the nested <cart-drawer-items>, and whose
        // line-item markup we don't control from this app. Rather than
        // guessing at that markup, ask Shopify to server-render the actual
        // cart-drawer section (Section Rendering API) and swap in its
        // freshly rendered contents wholesale — guaranteed to match
        // whatever template the theme uses.
        const parsed = new DOMParser().parseFromString(sectionHtml, "text/html");
        const freshDrawer = parsed.querySelector("cart-drawer") || parsed.body.firstElementChild;
        if (freshDrawer) {
          cartDrawer.innerHTML = freshDrawer.innerHTML;
          cartDrawer.className = freshDrawer.className;
        }

        const headerSectionHtml = addResult.sections && addResult.sections[headerSectionId];
        const currentCartIcon = document.getElementById("cart-icon-bubble");
        if (headerSectionHtml && currentCartIcon) {
          // The header's cart icon has no count badge in the DOM at all
          // until the cart has items — the theme only renders it server-side
          // once cart.item_count > 0. Swap in the freshly rendered icon
          // element itself (not just text) so we pick up whatever badge
          // markup the theme adds, rather than trying to update text nodes
          // that don't exist yet.
          const headerParsed = new DOMParser().parseFromString(headerSectionHtml, "text/html");
          const freshCartIcon = headerParsed.getElementById("cart-icon-bubble");
          if (freshCartIcon) {
            currentCartIcon.replaceWith(freshCartIcon);
          }
        } else {
          this.updateCartCountElements(addResult.item_count);
        }

        document.dispatchEvent(
          new CustomEvent("cart:refresh", { detail: { cart: addResult }, bubbles: true }),
        );
      } else {
        await this.refreshCartUi();
      }

      if (cartDrawer && typeof cartDrawer.open === "function") {
        cartDrawer.open();
      } else if (cartDrawer) {
        cartDrawer.classList.add("active");
        cartDrawer.removeAttribute("hidden");
        document.body.classList.add("overflow-hidden");
      }

      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1500);
    } catch (error) {
      console.error("[collection-filters-app] add to cart failed", error);
      button.textContent = "Error";
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1500);
    }
  }

  async refreshCartUi() {
    let cart = null;
    try {
      const response = await fetch("/cart.js");
      console.log("[collection-filters-app] /cart.js status", response.status);
      if (response.ok) {
        cart = await response.json();
        console.log("[collection-filters-app] cart.js body", cart);
      }
    } catch (error) {
      console.warn("[collection-filters-app] cart.js fetch failed", error);
    }

    if (cart) {
      // Only touch count text nodes inside the header cart icon, never its
      // markup — a previous version replaced #cart-icon-bubble's innerHTML
      // wholesale via the Section Rendering API, which duplicated/corrupted
      // the icon SVG structure and made the cart icon render oversized.
      this.updateCartCountElements(cart.item_count);
      console.log(
        "[collection-filters-app] count elements matched",
        document.querySelectorAll(
          "[data-cart-count], [data-cart-item-count], .cart-count-bubble, .cart-count, #CartCount, #cart-icon-bubble .visually-hidden",
        ).length,
      );
    }

    // <cart-drawer> is not rendered as a theme section on this theme (it's
    // a direct child of <body>), so the Section Rendering API can't refresh
    // it. Rebuild its item rows directly from the /cart.js line items.
    if (cart) {
      await this.rebuildCartDrawerItems(cart);
    }

    document.dispatchEvent(
      new CustomEvent("cart:refresh", { detail: { cart }, bubbles: true }),
    );
  }

  async rebuildCartDrawerItems(cart) {
    let itemsTable = document.querySelector("cart-drawer .cart-items, #CartDrawer-CartItems .cart-items");
    console.log("[collection-filters-app] existing itemsTable found?", Boolean(itemsTable));
    console.log(
      "[collection-filters-app] #CartDrawer-CartItems exists?",
      Boolean(document.getElementById("CartDrawer-CartItems")),
    );

    if (!itemsTable) {
      // The drawer was rendered in its empty-cart state — the .cart-items
      // table doesn't exist yet (themes show a "cart is empty" message
      // instead). Build the table ourselves and insert it into the existing
      // #CartDrawer-CartItems container without touching any of the
      // theme's own wrapper elements, so we don't disrupt whatever
      // listeners/state Dawn's own JS holds on those nodes (unlike an
      // earlier attempt that replaced the whole drawer's innerHTML and
      // broke it).
      itemsTable = this.buildEmptyCartItemsTable();
      if (!itemsTable) {
        // No known container to insert into on this theme — fall back to
        // a reload rather than leaving the drawer showing stale content.
        window.location.reload();
        return;
      }
    }

    const tbody = itemsTable.querySelector("tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    cart.items.forEach((item, index) => {
      const lineNumber = index + 1;
      const row = document.createElement("tr");
      row.id = `CartDrawer-Item-${lineNumber}`;
      row.className = "cart-item";
      row.setAttribute("role", "row");

      const mediaCell = document.createElement("td");
      mediaCell.className = "cart-item__media";
      mediaCell.setAttribute("role", "cell");
      if (item.image) {
        const link = document.createElement("a");
        link.href = item.url;
        link.className = "cart-item__link";
        link.tabIndex = -1;
        link.setAttribute("aria-hidden", "true");
        const img = document.createElement("img");
        img.className = "cart-item__image";
        img.src = item.image;
        img.alt = "";
        img.loading = "lazy";
        img.width = 150;
        img.height = 150;
        mediaCell.append(link, img);
      }

      const detailsCell = document.createElement("td");
      detailsCell.className = "cart-item__details";
      detailsCell.setAttribute("role", "cell");
      const nameLink = document.createElement("a");
      nameLink.href = item.url;
      nameLink.className = "cart-item__name h4 break";
      nameLink.textContent = item.product_title;
      detailsCell.appendChild(nameLink);
      if (item.variant_title && item.variant_title !== "Default Title") {
        const priceLine = document.createElement("div");
        priceLine.className = "product-option";
        priceLine.textContent = item.variant_title;
        detailsCell.appendChild(priceLine);
      }

      const totalsCell = document.createElement("td");
      totalsCell.className = "cart-item__totals right";
      totalsCell.setAttribute("role", "cell");
      const priceWrapper = document.createElement("div");
      priceWrapper.className = "cart-item__price-wrapper";
      const priceSpan = document.createElement("span");
      priceSpan.className = "price price--end";
      priceSpan.textContent = this.formatMoney(item.final_line_price, cart.currency);
      priceWrapper.appendChild(priceSpan);
      totalsCell.appendChild(priceWrapper);

      const quantityCell = document.createElement("td");
      quantityCell.className = "cart-item__quantity";
      quantityCell.setAttribute("role", "cell");
      quantityCell.innerHTML = this.cartItemQuantityMarkup(item, lineNumber);

      row.append(mediaCell, detailsCell, totalsCell, quantityCell);
      tbody.appendChild(row);
    });
  }

  buildEmptyCartItemsTable() {
    const cartItemsContainer = document.getElementById("CartDrawer-CartItems");
    if (!cartItemsContainer) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "drawer__cart-items-wrapper";

    const table = document.createElement("table");
    table.className = "cart-items";
    table.setAttribute("role", "table");

    const thead = document.createElement("thead");
    thead.setAttribute("role", "rowgroup");
    thead.innerHTML = `
      <tr role="row">
        <th id="CartDrawer-ColumnProductImage" role="columnheader">
          <span class="visually-hidden">Product image</span>
        </th>
        <th id="CartDrawer-ColumnProduct" class="caption-with-letter-spacing" scope="col" role="columnheader">
          Product
        </th>
        <th id="CartDrawer-ColumnTotal" class="right caption-with-letter-spacing" scope="col" role="columnheader">
          Total
        </th>
        <th id="CartDrawer-ColumnQuantity" role="columnheader">
          <span class="visually-hidden">Quantity</span>
        </th>
      </tr>
    `;

    const tbody = document.createElement("tbody");
    tbody.setAttribute("role", "rowgroup");

    table.append(thead, tbody);
    wrapper.appendChild(table);

    // Clear whatever "cart is empty" markup the theme rendered, then
    // insert our freshly built table in its place.
    cartItemsContainer.innerHTML = "";
    cartItemsContainer.appendChild(wrapper);

    return table;
  }

  cartItemQuantityMarkup(item, lineNumber) {
    const escapedTitle = this.escapeHtml(item.product_title);
    return `
      <div class="cart-item__quantity-wrapper">
        <quantity-input class="quantity cart-quantity">
          <button class="quantity__button" name="minus" type="button">
            <span class="visually-hidden">Decrease quantity for ${escapedTitle}</span>
            <span class="svg-wrapper"><svg xmlns="http://www.w3.org/2000/svg" fill="none" class="icon icon-minus" viewBox="0 0 10 2"><path fill="currentColor" fill-rule="evenodd" d="M.5 1C.5.7.7.5 1 .5h8a.5.5 0 1 1 0 1H1A.5.5 0 0 1 .5 1" clip-rule="evenodd"></path></svg>
</span>
          </button>
          <input class="quantity__input" type="number" data-quantity-variant-id="${item.variant_id}" name="updates[]" value="${item.quantity}" data-cart-quantity="${item.quantity}" min="0" step="1" aria-label="Quantity for ${escapedTitle}" id="Drawer-quantity-${lineNumber}" data-index="${lineNumber}">
          <button class="quantity__button" name="plus" type="button">
            <span class="visually-hidden">Increase quantity for ${escapedTitle}</span>
            <span class="svg-wrapper"><svg xmlns="http://www.w3.org/2000/svg" fill="none" class="icon icon-plus" viewBox="0 0 10 10"><path fill="currentColor" fill-rule="evenodd" d="M1 4.51a.5.5 0 0 0 0 1h3.5l.01 3.5a.5.5 0 0 0 1-.01V5.5l3.5-.01a.5.5 0 0 0-.01-1H5.5L5.49.99a.5.5 0 0 0-1 .01v3.5l-3.5.01z" clip-rule="evenodd"></path></svg>
</span>
          </button>
        </quantity-input>
        <cart-remove-button id="CartDrawer-Remove-${lineNumber}" data-index="${lineNumber}">
          <button type="button" class="button button--tertiary" aria-label="Remove ${escapedTitle}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" class="icon icon-remove">
              <path d="M14 3h-3.53a3.07 3.07 0 00-.6-1.65C9.44.82 8.8.5 8 .5s-1.44.32-1.87.85A3.06 3.06 0 005.53 3H2a.5.5 0 000 1h1.25v10c0 .28.22.5.5.5h8.5a.5.5 0 00.5-.5V4H14a.5.5 0 000-1zM6.91 1.98c.23-.29.58-.48 1.09-.48s.85.19 1.09.48c.2.24.3.6.36 1.02h-2.9c.05-.42.17-.78.36-1.02zm4.84 11.52h-7.5V4h7.5v9.5z" fill="currentColor"></path>
              <path d="M6.55 5.25a.5.5 0 00-.5.5v6a.5.5 0 001 0v-6a.5.5 0 00-.5-.5zM9.45 5.25a.5.5 0 00-.5.5v6a.5.5 0 001 0v-6a.5.5 0 00-.5-.5z" fill="currentColor"></path>
            </svg>
          </button>
        </cart-remove-button>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  formatMoney(cents, currencyCode) {
    const formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
    });
    return formatter.format(cents / 100);
  }

  updateCartCountElements(count) {
    if (typeof count !== "number") return;

    document.querySelectorAll("[data-cart-count], [data-cart-item-count]").forEach((el) => {
      el.textContent = String(count);
    });

    document.querySelectorAll(".cart-count-bubble, .cart-count, #CartCount").forEach((el) => {
      const digitSpan = el.querySelector("[aria-hidden='true']");
      if (digitSpan && /^\d+$/.test(digitSpan.textContent.trim())) {
        digitSpan.textContent = String(count);
      } else if (/^\d+$/.test(el.textContent.trim())) {
        el.textContent = String(count);
      }
    });

    document.querySelectorAll(
      "#cart-icon-bubble .visually-hidden, .cart-count-bubble .visually-hidden",
    ).forEach((el) => {
      const text = el.textContent.trim();
      if (/^\d+\s/.test(text)) {
        el.textContent = text.replace(/^\d+/, String(count));
      } else if (/^\d+$/.test(text)) {
        el.textContent = String(count);
      }
    });
  }

  renderScrollStatus() {
    let status = this.pagination.querySelector(
      ".collection-filters-app__scroll-status",
    );
    if (!status) {
      status = document.createElement("p");
      status.className = "collection-filters-app__scroll-status";
      this.pagination.insertBefore(status, this.pagination.firstChild);
    }

    if (this.filteredCache.length === 0) {
      status.hidden = true;
      return;
    }

    status.hidden = false;
    status.textContent =
      this.loadedCount >= this.filteredCache.length
        ? `Showing all ${this.filteredCache.length} products`
        : `Showing ${this.loadedCount} of ${this.filteredCache.length} products`;
  }
}

customElements.define("collection-filters-app", CollectionFiltersApp);
