import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { FilterTabsNav } from "../filters-nav";
import { HeadingWithTip } from "../help-tip";
import { SettingsSaveBar } from "../settings-save-bar";
import { RouteErrorBoundary } from "../route-error-boundary";
import { FilterPagePreviewButton, FilterPagePreviewModal } from "../filter-page-preview";
import { CustomizerPopupButton, CustomizerPopupModal, useCustomizerPopup } from "../customizer-popup";

const VALID_CONTEXTS = ["collection", "search"];

// Mirrors the storefront's own color-field heuristic (see isColorField in
// collection-filters.js) so a merchant enabling the standard "Color" option
// gets round swatches without needing a display-type control in this UI.
function isColorField(field) {
  if (field.fieldKey === "variantOption:Color") return true;
  const label = (field.label || "").trim().toLowerCase();
  return label.includes("color") || label.includes("colour");
}

const STANDARD_FIELDS = [
  { fieldKey: "price", fieldType: "standard", label: "Price" },
  { fieldKey: "available", fieldType: "standard", label: "Availability" },
  { fieldKey: "vendor", fieldType: "standard", label: "Vendor" },
  { fieldKey: "tag", fieldType: "standard", label: "Tag" },
  { fieldKey: "product_type", fieldType: "standard", label: "Product type" },
  { fieldKey: "category", fieldType: "standard", label: "Product category" },
  { fieldKey: "review_rating", fieldType: "standard", label: "Review rating" },
];

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
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
    prisma.filterContextSettings.findUnique({
      where: { shop_context: { shop, context } },
    }),
  ]);

  const metafieldResponse = await admin.graphql(
    `#graphql
      query FilterableMetafieldDefinitions {
        metafieldDefinitions(first: 50, ownerType: PRODUCT) {
          edges {
            node {
              namespace
              key
              name
            }
          }
        }
      }`,
  );
  const metafieldJson = await metafieldResponse.json();
  const allMetafieldDefs = metafieldJson.data?.metafieldDefinitions?.edges ?? [];
  const reviewNamespace = shopSettings.reviewRatingNamespace || "reviews";
  const metafieldFields = allMetafieldDefs
    // The configured review-app namespace (rating / rating_count by default,
    // matching Judge.me's convention — see the "Review rating source"
    // section on the Advanced tab for how a merchant using a different
    // review app can repoint this) is already exposed as the dedicated "Review rating"
    // standard field (star-rendered, bucketed by threshold). Surfacing it
    // again here as a raw metafield filter would duplicate it with an
    // unformatted value.
    .filter(({ node }) => node.namespace !== reviewNamespace)
    .map(({ node }) => ({
      fieldKey: `metafield:${node.namespace}.${node.key}`,
      fieldType: "metafield",
      label: node.name,
    }));

  const variantOptionsResponse = await admin.graphql(
    `#graphql
      query DiscoverVariantOptions {
        products(first: 100) {
          edges {
            node {
              options {
                name
              }
            }
          }
        }
      }`,
  );
  const variantOptionsJson = await variantOptionsResponse.json();
  const optionNames = new Set();
  for (const { node } of variantOptionsJson.data?.products?.edges ?? []) {
    for (const option of node.options ?? []) {
      if (option.name.trim().toLowerCase() === "title") continue;
      optionNames.add(option.name);
    }
  }
  const variantOptionFields = [...optionNames].map((name) => ({
    fieldKey: `variantOption:${name}`,
    fieldType: "variantOption",
    label: name,
  }));

  const availableFields = [
    ...STANDARD_FIELDS,
    ...variantOptionFields,
    ...metafieldFields,
  ];

  const savedConfigs = await prisma.filterConfig.findMany({
    where: { shop, context },
    orderBy: { position: "asc" },
  });

  return {
    availableFields,
    savedConfigs,
    shopSettings,
    contextSettings,
    context,
  };
};

async function saveSelections({ shop, context, selections }) {
  await prisma.filterContextSettings.upsert({
    where: { shop_context: { shop, context } },
    update: {},
    create: { shop, context },
  });

  await prisma.$transaction([
    prisma.filterConfig.deleteMany({ where: { shop, context } }),
    ...selections.map((field, index) =>
      prisma.filterConfig.create({
        data: {
          shop,
          context,
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          label: field.label,
          displayType:
            field.displayType === "swatch" ||
            (field.displayType == null && isColorField(field))
              ? "swatch"
              : "list",
          selectMode: field.selectMode === "single" ? "single" : "multiple",
          valuePrefix:
            typeof field.valuePrefix === "string" && field.valuePrefix.trim() !== ""
              ? field.valuePrefix.trim()
              : null,
          enabled: true,
          position: index,
        },
      }),
    ),
  ]);
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const { context: rawContext, selections, intent } = body;

  const context = VALID_CONTEXTS.includes(rawContext) ? rawContext : "collection";

  if (intent === "delete-ordertag-filter") {
    const { fieldKey } = body;
    const existing = await prisma.filterConfig.findMany({
      where: { shop, context },
      orderBy: { position: "asc" },
    });
    const selections = existing.filter((c) => c.fieldKey !== fieldKey);
    await saveSelections({ shop, context, selections });
    return { ok: true, context, intent };
  }

  const orderTagCount = (selections ?? []).filter((f) =>
    f.fieldKey.startsWith("ordertag:"),
  ).length;
  if (orderTagCount > MAX_ORDERTAG_PREFIX_FILTERS) {
    return {
      error: `You can add up to ${MAX_ORDERTAG_PREFIX_FILTERS} order tag filters. Remove one before adding another.`,
      context,
    };
  }

  await saveSelections({ shop, context, selections });
  return { ok: true, context };
};

export default function Filters() {
  const { context } = useLoaderData();
  const [, setSearchParams] = useSearchParams();

  return (
    <FiltersPage
      key={context}
      onSwitchContext={(nextContext) => {
        setSearchParams(
          nextContext === "collection" ? {} : { context: nextContext },
        );
      }}
    />
  );
}

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const EMPTY_ORDERTAG_FILTER_FORM = {
  label: "",
  displayType: "list",
  selectMode: "multiple",
  valuePrefix: "",
};

const MAX_METAFIELD_FILTERS = 5;
const MAX_ORDERTAG_PREFIX_FILTERS = 5;

function FiltersPage({ onSwitchContext }) {
  const { availableFields, savedConfigs, shopSettings, contextSettings, context } = useLoaderData();
  const shopify = useAppBridge();
  const customizerPopup = useCustomizerPopup();
  // useFetcher submits through React Router's own data protocol (the
  // ".data" single-fetch requests useFetcher/<Form> build internally), so
  // the server reliably returns the action's JSON and revalidates the
  // loader on success — unlike a raw fetch() against the route URL, which
  // React Router treats as a full document request and answers with the
  // whole SSR-rendered page instead of the action's response.
  const saveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const isSaving = saveFetcher.state !== "idle";
  // Tracks which single order-tag-filter row is being deleted, so only that
  // row's delete button disables — not every row's.
  const [deletingOrderTagFieldKey, setDeletingOrderTagFieldKey] = useState(null);
  // s-modal teleports/restructures its children once the custom element
  // upgrades in the browser, which never matches the server-rendered markup
  // and throws a React hydration error (see the same workaround in
  // filter-page-preview.jsx and filters-nav.jsx). Mounting it only after
  // hydration sidesteps the mismatch entirely.
  const [mountedModals, setMountedModals] = useState(false);
  // s-modal teleports its children in the DOM (see comment above), which can
  // desync controlled inputs from React state. Reading values directly from
  // the DOM via refs at save time sidesteps that entirely.
  const orderTagLabelRef = useRef(null);
  const orderTagDisplayTypeRef = useRef(null);
  const orderTagSelectModeRef = useRef(null);
  const orderTagValuePrefixRef = useRef(null);
  // Stable ref callbacks (created once, never recreated) so React only
  // invokes them on actual mount/unmount of the field, not on every
  // re-render — otherwise .value would get reseeded on every keystroke
  // elsewhere in the form, wiping whatever the merchant just typed.
  const seedOrderTagLabelRef = useCallback((el) => {
    orderTagLabelRef.current = el;
  }, []);
  const seedOrderTagDisplayTypeRef = useCallback((el) => {
    orderTagDisplayTypeRef.current = el;
  }, []);
  const seedOrderTagSelectModeRef = useCallback((el) => {
    orderTagSelectModeRef.current = el;
  }, []);
  const seedOrderTagValuePrefixRef = useCallback((el) => {
    orderTagValuePrefixRef.current = el;
  }, []);
  useEffect(() => {
    setMountedModals(true);
  }, []);

  const initialSelectedOrder = savedConfigs.map((c) => c.fieldKey);
  const initialOrderTagFilters = savedConfigs
    .filter((c) => c.fieldKey.startsWith("ordertag:"))
    .map((c) => ({
      fieldKey: c.fieldKey,
      label: c.label,
      displayType: c.displayType || "list",
      selectMode: c.selectMode || "multiple",
      valuePrefix: c.valuePrefix || "",
    }));

  const [selectedOrder, setSelectedOrder] = useState(() => initialSelectedOrder);
  const [orderTagFilters, setOrderTagFilters] = useState(() => initialOrderTagFilters);
  const [orderTagFilterForm, setOrderTagFilterForm] = useState(null);
  const [editingOrderTagFieldKey, setEditingOrderTagFieldKey] = useState(null);
  const [orderTagFilterFormTouched, setOrderTagFilterFormTouched] = useState(false);
  const [savedSelectedOrder, setSavedSelectedOrder] = useState(() => initialSelectedOrder);
  const [savedOrderTagFilters, setSavedOrderTagFilters] = useState(() => initialOrderTagFilters);

  const dirty =
    JSON.stringify(selectedOrder) !== JSON.stringify(savedSelectedOrder) ||
    JSON.stringify(orderTagFilters) !== JSON.stringify(savedOrderTagFilters);

  const fieldsByKeyMap = new Map(availableFields.map((field) => [field.fieldKey, field]));
  const selectedMetafieldCount = selectedOrder.filter(
    (key) => fieldsByKeyMap.get(key)?.fieldType === "metafield",
  ).length;
  const metafieldLimitReached = selectedMetafieldCount >= MAX_METAFIELD_FILTERS;
  const orderTagPrefixLimitReached = orderTagFilters.length >= MAX_ORDERTAG_PREFIX_FILTERS;
  const disabledFields = availableFields.filter(
    (field) => !selectedOrder.includes(field.fieldKey),
  );

  useEffect(() => {
    const fresh = savedConfigs
      .filter((c) => c.fieldKey.startsWith("ordertag:"))
      .map((c) => ({
        fieldKey: c.fieldKey,
        label: c.label,
        displayType: c.displayType || "list",
        selectMode: c.selectMode || "multiple",
        valuePrefix: c.valuePrefix || "",
      }));
    setOrderTagFilters(fresh);
    setSavedOrderTagFilters(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedConfigs]);

  // Seed the order-tag-filter modal's fields whenever it opens for add/edit.
  // Runs after the s-stack's key change has remounted the fields, so refs
  // point at the fresh elements for this open.
  useEffect(() => {
    if (!orderTagFilterForm) return;
    if (orderTagLabelRef.current) orderTagLabelRef.current.value = orderTagFilterForm.label;
    if (orderTagDisplayTypeRef.current)
      orderTagDisplayTypeRef.current.value = orderTagFilterForm.displayType;
    if (orderTagSelectModeRef.current)
      orderTagSelectModeRef.current.value = orderTagFilterForm.selectMode;
    if (orderTagValuePrefixRef.current)
      orderTagValuePrefixRef.current.value = orderTagFilterForm.valuePrefix;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingOrderTagFieldKey, orderTagFilterForm !== null]);

  // A field newly enabled from "Disabled filters" is appended to the bottom
  // of "Filterable fields", which grows that table and shifts everything
  // below it — including wherever the merchant's mouse already is. Tracking
  // the key here lets an effect scroll the new row into view so their next
  // click (e.g. the row's own move-up arrow) actually lands on it instead of
  // on whatever shifted into that screen position.
  const justEnabledFieldKeyRef = useRef(null);

  const toggleField = (fieldKey) => {
    const field = fieldsByKeyMap.get(fieldKey);
    const isEnabling = !selectedOrder.includes(fieldKey);
    if (isEnabling && field?.fieldType === "metafield") {
      if (selectedMetafieldCount >= MAX_METAFIELD_FILTERS) {
        shopify.toast.show(
          `You can enable up to ${MAX_METAFIELD_FILTERS} metafield filters. Remove one before adding another.`,
          { isError: true },
        );
        return;
      }
    }
    justEnabledFieldKeyRef.current = isEnabling ? fieldKey : null;
    setSelectedOrder((prev) =>
      prev.includes(fieldKey)
        ? prev.filter((key) => key !== fieldKey)
        : [...prev, fieldKey],
    );
  };

  useEffect(() => {
    const fieldKey = justEnabledFieldKeyRef.current;
    if (!fieldKey) return;
    justEnabledFieldKeyRef.current = null;
    const row = document.querySelector(`[data-field-row="${CSS.escape(fieldKey)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedOrder]);

  // Drag-and-drop reordering for the "Filterable fields" table.
  // draggedFieldKey drives the dragged row's own "lifted" styling;
  // dragOverFieldKey drives the drop-target
  // indicator on whichever other row the pointer is currently over. Both are
  // state so the visuals stay live during the drag, but dragOverFieldKey
  // only actually changes when the pointer crosses into a *different* row
  // (see the early-return below), not on every dragover/mousemove tick.
  const draggedFieldKeyRef = useRef(null);
  const [draggedFieldKey, setDraggedFieldKey] = useState(null);
  const [dragOverFieldKey, setDragOverFieldKey] = useState(null);

  const handleRowDragStart = (fieldKey) => (event) => {
    draggedFieldKeyRef.current = fieldKey;
    setDraggedFieldKey(fieldKey);
    event.dataTransfer.effectAllowed = "move";
    // Firefox requires data to be set for the drag to start at all.
    event.dataTransfer.setData("text/plain", fieldKey);
  };

  const handleRowDragOver = (fieldKey) => (event) => {
    if (!draggedFieldKeyRef.current || draggedFieldKeyRef.current === fieldKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverFieldKey((prev) => (prev === fieldKey ? prev : fieldKey));
  };

  const handleRowDrop = (fieldKey) => (event) => {
    event.preventDefault();
    const draggedKey = draggedFieldKeyRef.current;
    draggedFieldKeyRef.current = null;
    setDraggedFieldKey(null);
    setDragOverFieldKey(null);
    if (!draggedKey || draggedKey === fieldKey) return;

    setSelectedOrder((prev) => {
      const from = prev.indexOf(draggedKey);
      const to = prev.indexOf(fieldKey);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, draggedKey);
      return next;
    });
  };

  const handleRowDragEnd = () => {
    draggedFieldKeyRef.current = null;
    setDraggedFieldKey(null);
    setDragOverFieldKey(null);
  };

  // handleSave fires the submit and returns immediately — useFetcher has no
  // awaitable result, so the actual success/failure handling below lives in
  // the effect watching saveFetcher.data. pendingSaveRef carries the bits
  // that effect needs once the response lands: the selectedOrder/orderTagFilters
  // snapshot being saved (to set as the new baseline on success) and the
  // pre-save orderTagFilters baseline to restore on failure — used when the
  // caller already optimistically marked its change as "saved" to avoid a
  // Save Bar flash, and needs that undone on failure so the bar reappears.
  const pendingSaveRef = useRef(null);

  // Accepts explicit snapshots so a caller that just staged a change (e.g.
  // the order-tag-filter popup, via setState) can save immediately without
  // waiting a render for that state update to land.
  const handleSave = (orderTagFiltersOverride, revertOrderTagFiltersTo) => {
    const orderTagFiltersToSave = orderTagFiltersOverride ?? orderTagFilters;
    const fieldsByKey = new Map(
      availableFields.map((field) => [field.fieldKey, field]),
    );
    const selections = [
      ...selectedOrder.map((key) => fieldsByKey.get(key)).filter(Boolean),
      ...orderTagFiltersToSave.map((filter) => ({
        fieldKey: filter.fieldKey,
        fieldType: "standard",
        label: filter.label,
        displayType: filter.displayType,
        selectMode: filter.selectMode,
        valuePrefix: filter.valuePrefix,
      })),
    ];
    pendingSaveRef.current = {
      selectedOrder,
      orderTagFiltersToSave,
      revertOrderTagFiltersTo,
    };
    saveFetcher.submit(
      { context, selections },
      { method: "POST", encType: "application/json" },
    );
  };

  useEffect(() => {
    if (saveFetcher.state !== "idle" || !saveFetcher.data || !pendingSaveRef.current) return;
    const { selectedOrder: savedOrderSnapshot, orderTagFiltersToSave, revertOrderTagFiltersTo } =
      pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (saveFetcher.data.ok) {
      shopify.toast.show("Filters saved");
      setSavedSelectedOrder(savedOrderSnapshot);
      setSavedOrderTagFilters(orderTagFiltersToSave);
    } else if (saveFetcher.data.error) {
      if (revertOrderTagFiltersTo) setSavedOrderTagFilters(revertOrderTagFiltersTo);
      shopify.toast.show(saveFetcher.data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.state, saveFetcher.data]);

  const handleDiscard = () => {
    setSelectedOrder(savedSelectedOrder);
    setOrderTagFilters(savedOrderTagFilters);
  };

  // Saving the popup immediately triggers the same save as the top Save
  // bar (single click, no separate confirmation step) so the merchant isn't
  // left with two different "Save" actions to press.
  const handleSaveOrderTagFilter = async () => {
    if (!orderTagFilterForm) return;
    const label = (orderTagLabelRef.current?.value ?? "").trim();
    const valuePrefix = (orderTagValuePrefixRef.current?.value ?? "").trim();
    const displayType = orderTagDisplayTypeRef.current?.value === "swatch" ? "swatch" : "list";
    const selectMode = orderTagSelectModeRef.current?.value === "single" ? "single" : "multiple";
    if (!label || !valuePrefix) {
      setOrderTagFilterFormTouched(true);
      return;
    }

    const fieldKey = editingOrderTagFieldKey || `ordertag:${slugify(label)}`;
    const entry = { fieldKey, label, displayType, selectMode, valuePrefix };
    const alreadyExists = orderTagFilters.some((f) => f.fieldKey === fieldKey);
    const nextOrderTagFilters = alreadyExists
      ? orderTagFilters.map((f) => (f.fieldKey === fieldKey ? entry : f))
      : [...orderTagFilters, entry];

    // Set the "saved" baseline optimistically too, so `dirty` never flips
    // true once the popup closes — otherwise the App Bridge Save Bar
    // flashes in for that instant. handleSave re-sets this same value on
    // success; on failure it restores savedOrderTagFilters so the Save Bar
    // correctly reappears.
    const previousSavedOrderTagFilters = savedOrderTagFilters;
    setOrderTagFilters(nextOrderTagFilters);
    setSavedOrderTagFilters(nextOrderTagFilters);

    // s-modal's hideOverlay() only takes effect when called synchronously
    // from the click that triggered it — calling it after an awaited fetch
    // resolves (i.e. from a later microtask, outside that original user
    // gesture) is silently ignored by the web component. So close the
    // popup immediately and let the save happen in the background,
    // surfaced via toast rather than the popup's own button state.
    setOrderTagFilterForm(null);
    setEditingOrderTagFieldKey(null);
    setOrderTagFilterFormTouched(false);
    document.getElementById("ordertag-filter-modal")?.hideOverlay();

    handleSave(nextOrderTagFilters, previousSavedOrderTagFilters);
  };

  const pendingDeleteRef = useRef(null);

  const handleDeleteOrderTagFilter = (fieldKey) => {
    setDeletingOrderTagFieldKey(fieldKey);
    // Remove it from the table immediately rather than waiting on the
    // server round-trip + revalidation, then restore it if the delete
    // actually fails.
    const previousOrderTagFilters = orderTagFilters;
    const previousSavedOrderTagFilters = savedOrderTagFilters;
    const nextOrderTagFilters = orderTagFilters.filter((f) => f.fieldKey !== fieldKey);
    setOrderTagFilters(nextOrderTagFilters);
    setSavedOrderTagFilters(nextOrderTagFilters);
    pendingDeleteRef.current = { previousOrderTagFilters, previousSavedOrderTagFilters };
    deleteFetcher.submit(
      { context, intent: "delete-ordertag-filter", fieldKey },
      { method: "POST", encType: "application/json" },
    );
  };

  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data || !pendingDeleteRef.current) return;
    const { previousOrderTagFilters, previousSavedOrderTagFilters } = pendingDeleteRef.current;
    pendingDeleteRef.current = null;
    if (deleteFetcher.data.ok) {
      shopify.toast.show("Order tag filter removed");
    } else {
      setOrderTagFilters(previousOrderTagFilters);
      setSavedOrderTagFilters(previousSavedOrderTagFilters);
      shopify.toast.show(
        deleteFetcher.data.error || "Failed to remove order tag filter",
        { isError: true },
      );
    }
    setDeletingOrderTagFieldKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  const draftOrderTagFilter =
    orderTagFilterForm &&
    orderTagFilterForm.label.trim() &&
    orderTagFilterForm.valuePrefix.trim()
      ? {
          fieldKey:
            editingOrderTagFieldKey || `ordertag:${slugify(orderTagFilterForm.label)}:draft`,
          label: orderTagFilterForm.label.trim(),
          displayType: orderTagFilterForm.displayType,
          selectMode: orderTagFilterForm.selectMode,
        }
      : null;

  const previewFields = [
    ...selectedOrder
      .map((fieldKey) => fieldsByKeyMap.get(fieldKey))
      .filter(Boolean)
      .map((field) =>
        field.displayType == null && isColorField(field)
          ? { ...field, displayType: "swatch" }
          : field,
      ),
    ...orderTagFilters
      .filter((f) => f.fieldKey !== draftOrderTagFilter?.fieldKey)
      .map((f) => ({ ...f, fieldType: "standard" })),
    ...(draftOrderTagFilter ? [draftOrderTagFilter] : []),
  ];

  return (
    <s-page
      heading={
        context === "search" ? "Search filters" : "Collection filters"
      }
    >
      <style>{`
        .collection-filters-drag-handle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          color: #8a8a8a;
          cursor: grab;
          user-select: none;
          touch-action: none;
        }
        .collection-filters-drag-handle:active {
          cursor: grabbing;
        }
        s-table-row {
          transition: box-shadow 0.12s ease, opacity 0.12s ease, background-color 0.12s ease;
        }
        .collection-filters-row--dragging {
          opacity: 0.4;
          background: rgba(0, 0, 0, 0.04);
        }
        .collection-filters-row--drag-over {
          box-shadow: inset 0 2px 0 0 #1a1a1a;
        }
      `}</style>
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
          id="filters-save-bar"
          dirty={dirty}
          saving={isSaving}
          onSave={() => handleSave()}
          onDiscard={handleDiscard}
        />
      )}

      <FilterTabsNav
        active="tree"
        context={context}
        onSwitchContext={onSwitchContext}
        endAction={<FilterPagePreviewButton id="filters-preview" variant="primary" />}
      />

      <s-stack direction="block" gap="base">
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
      <s-stack direction="block" gap="base">
      <s-section padding="none">
        <s-box padding="base">
          <HeadingWithTip
            tip={`Choose which fields shoppers can filter by${
              context === "search"
                ? " on your search results page."
                : " on your collection and all-products pages."
            }`}
            paddingBlockEnd="none"
          >
            Filterable fields
          </HeadingWithTip>

          {metafieldLimitReached && (
            <s-paragraph tone="critical">
              You've enabled {MAX_METAFIELD_FILTERS} metafield filters, the
              maximum allowed. Remove one before enabling another.
            </s-paragraph>
          )}
        </s-box>

          <s-table>
            <s-table-header-row>
              <s-table-header>Action</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Label</s-table-header>
              <s-table-header>Type</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {selectedOrder
                .map((fieldKey) => availableFields.find((f) => f.fieldKey === fieldKey))
                .filter(Boolean)
                .map((field) => {
                return (
                  <s-table-row
                    key={field.fieldKey}
                    data-field-row={field.fieldKey}
                    className={[
                      draggedFieldKey === field.fieldKey
                        ? "collection-filters-row--dragging"
                        : "",
                      dragOverFieldKey === field.fieldKey
                        ? "collection-filters-row--drag-over"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    onDragOver={handleRowDragOver(field.fieldKey)}
                    onDrop={handleRowDrop(field.fieldKey)}
                  >
                    <s-table-cell>
                      <span
                        className="collection-filters-drag-handle"
                        draggable="true"
                        role="button"
                        tabIndex={-1}
                        aria-label={`Drag to reorder ${field.label}`}
                        onDragStart={handleRowDragStart(field.fieldKey)}
                        onDragEnd={handleRowDragEnd}
                      >
                        ⠿
                      </span>
                    </s-table-cell>
                    <s-table-cell>
                      <s-switch
                        label={`Enable ${field.label}`}
                        labelAccessibilityVisibility="exclusive"
                        checked
                        onChange={() => toggleField(field.fieldKey)}
                      />
                    </s-table-cell>
                    <s-table-cell>{field.label}</s-table-cell>
                    <s-table-cell>{field.fieldType}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
      </s-section>
      </s-stack>

      <s-box position="sticky" style={{ top: "16px" }}>
        <s-section padding="none">
          <s-box padding="base">
            <s-heading>Disabled filters</s-heading>
          </s-box>
          {disabledFields.length === 0 ? (
            <s-box padding="base" paddingBlockStart="none">
              <s-paragraph tone="subdued">
                All available fields are currently enabled.
              </s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Status</s-table-header>
                <s-table-header>Label</s-table-header>
                <s-table-header>Type</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {disabledFields.map((field) => (
                  <s-table-row key={field.fieldKey}>
                    <s-table-cell>
                      <s-switch
                        label={`Enable ${field.label}`}
                        labelAccessibilityVisibility="exclusive"
                        checked={false}
                        disabled={
                          field.fieldType === "metafield" && metafieldLimitReached
                        }
                        onChange={() => toggleField(field.fieldKey)}
                      />
                    </s-table-cell>
                    <s-table-cell>{field.label}</s-table-cell>
                    <s-table-cell>{field.fieldType}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      </s-box>
      </s-grid>

      <s-section padding="none">
        <s-box padding="base" paddingBlockEnd="none">
          <HeadingWithTip tip={'Create extra filters by order tag prefix — for example, if your products carry order-derived tags like "season_summer" or "collection_new", add a filter with prefix "season_" to build a Season filter (shown as "summer"), and another with prefix "collection_" for a Collection filter.'}>
            Order tag filter
          </HeadingWithTip>
        </s-box>

        {orderTagFilters.length > 0 && (
          <s-table>
              <s-table-header-row>
                <s-table-header>Label</s-table-header>
                <s-table-header>Display type</s-table-header>
                <s-table-header>Select</s-table-header>
                <s-table-header>Prefix</s-table-header>
                <s-table-header format="numeric">Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {orderTagFilters.map((filter) => (
                  <s-table-row key={filter.fieldKey}>
                    <s-table-cell>{filter.label}</s-table-cell>
                    <s-table-cell>
                      {filter.displayType === "swatch" ? "Swatch" : "List"}
                    </s-table-cell>
                    <s-table-cell>
                      {filter.selectMode === "single" ? "Single" : "Multiple"}
                    </s-table-cell>
                    <s-table-cell>{filter.valuePrefix}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="tight" justifyContent="end">
                        <s-button
                          variant="tertiary"
                          icon="edit"
                          accessibilityLabel={`Edit ${filter.label}`}
                          onClick={() => {
                            setEditingOrderTagFieldKey(filter.fieldKey);
                            setOrderTagFilterForm({
                              label: filter.label,
                              displayType: filter.displayType,
                              selectMode: filter.selectMode,
                              valuePrefix: filter.valuePrefix,
                            });
                            setOrderTagFilterFormTouched(false);
                            document.getElementById("ordertag-filter-modal")?.showOverlay();
                          }}
                        ></s-button>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          icon="delete"
                          accessibilityLabel={`Remove ${filter.label}`}
                          disabled={deletingOrderTagFieldKey === filter.fieldKey}
                          onClick={() => handleDeleteOrderTagFilter(filter.fieldKey)}
                        ></s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
        )}

        <s-box paddingInline="base" paddingBlockStart="small-300" paddingBlockEnd="base">
          <s-stack direction="block" gap="tight">
            {orderTagPrefixLimitReached && (
              <s-paragraph tone="critical">
                You've added {MAX_ORDERTAG_PREFIX_FILTERS} order tag filters, the
                maximum allowed. Remove one above before adding another.
              </s-paragraph>
            )}
            <s-button
              variant="primary"
              disabled={orderTagPrefixLimitReached}
              onClick={() => {
                setEditingOrderTagFieldKey(null);
                setOrderTagFilterForm(EMPTY_ORDERTAG_FILTER_FORM);
                setOrderTagFilterFormTouched(false);
                document.getElementById("ordertag-filter-modal")?.showOverlay();
              }}
            >
              + Add filter option
            </s-button>
          </s-stack>
        </s-box>
      </s-section>
      </s-stack>

      {mountedModals && (
        <s-modal
          id="ordertag-filter-modal"
          heading={editingOrderTagFieldKey ? "Edit filter option" : "Add filter option"}
        >
          {orderTagFilterForm && (
            <s-stack
              direction="block"
              gap="base"
              key={editingOrderTagFieldKey || "new-ordertag-filter"}
            >
              {isSaving && (
                <s-banner tone="info">
                  Still saving your last change — you can keep filling this
                  form, but Save will be enabled once that finishes.
                </s-banner>
              )}
              <s-text-field
                ref={seedOrderTagLabelRef}
                label="Option label"
                required
                error={
                  orderTagFilterFormTouched && !orderTagLabelRef.current?.value?.trim()
                    ? "Enter an option label"
                    : undefined
                }
              />
              <s-select ref={seedOrderTagDisplayTypeRef} label="Option display">
                <s-option value="list">List</s-option>
                <s-option value="swatch">Swatch</s-option>
              </s-select>
              <s-select ref={seedOrderTagSelectModeRef} label="Option select">
                <s-option value="multiple">Multiple</s-option>
                <s-option value="single">Single</s-option>
              </s-select>
              <s-text-field
                ref={seedOrderTagValuePrefixRef}
                label="Tag prefix"
                placeholder="e.g. season_"
                required
                error={
                  orderTagFilterFormTouched && !orderTagValuePrefixRef.current?.value?.trim()
                    ? "Enter a tag prefix"
                    : undefined
                }
              />
              <s-paragraph tone="subdued">
                Only tags starting with this prefix will appear as values for
                this filter, shown with the prefix removed.
              </s-paragraph>
              <s-stack direction="inline" gap="base" justifyContent="end">
                <s-button
                  type="button"
                  onClick={() => {
                    setOrderTagFilterForm(null);
                    setEditingOrderTagFieldKey(null);
                    setOrderTagFilterFormTouched(false);
                    document.getElementById("ordertag-filter-modal")?.hideOverlay();
                  }}
                >
                  Cancel
                </s-button>
                <s-button
                  variant="primary"
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    handleSaveOrderTagFilter();
                  }}
                >
                  {isSaving ? "Saving…" : "Save option"}
                </s-button>
              </s-stack>
            </s-stack>
          )}
        </s-modal>
      )}

      <FilterPagePreviewModal
        id="filters-preview"
        fields={previewFields}
        filterLayout={contextSettings?.filterLayout || "vertical"}
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
