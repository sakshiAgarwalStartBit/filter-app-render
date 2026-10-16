const LAYOUTS = [
  {
    value: "vertical",
    label: "Vertical",
    description: "Sidebar next to the product grid",
  },
  {
    value: "horizontal",
    label: "Horizontal",
    description: "Filter bar above the product grid",
  },
  {
    value: "drawer",
    label: "Drawer",
    description: "Slide-out panel opens",
  },
];

function LayoutThumbnail({ value }) {
  const barStyle = {
    height: 6,
    borderRadius: 2,
    background: "#c4cdd5",
  };
  const blockStyle = {
    borderRadius: 2,
    background: "#c4cdd5",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gridAutoRows: "1fr",
    gap: 3,
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
  };

  if (value === "vertical") {
    return (
      <div style={{ display: "flex", gap: 4, height: 60, width: "100%", boxSizing: "border-box" }}>
        <div style={{ ...blockStyle, width: "28%", flexShrink: 0, background: "#1a1a1a" }} />
        <div style={{ ...gridStyle, flex: 1, width: "auto" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={blockStyle} />
          ))}
        </div>
      </div>
    );
  }

  if (value === "horizontal") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, height: 60, width: "100%", boxSizing: "border-box" }}>
        <div style={{ ...barStyle, background: "#1a1a1a" }} />
        <div style={{ ...gridStyle, flex: 1, height: "auto" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={blockStyle} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: 60, width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      <div style={gridStyle}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={blockStyle} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: "35%",
          background: "#1a1a1a",
          borderRadius: 2,
        }}
      />
    </div>
  );
}

export function FilterLayoutPicker({ value, onChange }) {
  return (
    <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base" alignItems="stretch">
      {LAYOUTS.map((layout) => {
        const inputId = `filter-layout-${layout.value}`;
        const selected = value === layout.value;
        return (
          <s-grid-item key={layout.value} style={{ height: "100%", display: "flex" }}>
            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              style={{ height: "100%", width: "100%", boxSizing: "border-box", display: "flex" }}
            >
              <label
                htmlFor={inputId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  cursor: "pointer",
                  height: "100%",
                  width: "100%",
                }}
              >
                <s-stack direction="inline" gap="small" alignItems="center">
                  <input
                    type="radio"
                    id={inputId}
                    name="filter-layout"
                    value={layout.value}
                    checked={selected}
                    onChange={() => onChange(layout.value)}
                    style={{
                      appearance: "none",
                      WebkitAppearance: "none",
                      margin: 0,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: selected ? "5px solid #1a1a1a" : "1px solid #8a8a8a",
                      backgroundColor: "#ffffff",
                      boxSizing: "border-box",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  />
                  <s-text>{layout.label}</s-text>
                </s-stack>
                <s-text color="subdued">{layout.description}</s-text>
                <div style={{ marginTop: "auto", paddingTop: 8 }}>
                  <LayoutThumbnail value={layout.value} />
                </div>
              </label>
            </s-box>
          </s-grid-item>
        );
      })}
    </s-grid>
  );
}
