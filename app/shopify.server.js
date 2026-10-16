import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// The stock PrismaSessionStorage checks that its table is reachable once, when
// the server instance starts, and keeps that result for the instance's whole
// life. If that one check fails (for example the database is slow or waking up
// on a cold start), every later request on that instance fails with
// "MissingSessionTableError" until the host recycles it. Re-checking whenever
// the storage isn't ready makes a transient database problem recover by itself.
class ResilientPrismaSessionStorage extends PrismaSessionStorage {
  constructor(prismaClient) {
    // Shorter waits than the default (2 tries, 5s apart) so a retry fits well
    // inside a request's time limit.
    super(prismaClient, { connectionRetries: 3, connectionRetryIntervalMs: 1000 });
    // A failed first check is reported through ensureReady() below; without
    // this it would also surface as an unhandled promise rejection.
    this.ready.catch(() => {});
  }

  async ensureReady() {
    let ready = false;
    try {
      ready = await this.ready;
    } catch {
      // fall through to a fresh check
    }
    if (!ready) {
      ready = await this.isReady();
    }
    return super.ensureReady();
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new ResilientPrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
