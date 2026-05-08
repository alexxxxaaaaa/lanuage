-- AlterTable
ALTER TABLE `Word` ADD COLUMN `sourceNoteId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Note` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `course` VARCHAR(191) NOT NULL DEFAULT '',
    `lesson` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Word` ADD CONSTRAINT `Word_sourceNoteId_fkey` FOREIGN KEY (`sourceNoteId`) REFERENCES `Note`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
