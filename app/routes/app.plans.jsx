import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getTrialStatus } from "../billing.server";
import { RouteErrorBoundary } from "../route-error-boundary";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const trialStatus = await getTrialStatus(session.shop, admin);
  // eslint-disable-next-line no-undef
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "";

  return {
    pricingPlansUrl: `https://admin.shopify.com/store/${session.shop.replace(".myshopify.com", "")}/charges/${appHandle}/pricing_plans`,
    // Managed Pricing needs a plan published for this app handle in the
    // Partner Dashboard before the URL above resolves to anything; without
    // an app handle configured it's guaranteed broken (double slash, no
    // plan to show), so gate the button on it being present.
    upgradeAvailable: Boolean(appHandle),
    trialDaysRemaining: trialStatus.daysRemaining,
    isTrialActive: trialStatus.isTrialActive,
    isPaid: trialStatus.isPaid,
    isDevelopmentStore: trialStatus.isDevelopmentStore,
    billingEnabled: trialStatus.billingEnabled,
  };
};

const PLAN = {
  key: "paid",
  name: "Paid",
  price: "$4.99",
  cadence: "/ month",
  tagline: "Everything you need for storefront filtering.",
};

const FEATURES = [
  "Collection page filters",
  "Search page filters",
  "Standard filters (Price, Availability, Vendor, Tag, Product type, Category, Review rating)",
  "Unlimited variant option filters",
  "Unlimited metafield filters",
  "Unlimited tag-prefix filters",
  "Storefront filter layout: vertical, horizontal, or drawer",
  "Product reviews",
  "Wishlist",
];

function statusBadge({ isPaid, isDevelopmentStore, isTrialActive, trialDaysRemaining, billingEnabled }) {
  if (!billingEnabled) {
    return null;
  }
  if (isPaid) {
    return { text: "Current plan", tone: "success" };
  }
  if (isDevelopmentStore) {
    return { text: "Development store: free", tone: "info" };
  }
  if (isTrialActive) {
    return {
      text: `${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"} left in trial`,
      tone: "warning",
    };
  }
  return { text: "Trial ended", tone: "critical" };
}

export default function Plans() {
  const {
    pricingPlansUrl,
    upgradeAvailable,
    trialDaysRemaining,
    isTrialActive,
    isPaid,
    isDevelopmentStore,
    billingEnabled,
  } = useLoaderData();

  const handleUpgrade = () => {
    open(pricingPlansUrl, "_top");
  };

  const badge = statusBadge({
    isPaid,
    isDevelopmentStore,
    isTrialActive,
    trialDaysRemaining,
    billingEnabled,
  });

  return (
    <s-page heading="Plans">
      {billingEnabled && !isPaid && !isDevelopmentStore && (
        <s-box paddingBlockEnd="base">
          {isTrialActive ? (
            <s-banner tone="warning" heading={`${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"} left in your free trial`}>
              <s-paragraph>
                After your trial ends, storefront filters will stop working until you upgrade.
              </s-paragraph>
            </s-banner>
          ) : (
            <s-banner tone="critical" heading="Your free trial has ended">
              <s-paragraph>
                Storefront filters are disabled. Upgrade to the Paid plan to restore filtering for
                your customers.
              </s-paragraph>
            </s-banner>
          )}
        </s-box>
      )}
      <s-section padding="large">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-heading>{PLAN.name}</s-heading>
            {badge && (
              <s-badge tone={badge.tone} size="large">
                {badge.text}
              </s-badge>
            )}
          </s-stack>

          <s-stack direction="inline" gap="small-200" alignItems="baseline">
            <span style={{ fontSize: "20px", fontWeight: "bold" }}>{PLAN.price}</span>
            <s-text tone="subdued">{PLAN.cadence}</s-text>
          </s-stack>

          <s-paragraph tone="subdued">{PLAN.tagline}</s-paragraph>

          <s-divider></s-divider>

          <s-stack direction="block" gap="base">
            {FEATURES.map((label) => (
              <s-stack key={label} direction="inline" gap="small-300" alignItems="start">
                <s-icon type="check-circle" tone="success"></s-icon>
                <s-text>{label}</s-text>
              </s-stack>
            ))}
          </s-stack>

          {!isPaid && (
            <s-box paddingBlockStart="small">
              <s-button
                variant="primary"
                disabled={!upgradeAvailable}
                onClick={upgradeAvailable ? handleUpgrade : undefined}
              >
                Upgrade
              </s-button>
            </s-box>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
