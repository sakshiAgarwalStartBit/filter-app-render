import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import { Form, redirect, useActionData } from "react-router";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";
import { login } from "../../shopify.server";

function loginErrorMessage(loginErrors) {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  }
  if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return {};
}

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

// The landing page's "Install app" form posts a shop domain here; login()
// validates it and redirects into OAuth, or returns an error to display.
export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

export default function Auth() {
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const error = actionData?.errors?.shop;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
          <s-section heading="Install SB Product Filter">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              autocomplete="on"
              error={error}
            ></s-text-field>
            <s-button type="submit">Install app</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
