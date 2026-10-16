-- Add context column to FilterConfig, backfilled to "collection" for all
-- existing rows so current shops keep their existing collection-page config
-- unchanged, and replace the old (shop, fieldKey) unique index with one that
-- includes context.
ALTER TABLE `FilterConfig` ADD COLUMN `context` VARCHAR(191) NOT NULL DEFAULT 'collection';

DROP INDEX `FilterConfig_shop_fieldKey_key` ON `FilterConfig`;
DROP INDEX `FilterConfig_shop_idx` ON `FilterConfig`;

CREATE UNIQUE INDEX `FilterConfig_shop_context_fieldKey_key` ON `FilterConfig`(`shop`, `context`, `fieldKey`);
CREATE INDEX `FilterConfig_shop_context_idx` ON `FilterConfig`(`shop`, `context`);

-- New table holding the per-context settings (page size, layout, visibility,
-- clear-all text) that used to live as shop-wide fields on ShopSettings.
CREATE TABLE `FilterContextSettings` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `context` VARCHAR(191) NOT NULL,
    `pageSize` INTEGER NOT NULL DEFAULT 10,
    `filterLayout` VARCHAR(191) NOT NULL DEFAULT 'vertical',
    `showOnDesktop` BOOLEAN NOT NULL DEFAULT true,
    `showOnMobile` BOOLEAN NOT NULL DEFAULT true,
    `clearAllButtonText` VARCHAR(191) NOT NULL DEFAULT 'Clear all',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FilterContextSettings_shop_context_key`(`shop`, `context`),
    INDEX `FilterContextSettings_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- Seed a "collection" row per existing shop from their current shared
-- settings, so existing shops don't lose their configured page size,
-- layout, visibility, or clear-all text after the split.
INSERT INTO `FilterContextSettings` (`id`, `shop`, `context`, `pageSize`, `filterLayout`, `showOnDesktop`, `showOnMobile`, `clearAllButtonText`, `createdAt`, `updatedAt`)
SELECT
  CONCAT('seed_', `shop`, '_collection'),
  `shop`,
  'collection',
  `pageSize`,
  `filterLayout`,
  `showOnDesktop`,
  `showOnMobile`,
  `clearAllButtonText`,
  NOW(3),
  NOW(3)
FROM `ShopSettings`;

-- Global "show product count" toggle on ShopSettings.
ALTER TABLE `ShopSettings` ADD COLUMN `showFilterCounts` BOOLEAN NOT NULL DEFAULT true;
