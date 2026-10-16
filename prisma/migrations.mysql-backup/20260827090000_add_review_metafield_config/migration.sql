ALTER TABLE `ShopSettings`
  ADD COLUMN `reviewRatingNamespace` VARCHAR(191) NOT NULL DEFAULT 'reviews',
  ADD COLUMN `reviewRatingKey` VARCHAR(191) NOT NULL DEFAULT 'rating',
  ADD COLUMN `reviewCountKey` VARCHAR(191) NOT NULL DEFAULT 'rating_count';
