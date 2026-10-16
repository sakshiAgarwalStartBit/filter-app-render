import { authenticate } from "../shopify.server";
import { getTrialStatus } from "../billing.server";

// Keeps ShopSettings.plan current between admin visits. Fires on
// app_subscriptions/update (a plan is approved, cancelled or expires) and
// shop/update (e.g. a development store going live). The storefront filters
// read the stored plan, so without this a cancelled plan, or a dev store
// that went live, would keep its old access until someone next opened the
// app in the admin.
export const action = async ({ request }) => {
  const { shop, topic, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // `admin` is undefined once the app has been uninstalled (the session is
  // gone), in which case there is nothing left to refresh.
  if (admin) {
    await getTrialStatus(shop, admin);
  }

  return new Response();
};
