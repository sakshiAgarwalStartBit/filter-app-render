import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { HeadingWithTip } from "../help-tip";
import { SettingsSaveBar } from "../settings-save-bar";
import { RouteErrorBoundary } from "../route-error-boundary";
import { DesktopFilterLayout } from "../filter-page-preview";

const TEXT_TRANSFORMS = ["none", "capitalize", "uppercase", "lowercase"];
const MIN_GRID_COLUMNS = 2;
const MAX_GRID_COLUMNS = 6;
const SWATCH_SHAPES = ["circle", "square"];
const VALID_CONTEXTS = ["collection", "search"];
const MAX_CUSTOM_CSS_LENGTH = 20000;

function clampGridColumns(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(MAX_GRID_COLUMNS, Math.max(MIN_GRID_COLUMNS, Math.round(parsed)));
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const contextParam = url.searchParams.get("context");
  const context = VALID_CONTEXTS.includes(contextParam) ? contextParam : "collection";

  const [shopSettings, savedConfigs, contextSettings] = await Promise.all([
    prisma.shopSettings.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.filterConfig.findMany({
      where: { shop, context },
      orderBy: { position: "asc" },
    }),
    prisma.filterContextSettings.findUnique({
      where: { shop_context: { shop, context } },
    }),
  ]);

  return {
    shopSettings,
    savedConfigs,
    filterLayout: contextSettings?.filterLayout || "vertical",
    context,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const {
    values,
    headings,
    clearButton,
    toggleButton,
    sidebar,
    productGrid,
    swatches,
    addToCartCollection,
    addToCartSearch,
    customCss,
  } = await request.json();

  const transform = (value) =>
    TEXT_TRANSFORMS.includes(value) ? value : "none";

  await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  await prisma.shopSettings.update({
    where: { shop },
    data: {
      valueFontSize: Number(values.fontSize) || 14,
      valueFontWeight: Number(values.fontWeight) || 400,
      valueTextTransform: transform(values.textTransform),
      valueTextColor: values.textColor || "#3A3A3A",

      headingFontSize: Number(headings.fontSize) || 16,
      headingFontWeight: Number(headings.fontWeight) || 600,
      headingTextTransform: transform(headings.textTransform),
      headingTextColor: headings.textColor || "#1A1A1A",

      buttonFontSize: Number(clearButton.fontSize) || 14,
      buttonFontWeight: Number(clearButton.fontWeight) || 700,
      buttonBorderRadius: Number(clearButton.borderRadius) || 0,
      buttonTextTransform: transform(clearButton.textTransform),
      buttonTextColor: clearButton.textColor || "#3A3A3A",
      buttonBorderColor: clearButton.borderColor || "#BFBFBF",
      buttonBackgroundColor: clearButton.backgroundColor || "#FFFFFF",

      toggleFontSize: Number(toggleButton.fontSize) || 16,
      toggleFontWeight: Number(toggleButton.fontWeight) || 700,
      toggleBorderRadius: Number(toggleButton.borderRadius) || 6,
      toggleTextTransform: transform(toggleButton.textTransform),
      toggleTextColor: toggleButton.textColor || "#1A1A1A",
      toggleBorderColor: toggleButton.borderColor || "#D1D1D1",
      toggleBackgroundColor: toggleButton.backgroundColor || "#FFFFFF",

      sidebarBackgroundColor: sidebar?.backgroundColor || "#F5F5F5",

      productGridColumns: clampGridColumns(productGrid?.columns),

      swatchShape: SWATCH_SHAPES.includes(swatches?.shape) ? swatches.shape : "circle",

      addToCartCollectionBackgroundColor: addToCartCollection?.backgroundColor || "#1A1A1A",
      addToCartCollectionTextColor: addToCartCollection?.textColor || "#FFFFFF",
      addToCartCollectionFontSize: Number(addToCartCollection?.fontSize) || 14,

      addToCartSearchBackgroundColor: addToCartSearch?.backgroundColor || "#1A1A1A",
      addToCartSearchTextColor: addToCartSearch?.textColor || "#FFFFFF",
      addToCartSearchFontSize: Number(addToCartSearch?.fontSize) || 14,

      customCssCollection: String(customCss?.collection || "").slice(0, MAX_CUSTOM_CSS_LENGTH),
      customCssSearch: String(customCss?.search || "").slice(0, MAX_CUSTOM_CSS_LENGTH),
    },
  });

  return { ok: true };
};

function FontWeightSelect({ label, value, onChange }) {
  return (
    <s-select label={label} value={value} onChange={onChange}>
      <s-option value="400">Regular</s-option>
      <s-option value="500">Medium</s-option>
      <s-option value="600">Semibold</s-option>
      <s-option value="700">Bold</s-option>
    </s-select>
  );
}

function TextTransformSelect({ label, value, onChange }) {
  return (
    <s-select label={label} value={value} onChange={onChange}>
      <s-option value="none">None</s-option>
      <s-option value="capitalize">Capitalize</s-option>
      <s-option value="uppercase">Uppercase</s-option>
      <s-option value="lowercase">Lowercase</s-option>
    </s-select>
  );
}

function initialFieldsFrom(shopSettings) {
  return {
    valueFontSize: shopSettings.valueFontSize,
    valueFontWeight: String(shopSettings.valueFontWeight),
    valueTextTransform: shopSettings.valueTextTransform,
    valueTextColor: shopSettings.valueTextColor,

    headingFontSize: shopSettings.headingFontSize,
    headingFontWeight: String(shopSettings.headingFontWeight),
    headingTextTransform: shopSettings.headingTextTransform,
    headingTextColor: shopSettings.headingTextColor,

    buttonFontSize: shopSettings.buttonFontSize,
    buttonFontWeight: String(shopSettings.buttonFontWeight),
    buttonBorderRadius: shopSettings.buttonBorderRadius,
    buttonTextTransform: shopSettings.buttonTextTransform,
    buttonTextColor: shopSettings.buttonTextColor,
    buttonBorderColor: shopSettings.buttonBorderColor,
    buttonBackgroundColor: shopSettings.buttonBackgroundColor,

    toggleFontSize: shopSettings.toggleFontSize,
    toggleFontWeight: String(shopSettings.toggleFontWeight),
    toggleBorderRadius: shopSettings.toggleBorderRadius,
    toggleTextTransform: shopSettings.toggleTextTransform,
    toggleTextColor: shopSettings.toggleTextColor,
    toggleBorderColor: shopSettings.toggleBorderColor,
    toggleBackgroundColor: shopSettings.toggleBackgroundColor,

    sidebarBackgroundColor: shopSettings.sidebarBackgroundColor || "#F5F5F5",
    productGridColumns: shopSettings.productGridColumns || 4,
    swatchShape: shopSettings.swatchShape || "circle",

    addToCartCollectionBackgroundColor:
      shopSettings.addToCartCollectionBackgroundColor || "#1A1A1A",
    addToCartCollectionTextColor: shopSettings.addToCartCollectionTextColor || "#FFFFFF",
    addToCartCollectionFontSize: shopSettings.addToCartCollectionFontSize || 14,

    addToCartSearchBackgroundColor:
      shopSettings.addToCartSearchBackgroundColor || "#1A1A1A",
    addToCartSearchTextColor: shopSettings.addToCartSearchTextColor || "#FFFFFF",
    addToCartSearchFontSize: shopSettings.addToCartSearchFontSize || 14,

    customCssCollection: shopSettings.customCssCollection || "",
    customCssSearch: shopSettings.customCssSearch || "",
  };
}

export default function Style() {
  const { shopSettings, savedConfigs, filterLayout } = useLoaderData();
  const previewFields = savedConfigs;
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  // App Bridge's SaveBar only works in the app's own top-level frame. When
  // this page is loaded inside a ui-modal (e.g. the Filters page's
  // "Customizer" popup), it runs in a nested iframe where SaveBar throws
  // ("e.hide is not a function") — so that case instead reports its
  // dirty/saving state to the popup shell (customizer-popup.jsx) over a
  // BroadcastChannel, which renders Save/Discard in its own outer TitleBar
  // next to the modal's Close icon, and sends save/discard commands back the
  // same way. BroadcastChannel is used instead of window.postMessage because
  // this iframe isn't reliably reachable as window.parent from here (App
  // Bridge's ui-modal may render the src iframe outside of the shell
  // component's own place in the DOM tree) — BroadcastChannel only needs a
  // shared origin, not a window reference. Note: the param is named "popup"
  // (not "embedded") because "embedded" is a reserved Shopify App Bridge
  // query param that the auth middleware rewrites during its own redirects,
  // which silently wiped a custom "embedded" value here.
  const [searchParams] = useSearchParams();
  const isModalEmbed = searchParams.get("popup") === "1";

  const initialFields = useMemo(() => initialFieldsFrom(shopSettings), [shopSettings]);

  const [valueFontSize, setValueFontSize] = useState(initialFields.valueFontSize);
  const [valueFontWeight, setValueFontWeight] = useState(initialFields.valueFontWeight);
  const [valueTextTransform, setValueTextTransform] = useState(
    initialFields.valueTextTransform,
  );
  const [valueTextColor, setValueTextColor] = useState(initialFields.valueTextColor);

  const [headingFontSize, setHeadingFontSize] = useState(initialFields.headingFontSize);
  const [headingFontWeight, setHeadingFontWeight] = useState(
    initialFields.headingFontWeight,
  );
  const [headingTextTransform, setHeadingTextTransform] = useState(
    initialFields.headingTextTransform,
  );
  const [headingTextColor, setHeadingTextColor] = useState(
    initialFields.headingTextColor,
  );

  const [buttonFontSize, setButtonFontSize] = useState(initialFields.buttonFontSize);
  const [buttonFontWeight, setButtonFontWeight] = useState(
    initialFields.buttonFontWeight,
  );
  const [buttonBorderRadius, setButtonBorderRadius] = useState(
    initialFields.buttonBorderRadius,
  );
  const [buttonTextTransform, setButtonTextTransform] = useState(
    initialFields.buttonTextTransform,
  );
  const [buttonTextColor, setButtonTextColor] = useState(initialFields.buttonTextColor);
  const [buttonBorderColor, setButtonBorderColor] = useState(
    initialFields.buttonBorderColor,
  );
  const [buttonBackgroundColor, setButtonBackgroundColor] = useState(
    initialFields.buttonBackgroundColor,
  );

  const [toggleFontSize, setToggleFontSize] = useState(initialFields.toggleFontSize);
  const [toggleFontWeight, setToggleFontWeight] = useState(
    initialFields.toggleFontWeight,
  );
  const [toggleBorderRadius, setToggleBorderRadius] = useState(
    initialFields.toggleBorderRadius,
  );
  const [toggleTextTransform, setToggleTextTransform] = useState(
    initialFields.toggleTextTransform,
  );
  const [toggleTextColor, setToggleTextColor] = useState(initialFields.toggleTextColor);
  const [toggleBorderColor, setToggleBorderColor] = useState(
    initialFields.toggleBorderColor,
  );
  const [toggleBackgroundColor, setToggleBackgroundColor] = useState(
    initialFields.toggleBackgroundColor,
  );

  const [sidebarBackgroundColor, setSidebarBackgroundColor] = useState(
    initialFields.sidebarBackgroundColor,
  );

  const [productGridColumns, setProductGridColumns] = useState(
    initialFields.productGridColumns,
  );

  const [swatchShape, setSwatchShape] = useState(initialFields.swatchShape);

  const [addToCartCollectionBackgroundColor, setAddToCartCollectionBackgroundColor] =
    useState(initialFields.addToCartCollectionBackgroundColor);
  const [addToCartCollectionTextColor, setAddToCartCollectionTextColor] = useState(
    initialFields.addToCartCollectionTextColor,
  );
  const [addToCartCollectionFontSize, setAddToCartCollectionFontSize] = useState(
    initialFields.addToCartCollectionFontSize,
  );

  const [addToCartSearchBackgroundColor, setAddToCartSearchBackgroundColor] = useState(
    initialFields.addToCartSearchBackgroundColor,
  );
  const [addToCartSearchTextColor, setAddToCartSearchTextColor] = useState(
    initialFields.addToCartSearchTextColor,
  );
  const [addToCartSearchFontSize, setAddToCartSearchFontSize] = useState(
    initialFields.addToCartSearchFontSize,
  );

  const [customCssCollection, setCustomCssCollection] = useState(
    initialFields.customCssCollection,
  );
  const [customCssSearch, setCustomCssSearch] = useState(initialFields.customCssSearch);

  const isSaving = fetcher.state !== "idle";

  const currentFields = {
    valueFontSize,
    valueFontWeight,
    valueTextTransform,
    valueTextColor,
    headingFontSize,
    headingFontWeight,
    headingTextTransform,
    headingTextColor,
    buttonFontSize,
    buttonFontWeight,
    buttonBorderRadius,
    buttonTextTransform,
    buttonTextColor,
    buttonBorderColor,
    buttonBackgroundColor,
    toggleFontSize,
    toggleFontWeight,
    toggleBorderRadius,
    toggleTextTransform,
    toggleTextColor,
    toggleBorderColor,
    toggleBackgroundColor,
    sidebarBackgroundColor,
    productGridColumns,
    swatchShape,
    addToCartCollectionBackgroundColor,
    addToCartCollectionTextColor,
    addToCartCollectionFontSize,
    addToCartSearchBackgroundColor,
    addToCartSearchTextColor,
    addToCartSearchFontSize,
    customCssCollection,
    customCssSearch,
  };
  const [savedFields, setSavedFields] = useState(initialFields);

  const dirty =
    JSON.stringify(currentFields) !== JSON.stringify(savedFields);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Style saved");
      setSavedFields(currentFields);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, shopify]);

  const handleSave = () => {
    fetcher.submit(
      {
        values: {
          fontSize: Number(valueFontSize),
          fontWeight: Number(valueFontWeight),
          textTransform: valueTextTransform,
          textColor: valueTextColor,
        },
        headings: {
          fontSize: Number(headingFontSize),
          fontWeight: Number(headingFontWeight),
          textTransform: headingTextTransform,
          textColor: headingTextColor,
        },
        clearButton: {
          fontSize: Number(buttonFontSize),
          fontWeight: Number(buttonFontWeight),
          borderRadius: Number(buttonBorderRadius),
          textTransform: buttonTextTransform,
          textColor: buttonTextColor,
          borderColor: buttonBorderColor,
          backgroundColor: buttonBackgroundColor,
        },
        toggleButton: {
          fontSize: Number(toggleFontSize),
          fontWeight: Number(toggleFontWeight),
          borderRadius: Number(toggleBorderRadius),
          textTransform: toggleTextTransform,
          textColor: toggleTextColor,
          borderColor: toggleBorderColor,
          backgroundColor: toggleBackgroundColor,
        },
        sidebar: {
          backgroundColor: sidebarBackgroundColor,
        },
        productGrid: {
          columns: Number(productGridColumns),
        },
        swatches: {
          shape: swatchShape,
        },
        addToCartCollection: {
          backgroundColor: addToCartCollectionBackgroundColor,
          textColor: addToCartCollectionTextColor,
          fontSize: Number(addToCartCollectionFontSize),
        },
        addToCartSearch: {
          backgroundColor: addToCartSearchBackgroundColor,
          textColor: addToCartSearchTextColor,
          fontSize: Number(addToCartSearchFontSize),
        },
        customCss: {
          collection: customCssCollection,
          search: customCssSearch,
        },
      },
      { method: "POST", encType: "application/json" },
    );
  };

  const handleDiscard = () => {
    setValueFontSize(savedFields.valueFontSize);
    setValueFontWeight(savedFields.valueFontWeight);
    setValueTextTransform(savedFields.valueTextTransform);
    setValueTextColor(savedFields.valueTextColor);

    setHeadingFontSize(savedFields.headingFontSize);
    setHeadingFontWeight(savedFields.headingFontWeight);
    setHeadingTextTransform(savedFields.headingTextTransform);
    setHeadingTextColor(savedFields.headingTextColor);

    setButtonFontSize(savedFields.buttonFontSize);
    setButtonFontWeight(savedFields.buttonFontWeight);
    setButtonBorderRadius(savedFields.buttonBorderRadius);
    setButtonTextTransform(savedFields.buttonTextTransform);
    setButtonTextColor(savedFields.buttonTextColor);
    setButtonBorderColor(savedFields.buttonBorderColor);
    setButtonBackgroundColor(savedFields.buttonBackgroundColor);

    setToggleFontSize(savedFields.toggleFontSize);
    setToggleFontWeight(savedFields.toggleFontWeight);
    setToggleBorderRadius(savedFields.toggleBorderRadius);
    setToggleTextTransform(savedFields.toggleTextTransform);
    setToggleTextColor(savedFields.toggleTextColor);
    setToggleBorderColor(savedFields.toggleBorderColor);
    setToggleBackgroundColor(savedFields.toggleBackgroundColor);

    setSidebarBackgroundColor(savedFields.sidebarBackgroundColor);
    setProductGridColumns(savedFields.productGridColumns);
    setSwatchShape(savedFields.swatchShape);

    setAddToCartCollectionBackgroundColor(savedFields.addToCartCollectionBackgroundColor);
    setAddToCartCollectionTextColor(savedFields.addToCartCollectionTextColor);
    setAddToCartCollectionFontSize(savedFields.addToCartCollectionFontSize);

    setAddToCartSearchBackgroundColor(savedFields.addToCartSearchBackgroundColor);
    setAddToCartSearchTextColor(savedFields.addToCartSearchTextColor);
    setAddToCartSearchFontSize(savedFields.addToCartSearchFontSize);

    setCustomCssCollection(savedFields.customCssCollection);
    setCustomCssSearch(savedFields.customCssSearch);
  };

  // When embedded in the Customizer popup, report dirty/saving state up to
  // the popup shell so it can show Save/Discard in its own TitleBar, and
  // listen for the shell relaying clicks on those buttons back down here.
  // See customizer-popup.jsx for why this uses BroadcastChannel rather than
  // window.postMessage.
  useEffect(() => {
    if (!isModalEmbed) return;
    const channel = new BroadcastChannel("sb-customizer-popup");
    channel.postMessage({ type: "state", dirty, saving: isSaving });
    return () => channel.close();
  }, [isModalEmbed, dirty, isSaving]);

  useEffect(() => {
    if (!isModalEmbed) return;
    const channel = new BroadcastChannel("sb-customizer-popup");
    channel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "action") return;
      if (data.action === "save") handleSave();
      if (data.action === "discard") handleDiscard();
    };
    return () => channel.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalEmbed, handleSave, handleDiscard]);

  return (
    <s-page heading="Customize" inlineSize="large">
      {!isModalEmbed && (
        <SettingsSaveBar
          id="style-save-bar"
          dirty={dirty}
          saving={isSaving}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 1fr) 2fr",
          gap: "16px",
        }}
      >
        <s-stack direction="block" gap="base">
          <s-section>
            <HeadingWithTip tip="Background color for the filter panel/sidebar itself, so it stands out from the page background.">
              Filter panel
            </HeadingWithTip>
            <s-color-field
              label="Background color"
              value={sidebarBackgroundColor}
              onChange={(e) => setSidebarBackgroundColor(e.target.value)}
            />
          </s-section>

          <s-section>
            <HeadingWithTip
              tip="Shape of the color swatches shown in the filter panel."
              paddingBlockEnd="5px"
            >
              Color swatches
            </HeadingWithTip>
            <s-choice-list
              name="swatch-shape"
              onChange={(e) => setSwatchShape(e.currentTarget.values[0])}
            >
              {SWATCH_SHAPES.map((shape) => (
                <s-choice
                  key={shape}
                  value={shape}
                  selected={swatchShape === shape}
                >
                  {shape === "circle" ? "Circle" : "Square"}
                </s-choice>
              ))}
            </s-choice-list>
          </s-section>

          <s-section>
            <HeadingWithTip tip="Number of products shown per row on the collection and search results pages. Applies to both Collection filters and Search filters.">
              Product grid
            </HeadingWithTip>
            <s-select
              label="Products per row"
              value={String(productGridColumns)}
              onChange={(e) => setProductGridColumns(e.target.value)}
            >
              <s-option value="2">2</s-option>
              <s-option value="3">3</s-option>
              <s-option value="4">4</s-option>
              <s-option value="5">5</s-option>
              <s-option value="6">6</s-option>
            </s-select>
          </s-section>

          <s-section>
            <HeadingWithTip tip="Text style for the checkboxes and values inside each filter group.">
              Filter values
            </HeadingWithTip>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-text-field
                label="Font size"
                type="number"
                value={String(valueFontSize)}
                onChange={(e) => setValueFontSize(e.target.value)}
              />
              <FontWeightSelect
                label="Font weight"
                value={valueFontWeight}
                onChange={(e) => setValueFontWeight(e.target.value)}
              />
              <TextTransformSelect
                label="Text transform"
                value={valueTextTransform}
                onChange={(e) => setValueTextTransform(e.target.value)}
              />
              <s-color-field
                label="Text color"
                value={valueTextColor}
                onChange={(e) => setValueTextColor(e.target.value)}
              />
            </s-grid>
          </s-section>

          <s-section>
            <HeadingWithTip tip={'Text style for each filter group\'s title (e.g. "Color", "Price").'}>
              Filter headings
            </HeadingWithTip>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-text-field
                label="Font size"
                type="number"
                value={String(headingFontSize)}
                onChange={(e) => setHeadingFontSize(e.target.value)}
              />
              <FontWeightSelect
                label="Font weight"
                value={headingFontWeight}
                onChange={(e) => setHeadingFontWeight(e.target.value)}
              />
              <TextTransformSelect
                label="Text transform"
                value={headingTextTransform}
                onChange={(e) => setHeadingTextTransform(e.target.value)}
              />
              <s-color-field
                label="Text color"
                value={headingTextColor}
                onChange={(e) => setHeadingTextColor(e.target.value)}
              />
            </s-grid>
          </s-section>

          <s-section>
            <HeadingWithTip tip={'Style the "Clear all" button shown in the filter panel.'}>
              Clear all button
            </HeadingWithTip>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-text-field
                label="Font size"
                type="number"
                value={String(buttonFontSize)}
                onChange={(e) => setButtonFontSize(e.target.value)}
              />
              <FontWeightSelect
                label="Font weight"
                value={buttonFontWeight}
                onChange={(e) => setButtonFontWeight(e.target.value)}
              />
              <s-text-field
                label="Border radius"
                type="number"
                value={String(buttonBorderRadius)}
                onChange={(e) => setButtonBorderRadius(e.target.value)}
              />
              <TextTransformSelect
                label="Text transform"
                value={buttonTextTransform}
                onChange={(e) => setButtonTextTransform(e.target.value)}
              />
              <s-color-field
                label="Text color"
                value={buttonTextColor}
                onChange={(e) => setButtonTextColor(e.target.value)}
              />
              <s-color-field
                label="Border color"
                value={buttonBorderColor}
                onChange={(e) => setButtonBorderColor(e.target.value)}
              />
              <s-color-field
                label="Background color"
                value={buttonBackgroundColor}
                onChange={(e) => setButtonBackgroundColor(e.target.value)}
              />
            </s-grid>
          </s-section>

          <s-section>
            <HeadingWithTip tip={'Style the "Filters" button shown in Drawer layout mode.'}>
              Filters toggle button
            </HeadingWithTip>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-text-field
                label="Font size"
                type="number"
                value={String(toggleFontSize)}
                onChange={(e) => setToggleFontSize(e.target.value)}
              />
              <FontWeightSelect
                label="Font weight"
                value={toggleFontWeight}
                onChange={(e) => setToggleFontWeight(e.target.value)}
              />
              <s-text-field
                label="Border radius"
                type="number"
                value={String(toggleBorderRadius)}
                onChange={(e) => setToggleBorderRadius(e.target.value)}
              />
              <TextTransformSelect
                label="Text transform"
                value={toggleTextTransform}
                onChange={(e) => setToggleTextTransform(e.target.value)}
              />
              <s-color-field
                label="Text color"
                value={toggleTextColor}
                onChange={(e) => setToggleTextColor(e.target.value)}
              />
              <s-color-field
                label="Border color"
                value={toggleBorderColor}
                onChange={(e) => setToggleBorderColor(e.target.value)}
              />
              <s-color-field
                label="Background color"
                value={toggleBackgroundColor}
                onChange={(e) => setToggleBackgroundColor(e.target.value)}
              />
            </s-grid>
          </s-section>

          <s-section>
            <HeadingWithTip tip="Style the product grid's Add to cart button on the collection filter.">
              Add to cart button (Collection filter)
            </HeadingWithTip>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-text-field
                label="Font size"
                type="number"
                value={String(addToCartCollectionFontSize)}
                onChange={(e) => setAddToCartCollectionFontSize(e.target.value)}
              />
              <s-color-field
                label="Text color"
                value={addToCartCollectionTextColor}
                onChange={(e) => setAddToCartCollectionTextColor(e.target.value)}
              />
              <s-color-field
                label="Background color"
                value={addToCartCollectionBackgroundColor}
                onChange={(e) => setAddToCartCollectionBackgroundColor(e.target.value)}
              />
            </s-grid>
          </s-section>

          <s-section>
            <HeadingWithTip tip="Style the product grid's Add to cart button on the search filter.">
              Add to cart button (Search filter)
            </HeadingWithTip>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-text-field
                label="Font size"
                type="number"
                value={String(addToCartSearchFontSize)}
                onChange={(e) => setAddToCartSearchFontSize(e.target.value)}
              />
              <s-color-field
                label="Text color"
                value={addToCartSearchTextColor}
                onChange={(e) => setAddToCartSearchTextColor(e.target.value)}
              />
              <s-color-field
                label="Background color"
                value={addToCartSearchBackgroundColor}
                onChange={(e) => setAddToCartSearchBackgroundColor(e.target.value)}
              />
            </s-grid>
          </s-section>

        </s-stack>

        <s-stack direction="block" gap="base">
          <s-box position="sticky" style={{ top: "16px" }}>
            <s-section heading="Preview">
              <DesktopFilterLayout
              fields={previewFields}
              filterLayout={filterLayout}
              styleVars={{
                headingFontSize,
                headingFontWeight,
                headingTextTransform,
                headingTextColor,
                valueFontSize,
                valueFontWeight,
                valueTextTransform,
                valueTextColor,
              }}
              buttonStyle={{
                fontSize: `${buttonFontSize}px`,
                fontWeight: buttonFontWeight,
                textTransform: buttonTextTransform,
                color: buttonTextColor,
                borderRadius: `${buttonBorderRadius}px`,
                border: `1px solid ${buttonBorderColor}`,
                background: buttonBackgroundColor,
              }}
              toggleButtonStyle={{
                fontSize: `${toggleFontSize}px`,
                fontWeight: toggleFontWeight,
                textTransform: toggleTextTransform,
                color: toggleTextColor,
                borderRadius: `${toggleBorderRadius}px`,
                border: `1px solid ${toggleBorderColor}`,
                background: toggleBackgroundColor,
              }}
              sidebarBackgroundColor={sidebarBackgroundColor}
              productGridColumns={productGridColumns}
              swatchShape={swatchShape}
              />
            </s-section>
          </s-box>

          <s-stack direction="inline" gap="base">
            <s-box inlineSize="100%">
              <s-section heading="Custom CSS (Collection filter)">
                <s-text-area
                  label="CSS"
                  labelAccessibilityVisibility="exclusive"
                  rows={10}
                  value={customCssCollection}
                  placeholder={".collection-filters-app__add-to-cart {\n  background: #000;\n}"}
                  onChange={(e) => setCustomCssCollection(e.target.value)}
                />
              </s-section>
            </s-box>
            <s-box inlineSize="100%">
              <s-section heading="Custom CSS (Search filter)">
                <s-text-area
                  label="CSS"
                  labelAccessibilityVisibility="exclusive"
                  rows={10}
                  value={customCssSearch}
                  placeholder={".collection-filters-app__add-to-cart {\n  background: #000;\n}"}
                  onChange={(e) => setCustomCssSearch(e.target.value)}
                />
              </s-section>
            </s-box>
          </s-stack>
        </s-stack>
      </div>
    </s-page>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
