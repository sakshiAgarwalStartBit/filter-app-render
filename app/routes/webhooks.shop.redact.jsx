import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook: fires 48 hours after uninstall, requesting full
// erasure of this shop's data. Delete everything scoped to the shop.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await Promise.all([
    db.filterConfig.deleteMany({ where: { shop } }),
    db.filterContextSettings.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
    db.wishlistItem.deleteMany({ where: { shop } }),
    db.productCache.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
