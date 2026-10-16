import prisma from "./db.server";

const TRIAL_DAYS = 7;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

// Billing is only enforced once a Managed Pricing plan is published, which
// is signalled by SHOPIFY_APP_HANDLE being set (the Plans page's Upgrade
// link needs it too). Until then nobody is locked out, since there would be
// no plan for them to pay for.
function isBillingEnabled() {
  // eslint-disable-next-line no-undef
  return Boolean(process.env.SHOPIFY_APP_HANDLE);
}

// Asks Shopify whether this shop is a development store and whether it has
// an active Managed Pricing subscription, and stores the answer on
// ShopSettings.plan ("paid", "dev" or "free") so storefront requests (which
// have no admin session) can read it without calling Shopify themselves.
// Shopify never bills development stores, so they get full access.
async function syncBillingState(admin, shop, previousPlan) {
  const response = await admin.graphql(
    `#graphql
    query BillingState {
      shop {
        plan {
          partnerDevelopment
        }
      }
      currentAppInstallation {
        activeSubscriptions {
          status
        }
      }
    }`,
  );
  const json = await response.json();
  if (!json.data?.shop) {
    throw new Error(`Unexpected billing response: ${JSON.stringify(json.errors ?? json)}`);
  }

  const isDevelopmentStore = json.data.shop.plan?.partnerDevelopment === true;
  const subscriptions = json.data.currentAppInstallation?.activeSubscriptions ?? [];
  const hasSubscription = subscriptions.some((s) => s.status === "ACTIVE");
  const plan = hasSubscription ? "paid" : isDevelopmentStore ? "dev" : "free";

  // A development store that goes live (transferred or moved to a paid
  // Shopify plan) starts its 7-day trial then, rather than being measured
  // from its original install date.
  const installedAt = previousPlan === "dev" && plan === "free" ? new Date() : null;

  await prisma.shopSettings.upsert({
    where: { shop },
    update: { plan, ...(installedAt ? { installedAt } : {}) },
    create: { shop, plan },
  });

  return { plan, installedAt };
}

// Determines this shop's trial/paid status. Pass `admin` (from an admin
// request) to refresh the stored billing state from Shopify first; without
// it (storefront requests) the last stored value is used.
export async function getTrialStatus(shop, admin = null) {
  const shopSettings = await prisma.shopSettings.findUnique({
    where: { shop },
    select: { installedAt: true, plan: true },
  });

  let plan = shopSettings?.plan ?? "free";
  let restartedAt = null;
  if (admin) {
    try {
      ({ plan, installedAt: restartedAt } = await syncBillingState(admin, shop, plan));
    } catch (error) {
      // Keep the last stored value rather than locking out a merchant who
      // may already be paying because of a transient API error.
      console.error(`Billing check failed for ${shop}:`, error);
    }
  }

  const installedAt = restartedAt ?? shopSettings?.installedAt ?? new Date();
  const trialEndsAt = new Date(installedAt.getTime() + TRIAL_MS);
  const now = new Date();

  const billingEnabled = isBillingEnabled();
  const isPaid = plan === "paid";
  const isDevelopmentStore = plan === "dev";
  const isTrialActive = now < trialEndsAt;
  const daysRemaining = Math.max(
    0,
    Math.ceil((trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
  );

  return {
    installedAt,
    trialEndsAt,
    daysRemaining,
    isTrialActive,
    isPaid,
    isDevelopmentStore,
    billingEnabled,
    hasAccess: !billingEnabled || isPaid || isDevelopmentStore || isTrialActive,
  };
}
