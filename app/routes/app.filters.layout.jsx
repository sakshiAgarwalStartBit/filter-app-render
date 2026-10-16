import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { clearProductCache } from "../collection-filters.server";
import { FilterTabsNav } from "../filters-nav";
import { FilterLayoutPicker } from "../filter-layout-picker";
import { FilterPagePreviewButton, FilterPagePreviewModal } from "../filter-page-preview";
import { HeadingWithTip } from "../help-tip";
import { SettingsSaveBar } from "../settings-save-bar";
import { RouteErrorBoundary } from "../route-error-boundary";
import { CustomizerPopupButton, CustomizerPopupModal, useCustomizerPopup } from "../customizer-popup";

const VALID_CONTEXTS = ["collection", "search"];
const FILTER_LAYOUTS = ["vertical", "horizontal", "drawer"];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const contextParam = url.searchParams.get("context");
  const context = VALID_CONTEXTS.includes(contextParam) ? contextParam : "collection";

  const [shopSettings, contextSettings] = await Promise.all([
    prisma.shopSettings.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.filterContextSettings.upsert({
      where: { shop_context: { shop, context } },
      update: {},
      create: { shop, context },
    }),
  ]);

  return { shopSettings, contextSettings, context };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  if (body.intent === "clearCache") {
    await clearProductCache(shop);
    return { cacheCleared: true };
  }

  const {
    context: rawContext,
    pageSize,
    filterLayout,
    showOnDesktop,
    showOnMobile,
    clearAllButtonText,
    showFilterCounts,
    showWishlist,
  } = body;

  const context = VALID_CONTEXTS.includes(rawContext) ? rawContext : "collection";

  await prisma.filterContextSettings.upsert({
    where: { shop_context: { shop, context } },
    update: {
      pageSize: pageSize || 10,
      filterLayout: FILTER_LAYOUTS.includes(filterLayout) ? filterLayout : "vertical",
      showOnDesktop: Boolean(showOnDesktop),
      showOnMobile: Boolean(showOnMobile),
      clearAllButtonText:
        typeof clearAllButtonText === "string" && clearAllButtonText.trim() !== ""
          ? clearAllButtonText.trim()
          : "Clear all",
    },
    create: {
      shop,
      context,
      pageSize: pageSize || 10,
      filterLayout: FILTER_LAYOUTS.includes(filterLayout) ? filterLayout : "vertical",
      showOnDesktop: Boolean(showOnDesktop),
      showOnMobile: Boolean(showOnMobile),
      clearAllButtonText:
        typeof clearAllButtonText === "string" && clearAllButtonText.trim() !== ""
          ? clearAllButtonText.trim()
          : "Clear all",
    },
  });

  await prisma.shopSettings.upsert({
    where: { shop },
    update: {
      showFilterCounts: Boolean(showFilterCounts),
      showWishlist: Boolean(showWishlist),
    },
    create: {
      shop,
      showFilterCounts: Boolean(showFilterCounts),
      showWishlist: Boolean(showWishlist),
    },
  });

  return { ok: true, context };
};

export default function FiltersLayout() {
  const { shopSettings, contextSettings, context } = useLoaderData();
  const fetcher = useFetcher();
  const cacheFetcher = useFetcher();
  const shopify = useAppBridge();
  const customizerPopup = useCustomizerPopup();

  const [pageSize, setPageSize] = useState(contextSettings?.pageSize ?? 10);
  const [filterLayout, setFilterLayout] = useState(
    contextSettings?.filterLayout || "vertical",
  );
  const [showOnDesktop, setShowOnDesktop] = useState(
    contextSettings?.showOnDesktop ?? true,
  );
  const [showOnMobile, setShowOnMobile] = useState(
    contextSettings?.showOnMobile ?? true,
  );
  const [clearAllButtonText, setClearAllButtonText] = useState(
    contextSettings?.clearAllButtonText || "Clear all",
  );
  const [showFilterCounts, setShowFilterCounts] = useState(
    shopSettings.showFilterCounts ?? true,
  );
  const [showWishlist, setShowWishlist] = useState(
    shopSettings.showWishlist ?? false,
  );

  const isSaving = fetcher.state !== "idle";

  const initialFields = {
    pageSize: contextSettings?.pageSize ?? 10,
    filterLayout: contextSettings?.filterLayout || "vertical",
    showOnDesktop: contextSettings?.showOnDesktop ?? true,
    showOnMobile: contextSettings?.showOnMobile ?? true,
    clearAllButtonText: contextSettings?.clearAllButtonText || "Clear all",
    showFilterCounts: shopSettings.showFilterCounts ?? true,
    showWishlist: shopSettings.showWishlist ?? false,
  };
  const currentFields = {
    pageSize,
    filterLayout,
    showOnDesktop,
    showOnMobile,
    clearAllButtonText,
    showFilterCounts,
    showWishlist,
  };
  const dirty = JSON.stringify(currentFields) !== JSON.stringify(initialFields);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Layout settings saved");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (cacheFetcher.data?.cacheCleared) {
      shopify.toast.show("Cache cleared. Your storefront will show the latest products.");
    }
  }, [cacheFetcher.data, shopify]);

  const handleClearCache = () => {
    cacheFetcher.submit(
      { intent: "clearCache" },
      { method: "POST", encType: "application/json" },
    );
  };

  const handleSave = () => {
    fetcher.submit(
      {
        context,
        pageSize: Number(pageSize),
        filterLayout,
        showOnDesktop,
        showOnMobile,
        clearAllButtonText,
        showFilterCounts,
        showWishlist,
      },
      { method: "POST", encType: "application/json" },
    );
  };

  const handleDiscard = () => {
    setPageSize(initialFields.pageSize);
    setFilterLayout(initialFields.filterLayout);
    setShowOnDesktop(initialFields.showOnDesktop);
    setShowOnMobile(initialFields.showOnMobile);
    setClearAllButtonText(initialFields.clearAllButtonText);
    setShowFilterCounts(initialFields.showFilterCounts);
    setShowWishlist(initialFields.showWishlist);
  };

  return (
    <s-page
      heading={
        context === "search"
          ? "Search filters — layout & display"
          : "Collection filters — layout & display"
      }
    >
      <CustomizerPopupButton slot="primary-action" onOpen={customizerPopup.onOpen} />
      <CustomizerPopupModal
        open={customizerPopup.open}
        onClose={customizerPopup.onClose}
        context={context}
      />
      {/* The Customizer modal loads a whole second app page in a ui-modal,
          which races with this page's own ui-save-bar custom element
          upgrading and throws "saveBar.hide is not a function" inside
          App Bridge's SaveBar internals. Unmounting this save bar while the
          modal is open avoids two ui-save-bar instances existing at once. */}
      {!customizerPopup.open && (
        <SettingsSaveBar
          id="filters-layout-save-bar"
          dirty={dirty}
          saving={isSaving}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      )}

      <FilterTabsNav
        active="layout"
        context={context}
        endAction={<FilterPagePreviewButton id="filters-layout-preview" variant="primary" />}
      />

      <s-section>
        <HeadingWithTip tip="Choose how the filter panel appears on your storefront. On mobile screens, the filter panel always uses the Drawer style regardless of the layout chosen here.">
          Filter layout
        </HeadingWithTip>
        <FilterLayoutPicker value={filterLayout} onChange={setFilterLayout} />
      </s-section>

      <s-stack direction="block" gap="base">
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <s-section>
          <HeadingWithTip tip="Customize the text shown on the button that clears all active filters on the storefront.">
            Clear all button
          </HeadingWithTip>
          <s-text-field
            label="Button text"
            value={clearAllButtonText}
            onChange={(e) => setClearAllButtonText(e.target.value)}
          />
        </s-section>

        <s-section heading="Pagination">
          <s-text-field
            label="Products per page"
            type="number"
            value={String(pageSize)}
            onChange={(e) => setPageSize(e.target.value)}
          />
        </s-section>
      </s-grid>

      <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
        <s-section>
          <HeadingWithTip tip={'When checked, each filter value shows the number of matching products next to it, for example "XL (3)". When unchecked, it\'s just "XL". Applies to both Collection and Search filters.'}>
            Filter value display
          </HeadingWithTip>
          <s-switch
            label="Show product count"
            checked={showFilterCounts}
            onChange={(e) => setShowFilterCounts(e.target.checked)}
          />
        </s-section>

        <s-section>
          <HeadingWithTip tip="Adds a heart icon to product cards so shoppers can save products to a wishlist. Logged-in customers' wishlists sync to their account; guests get a browser-only wishlist. Add the app's 'Wishlist' block to a page in the theme editor so shoppers can view their saved products.">
            Wishlist
          </HeadingWithTip>
          <s-switch
            label="Show wishlist heart icon"
            checked={showWishlist}
            onChange={(e) => setShowWishlist(e.target.checked)}
          />
        </s-section>

        <s-section>
          <HeadingWithTip tip="Choose which devices show the filter widget.">
            Visibility
          </HeadingWithTip>
          <s-stack direction="block" gap="tight">
            <s-switch
              label="Show on desktop"
              checked={showOnDesktop}
              onChange={(e) => setShowOnDesktop(e.target.checked)}
            />
            <s-switch
              label="Show on mobile"
              checked={showOnMobile}
              onChange={(e) => setShowOnMobile(e.target.checked)}
            />
          </s-stack>
        </s-section>
      </s-grid>

      <s-section heading="Product cache">
        <s-stack direction="block" gap="small-300">
          <s-paragraph tone="subdued">
            To keep your storefront fast, product data is cached. Product changes (such as
            price, stock or new products) can take 5-10 minutes to show up in the filters. If
            you want to see them right away, clear the cache here.
          </s-paragraph>
          <s-stack direction="inline">
            <s-button
              onClick={handleClearCache}
              loading={cacheFetcher.state !== "idle" || undefined}
            >
              Clear cache
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
      </s-stack>

      <FilterPagePreviewModal
        id="filters-layout-preview"
        filterLayout={filterLayout}
        styleVars={{
          headingFontSize: shopSettings.headingFontSize,
          headingFontWeight: shopSettings.headingFontWeight,
          headingTextTransform: shopSettings.headingTextTransform,
          headingTextColor: shopSettings.headingTextColor,
          valueFontSize: shopSettings.valueFontSize,
          valueFontWeight: shopSettings.valueFontWeight,
          valueTextTransform: shopSettings.valueTextTransform,
          valueTextColor: shopSettings.valueTextColor,
        }}
        buttonStyle={{
          fontSize: `${shopSettings.buttonFontSize}px`,
          fontWeight: shopSettings.buttonFontWeight,
          textTransform: shopSettings.buttonTextTransform,
          color: shopSettings.buttonTextColor,
          borderRadius: `${shopSettings.buttonBorderRadius}px`,
          border: `1px solid ${shopSettings.buttonBorderColor}`,
          background: shopSettings.buttonBackgroundColor,
        }}
        toggleButtonStyle={{
          fontSize: `${shopSettings.toggleFontSize}px`,
          fontWeight: shopSettings.toggleFontWeight,
          textTransform: shopSettings.toggleTextTransform,
          color: shopSettings.toggleTextColor,
          borderRadius: `${shopSettings.toggleBorderRadius}px`,
          border: `1px solid ${shopSettings.toggleBorderColor}`,
          background: shopSettings.toggleBackgroundColor,
        }}
        sidebarBackgroundColor={shopSettings.sidebarBackgroundColor}
        productGridColumns={shopSettings.productGridColumns}
        swatchShape={shopSettings.swatchShape}
      />
    </s-page>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
