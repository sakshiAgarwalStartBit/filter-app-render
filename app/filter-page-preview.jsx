import { useEffect, useState } from "react";

const SAMPLE_VALUES_BY_FIELD_TYPE = {
  available: ["In stock", "Out of stock"],
  vendor: ["Acme Co.", "Northwind"],
  product_type: ["Shirts", "Shoes"],
  category: ["Apparel", "Footwear"],
  review_rating: ["★★★★★ & up", "★★★★ & up"],
};

const SAMPLE_COLOR_SWATCHES = [
  { label: "Black", color: "#1a1a1a" },
  { label: "White", color: "#ffffff" },
  { label: "Blue", color: "#3b6bd1" },
  { label: "Green", color: "#2f9e44" },
];

// Generic placeholder fields for previews that aren't tied to a shop's
// actual configured filters (e.g. the Layout & display page, which previews
// layout structure rather than filter content).
const GENERIC_PREVIEW_FIELDS = [
  { fieldKey: "price", label: "Price", fieldType: "standard", selectMode: "range" },
  { fieldKey: "available", label: "Availability", fieldType: "standard", selectMode: "multiple" },
  { fieldKey: "vendor", label: "Vendor", fieldType: "standard", selectMode: "multiple" },
  { fieldKey: "product_type", label: "Product type", fieldType: "standard", selectMode: "multiple" },
  { fieldKey: "color", label: "Color", fieldType: "standard", selectMode: "multiple", displayType: "swatch" },
];

function sampleValuesFor(field) {
  if (
    field.fieldKey === "tag" ||
    (field.fieldType === "standard" &&
      (field.fieldKey.startsWith("tag:") || field.fieldKey.startsWith("ordertag:")))
  ) {
    return ["Sample 1", "Sample 2"];
  }
  return SAMPLE_VALUES_BY_FIELD_TYPE[field.fieldKey] || ["Sample 1", "Sample 2"];
}

function PriceRangePreview() {
  return (
    <div style={{ paddingTop: "4px" }}>
      <div style={{ position: "relative", height: "20px", padding: "0 8px" }}>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "8px",
            width: "calc(100% - 16px)",
            height: "3px",
            transform: "translateY(-50%)",
            background: "#000",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "8px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "#fff",
            border: "2px solid #1a1a1a",
            transform: "translate(-2px, -50%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            right: "8px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "#fff",
            border: "2px solid #1a1a1a",
            transform: "translate(2px, -50%)",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "12px" }}>
        {["$0", "$39"].map((label) => (
          <span
            key={label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "56px",
              padding: "7px 12px",
              border: "1px solid #d1d1d1",
              borderRadius: "6px",
              background: "#fff",
              color: "#1a1a1a",
              fontSize: "1.05rem",
              fontWeight: 600,
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function FilterGroupPreview({ field, styleVars, swatchShape }) {
  const isSwatch = field.displayType === "swatch";
  const isPrice = field.fieldKey === "price";
  const isSingle = field.selectMode === "single";
  const inputType = isSingle ? "radio" : "checkbox";

  const headingStyle = {
    fontSize: `${styleVars.headingFontSize}px`,
    fontWeight: styleVars.headingFontWeight,
    textTransform: styleVars.headingTextTransform,
    color: styleVars.headingTextColor,
  };
  const valueStyle = {
    fontSize: `${styleVars.valueFontSize}px`,
    fontWeight: styleVars.valueFontWeight,
    textTransform: styleVars.valueTextTransform,
    color: styleVars.valueTextColor,
  };
  const swatchRadius = swatchShape === "square" ? "6px" : "50%";

  return (
    <s-stack direction="block" gap="small-200">
      <div style={{ ...headingStyle, letterSpacing: "0.02em" }}>{field.label}</div>

      {isPrice ? (
        <PriceRangePreview />
      ) : isSwatch ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {SAMPLE_COLOR_SWATCHES.map((swatch, i) => (
            <div
              key={swatch.label}
              title={swatch.label}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: swatchRadius,
                background: swatch.color,
                border: "1px solid #d1d1d1",
                boxShadow:
                  i === 0
                    ? "0 0 0 2px #fff, 0 0 0 4px #1a1a1a"
                    : "0 0 0 2px #fff",
                cursor: "default",
              }}
            />
          ))}
        </div>
      ) : (
        <s-stack direction="block" gap="tight">
          {sampleValuesFor(field).map((value, i) => (
            <label
              key={value}
              style={{ ...valueStyle, display: "flex", alignItems: "center", gap: "8px" }}
            >
              <input type={inputType} name={isSingle ? field.fieldKey : undefined} readOnly checked={i === 0} />
              {value}
            </label>
          ))}
        </s-stack>
      )}
    </s-stack>
  );
}

const SHIMMER_STYLE = {
  background: "linear-gradient(90deg, #eee 25%, #f6f6f6 50%, #eee 75%)",
  backgroundSize: "200% 100%",
  animation: "filter-page-preview-shimmer 1.4s ease-in-out infinite",
  borderRadius: "4px",
};

function SkeletonProductCard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ ...SHIMMER_STYLE, aspectRatio: "1 / 1" }} />
      <div style={{ ...SHIMMER_STYLE, height: "12px", width: "80%" }} />
      <div style={{ ...SHIMMER_STYLE, height: "12px", width: "40%" }} />
    </div>
  );
}

const SEARCH_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9b9b9b" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const GRID_VIEW_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="6.5" height="6.5" rx="1" fill="currentColor" />
    <rect x="10.5" y="1" width="6.5" height="6.5" rx="1" fill="currentColor" />
    <rect x="1" y="10.5" width="6.5" height="6.5" rx="1" fill="currentColor" />
    <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1" fill="currentColor" />
  </svg>
);

const LIST_VIEW_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="1" y="1.75" width="16" height="3" rx="1" fill="currentColor" />
    <rect x="1" y="7.5" width="16" height="3" rx="1" fill="currentColor" />
    <rect x="1" y="13.25" width="16" height="3" rx="1" fill="currentColor" />
  </svg>
);

/**
 * Skeleton for the storefront's search-bar / results-bar toolbar (product
 * search input, result count, grid/list view toggle, sort dropdown) so the
 * admin preview's chrome matches collection-filters.liquid's real layout —
 * only the product cards below it are actual shimmer placeholders, since
 * real product data isn't available in the admin preview.
 */
function ResultsToolbarPreview() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "9px 12px",
          border: "1px solid #d1d1d1",
          borderRadius: "6px",
          background: "#fff",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <span style={{ ...SHIMMER_STYLE, height: "12px", width: "70%", borderRadius: "2px" }} />
        <span style={{ marginLeft: "auto", display: "flex" }}>{SEARCH_ICON}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <span style={{ ...SHIMMER_STYLE, height: "12px", width: "90px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div role="group" aria-hidden="true" style={{ display: "flex", gap: "4px", color: "#bdbdbd" }}>
            <span style={{ display: "flex", padding: "4px", border: "1px solid #e1e1e1", borderRadius: "4px" }}>
              {GRID_VIEW_ICON}
            </span>
            <span style={{ display: "flex", padding: "4px", border: "1px solid transparent" }}>
              {LIST_VIEW_ICON}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ ...SHIMMER_STYLE, height: "12px", width: "48px" }} />
            <span
              style={{
                display: "inline-block",
                height: "30px",
                width: "130px",
                border: "1px solid #d1d1d1",
                borderRadius: "6px",
                background: "#fff",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Mirrors .collection-filters-app__load-more (collection-filters.css) — the
// storefront paginates with a single "Load more" button, not page numbers.
// Shown as a shimmer skeleton since no real pagination state exists in the
// admin preview.
function PaginationPreview({ toggleButtonStyle }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
      <div
        style={{
          padding: "12px 32px",
          borderRadius: toggleButtonStyle?.borderRadius,
          border: toggleButtonStyle?.border,
          background: toggleButtonStyle?.background,
        }}
      >
        <span style={{ ...SHIMMER_STYLE, display: "block", height: "14px", width: "80px" }} />
      </div>
    </div>
  );
}

export function FilterGroupsList({ fields, styleVars, swatchShape, buttonStyle }) {
  if (fields.length === 0) {
    return (
      <s-paragraph tone="subdued">
        Enable a filter or add a filter option to see a preview here.
      </s-paragraph>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      {fields.map((field) => (
        <FilterGroupPreview key={field.fieldKey} field={field} styleVars={styleVars} swatchShape={swatchShape} />
      ))}
      <button type="button" style={{ ...buttonStyle, padding: "8px 16px", cursor: "default", alignSelf: "flex-start" }}>
        Clear all
      </button>
    </s-stack>
  );
}

const CHEVRON_DOWN_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Collapsed dropdown-button row used by the horizontal layout: each filter
 * is a closed pill (label + chevron), matching collection-filters.liquid's
 * real horizontal bar, wrapping onto new rows once it runs out of width.
 */
function FilterChipsRow({ fields, styleVars, buttonStyle }) {
  if (fields.length === 0) {
    return (
      <s-paragraph tone="subdued">
        Enable a filter or add a filter option to see a preview here.
      </s-paragraph>
    );
  }

  const chipStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "10px 14px",
    borderRadius: "6px",
    border: "1px solid #d1d1d1",
    background: "#fff",
    fontSize: `${styleVars.headingFontSize}px`,
    fontWeight: styleVars.headingFontWeight,
    textTransform: styleVars.headingTextTransform,
    color: styleVars.headingTextColor,
    cursor: "default",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
      {fields.map((field) => (
        <button key={field.fieldKey} type="button" style={chipStyle}>
          {field.label}
          {CHEVRON_DOWN_ICON}
        </button>
      ))}
      <button
        type="button"
        style={{ ...buttonStyle, padding: "10px 14px", cursor: "default", whiteSpace: "nowrap" }}
      >
        Clear all
      </button>
    </div>
  );
}

function ProductGrid({ columns }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "16px",
      }}
    >
      {Array.from({ length: columns * 2 }).map((_, i) => (
        <SkeletonProductCard key={i} />
      ))}
    </div>
  );
}

/**
 * Desktop-scale storefront layout, sized like the real collection/search
 * page. Renders one of three skeleton structures depending on filterLayout
 * so merchants see an accurate preview of the layout they've chosen. Used
 * inside the full-width preview modal instead of a cramped sidebar preview.
 */
export function DesktopFilterLayout({ fields, filterLayout = "vertical", styleVars, buttonStyle, toggleButtonStyle, sidebarBackgroundColor, productGridColumns, swatchShape }) {
  const columns = Math.max(2, Math.min(6, Number(productGridColumns) || 4));
  const shimmerKeyframes = (
    <style>
      {"@keyframes filter-page-preview-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }"}
    </style>
  );

  if (filterLayout === "horizontal") {
    return (
      <div>
        {shimmerKeyframes}
        <div
          style={{
            background: sidebarBackgroundColor,
            borderRadius: "8px",
            border: "1px solid #e1e1e1",
            padding: "16px",
            marginBottom: "24px",
          }}
        >
          <FilterChipsRow fields={fields} styleVars={styleVars} buttonStyle={buttonStyle} />
        </div>
        <ResultsToolbarPreview />
        <ProductGrid columns={columns} />
        <PaginationPreview toggleButtonStyle={toggleButtonStyle} />
      </div>
    );
  }

  if (filterLayout === "drawer") {
    const headingStyle = {
      fontSize: `${styleVars.headingFontSize}px`,
      fontWeight: styleVars.headingFontWeight,
      textTransform: styleVars.headingTextTransform,
      color: styleVars.headingTextColor,
    };

    return (
      <div style={{ position: "relative" }}>
        {shimmerKeyframes}
        <button type="button" style={{ ...toggleButtonStyle, padding: "8px 16px", cursor: "default", marginBottom: "16px" }}>
          Filters
        </button>
        <ResultsToolbarPreview />
        <ProductGrid columns={columns} />
        <PaginationPreview toggleButtonStyle={toggleButtonStyle} />

        {/* Dimmed overlay behind the slide-out panel, matching the real drawer's backdrop */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0, 0, 0, 0.3)",
            borderRadius: "8px",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: "300px",
            maxWidth: "80%",
            background: sidebarBackgroundColor,
            boxShadow: "4px 0 24px rgba(0, 0, 0, 0.18)",
            padding: "20px",
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <span style={{ ...headingStyle, fontSize: `${Number(styleVars.headingFontSize) + 4}px` }}>Filter products</span>
            <span style={{ fontSize: "20px", lineHeight: 1, color: headingStyle.color, cursor: "default" }}>&times;</span>
          </div>
          <FilterGroupsList fields={fields} styleVars={styleVars} swatchShape={swatchShape} buttonStyle={buttonStyle} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "24px" }}>
      {shimmerKeyframes}
      <s-stack direction="block" gap="base">
        <button type="button" style={{ ...toggleButtonStyle, padding: "8px 16px", cursor: "default", alignSelf: "flex-start" }}>
          Filters
        </button>
        <div
          style={{
            background: sidebarBackgroundColor,
            borderRadius: "8px",
            border: "1px solid #e1e1e1",
            padding: "16px",
          }}
        >
          <FilterGroupsList fields={fields} styleVars={styleVars} swatchShape={swatchShape} buttonStyle={buttonStyle} />
        </div>
      </s-stack>

      <div>
        <ResultsToolbarPreview />
        <ProductGrid columns={columns} />
        <PaginationPreview toggleButtonStyle={toggleButtonStyle} />
      </div>
    </div>
  );
}

/**
 * Sidebar preview control shared by the Filters and Customize (Style) admin
 * pages: a "Preview" button that opens a full-width modal rendering
 * DesktopFilterLayout, so merchants get an accurate desktop view of the
 * filter panel + product grid instead of a cramped inline box.
 */
export function filterPagePreviewModalId(id) {
  return `${id}-modal`;
}

/**
 * Standalone trigger button for the preview modal, so it can be placed
 * anywhere on the page (e.g. the top-right of the tab nav) independently of
 * where the modal itself is rendered.
 */
export function FilterPagePreviewButton({ id, variant = "primary" }) {
  return (
    <s-button variant={variant} commandFor={filterPagePreviewModalId(id)} command="--show">
      Preview
    </s-button>
  );
}

export function FilterPagePreviewModal({ id, fields, filterLayout, styleVars, buttonStyle, toggleButtonStyle, sidebarBackgroundColor, productGridColumns, swatchShape }) {
  const modalId = filterPagePreviewModalId(id);
  const previewFields = fields ?? GENERIC_PREVIEW_FIELDS;
  // s-modal teleports/restructures its children once the custom element
  // upgrades in the browser, which never matches the server-rendered markup
  // and throws a React hydration error (#418/#423) that can take down
  // interactivity elsewhere on the page. Mounting it only after hydration
  // sidesteps the mismatch entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <s-modal id={modalId} heading="Preview" size="large">
      <DesktopFilterLayout
        fields={previewFields}
        filterLayout={filterLayout}
        styleVars={styleVars}
        buttonStyle={buttonStyle}
        toggleButtonStyle={toggleButtonStyle}
        sidebarBackgroundColor={sidebarBackgroundColor}
        productGridColumns={productGridColumns}
        swatchShape={swatchShape}
      />
      <s-button slot="secondary-actions" commandFor={modalId} command="--hide">
        Close
      </s-button>
    </s-modal>
  );
}

/**
 * Backwards-compatible combined button+modal, kept for other call sites that
 * still want the trigger and modal rendered together in one spot.
 */
export function FilterPagePreview(props) {
  return (
    <>
      <FilterPagePreviewButton id={props.id} />
      <FilterPagePreviewModal {...props} />
    </>
  );
}
