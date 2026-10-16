-- Wishlist items saved by logged-in customers, synced across devices.
-- Guests (no customerId) use a local-only wishlist in the storefront widget
-- instead of writing here.
CREATE TABLE `WishlistItem` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WishlistItem_shop_customerId_productId_key`(`shop`, `customerId`, `productId`),
    INDEX `WishlistItem_shop_customerId_idx`(`shop`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;
