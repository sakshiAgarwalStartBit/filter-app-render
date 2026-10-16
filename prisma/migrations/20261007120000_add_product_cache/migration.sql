-- CreateTable
CREATE TABLE "ProductCache" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductCache_shop_idx" ON "ProductCache"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCache_shop_cacheKey_key" ON "ProductCache"("shop", "cacheKey");
