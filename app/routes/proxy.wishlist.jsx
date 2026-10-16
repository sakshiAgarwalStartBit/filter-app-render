import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d{1,20}$/;
const MAX_WISHLIST_ITEMS = 500;

function getVerifiedCustomerId(request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  return customerId && /^[0-9]+$/.test(customerId) ? customerId : null;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return new Response(null, { status: 404 });
  }

  const customerId = getVerifiedCustomerId(request);
  if (!customerId) {
    return Response.json({ productIds: [] });
  }

  const items = await prisma.wishlistItem.findMany({
    where: { shop: session.shop, customerId },
    select: { productId: true },
  });

  return Response.json(
    { productIds: items.map((i) => i.productId) },
    { headers: { "Cache-Control": "no-store" } },
  );
};

export const action = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return new Response(null, { status: 404 });
  }

  const customerId = getVerifiedCustomerId(request);
  if (!customerId) {
    return Response.json({ error: "Log in to use the wishlist" }, { status: 401 });
  }

  let productId;
  try {
    ({ productId } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof productId !== "string" || !PRODUCT_GID_PATTERN.test(productId)) {
    return Response.json({ error: "Invalid productId parameter" }, { status: 400 });
  }

  const shop = session.shop;
  const existing = await prisma.wishlistItem.findUnique({
    where: { shop_customerId_productId: { shop, customerId, productId } },
  });

  if (existing) {
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
    return Response.json({ ok: true, wishlisted: false });
  }

  // Removing is always allowed above; only adding is capped.
  const itemCount = await prisma.wishlistItem.count({ where: { shop, customerId } });
  if (itemCount >= MAX_WISHLIST_ITEMS) {
    return Response.json(
      { error: `Your wishlist is full (${MAX_WISHLIST_ITEMS} items)` },
      { status: 400 },
    );
  }

  await prisma.wishlistItem.create({ data: { shop, customerId, productId } });
  return Response.json({ ok: true, wishlisted: true });
};
