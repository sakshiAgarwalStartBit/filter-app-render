-- AlterTable
ALTER TABLE `shopsettings` ADD COLUMN `cacheVersion` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `showOnDesktop` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showOnMobile` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `sidebarBackgroundColor` VARCHAR(191) NOT NULL DEFAULT '#F5F5F5';
