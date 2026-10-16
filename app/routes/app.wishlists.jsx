import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getWishlistOverview } from "../wishlist-admin.server";
import { RouteErrorBoundary } from "../route-error-boundary";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const overview = await getWishlistOverview(admin, session.shop);

  return {
    ...overview,
    storeHandle: session.shop.replace(/\.myshopify\.com$/, ""),
  };
};

export default function Wishlists() {
  const { totalItems, customerCount, products, customers, storeHandle } = useLoaderData();

  return (
    <s-page heading="Wishlists">
      <s-section heading="Overview">
        <s-paragraph tone="subdued">
          Products your logged-in customers have saved with the wishlist heart icon. Guest
          wishlists stay in the shopper&apos;s own browser and aren&apos;t listed here.
        </s-paragraph>
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="small-300">
            <s-text tone="subdued">Saved items</s-text>
            <s-heading>{totalItems}</s-heading>
          </s-stack>
          <s-stack direction="block" gap="small-300">
            <s-text tone="subdued">Customers with a wishlist</s-text>
            <s-heading>{customerCount}</s-heading>
          </s-stack>
        </s-stack>
      </s-section>

      {totalItems === 0 ? (
        <s-section heading="No wishlists yet">
          <s-paragraph>
            Nothing has been saved yet. To let shoppers save products, turn on the wishlist heart
            icon under Filters, then Layout &amp; display.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section heading="Most saved products">
            <s-table>
              <s-table-header-row>
                <s-table-header>Product</s-table-header>
                <s-table-header>Times saved</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {products.map((product) => (
                  <s-table-row key={product.productId}>
                    <s-table-cell>{product.title ?? product.productId}</s-table-cell>
                    <s-table-cell>{product.count}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-section heading="Customers">
            <s-table>
              <s-table-header-row>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Saved items</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {customers.map((customer) => (
                  <s-table-row key={customer.customerId}>
                    <s-table-cell>
                      <s-link
                        href={`https://admin.shopify.com/store/${storeHandle}/customers/${customer.customerId}`}
                        target="_blank"
                      >
                        Customer {customer.customerId}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{customer.count}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const ErrorBoundary = RouteErrorBoundary;

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
