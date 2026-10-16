import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

export const TAB_BAR_STYLE = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  boxSizing: "border-box",
  gap: "8px",
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid var(--s-color-border, #e1e1e1)",
  background: "var(--s-color-bg-surface, #fff)",
  boxShadow: "0 1px 0 rgba(0, 0, 0, 0.02)",
  marginTop: "16px",
  marginBottom: "16px",
};

const TAB_LINK_BASE_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  padding: "12px 2px",
  fontSize: "14px",
  fontWeight: "500",
  textDecoration: "none",
  borderBottom: "3px solid transparent",
  cursor: "pointer",
  background: "none",
  border: "none",
  borderBottomWidth: "3px",
  borderBottomStyle: "solid",
};

function tabStyle(isActive) {
  return {
    ...TAB_LINK_BASE_STYLE,
    color: isActive ? "#000000" : "var(--s-color-text-secondary, #6d7175)",
    borderBottomColor: isActive ? "#000000" : "transparent",
  };
}

export function FilterTabsNav({ active, context, onSwitchContext, endAction }) {
  const navigate = useNavigate();
  const suffix = context === "search" ? "?context=search" : "";
  const filterTreeHref = `/app/filters${suffix}`;
  const tabs = [
    { key: "tree", label: "Filter tree" },
    { key: "layout", label: "Layout & display", href: `/app/filters/layout${suffix}` },
  ];

  // s-menu teleports/restructures its children into a top-level popover once
  // the custom element upgrades in the browser, which never matches the
  // server-rendered markup and throws a React hydration error (#418/#423)
  // that can take down interactivity elsewhere on the page (see the same
  // workaround for s-modal in filter-page-preview.jsx). Mounting it only
  // after hydration sidesteps the mismatch entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div style={TAB_BAR_STYLE}>
      {tabs.map((tab) =>
        tab.key === "tree" ? (
          <div
            key={tab.key}
            style={{
              display: "inline-flex",
              borderBottom: tabStyle(active === "tree").borderBottom,
              borderBottomColor: tabStyle(active === "tree").borderBottomColor,
            }}
          >
            <s-button
              commandFor={mounted ? "filter-tree-menu" : undefined}
              variant="tertiary"
              tone={active === "tree" ? "auto" : "neutral"}
            >
              {tab.label}
            </s-button>
            {mounted && (
              <s-menu id="filter-tree-menu" accessibilityLabel="Filter tree">
                {onSwitchContext ? (
                  <>
                    <s-button onClick={() => onSwitchContext("collection")}>
                      Collection filters
                    </s-button>
                    <s-button onClick={() => onSwitchContext("search")}>
                      Search filters
                    </s-button>
                  </>
                ) : (
                  <>
                    <s-button onClick={() => navigate(filterTreeHref)}>
                      Collection filters
                    </s-button>
                    <s-button onClick={() => navigate("/app/filters?context=search")}>
                      Search filters
                    </s-button>
                  </>
                )}
              </s-menu>
            )}
          </div>
        ) : (
          <div
            key={tab.key}
            style={{
              display: "inline-flex",
              borderBottom: tabStyle(active === tab.key).borderBottom,
              borderBottomColor: tabStyle(active === tab.key).borderBottomColor,
            }}
          >
            <s-button
              onClick={() => navigate(tab.href)}
              variant="tertiary"
              tone={active === tab.key ? "auto" : "neutral"}
            >
              {tab.label}
            </s-button>
          </div>
        ),
      )}
      {endAction && (
        <div style={{ marginLeft: "auto" }}>{endAction}</div>
      )}
    </div>
  );
}
