import { createHash } from "node:crypto";
import prisma from "./db.server";
import { getTrialStatus } from "./billing.server";

const COLLECTION_HANDLE_PATTERN = /^[a-z0-9-]*$/;
const PAGE_SIZE = 250;
// Safety cap on how many products a single storefront filter request will
// page through. Shopify collections/catalogs can hold far more than this;
// beyond the cap we stop paginating rather than risk unbounded GraphQL cost
// (and an unbounded response) for very large catalogs.
const MAX_PRODUCTS = 2000;
const ALL_PRODUCTS_HANDLES = new Set(["", "all"]);
// How long a cached collection stays valid. Product updates clear it sooner
// via webhook; this is the safety net if a webhook is missed.
const PRODUCT_CACHE_TTL_MS = 10 * 60 * 1000;
// Bump when the shape or filtering of cached products changes, so entries
// saved by older code are ignored instead of served.
const PRODUCT_CACHE_VERSION = 4;
// The storefront product endpoint is public (anyone can open the shop's
// /apps/... URL), and a search miss costs a full catalog fetch. These limits
// stop it being used to burn through a shop's Admin API allowance.
const SEARCH_CACHE_PREFIX = "s:";
const MAX_SEARCH_TERM_LENGTH = 100;
const MAX_UNCACHED_SEARCHES_PER_MINUTE = 60;
const MAX_CACHED_SEARCHES_PER_SHOP = 200;

// Retries a throttled Admin GraphQL request using the cost extension's
// throttleStatus to wait exactly as long as needed for the bucket to refill,
// instead of guessing a backoff delay.
async function graphqlWithRetry(admin, query, options, maxRetries = 3) {
  for (let attempt = 0; ; attempt++) {
    const response = await admin.graphql(query, options);
    const body = await response.json();
    const throttled = body.errors?.some(
      (e) => e.extensions?.code === "THROTTLED",
    );

    if (!throttled || attempt >= maxRetries) {
      return body;
    }

    const throttleStatus = body.extensions?.cost?.throttleStatus;
    const requestedCost = body.extensions?.cost?.requestedQueryCost ?? 100;
    const waitMs = throttleStatus
      ? Math.max(
          0,
          ((requestedCost - throttleStatus.currentlyAvailable) /
            throttleStatus.restoreRate) *
            1000,
        )
      : 500 * 2 ** attempt;

    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
  }
}

// Fetches all pages of a `first`/`after` product connection up to
// MAX_PRODUCTS, retrying on throttling. `getConnection` extracts the
// products connection (edges + pageInfo) from a response body's `data`.
async function fetchAllProducts({ admin, query, baseVariables, getConnection }) {
  let after = null;
  let allEdges = [];
  let lastBody = null;

  while (allEdges.length < MAX_PRODUCTS) {
    const remaining = MAX_PRODUCTS - allEdges.length;
    const body = await graphqlWithRetry(admin, query, {
      variables: {
        ...baseVariables,
        first: Math.min(PAGE_SIZE, remaining),
        after,
      },
    });

    lastBody = body;
    if (body.errors?.length) {
      return { errors: body.errors, data: body.data };
    }

    const connection = getConnection(body.data);
    if (!connection) {
      return { errors: null, data: body.data };
    }

    allEdges = allEdges.concat(connection.edges);

    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }

  return { errors: null, data: lastBody.data, edges: allEdges };
}

// Sort keys for products within a specific collection (Collection.products).
const COLLECTION_SORT_OPTIONS = {
  featured: { sortKey: "COLLECTION_DEFAULT", reverse: false },
  best_selling: { sortKey: "BEST_SELLING", reverse: false },
  price_asc: { sortKey: "PRICE", reverse: false },
  price_desc: { sortKey: "PRICE", reverse: true },
  title_asc: { sortKey: "TITLE", reverse: false },
  title_desc: { sortKey: "TITLE", reverse: true },
};

// Sort keys for the shop-wide product list (Query.products) — this connection
// has no BEST_SELLING or PRICE sort key, so those fall back to client-side
// sorting after fetching (see sortProductsClientSide below).
const ALL_PRODUCTS_SORT_OPTIONS = {
  featured: { sortKey: "ID", reverse: false },
  best_selling: { sortKey: "ID", reverse: false },
  price_asc: { sortKey: "ID", reverse: false },
  price_desc: { sortKey: "ID", reverse: false },
  title_asc: { sortKey: "TITLE", reverse: false },
  title_desc: { sortKey: "TITLE", reverse: true },
};

function sortProductsClientSide(products, sort) {
  if (sort === "price_asc" || sort === "price_desc") {
    const sorted = [...products].sort(
      (a, b) =>
        Number(a.priceRange.minVariantPrice.amount) -
        Number(b.priceRange.minVariantPrice.amount),
    );
    return sort === "price_desc" ? sorted.reverse() : sorted;
  }
  return products;
}

function metafieldAlias(index) {
  return `mf${index}`;
}

export async function getFilterConfig(shop, context = "collection") {
  const [filters, shopSettings, contextSettings, trialStatus] = await Promise.all([
    prisma.filterConfig.findMany({
      where: { shop, context, enabled: true },
      orderBy: { position: "asc" },
      select: {
        fieldKey: true,
        fieldType: true,
        label: true,
        position: true,
        displayType: true,
        selectMode: true,
        valuePrefix: true,
      },
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
    prisma.filterContextSettings.findUnique({
      where: { shop_context: { shop, context } },
    }),
    getTrialStatus(shop),
  ]);

  // Once the 7-day trial ends without a paid subscription, stop serving
  // filters to the storefront rather than deleting the merchant's saved
  // configuration — access resumes automatically once they upgrade.
  return {
    filters: trialStatus.hasAccess ? filters : [],
    trialExpired: !trialStatus.hasAccess,
    pageSize: contextSettings?.pageSize ?? 10,
    filterLayout: contextSettings?.filterLayout ?? "vertical",
    showFilterCounts: shopSettings?.showFilterCounts ?? true,
    showWishlist: shopSettings?.showWishlist ?? false,
    valueStyle: {
      fontSize: shopSettings?.valueFontSize ?? 14,
      fontWeight: shopSettings?.valueFontWeight ?? 400,
      textTransform: shopSettings?.valueTextTransform ?? "none",
      textColor: shopSettings?.valueTextColor ?? "#3A3A3A",
    },
    headingStyle: {
      fontSize: shopSettings?.headingFontSize ?? 16,
      fontWeight: shopSettings?.headingFontWeight ?? 600,
      textTransform: shopSettings?.headingTextTransform ?? "none",
      textColor: shopSettings?.headingTextColor ?? "#1A1A1A",
    },
    buttonStyle: {
      fontSize: shopSettings?.buttonFontSize ?? 14,
      fontWeight: shopSettings?.buttonFontWeight ?? 700,
      borderRadius: shopSettings?.buttonBorderRadius ?? 0,
      textTransform: shopSettings?.buttonTextTransform ?? "none",
      textColor: shopSettings?.buttonTextColor ?? "#3A3A3A",
      borderColor: shopSettings?.buttonBorderColor ?? "#BFBFBF",
      backgroundColor: shopSettings?.buttonBackgroundColor ?? "#FFFFFF",
    },
    toggleStyle: {
      fontSize: shopSettings?.toggleFontSize ?? 16,
      fontWeight: shopSettings?.toggleFontWeight ?? 700,
      borderRadius: shopSettings?.toggleBorderRadius ?? 6,
      textTransform: shopSettings?.toggleTextTransform ?? "none",
      textColor: shopSettings?.toggleTextColor ?? "#1A1A1A",
      borderColor: shopSettings?.toggleBorderColor ?? "#D1D1D1",
      backgroundColor: shopSettings?.toggleBackgroundColor ?? "#FFFFFF",
    },
    sidebarBackgroundColor: shopSettings?.sidebarBackgroundColor ?? "#F5F5F5",
    productGridColumns: shopSettings?.productGridColumns ?? 4,
    swatchShape: shopSettings?.swatchShape ?? "circle",
    addToCartStyle:
      context === "search"
        ? {
            backgroundColor: shopSettings?.addToCartSearchBackgroundColor ?? "#1A1A1A",
            textColor: shopSettings?.addToCartSearchTextColor ?? "#FFFFFF",
            fontSize: shopSettings?.addToCartSearchFontSize ?? 14,
          }
        : {
            backgroundColor: shopSettings?.addToCartCollectionBackgroundColor ?? "#1A1A1A",
            textColor: shopSettings?.addToCartCollectionTextColor ?? "#FFFFFF",
            fontSize: shopSettings?.addToCartCollectionFontSize ?? 14,
          },
    customCss:
      (context === "search"
        ? shopSettings?.customCssSearch
        : shopSettings?.customCssCollection) ?? "",
    showOnDesktop: contextSettings?.showOnDesktop ?? true,
    showOnMobile: contextSettings?.showOnMobile ?? true,
    clearAllButtonText: contextSettings?.clearAllButtonText ?? "Clear all",
  };
}

// Only products shoppers can actually see are returned: active AND published
// to the Online Store. Product.publishedAt is the date it was published to
// the Online Store (null if it isn't, a future date if scheduled), and unlike
// the publication fields it works with the app's existing scopes. This
// deliberately does NOT use onlineStoreUrl: it was null for every product on
// a development store whose products were live, which hid everything.
function isStorefrontVisible(product) {
  if (product.status !== "ACTIVE" || !product.publishedAt) return false;
  return new Date(product.publishedAt).getTime() <= Date.now();
}

function mapProductNode(node, metafieldFields) {
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    vendor: node.vendor,
    productType: node.productType,
    tags: node.tags,
    status: node.status,
    availableForSale: node.tracksInventory ? node.totalInventory > 0 : true,
    onlineStoreUrl: node.onlineStoreUrl,
    publishedAt: node.publishedAt,
    category: node.category,
    featuredImage: node.featuredMedia?.preview?.image
      ? {
          url: node.featuredMedia.preview.image.url,
          altText: node.featuredMedia.preview.image.altText,
        }
      : null,
    hoverImage: getSecondImage(node),
    priceRange: {
      minVariantPrice: node.priceRangeV2.minVariantPrice,
      maxVariantPrice: node.priceRangeV2.maxVariantPrice,
    },
    compareAtPriceRange: node.compareAtPriceRange?.minVariantCompareAtPrice
      ? {
          minVariantCompareAtPrice: node.compareAtPriceRange.minVariantCompareAtPrice,
          maxVariantCompareAtPrice: node.compareAtPriceRange.maxVariantCompareAtPrice,
        }
      : null,
    options: node.options,
    reviewRating: getReviewRating(node),
    reviewCount: getReviewCount(node),
    metafields: metafieldFields.map(({ alias, namespace, key }) => {
      const field = node[alias];
      return field ? { namespace, key, value: field.value } : null;
    }),
    firstAvailableVariant: getFirstAvailableVariant(node),
    hasMultipleVariants: (node.variants?.edges?.length ?? 0) > 1,
    variants: mapVariants(node),
  };
}

// Metafield namespaces/keys only ever contain lowercase letters, numbers,
// and underscores — enforced here before any such value is spliced into a
// GraphQL query string (both FilterConfig-sourced metafield selections
// above, and the merchant-editable review-source config below).
const METAFIELD_IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;

function safeMetafieldPart(value, fallback) {
  return typeof value === "string" && METAFIELD_IDENTIFIER_PATTERN.test(value)
    ? value
    : fallback;
}

function getReviewRating(node) {
  const raw = node.reviewRatingMeta?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const value = Number(parsed.value);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function getReviewCount(node) {
  const raw = node.reviewCountMeta?.value;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function getSecondImage(node) {
  const mediaImages = node.media?.edges?.map(({ node: m }) => m.preview?.image).filter(Boolean) ?? [];
  const second = mediaImages[1];
  return second ? { url: second.url, altText: second.altText } : null;
}

function mapVariants(node) {
  const variants = node.variants?.edges?.map(({ node: v }) => v) ?? [];
  return variants.map((v) => ({
    id: v.id.split("/").pop(),
    availableForSale: v.availableForSale,
    price: v.price,
    selectedOptions: v.selectedOptions,
    image: v.media?.edges?.[0]?.node?.preview?.image
      ? {
          url: v.media.edges[0].node.preview.image.url,
          altText: v.media.edges[0].node.preview.image.altText,
        }
      : null,
  }));
}

function getFirstAvailableVariant(node) {
  const variants = node.variants?.edges?.map(({ node: v }) => v) ?? [];
  const available = variants.find((v) => v.availableForSale);
  const chosen = available || variants[0];
  if (!chosen) return null;

  const numericId = chosen.id.split("/").pop();
  return {
    id: numericId,
    availableForSale: chosen.availableForSale,
  };
}

function productNodeFields(reviewConfig) {
  const namespace = safeMetafieldPart(reviewConfig?.namespace, "reviews");
  const ratingKey = safeMetafieldPart(reviewConfig?.ratingKey, "rating");
  const countKey = safeMetafieldPart(reviewConfig?.countKey, "rating_count");

  return `
  id
  title
  handle
  vendor
  productType
  tags
  status
  onlineStoreUrl
  publishedAt
  totalInventory
  tracksInventory
  category {
    id
    name
  }
  featuredMedia {
    preview {
      image {
        url(transform: { maxWidth: 400 })
        altText
      }
    }
  }
  media(first: 2) {
    edges {
      node {
        preview {
          image {
            url(transform: { maxWidth: 400 })
            altText
          }
        }
      }
    }
  }
  priceRangeV2 {
    minVariantPrice {
      amount
      currencyCode
    }
    maxVariantPrice {
      amount
      currencyCode
    }
  }
  compareAtPriceRange {
    minVariantCompareAtPrice {
      amount
      currencyCode
    }
    maxVariantCompareAtPrice {
      amount
      currencyCode
    }
  }
  reviewRatingMeta: metafield(namespace: "${namespace}", key: "${ratingKey}") {
    value
  }
  reviewCountMeta: metafield(namespace: "${namespace}", key: "${countKey}") {
    value
  }
  options {
    name
    optionValues {
      name
      swatch {
        color
        image {
          preview {
            image {
              url
            }
          }
        }
      }
    }
  }
  variants(first: 25) {
    edges {
      node {
        id
        availableForSale
        price
        selectedOptions {
          name
          value
        }
        media(first: 1) {
          edges {
            node {
              preview {
                image {
                  url(transform: { maxWidth: 400 })
                  altText
                }
              }
            }
          }
        }
      }
    }
  }
`;
}

function productCacheKey(parts) {
  return createHash("sha1")
    .update(JSON.stringify([PRODUCT_CACHE_VERSION, parts]))
    .digest("hex");
}

// Cache problems must never break the storefront: on any failure, fall
// through to fetching from Shopify as if there were no cache.
async function readProductCache(shop, cacheKey) {
  try {
    const row = await prisma.productCache.findUnique({
      where: { shop_cacheKey: { shop, cacheKey } },
    });
    if (row && Date.now() - row.createdAt.getTime() < PRODUCT_CACHE_TTL_MS) {
      return row.data;
    }
  } catch (error) {
    console.error(`Product cache read failed for ${shop}:`, error);
  }
  return null;
}

async function writeProductCache(shop, cacheKey, data) {
  try {
    await prisma.productCache.upsert({
      where: { shop_cacheKey: { shop, cacheKey } },
      update: { data, createdAt: new Date() },
      create: { shop, cacheKey, data },
    });
    // Drop this shop's expired rows so the table doesn't grow unbounded.
    await prisma.productCache.deleteMany({
      where: { shop, createdAt: { lt: new Date(Date.now() - PRODUCT_CACHE_TTL_MS) } },
    });

    // Search terms are free text, so bound how many search rows one shop can
    // hold by evicting the oldest ones.
    if (cacheKey.startsWith(SEARCH_CACHE_PREFIX)) {
      const searchRows = { shop, cacheKey: { startsWith: SEARCH_CACHE_PREFIX } };
      const total = await prisma.productCache.count({ where: searchRows });
      if (total > MAX_CACHED_SEARCHES_PER_SHOP) {
        const oldest = await prisma.productCache.findMany({
          where: searchRows,
          orderBy: { createdAt: "asc" },
          take: total - MAX_CACHED_SEARCHES_PER_SHOP,
          select: { id: true },
        });
        await prisma.productCache.deleteMany({
          where: { id: { in: oldest.map((row) => row.id) } },
        });
      }
    }
  } catch (error) {
    console.error(`Product cache write failed for ${shop}:`, error);
  }
}

// Cache rows are only written on a miss, so the number of search rows created
// in the last minute is the number of uncached searches. Fails open: a
// database error must not block real shoppers.
async function isSearchRateLimited(shop) {
  try {
    const recent = await prisma.productCache.count({
      where: {
        shop,
        cacheKey: { startsWith: SEARCH_CACHE_PREFIX },
        createdAt: { gt: new Date(Date.now() - 60 * 1000) },
      },
    });
    return recent >= MAX_UNCACHED_SEARCHES_PER_MINUTE;
  } catch (error) {
    console.error(`Search rate-limit check failed for ${shop}:`, error);
    return false;
  }
}

export async function clearProductCache(shop) {
  await prisma.productCache.deleteMany({ where: { shop } });
}

export async function getCollectionProducts(admin, shop, collectionHandle, sort, searchTerms) {
  // Normalised so equivalent searches ("Shirt", " shirt ") share one cache
  // entry, and capped so a huge term can't be sent to Shopify. Shopify's
  // product search is case-insensitive, so lowercasing doesn't change results.
  const normalizedSearch =
    typeof searchTerms === "string"
      ? searchTerms.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_SEARCH_TERM_LENGTH)
      : "";
  const isSearch = normalizedSearch !== "";

  if (!isSearch && (collectionHandle == null || !COLLECTION_HANDLE_PATTERN.test(collectionHandle))) {
    return { error: "Invalid collection parameter", status: 400 };
  }

  // Once the 7-day trial ends without a paid subscription, stop serving
  // products to the storefront widget (same gate as getFilterConfig).
  const trialStatus = await getTrialStatus(shop);
  if (!trialStatus.hasAccess) {
    return { products: [], trialExpired: true };
  }

  const isAllProducts = !isSearch && ALL_PRODUCTS_HANDLES.has(collectionHandle);
  const context = isSearch ? "search" : "collection";

  // Unknown sort values already behave like "featured" below; resolving them
  // here keeps them from creating extra cache entries (and Object.hasOwn
  // rejects inherited keys such as "constructor").
  const sortOptions = isSearch || isAllProducts ? ALL_PRODUCTS_SORT_OPTIONS : COLLECTION_SORT_OPTIONS;
  const sortName = Object.hasOwn(sortOptions, sort) ? sort : "featured";

  const [enabledFilters, shopSettings] = await Promise.all([
    prisma.filterConfig.findMany({
      where: { shop, context, enabled: true, fieldType: "metafield" },
    }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  const reviewConfig = {
    namespace: shopSettings?.reviewRatingNamespace,
    ratingKey: shopSettings?.reviewRatingKey,
    countKey: shopSettings?.reviewCountKey,
  };
  const productNodeFieldsSelection = productNodeFields(reviewConfig);

  const metafieldFields = enabledFilters
    .map((filter, index) => {
      const [namespace, key] = filter.fieldKey.replace("metafield:", "").split(".");
      return { alias: metafieldAlias(index), namespace, key };
    })
    // Metafield namespace/key ultimately come from a FilterConfig row's
    // fieldKey, written by the admin action from merchant-submitted JSON
    // with no format check at write time — validate here, right before
    // splicing into a GraphQL query string, rather than trusting the DB.
    .filter(
      ({ namespace, key }) =>
        METAFIELD_IDENTIFIER_PATTERN.test(namespace || "") &&
        METAFIELD_IDENTIFIER_PATTERN.test(key || ""),
    );

  const metafieldSelections = metafieldFields
    .map(
      ({ alias, namespace, key }) =>
        `${alias}: metafield(namespace: "${namespace}", key: "${key}") { namespace key value }`,
    )
    .join("\n");

  const cacheKey =
    (isSearch ? SEARCH_CACHE_PREFIX : "c:") +
    productCacheKey(
      isSearch
        ? [normalizedSearch, sortName, metafieldFields, reviewConfig]
        : [collectionHandle, sortName, metafieldFields, reviewConfig],
    );
  const cached = await readProductCache(shop, cacheKey);
  if (cached) return cached;

  if (isSearch && (await isSearchRateLimited(shop))) {
    return { error: "Too many searches. Please try again in a moment.", status: 429 };
  }

  if (isSearch) {
    const { sortKey, reverse } =
      ALL_PRODUCTS_SORT_OPTIONS[sortName] || ALL_PRODUCTS_SORT_OPTIONS.featured;

    const { errors, edges } = await fetchAllProducts({
      admin,
      query: `#graphql
        query SearchShopProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
          products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
            edges {
              node {
                ${productNodeFieldsSelection}
                ${metafieldSelections}
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      baseVariables: { query: `status:active (${normalizedSearch})`, sortKey, reverse },
      getConnection: (data) => data?.products,
    });

    if (errors?.length) {
      return { error: "Failed to load products", status: 502 };
    }

    const products = sortProductsClientSide(
      edges
        .map(({ node }) => mapProductNode(node, metafieldFields))
        .filter(isStorefrontVisible),
      sortName,
    );

    const result = { products };
    await writeProductCache(shop, cacheKey, result);
    return result;
  }

  if (isAllProducts) {
    const { sortKey, reverse } =
      ALL_PRODUCTS_SORT_OPTIONS[sortName] || ALL_PRODUCTS_SORT_OPTIONS.featured;

    const { errors, edges } = await fetchAllProducts({
      admin,
      query: `#graphql
        query AllShopProducts($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
          products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
            edges {
              node {
                ${productNodeFieldsSelection}
                ${metafieldSelections}
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      baseVariables: { query: "status:active", sortKey, reverse },
      getConnection: (data) => data?.products,
    });

    if (errors?.length) {
      return { error: "Failed to load products", status: 502 };
    }

    const products = sortProductsClientSide(
      edges
        .map(({ node }) => mapProductNode(node, metafieldFields))
        .filter(isStorefrontVisible),
      sortName,
    );

    const result = { products };
    await writeProductCache(shop, cacheKey, result);
    return result;
  }

  const { sortKey, reverse } =
    COLLECTION_SORT_OPTIONS[sortName] || COLLECTION_SORT_OPTIONS.featured;

  const { errors, data, edges } = await fetchAllProducts({
    admin,
    query: `#graphql
      query CollectionFilterProducts($identifier: CollectionIdentifierInput!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean) {
        collectionByIdentifier(identifier: $identifier) {
          id
          products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
            edges {
              node {
                ${productNodeFieldsSelection}
                ${metafieldSelections}
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`,
    baseVariables: { identifier: { handle: collectionHandle }, sortKey, reverse },
    getConnection: (data) => data?.collectionByIdentifier?.products,
  });

  if (errors?.length) {
    return { error: "Failed to load products", status: 502 };
  }
  if (!data?.collectionByIdentifier) {
    return { error: "Collection not found", status: 404 };
  }

  const products = edges
    .map(({ node }) => mapProductNode(node, metafieldFields))
    .filter(isStorefrontVisible);

  const result = { products };
  await writeProductCache(shop, cacheKey, result);
  return result;
}

// Shopify's `nodes(ids:)` field accepts at most 250 IDs per call.
const NODES_QUERY_BATCH_SIZE = 250;

export async function getProductsByIds(admin, shop, productIds) {
  if (productIds.length === 0) return { products: [] };

  const shopSettings = await prisma.shopSettings.findUnique({ where: { shop } });
  const reviewConfig = {
    namespace: shopSettings?.reviewRatingNamespace,
    ratingKey: shopSettings?.reviewRatingKey,
    countKey: shopSettings?.reviewCountKey,
  };
  const productNodeFieldsSelection = productNodeFields(reviewConfig);

  const query = `#graphql
    query WishlistProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          ${productNodeFieldsSelection}
        }
      }
    }`;

  const batches = [];
  for (let i = 0; i < productIds.length; i += NODES_QUERY_BATCH_SIZE) {
    batches.push(productIds.slice(i, i + NODES_QUERY_BATCH_SIZE));
  }

  const products = [];
  for (const batch of batches) {
    const body = await graphqlWithRetry(admin, query, { variables: { ids: batch } });
    if (body.errors?.length) {
      return { error: "Failed to load products", status: 502 };
    }
    for (const node of body.data?.nodes || []) {
      if (!node) continue;
      const product = mapProductNode(node, []);
      if (isStorefrontVisible(product)) products.push(product);
    }
  }

  return { products };
}

// An app block reference in template JSON looks like
// "shopify://apps/{app-handle}/blocks/{block-handle}/{uuid}" — match on the
// block handle segment, not the full URI, since the app handle can vary
// (e.g. a "-1", "-2" suffix Shopify appends if the handle collides) and the
// uuid is unique per placement.
// Blocks can nest inside other blocks (e.g. a block that itself accepts
// child blocks), so this walks the whole blocks tree rather than assuming
// app blocks always sit directly under a section.
function blocksContainAppBlock(blocks, needle) {
  if (!blocks || typeof blocks !== "object") return false;
  return Object.values(blocks).some((block) => {
    if (typeof block?.type === "string" && block.type.includes(needle)) {
      return true;
    }
    return blocksContainAppBlock(block?.blocks, needle);
  });
}

// Shopify theme JSON templates can be authored with leading/inline "/* */"
// comments (invalid strict JSON, but the theme editor writes and accepts
// them), so strip block comments before parsing.
function parseThemeJson(content) {
  return JSON.parse(content.replace(/\/\*[\s\S]*?\*\//g, ""));
}

function templateHasAppBlock(templateJson, blockHandle) {
  const needle = `/blocks/${blockHandle}/`;
  const sections = templateJson?.sections;
  if (!sections || typeof sections !== "object") return false;

  return Object.values(sections).some((section) =>
    blocksContainAppBlock(section?.blocks, needle),
  );
}

// Checks the shop's main (published) theme for our "collection-filters" and
// "wishlist" app blocks, so the admin dashboard can show real "added to
// theme" status instead of just linking to the theme editor and hoping.
// Read-only, requires the `read_themes` scope.
export async function getThemeBlockStatus(admin) {
  const themeBody = await graphqlWithRetry(
    admin,
    `#graphql
      query MainTheme {
        themes(first: 1, roles: [MAIN]) {
          nodes { id name }
        }
      }`,
    {},
  );

  const themeId = themeBody.data?.themes?.nodes?.[0]?.id;
  if (!themeId) {
    return { collectionFilters: false, wishlist: false, checked: false };
  }

  // theme.files(filenames: …) only matches exact filenames — it has no
  // wildcard/glob support — so we can't ask for "templates/*.json" directly.
  // Instead, paginate the full file listing and filter for JSON templates
  // client-side.
  const templateFilenames = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const listBody = await graphqlWithRetry(
      admin,
      `#graphql
        query ThemeFileList($themeId: ID!, $after: String) {
          theme(id: $themeId) {
            files(first: 250, after: $after) {
              nodes { filename }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
      { variables: { themeId, after: cursor } },
    );

    const page_ = listBody.data?.theme?.files;
    for (const node of page_?.nodes || []) {
      if (/^templates\/.*\.json$/.test(node?.filename || "")) {
        templateFilenames.push(node.filename);
      }
    }

    if (!page_?.pageInfo?.hasNextPage) break;
    cursor = page_.pageInfo.endCursor;
  }

  if (templateFilenames.length === 0) {
    return { collectionFilters: false, wishlist: false, checked: false };
  }

  const filesBody = await graphqlWithRetry(
    admin,
    `#graphql
      query ThemeTemplates($themeId: ID!, $filenames: [String!]!) {
        theme(id: $themeId) {
          files(filenames: $filenames) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }`,
    { variables: { themeId, filenames: templateFilenames } },
  );

  const fileNodes = filesBody.data?.theme?.files?.nodes || [];

  let collectionFilters = false;
  let wishlist = false;

  for (const file of fileNodes) {
    const content = file?.body?.content;
    if (!content) continue;

    let parsed;
    try {
      parsed = parseThemeJson(content);
    } catch {
      continue;
    }

    if (!collectionFilters && templateHasAppBlock(parsed, "collection-filters")) {
      collectionFilters = true;
    }
    if (!wishlist && templateHasAppBlock(parsed, "wishlist")) {
      wishlist = true;
    }
  }

  return { collectionFilters, wishlist, checked: true };
}
