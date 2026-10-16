import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook: a merchant or customer has requested a copy of the
// customer's data. This app's only customer-linked data is wishlist items
// keyed by customerId, so log them for the merchant to retrieve — Shopify
// does not provide a direct reply channel, fulfillment happens out-of-band.
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = payload.customer?.id?.toString();
  if (customerId) {
    const items = await db.wishlistItem.findMany({
      where: { shop, customerId },
      select: { productId: true, createdAt: true },
    });
    console.log(
      `Data request for customer ${customerId} on ${shop}: ${JSON.stringify(items)}`,
    );
  }

  return new Response();
};
