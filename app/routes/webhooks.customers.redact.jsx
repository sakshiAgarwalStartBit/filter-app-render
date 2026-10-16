import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook: erase this customer's data. This app's only
// customer-linked data is wishlist items keyed by customerId.
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = payload.customer?.id?.toString();
  if (customerId) {
    await db.wishlistItem.deleteMany({ where: { shop, customerId } });
  }

  return new Response();
};
