import prisma from "./db.server";

const TOP_PRODUCTS = 20;
const TOP_CUSTOMERS = 50;

// Summary of what shoppers have saved to their wishlists, for the merchant's
// Wishlists page. Wishlist items are collected on the storefront and stored by
// this app, so the merchant needs a way to see them.
export async function getWishlistOverview(admin, shop) {
  const [totalItems, customerRows, topProducts, topCustomers] = await Promise.all([
    prisma.wishlistItem.count({ where: { shop } }),
    prisma.wishlistItem.groupBy({ by: ["customerId"], where: { shop } }),
    prisma.wishlistItem.groupBy({
      by: ["productId"],
      where: { shop },
      _count: { productId: true },
      orderBy: { _count: { productId: "desc" } },
      take: TOP_PRODUCTS,
    }),
    prisma.wishlistItem.groupBy({
      by: ["customerId"],
      where: { shop },
      _count: { customerId: true },
      orderBy: { _count: { customerId: "desc" } },
      take: TOP_CUSTOMERS,
    }),
  ]);

  const titles = new Map();
  if (topProducts.length > 0) {
    try {
      const response = await admin.graphql(
        `#graphql
        query WishlistProductTitles($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
            }
          }
        }`,
        { variables: { ids: topProducts.map((row) => row.productId) } },
      );
      const json = await response.json();
      for (const node of json.data?.nodes ?? []) {
        if (node?.id) titles.set(node.id, node.title);
      }
    } catch (error) {
      // Titles are a nicety: fall back to showing the product id.
      console.error(`Wishlist product titles failed for ${shop}:`, error);
    }
  }

  return {
    totalItems,
    customerCount: customerRows.length,
    products: topProducts.map((row) => ({
      productId: row.productId,
      title: titles.get(row.productId) ?? null,
      count: row._count.productId,
    })),
    customers: topCustomers.map((row) => ({
      customerId: row.customerId,
      count: row._count.customerId,
    })),
  };
}
