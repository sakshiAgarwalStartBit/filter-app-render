import { authenticate } from "../shopify.server";
import { getCollectionProducts } from "../collection-filters.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const collectionHandle = url.searchParams.get("collection");
  const sort = url.searchParams.get("sort");
  const searchTerms = url.searchParams.get("search");

  const result = await getCollectionProducts(
    admin,
    session.shop,
    collectionHandle,
    sort,
    searchTerms,
  );

  if (result.error) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
};
