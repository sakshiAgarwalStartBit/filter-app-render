-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'collection',
    "fieldKey" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayType" TEXT NOT NULL DEFAULT 'list',
    "selectMode" TEXT NOT NULL DEFAULT 'multiple',
    "valuePrefix" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterContextSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "pageSize" INTEGER NOT NULL DEFAULT 10,
    "filterLayout" TEXT NOT NULL DEFAULT 'vertical',
    "showOnDesktop" BOOLEAN NOT NULL DEFAULT true,
    "showOnMobile" BOOLEAN NOT NULL DEFAULT true,
    "clearAllButtonText" TEXT NOT NULL DEFAULT 'Clear all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterContextSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "maxFilters" INTEGER NOT NULL DEFAULT 5,
    "pageSize" INTEGER NOT NULL DEFAULT 10,
    "filterLayout" TEXT NOT NULL DEFAULT 'vertical',
    "buttonFontSize" INTEGER NOT NULL DEFAULT 14,
    "buttonFontWeight" INTEGER NOT NULL DEFAULT 700,
    "buttonBorderRadius" INTEGER NOT NULL DEFAULT 0,
    "buttonTextTransform" TEXT NOT NULL DEFAULT 'none',
    "buttonTextColor" TEXT NOT NULL DEFAULT '#3A3A3A',
    "buttonBorderColor" TEXT NOT NULL DEFAULT '#BFBFBF',
    "buttonBackgroundColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "toggleFontSize" INTEGER NOT NULL DEFAULT 16,
    "toggleFontWeight" INTEGER NOT NULL DEFAULT 700,
    "toggleBorderRadius" INTEGER NOT NULL DEFAULT 6,
    "toggleTextTransform" TEXT NOT NULL DEFAULT 'none',
    "toggleTextColor" TEXT NOT NULL DEFAULT '#1A1A1A',
    "toggleBorderColor" TEXT NOT NULL DEFAULT '#D1D1D1',
    "toggleBackgroundColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "valueFontSize" INTEGER NOT NULL DEFAULT 14,
    "valueFontWeight" INTEGER NOT NULL DEFAULT 400,
    "valueTextTransform" TEXT NOT NULL DEFAULT 'none',
    "valueTextColor" TEXT NOT NULL DEFAULT '#3A3A3A',
    "headingFontSize" INTEGER NOT NULL DEFAULT 16,
    "headingFontWeight" INTEGER NOT NULL DEFAULT 600,
    "headingTextTransform" TEXT NOT NULL DEFAULT 'none',
    "headingTextColor" TEXT NOT NULL DEFAULT '#1A1A1A',
    "sidebarBackgroundColor" TEXT NOT NULL DEFAULT '#F5F5F5',
    "showOnDesktop" BOOLEAN NOT NULL DEFAULT true,
    "showOnMobile" BOOLEAN NOT NULL DEFAULT true,
    "clearAllButtonText" TEXT NOT NULL DEFAULT 'Clear all',
    "reviewRatingNamespace" TEXT NOT NULL DEFAULT 'reviews',
    "reviewRatingKey" TEXT NOT NULL DEFAULT 'rating',
    "reviewCountKey" TEXT NOT NULL DEFAULT 'rating_count',
    "showFilterCounts" BOOLEAN NOT NULL DEFAULT true,
    "showWishlist" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilterConfig_shop_context_idx" ON "FilterConfig"("shop", "context");

-- CreateIndex
CREATE UNIQUE INDEX "FilterConfig_shop_context_fieldKey_key" ON "FilterConfig"("shop", "context", "fieldKey");

-- CreateIndex
CREATE INDEX "FilterContextSettings_shop_idx" ON "FilterContextSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "FilterContextSettings_shop_context_key" ON "FilterContextSettings"("shop", "context");

-- CreateIndex
CREATE INDEX "WishlistItem_shop_customerId_idx" ON "WishlistItem"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_shop_customerId_productId_key" ON "WishlistItem"("shop", "customerId", "productId");
