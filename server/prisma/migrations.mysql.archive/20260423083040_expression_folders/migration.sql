-- CreateTable
CREATE TABLE `Expression` (
    `id` VARCHAR(191) NOT NULL,
    `zhText` TEXT NOT NULL,
    `enCasual` TEXT NOT NULL,
    `jpCasual` TEXT NOT NULL,
    `sceneTag` VARCHAR(191) NOT NULL DEFAULT '',
    `note` TEXT NOT NULL,
    `isMastered` BOOLEAN NOT NULL DEFAULT false,
    `folderId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpressionFolder` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ExpressionFolder_name_language_key`(`name`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Expression` ADD CONSTRAINT `Expression_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `ExpressionFolder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
