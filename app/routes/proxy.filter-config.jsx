import { authenticate } from "../shopify.server";
import { getFilterConfig } from "../collection-filters.server";

const VALID_CONTEXTS = new Set(["collection", "search"]);

export const loader = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const contextParam = url.searchParams.get("context");
  const context = VALID_CONTEXTS.has(contextParam) ? contextParam : "collection";

  const config = await getFilterConfig(session.shop, context);

  return Response.json(config, {
    headers: { "Cache-Control": "no-store" },
  });
};
