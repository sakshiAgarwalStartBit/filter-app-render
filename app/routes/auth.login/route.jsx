import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { redirect } from "react-router";

// Merchants install and open this app from Shopify (the App Store or their
// Shopify admin), so it never asks for a shop domain. A request that already
// carries a ?shop= is forwarded to the app; anything else just explains where
// to open it from.
export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function Auth() {
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="SB Product Filter">
          <s-paragraph>
            Open this app from your Shopify admin: go to Apps, then SB Product
            Filter. To install it, find it in the Shopify App Store.
          </s-paragraph>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
