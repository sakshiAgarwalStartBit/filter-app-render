import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { CustomizerPopupModal, useCustomizerPopup } from "../customizer-popup";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getThemeBlockStatus } from "../collection-filters.server";
import { getTrialStatus } from "../billing.server";
import { sendFeatureRequestEmail } from "../feedback.server";
import { RouteErrorBoundary } from "../route-error-boundary";

const FEEDBACK_BAR_DISMISSED_KEY = "sb-collection-filter:feedback-bar-dismissed";
const SETUP_GUIDE_STEP3_VERIFIED_KEY = "sb-collection-filter:setup-guide-step3-verified";
const SPOTLIGHT_DISMISSED_KEY = "sb-collection-filter:spotlight-dismissed";

function FeedbackBar() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(FEEDBACK_BAR_DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(FEEDBACK_BAR_DISMISSED_KEY, "1");
    } catch {
      // localStorage unavailable (e.g. private browsing) — dismissal just won't persist.
    }
  };

  const requestReview = () => {
    shopify.reviews.request();
    dismiss();
  };

  if (dismissed) return null;

  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-grid gridTemplateColumns="auto 1fr auto auto auto" gap="small-300" alignItems="center">
        <s-icon type="info" tone="info" />
        <s-text>We value feedback! It helps us make SB Product Filter better.</s-text>
        <s-button variant="secondary" icon="thumbs-down" onClick={requestReview}>
          Not good
        </s-button>
        <s-button variant="secondary" icon="thumbs-up" onClick={requestReview}>
          Great
        </s-button>
        <s-button
          accessibilityLabel="Dismiss feedback"
          variant="tertiary"
          tone="neutral"
          onClick={dismiss}
          icon="x"
        />
      </s-grid>
    </s-box>
  );
}

const SPOTLIGHT_APPS = [
  {
    name: "Smart Product Options",
    pricing: "$2.99/6.99/month. Free trial available.",
    description: "Add custom product options and variants to boost AOV.",
    href: "https://apps.shopify.com/smart-product-options-1",
    icon: "/icons/smart-product-options.png",
  },
  {
    name: "SB AI Chatbot - Sales & Support",
    pricing: "Free trial available.",
    description: "An AI chatbot that drives sales and handles customer support.",
    href: "https://apps.shopify.com/sb-ai-chatbot-sales-support",
    icon: "/icons/sb-ai-chatbot.png",
  },
  {
    name: "Smart Announcement Bar",
    pricing: "$2.99/month. Free trial available.",
    description: "Engage customers with customizable announcement bars for promotions.",
    href: "https://apps.shopify.com/smart-announcement-bar",
    icon: "/icons/smart-announcement-bar.webp",
  },
];

function SpotlightSection() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(SPOTLIGHT_DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(SPOTLIGHT_DISMISSED_KEY, "1");
    } catch {
      // localStorage unavailable (e.g. private browsing) — dismissal just won't persist.
    }
  };

  if (dismissed) return null;

  return (
    <s-section>
      <s-grid gridTemplateColumns="1fr auto" gap="small-300" alignItems="center">
        <s-heading>More apps your business might need</s-heading>
        <s-button
          accessibilityLabel="Dismiss more apps"
          variant="tertiary"
          tone="neutral"
          onClick={dismiss}
          icon="x"
        />
      </s-grid>
      <s-box paddingBlockStart="base">
        <SpotlightApps />
      </s-box>
    </s-section>
  );
}

function SpotlightApps() {
  return (
    <s-grid gridTemplateColumns={`repeat(${SPOTLIGHT_APPS.length}, 1fr)`} gap="base">
      {SPOTLIGHT_APPS.map((app) => (
        <s-box key={app.name} padding="base" border="base" borderRadius="base">
          <s-grid gridTemplateColumns="auto 1fr" gap="small-300">
            <s-box inlineSize="40px" blockSize="40px" borderRadius="base" overflow="hidden">
              <s-image
                src={app.icon}
                alt={`${app.name} icon`}
                inlineSize="100%"
                blockSize="100%"
                objectFit="cover"
              />
            </s-box>
            <s-stack direction="block" gap="small-300">
              <s-grid gridTemplateColumns="1fr auto" gap="small-300" alignItems="start">
                <s-text type="strong">{app.name}</s-text>
                <s-link
                  href={app.href}
                  target="_blank"
                  accessibilityLabel={`Open ${app.name} on the Shopify App Store`}
                >
                  <s-icon type="external" />
                </s-link>
              </s-grid>
              {app.pricing && <s-text tone="subdued">{app.pricing}</s-text>}
              <s-paragraph tone="subdued">{app.description}</s-paragraph>
            </s-stack>
          </s-grid>
        </s-box>
      ))}
    </s-grid>
  );
}

function friendlyShopName(shopDomain) {
  return shopDomain
    .replace(/\.myshopify\.com$/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// The app's client_id (api_key), from shopify.app.toml. Deep links identify
// the app by this value + a block handle to open the theme editor with that
// block preselected for adding — see
// https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#deep-linking
// (Not the extension UID from shopify.extension.toml — addAppBlockId expects
// {api_key}/{handle}, and passing the extension UID instead causes Shopify
// to fail silently: the block still renders once as a leftover preview, but
// a "not added... problem with the app block" error toast appears because
// the add-to-theme request itself couldn't resolve the app.) Read from
// SHOPIFY_API_KEY in the loader so it always matches the deployed app.
function themeEditorDeepLink(shop, apiKey, { template, blockHandle }) {
  const params = new URLSearchParams({
    template,
    addAppBlockId: `${apiKey}/${blockHandle}`,
    target: "mainSection",
  });
  return `https://${shop}/admin/themes/current/editor?${params.toString()}`;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [collectionFilters, searchFilters, collectionSettings, themeBlockStatus, trialStatus] =
    await Promise.all([
      prisma.filterConfig.findMany({
        where: { shop, context: "collection", enabled: true },
        orderBy: { position: "asc" },
        select: { label: true, fieldType: true },
      }),
      prisma.filterConfig.findMany({
        where: { shop, context: "search", enabled: true },
        select: { label: true },
      }),
      prisma.filterContextSettings.findUnique({
        where: { shop_context: { shop, context: "collection" } },
      }),
      // Best-effort: if this fails (e.g. an existing install hasn't
      // re-approved the read_themes scope yet), fall back to "unknown"
      // rather than breaking the whole dashboard.
      getThemeBlockStatus(admin).catch(() => ({
        collectionFilters: false,
        wishlist: false,
        checked: false,
      })),
      getTrialStatus(shop, admin),
    ]);

  return {
    shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopName: friendlyShopName(shop),
    enabledFilters: collectionFilters,
    hasSearchFilters: searchFilters.length > 0,
    pageSize: collectionSettings?.pageSize ?? 10,
    filterLayout: collectionSettings?.filterLayout ?? "vertical",
    themeBlockStatus,
    trialDaysRemaining: trialStatus.daysRemaining,
    isTrialActive: trialStatus.isTrialActive,
    isPaid: trialStatus.isPaid,
    isDevelopmentStore: trialStatus.isDevelopmentStore,
    billingEnabled: trialStatus.billingEnabled,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  if (formData.get("intent") === "sendFeatureRequest") {
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    if (!description) {
      return { featureRequestError: "Please describe your idea." };
    }
    try {
      await sendFeatureRequestEmail({ shop: session.shop, title, description });
      return { featureRequestSent: true };
    } catch (error) {
      console.error("[app._index] failed to send feature request email", error);
      return { featureRequestError: "Failed to send. Please try again." };
    }
  }

  const themeBlockStatus = await getThemeBlockStatus(admin).catch(() => ({
    collectionFilters: false,
    wishlist: false,
    checked: false,
  }));

  return { themeBlockStatus };
};

function SetupGuideStep({ done, title, description, children, expanded, onToggle, isLast }) {
  return (
    <>
      <s-box>
        <s-grid gridTemplateColumns="1fr auto" gap="base" padding="base" alignItems="center">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-checkbox checked={done} disabled accessibilityLabel={title} />
            <span style={{ color: "#000000" }}>{title}</span>
          </s-stack>
          <s-button
            accessibilityLabel={expanded ? "Collapse step details" : "Expand step details"}
            variant="tertiary"
            onClick={onToggle}
            icon={expanded ? "chevron-up" : "chevron-down"}
          />
        </s-grid>
        <s-box padding="base" paddingBlockStart="none" display={expanded ? "auto" : "none"}>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-paragraph>{description}</s-paragraph>
              {children}
            </s-stack>
          </s-box>
        </s-box>
      </s-box>
      {!isLast && <s-divider />}
    </>
  );
}

function SetupGuide({ hasCollectionFilters, themeBlockStatus, collectionFiltersDeepLink }) {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const liveThemeBlockStatus = fetcher.data?.themeBlockStatus ?? themeBlockStatus;
  const blockAddedToTheme =
    liveThemeBlockStatus.checked && liveThemeBlockStatus.collectionFilters;

  // Step 3 only gets marked done by an explicit, successful Verify click —
  // it must not auto-complete just because step 1 happens to be done.
  // Persisted to localStorage so it survives reloads instead of resetting
  // to "unverified" every time the page mounts.
  const [step3Verified, setStep3Verified] = useState(false);

  // True once we've read localStorage on the client. Must start false and
  // stay false through SSR/hydration (window is undefined there) so the
  // hydrated render matches the server render. Until this flips, we don't
  // yet know the real "allDone" state, so we render a small skeleton
  // instead of the full guide — otherwise a completed setup briefly shows
  // the full expanded box before collapsing once step3Verified resolves.
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SETUP_GUIDE_STEP3_VERIFIED_KEY) === "1") {
        setStep3Verified(true);
      }
    } catch {
      // localStorage unavailable — leave step3Verified as false.
    }
    setResolved(true);
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistStep3Verified = (value) => {
    setStep3Verified(value);
    try {
      if (value) {
        window.localStorage.setItem(SETUP_GUIDE_STEP3_VERIFIED_KEY, "1");
      } else {
        window.localStorage.removeItem(SETUP_GUIDE_STEP3_VERIFIED_KEY);
      }
    } catch {
      // localStorage unavailable — verified state just won't persist.
    }
  };

  useEffect(() => {
    if (!blockAddedToTheme) persistStep3Verified(false);
    // Only re-run when blockAddedToTheme flips, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockAddedToTheme]);

  const allDone = hasCollectionFilters && step3Verified;
  const stepsDone = [blockAddedToTheme, hasCollectionFilters, step3Verified].filter(
    Boolean,
  ).length;
  const totalSteps = 3;
  const checking = fetcher.state !== "idle";

  const [guideExpanded, setGuideExpanded] = useState(!allDone);
  // Expand only the first not-yet-done step by default, so a step already
  // completed before the guide ever renders (e.g. the theme block was added
  // earlier) starts collapsed instead of forcing step1 open regardless of
  // progress. After this initial render, manual toggles are free to open or
  // close any step — including a completed one, so merchants can revisit it.
  const [stepExpanded, setStepExpanded] = useState(() => {
    if (!blockAddedToTheme) return { step1: true, step2: false, step3: false };
    if (!hasCollectionFilters) return { step1: false, step2: true, step3: false };
    if (!step3Verified) return { step1: false, step2: false, step3: true };
    return { step1: false, step2: false, step3: false };
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setGuideExpanded(!allDone);
  }, [allDone]);

  // Auto-advance: the first time a step becomes done, collapse it (unless
  // the merchant has since manually reopened it) and open the next
  // incomplete one, so merchants aren't left looking at a finished step.
  const prevDoneRef = useRef({ step1: blockAddedToTheme, step2: hasCollectionFilters, step3: step3Verified });
  useEffect(() => {
    const prevDone = prevDoneRef.current;
    const nowDone = { step1: blockAddedToTheme, step2: hasCollectionFilters, step3: step3Verified };
    const order = ["step1", "step2", "step3"];
    const justCompleted = order.find((step) => !prevDone[step] && nowDone[step]);
    if (justCompleted) {
      const nextIncomplete = order.find((step) => !nowDone[step]);
      setStepExpanded((prev) => ({
        ...prev,
        [justCompleted]: false,
        ...(nextIncomplete ? { [nextIncomplete]: true } : {}),
      }));
    }
    prevDoneRef.current = nowDone;
  }, [blockAddedToTheme, hasCollectionFilters, step3Verified]);

  const toggleGuideExpanded = () => {
    setGuideExpanded((prev) => !prev);
  };

  // Dismissal is intentionally in-memory only (not persisted) — closing the
  // guide hides it for the current page view, and it reappears on the next
  // reload/visit until setup is actually complete.
  const dismissGuide = () => {
    setDismissed(true);
  };

  const toggleStep = (step) => {
    setStepExpanded((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  const pendingVerifyToastRef = useRef(false);

  const verifyBlock = () => {
    pendingVerifyToastRef.current = true;
    fetcher.submit({}, { method: "post" });
  };

  useEffect(() => {
    if (fetcher.state !== "idle" || !pendingVerifyToastRef.current) return;
    pendingVerifyToastRef.current = false;

    const result = fetcher.data?.themeBlockStatus;
    if (!result) return;

    if (result.checked && result.collectionFilters) {
      persistStep3Verified(true);
      shopify.toast.show('The "Collection filters" block is live on your published theme.');
    } else {
      persistStep3Verified(false);
      shopify.toast.show(
        result.checked
          ? 'We didn\'t find the "Collection filters" block on your published theme yet.'
          : "We couldn't check your theme automatically. Please try again.",
        { isError: true },
      );
    }
  }, [fetcher.state, fetcher.data, shopify]);

  if (dismissed) return null;

  // Client hasn't read localStorage yet, so we don't know the real
  // step3Verified/allDone state. Show a small skeleton instead of the full
  // guide to avoid flashing the expanded box for setups that are actually
  // already complete.
  if (!resolved) {
    return (
      <s-section>
        <s-grid gap="small-200">
          <s-heading>Setup Guide</s-heading>
          <s-box borderRadius="base" border="base" background="subdued" minBlockSize="48px" />
        </s-grid>
      </s-section>
    );
  }

  if (allDone) {
    return (
      <s-section>
        <s-grid gap="small-200">
          <s-grid gridTemplateColumns="1fr auto auto" gap="small-300" alignItems="center">
            <s-heading>Setup Guide</s-heading>
            <s-button
              accessibilityLabel="Dismiss setup guide"
              variant="tertiary"
              tone="neutral"
              onClick={dismissGuide}
              icon="x"
            />
            <s-button
              accessibilityLabel={guideExpanded ? "Collapse setup guide" : "Expand setup guide"}
              variant="tertiary"
              tone="neutral"
              onClick={toggleGuideExpanded}
              icon={guideExpanded ? "chevron-up" : "chevron-down"}
            />
          </s-grid>
          <s-paragraph>
            Use this personalized guide to get your store ready for sales.
          </s-paragraph>
          <s-paragraph tone="subdued">
            {stepsDone} out of {totalSteps} steps completed
          </s-paragraph>
        </s-grid>

        <s-box
          borderRadius="base"
          border="base"
          background="base"
          display={guideExpanded ? "auto" : "none"}
        >
          <SetupGuideStep
            done={blockAddedToTheme}
            title="Add the filter as a theme block"
            description={
              'Add the "Collection filters" block to your collection page in the theme editor.'
            }
            expanded={stepExpanded.step1}
            onToggle={() => toggleStep("step1")}
          >
            <s-stack direction="inline" gap="small-200">
              <s-button
                href={collectionFiltersDeepLink}
                target="_blank"
                variant="primary"
                disabled={blockAddedToTheme || undefined}
              >
                Add block in theme editor
              </s-button>
            </s-stack>
          </SetupGuideStep>

          <SetupGuideStep
            done={hasCollectionFilters}
            title="Customize your filters"
            description="Choose which fields shoppers can filter by, such as price, availability, or vendor."
            expanded={stepExpanded.step2}
            onToggle={() => toggleStep("step2")}
          >
            <s-stack direction="inline" gap="small-200">
              <s-button
                onClick={() => navigate("/app/filters")}
                variant="primary"
                disabled={hasCollectionFilters || undefined}
              >
                Customize filters
              </s-button>
            </s-stack>
          </SetupGuideStep>

          <SetupGuideStep
            done={step3Verified}
            title="Verify the block is enabled"
            description='The "Collection filters" block is live on your published theme.'
            expanded={stepExpanded.step3}
            onToggle={() => toggleStep("step3")}
            isLast
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-button
                variant="primary"
                onClick={verifyBlock}
                loading={checking || undefined}
                disabled={step3Verified || undefined}
              >
                {checking ? "Checking…" : "Verify"}
              </s-button>
            </s-stack>
          </SetupGuideStep>
        </s-box>
      </s-section>
    );
  }

  return (
    <s-section>
      <s-grid gap="base">
        <s-grid gap="small-200">
          <s-grid gridTemplateColumns="1fr auto" gap="small-300" alignItems="center">
            <s-heading>Setup Guide</s-heading>
            {allDone && (
              <s-button
                accessibilityLabel="Toggle setup guide"
                variant="tertiary"
                tone="neutral"
                onClick={toggleGuideExpanded}
                icon={guideExpanded ? "chevron-up" : "chevron-down"}
              />
            )}
          </s-grid>
          <s-paragraph>
            Use this guide to get collection filters live on your storefront.
          </s-paragraph>
          <s-paragraph tone="subdued">
            {stepsDone} of {totalSteps} steps completed
          </s-paragraph>
        </s-grid>

        <s-box borderRadius="base" border="base" background="base" display={guideExpanded ? "auto" : "none"}>
          <SetupGuideStep
            done={blockAddedToTheme}
            title="Add the filter as a theme block"
            description={
              'Add the "Collection filters" block to your collection page in the theme editor.'
            }
            expanded={stepExpanded.step1}
            onToggle={() => toggleStep("step1")}
          >
            <s-stack direction="inline" gap="small-200">
              <s-button
                href={collectionFiltersDeepLink}
                target="_blank"
                variant="primary"
                disabled={blockAddedToTheme || undefined}
              >
                Add block in theme editor
              </s-button>
            </s-stack>
          </SetupGuideStep>

          <SetupGuideStep
            done={hasCollectionFilters}
            title="Customize your filters"
            description="Choose which fields shoppers can filter by, such as price, availability, or vendor."
            expanded={stepExpanded.step2}
            onToggle={() => toggleStep("step2")}
          >
            <s-stack direction="inline" gap="small-200">
              <s-button
                onClick={() => navigate("/app/filters")}
                variant="primary"
                disabled={hasCollectionFilters || undefined}
              >
                Customize filters
              </s-button>
            </s-stack>
          </SetupGuideStep>

          <SetupGuideStep
            done={step3Verified}
            title="Verify the block is enabled"
            description={
              liveThemeBlockStatus.checked
                ? blockAddedToTheme
                  ? 'The "Collection filters" block is live on your published theme.'
                  : 'We didn\'t find the "Collection filters" block on your published theme\'s collection page yet.'
                : "We couldn't check your theme automatically — verify below or add the block manually."
            }
            expanded={stepExpanded.step3}
            onToggle={() => toggleStep("step3")}
            isLast
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-button
                variant="primary"
                onClick={verifyBlock}
                loading={checking || undefined}
                disabled={step3Verified || undefined}
              >
                {checking ? "Checking…" : "Verify"}
              </s-button>
              {!blockAddedToTheme && (
                <s-link href={collectionFiltersDeepLink} target="_blank">
                  Add it in the theme editor
                </s-link>
              )}
            </s-stack>
          </SetupGuideStep>
        </s-box>
      </s-grid>
    </s-section>
  );
}

// The "Current Plan: ..." pill shown next to the dashboard welcome heading.
function currentPlan({ isPaid, isDevelopmentStore, billingEnabled, isTrialActive }) {
  if (isPaid) return { label: "Paid", tone: "success" };
  if (isDevelopmentStore) return { label: "Development store (free)", tone: "info" };
  if (!billingEnabled) return { label: "Free", tone: "info" };
  if (isTrialActive) return { label: "Free trial", tone: "info" };
  return { label: "Trial ended", tone: "critical" };
}

function TrialBanner({ isPaid, isDevelopmentStore, isTrialActive, trialDaysRemaining, billingEnabled }) {
  const navigate = useNavigate();
  if (isPaid || isDevelopmentStore || !billingEnabled) return null;

  if (!isTrialActive) {
    return (
      <s-banner tone="critical" heading="Your free trial has ended">
        <s-paragraph>
          Storefront filters are now disabled. Upgrade to the Paid plan ($4.99/month) to
          restore filtering for your customers.
        </s-paragraph>
        <s-button slot="action" variant="primary" onClick={() => navigate("/app/plans")}>
          Upgrade now
        </s-button>
      </s-banner>
    );
  }

  return (
    <s-banner tone="warning" heading={`${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"} left in your free trial`}>
      <s-paragraph>
        After your trial ends, storefront filters will stop working until you upgrade to the
        Paid plan ($4.99/month).
      </s-paragraph>
      <s-button slot="action" onClick={() => navigate("/app/plans")}>
        View plan
      </s-button>
    </s-banner>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const customizerPopup = useCustomizerPopup();
  const featureRequestFetcher = useFetcher();
  const {
    shop,
    apiKey,
    shopName,
    enabledFilters,
    themeBlockStatus,
    trialDaysRemaining,
    isTrialActive,
    isPaid,
    isDevelopmentStore,
    billingEnabled,
  } = useLoaderData();

  const plan = currentPlan({ isPaid, isDevelopmentStore, billingEnabled, isTrialActive });

  const collectionFiltersDeepLink = themeEditorDeepLink(shop, apiKey, {
    template: "collection",
    blockHandle: "collection-filters",
  });
  const hasCollectionFilters = enabledFilters.length > 0;

  // s-modal has a known SSR/hydration quirk (see the order-tag-filter modal
  // in app.filters._index.jsx for the same pattern) — only render it once
  // mounted on the client.
  const [mountedFeedbackModal, setMountedFeedbackModal] = useState(false);
  useEffect(() => {
    setMountedFeedbackModal(true);
  }, []);
  const feedbackTitleRef = useRef(null);
  const feedbackDescriptionRef = useRef(null);
  const isSendingFeatureRequest = featureRequestFetcher.state !== "idle";

  const submitFeatureRequest = () => {
    const title = feedbackTitleRef.current?.value?.trim() || "";
    const description = feedbackDescriptionRef.current?.value?.trim() || "";
    featureRequestFetcher.submit(
      { intent: "sendFeatureRequest", title, description },
      { method: "post" },
    );
  };

  useEffect(() => {
    if (featureRequestFetcher.state !== "idle" || !featureRequestFetcher.data) return;
    if (featureRequestFetcher.data.featureRequestSent) {
      document.getElementById("feature-request-modal")?.hideOverlay();
      shopify.toast.show("Thanks! Your feature request has been sent.");
    } else if (featureRequestFetcher.data.featureRequestError) {
      shopify.toast.show(featureRequestFetcher.data.featureRequestError, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureRequestFetcher.state, featureRequestFetcher.data]);

  return (
    <s-page heading="SB Product Filter">
      <s-button slot="primary-action" onClick={() => navigate("/app/filters")}>
        Manage filters
      </s-button>
      <s-button slot="secondary-actions" href="https://startbit.co/helpdesk/open.php" target="_blank">
        Contact Support
      </s-button>

      <s-box paddingBlockEnd="large">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <div style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1.2 }}>
            Welcome, {shopName}
          </div>
          <s-badge tone={plan.tone}>Current Plan: {plan.label}</s-badge>
        </s-grid>
      </s-box>

      <s-stack direction="block" gap="base">
        <TrialBanner
          isPaid={isPaid}
          isDevelopmentStore={isDevelopmentStore}
          isTrialActive={isTrialActive}
          trialDaysRemaining={trialDaysRemaining}
          billingEnabled={billingEnabled}
        />

        <SetupGuide
          hasCollectionFilters={hasCollectionFilters}
          themeBlockStatus={themeBlockStatus}
          collectionFiltersDeepLink={collectionFiltersDeepLink}
        />

        <s-section>
          <s-grid gridTemplateColumns="3fr 7fr" gap="base" alignItems="center">
            <s-grid-item>
              <s-image
                src="/banners/Product-Filter-Dashboard.png"
                alt="SB Product Filter: create powerful product filters for your Shopify store"
                borderRadius="large"
                objectFit="cover"
                aspectRatio="16/9"
                inlineSize="fill"
              />
            </s-grid-item>
            <s-grid-item>
              <s-stack direction="inline" gap="tight" alignItems="center">
                <s-heading>Overview</s-heading>
              </s-stack>
              <s-paragraph>
                This app lets shoppers filter your collection pages and search
                results by price, availability, vendor, tags, product type,
                category, variant options (like size and color), reviews, and
                product metafields — with live product counts and pagination.
              </s-paragraph>
              <s-box paddingBlockStart="base">
                <a
                  href="https://youtu.be/488_BWFrysY"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 16px",
                    borderRadius: "8px",
                    backgroundColor: "#1a1a1a",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    textDecoration: "none",
                    lineHeight: 1,
                  }}
                >
                  <span aria-hidden="true">▶</span>
                  Watch a video
                </a>
              </s-box>
            </s-grid-item>
          </s-grid>
        </s-section>

        <s-section>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="small-300">
                <s-heading>Filters</s-heading>
                <s-paragraph tone="subdued">
                  Let shoppers narrow down collection and search results by
                  price, availability, vendor, tags, product type, variant
                  options, reviews, and metafields.
                </s-paragraph>
                <s-box paddingBlockStart="small-300">
                  <s-button onClick={() => navigate("/app/filters")} variant="primary">
                    Manage filters
                  </s-button>
                </s-box>
              </s-stack>
            </s-box>

            <s-box padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="small-300">
                <s-heading>Customizer</s-heading>
                <s-paragraph tone="subdued">
                  Match the filter widget to your theme — customize colors,
                  fonts, and layout for headings, buttons, and the sidebar
                  from the Customize page.
                </s-paragraph>
                <s-box paddingBlockStart="small-300">
                  <s-button onClick={customizerPopup.onOpen} variant="primary">
                    Go to Customize
                  </s-button>
                </s-box>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>

        <s-section heading="Feature Request">
          <s-paragraph tone="subdued">
            Have an idea to improve the app? We'd love to hear from you —
            submit a request and help shape the future of SB Product Filter.
          </s-paragraph>
          <s-box paddingBlockStart="small-200">
            <s-button
              onClick={() =>
                document.getElementById("feature-request-modal")?.showOverlay()
              }
            >
              Submit a request
            </s-button>
          </s-box>
        </s-section>

        {mountedFeedbackModal && (
          <s-modal id="feature-request-modal" heading="Submit a Feature Request">
            <s-stack direction="block" gap="base">
              <s-paragraph tone="subdued">
                Have an idea to improve the app? We'd love to hear from you.
              </s-paragraph>
              <s-text-field
                ref={feedbackTitleRef}
                label="Title"
                placeholder="Brief title for your idea"
              />
              <s-text-area
                ref={feedbackDescriptionRef}
                label="Description"
                placeholder="Describe the feature and how it would help you"
                rows={4}
              />
              <s-stack direction="inline" gap="base" justifyContent="end">
                <s-button
                  type="button"
                  disabled={isSendingFeatureRequest}
                  onClick={() =>
                    document.getElementById("feature-request-modal")?.hideOverlay()
                  }
                >
                  Cancel
                </s-button>
                <s-button
                  variant="primary"
                  type="button"
                  disabled={isSendingFeatureRequest}
                  onClick={submitFeatureRequest}
                >
                  {isSendingFeatureRequest ? "Sending…" : "Submit"}
                </s-button>
              </s-stack>
            </s-stack>
          </s-modal>
        )}

        <SpotlightSection />

        <FeedbackBar />
      </s-stack>

      <CustomizerPopupModal open={customizerPopup.open} onClose={customizerPopup.onClose} />
    </s-page>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
