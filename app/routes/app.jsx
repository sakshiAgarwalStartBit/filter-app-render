import { Outlet, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getTrialStatus } from "../billing.server";
import { RouteErrorBoundary } from "../route-error-boundary";

const PLANS_PATH = "/app/plans";

export const loader = async ({ request }) => {
  // Use the `redirect` from authenticate.admin, not react-router's: it keeps
  // the embedded-app params (host, shop, embedded), which a plain redirect
  // drops and which then leaks the auth bounce's "200" onto the page.
  const { admin, session, redirect } = await authenticate.admin(request);

  const trialStatus = await getTrialStatus(session.shop, admin);
  const url = new URL(request.url);
  if (!trialStatus.hasAccess && url.pathname !== PLANS_PATH) {
    throw redirect(PLANS_PATH);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", hasAccess: trialStatus.hasAccess };
};

export default function App() {
  const { apiKey, hasAccess } = useLoaderData();
  // Pages opened inside the Customizer's ui-modal popup (see
  // customizer-popup.jsx) are loaded via this same layout route, so the app
  // nav would otherwise render inside the modal too. ?popup=1 marks that
  // case so the nav is skipped there.
  const [searchParams] = useSearchParams();
  const isPopup = searchParams.get("popup") === "1";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {!isPopup && (
        <s-app-nav>
          {hasAccess && <s-link href="/app/filters">Filters</s-link>}
          {hasAccess && <s-link href="/app/reviews">Reviews</s-link>}
          {hasAccess && <s-link href="/app/wishlists">Wishlists</s-link>}
          <s-link href="/app/plans">Plans</s-link>
        </s-app-nav>
      )}
      <Outlet />
    </AppProvider>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
