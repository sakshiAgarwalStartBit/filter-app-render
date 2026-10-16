import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { HeadingWithTip } from "../help-tip";
import { SettingsSaveBar } from "../settings-save-bar";
import { RouteErrorBoundary } from "../route-error-boundary";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopSettings = await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  return { shopSettings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const { reviewRatingNamespace, reviewRatingKey, reviewCountKey } = body;

  const cleanKey = (value, fallback) => {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    // Metafield namespaces/keys only ever contain lowercase letters,
    // numbers, and underscores — reject anything else rather than let it
    // flow into the GraphQL query string built in collection-filters.server.js.
    return /^[a-z0-9_]+$/.test(trimmed) ? trimmed : fallback;
  };

  await prisma.shopSettings.upsert({
    where: { shop },
    update: {
      reviewRatingNamespace: cleanKey(reviewRatingNamespace, "reviews"),
      reviewRatingKey: cleanKey(reviewRatingKey, "rating"),
      reviewCountKey: cleanKey(reviewCountKey, "rating_count"),
    },
    create: {
      shop,
      reviewRatingNamespace: cleanKey(reviewRatingNamespace, "reviews"),
      reviewRatingKey: cleanKey(reviewRatingKey, "rating"),
      reviewCountKey: cleanKey(reviewCountKey, "rating_count"),
    },
  });

  return { ok: true };
};

export default function Reviews() {
  const { shopSettings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [howToExpanded, setHowToExpanded] = useState(false);

  const [reviewRatingNamespace, setReviewRatingNamespace] = useState(
    shopSettings.reviewRatingNamespace || "reviews",
  );
  const [reviewRatingKey, setReviewRatingKey] = useState(
    shopSettings.reviewRatingKey || "rating",
  );
  const [reviewCountKey, setReviewCountKey] = useState(
    shopSettings.reviewCountKey || "rating_count",
  );

  const [savedReviewRatingNamespace, setSavedReviewRatingNamespace] = useState(
    shopSettings.reviewRatingNamespace || "reviews",
  );
  const [savedReviewRatingKey, setSavedReviewRatingKey] = useState(
    shopSettings.reviewRatingKey || "rating",
  );
  const [savedReviewCountKey, setSavedReviewCountKey] = useState(
    shopSettings.reviewCountKey || "rating_count",
  );

  const isSaving = fetcher.state !== "idle";

  const dirty =
    reviewRatingNamespace !== savedReviewRatingNamespace ||
    reviewRatingKey !== savedReviewRatingKey ||
    reviewCountKey !== savedReviewCountKey;

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Review settings saved");
      setSavedReviewRatingNamespace(reviewRatingNamespace);
      setSavedReviewRatingKey(reviewRatingKey);
      setSavedReviewCountKey(reviewCountKey);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, shopify]);

  const handleSave = () => {
    fetcher.submit(
      { reviewRatingNamespace, reviewRatingKey, reviewCountKey },
      { method: "POST", encType: "application/json" },
    );
  };

  const handleDiscard = () => {
    setReviewRatingNamespace(savedReviewRatingNamespace);
    setReviewRatingKey(savedReviewRatingKey);
    setReviewCountKey(savedReviewCountKey);
  };

  return (
    <s-page heading="Reviews">
      <SettingsSaveBar
        id="reviews-save-bar"
        dirty={dirty}
        saving={isSaving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />

      <s-section>
        <HeadingWithTip tip={'"Review rating" reads star ratings from a product metafield. These default values match Judge.me. If you use a different review app, find its namespace and keys as described below, then enter them here — the storefront filter and product card star ratings will pick up the new values automatically.'}>
          Review rating source
        </HeadingWithTip>

        <s-box borderRadius="base" border="base" background="subdued" padding="small-300" marginBlockEnd="large">
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-heading>How to setup reviews</s-heading>
            <s-box style={{ "padding-block": ".25rem" }}>
              <s-button
                accessibilityLabel={howToExpanded ? "Collapse instructions" : "Expand instructions"}
                variant="tertiary"
                onClick={() => setHowToExpanded((prev) => !prev)}
                icon={howToExpanded ? "chevron-up" : "chevron-down"}
              />
            </s-box>
          </s-grid>
          <s-box display={howToExpanded ? "auto" : "none"} paddingBlockStart="small-300">
            <s-paragraph tone="subdued">
              These defaults ({'"reviews"'} / {'"rating"'} / {'"rating_count"'})
              match Judge.me. If you use a different review app (Loox, Stamped,
              Ryviu, etc.), find the correct values for it here:
            </s-paragraph>
            <s-ordered-list>
              <s-list-item>
                In Shopify admin, go to{" "}
                <s-text type="strong">Settings → Custom data → Products</s-text>.
              </s-list-item>
              <s-list-item>
                Look for a metafield definition your review app created — its
                name usually matches the app (e.g. &ldquo;Judge.me&rdquo;,
                &ldquo;Loox&rdquo;, &ldquo;Stamped.io&rdquo;). Click it to open
                the definition.
              </s-list-item>
              <s-list-item>
                The definition&apos;s{" "}
                <s-text type="strong">Namespace and key</s-text> field shows a
                value like <s-text type="strong">reviews.rating</s-text> — the
                part before the dot is the{" "}
                <s-text type="strong">Metafield namespace</s-text>, the part
                after is the <s-text type="strong">Rating key</s-text>.
              </s-list-item>
              <s-list-item>
                Repeat for the review count field (often named
                &ldquo;rating_count&rdquo;, &ldquo;review_count&rdquo;, or
                similar) to get the{" "}
                <s-text type="strong">Review count key</s-text>.
              </s-list-item>
              <s-list-item>
                Don&apos;t see any metafields there? Open one of your products in
                admin, scroll to the <s-text type="strong">Metafields</s-text>{" "}
                section near the bottom — any values written by your review app
                will be listed there with their namespace and key.
              </s-list-item>
            </s-ordered-list>
          </s-box>
        </s-box>

        <s-box paddingBlockStart="large">
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <s-text-field
              label="Metafield namespace"
              value={reviewRatingNamespace}
              onChange={(e) => setReviewRatingNamespace(e.target.value)}
            />
            <s-text-field
              label="Rating key"
              value={reviewRatingKey}
              onChange={(e) => setReviewRatingKey(e.target.value)}
            />
            <s-text-field
              label="Review count key"
              value={reviewCountKey}
              onChange={(e) => setReviewCountKey(e.target.value)}
            />
          </s-grid>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
