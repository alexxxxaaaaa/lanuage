-- CreateTable: User
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed initial user "zyd" with bcrypt hash for password "zyd370710"
INSERT INTO `User` (`id`, `username`, `passwordHash`, `createdAt`)
VALUES ('00000000-0000-0000-0000-000000000001', 'zyd', '$2b$10$W5Y8nMd/bwWVnZqZjr9YQuItLvaYafKi1B3C4wxEsS/OU16EiWOy.', CURRENT_TIMESTAMP(3));

-- AlterTable: add userId (nullable for backfill, then enforce)
ALTER TABLE `Folder` ADD COLUMN `userId` VARCHAR(191) NULL;
ALTER TABLE `Note` ADD COLUMN `userId` VARCHAR(191) NULL;
ALTER TABLE `ExpressionFolder` ADD COLUMN `userId` VARCHAR(191) NULL;
ALTER TABLE `AiUsageLog` ADD COLUMN `userId` VARCHAR(191) NULL;

-- Backfill: assign all existing rows to the seed user
UPDATE `Folder` SET `userId` = '00000000-0000-0000-0000-000000000001' WHERE `userId` IS NULL;
UPDATE `Note` SET `userId` = '00000000-0000-0000-0000-000000000001' WHERE `userId` IS NULL;
UPDATE `ExpressionFolder` SET `userId` = '00000000-0000-0000-0000-000000000001' WHERE `userId` IS NULL;
UPDATE `AiUsageLog` SET `userId` = '00000000-0000-0000-0000-000000000001' WHERE `userId` IS NULL;

-- Enforce NOT NULL
ALTER TABLE `Folder` MODIFY `userId` VARCHAR(191) NOT NULL;
ALTER TABLE `Note` MODIFY `userId` VARCHAR(191) NOT NULL;
ALTER TABLE `ExpressionFolder` MODIFY `userId` VARCHAR(191) NOT NULL;
ALTER TABLE `AiUsageLog` MODIFY `userId` VARCHAR(191) NOT NULL;

-- Indexes
CREATE INDEX `Folder_userId_idx` ON `Folder`(`userId`);
CREATE INDEX `Note_userId_idx` ON `Note`(`userId`);
CREATE INDEX `ExpressionFolder_userId_idx` ON `ExpressionFolder`(`userId`);
CREATE INDEX `AiUsageLog_userId_idx` ON `AiUsageLog`(`userId`);

-- Replace ExpressionFolder unique (was on name+language) with a per-user unique
ALTER TABLE `ExpressionFolder` DROP INDEX `ExpressionFolder_name_language_key`;
CREATE UNIQUE INDEX `ExpressionFolder_name_language_userId_key` ON `ExpressionFolder`(`name`, `language`, `userId`);

-- AddForeignKey
ALTER TABLE `Folder` ADD CONSTRAINT `Folder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Note` ADD CONSTRAINT `Note_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ExpressionFolder` ADD CONSTRAINT `ExpressionFolder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AiUsageLog` ADD CONSTRAINT `AiUsageLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
