-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "addToCartCollectionBackgroundColor" TEXT NOT NULL DEFAULT '#1A1A1A',
ADD COLUMN     "addToCartCollectionFontSize" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "addToCartCollectionTextColor" TEXT NOT NULL DEFAULT '#FFFFFF',
ADD COLUMN     "addToCartSearchBackgroundColor" TEXT NOT NULL DEFAULT '#1A1A1A',
ADD COLUMN     "addToCartSearchFontSize" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "addToCartSearchTextColor" TEXT NOT NULL DEFAULT '#FFFFFF';
