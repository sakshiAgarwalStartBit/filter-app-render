-- Global toggle controlling whether the wishlist heart icon appears on
-- product cards in the storefront. Defaults off so existing shops don't
-- suddenly show it without opting in.
ALTER TABLE `ShopSettings` ADD COLUMN `showWishlist` BOOLEAN NOT NULL DEFAULT false;
