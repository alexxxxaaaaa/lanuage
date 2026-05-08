-- CreateTable
CREATE TABLE `Folder` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Word` (
    `id` VARCHAR(191) NOT NULL,
    `word` VARCHAR(191) NOT NULL,
    `reading` VARCHAR(191) NOT NULL,
    `meaning` VARCHAR(191) NOT NULL,
    `example` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL,
    `folderId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Review` (
    `id` VARCHAR(191) NOT NULL,
    `wordId` VARCHAR(191) NOT NULL,
    `interval` INTEGER NOT NULL DEFAULT 1,
    `repetition` INTEGER NOT NULL DEFAULT 0,
    `easeFactor` DOUBLE NOT NULL DEFAULT 2.5,
    `nextReviewDate` DATETIME(3) NOT NULL,
    `lastReviewedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Review_wordId_key`(`wordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Word` ADD CONSTRAINT `Word_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `Folder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
