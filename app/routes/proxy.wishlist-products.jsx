import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getProductsByIds } from "../collection-filters.server";

function getVerifiedCustomerId(request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  return customerId && /^[0-9]+$/.test(customerId) ? customerId : null;
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return new Response(null, { status: 404 });
  }

  const customerId = getVerifiedCustomerId(request);
  if (!customerId) {
    return Response.json({ products: [] });
  }

  const items = await prisma.wishlistItem.findMany({
    where: { shop: session.shop, customerId },
    select: { productId: true },
  });

  const result = await getProductsByIds(
    admin,
    session.shop,
    items.map((i) => i.productId),
  );

  if (result.error) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
};
