import { authenticate } from "../shopify.server";
import { clearProductCache } from "../collection-filters.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // A product changed, so cached collections may be out of date.
  await clearProductCache(shop);

  return new Response();
};
