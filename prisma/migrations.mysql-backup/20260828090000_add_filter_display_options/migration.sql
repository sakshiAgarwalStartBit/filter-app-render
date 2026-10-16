-- Add per-field display/select mode and optional tag-prefix filtering to
-- FilterConfig, so merchants can add multiple named Tag filters (e.g.
-- "Color" with prefix "color_", "Size" with prefix "size_"), each with its
-- own display type (list/swatch) and select mode (single/multiple).
ALTER TABLE `FilterConfig` ADD COLUMN `displayType` VARCHAR(191) NOT NULL DEFAULT 'list';
ALTER TABLE `FilterConfig` ADD COLUMN `selectMode` VARCHAR(191) NOT NULL DEFAULT 'multiple';
ALTER TABLE `FilterConfig` ADD COLUMN `valuePrefix` VARCHAR(191) NULL;
