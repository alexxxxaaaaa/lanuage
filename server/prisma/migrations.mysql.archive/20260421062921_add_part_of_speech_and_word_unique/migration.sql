/*
  Warnings:

  - A unique constraint covering the columns `[folderId,word]` on the table `Word` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Word` ADD COLUMN `partOfSpeech` VARCHAR(191) NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX `Word_folderId_word_key` ON `Word`(`folderId`, `word`);
