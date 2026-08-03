-- 设置页的偏好入库，一个用户一行。行懒建：缺行 = 还没设置过，
-- 客户端此时会把本机 localStorage 里的选择推上来（见 settingsService.getSettings 的 saved 标记）。
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "theme" TEXT NOT NULL DEFAULT '',
    "uiLanguage" TEXT NOT NULL DEFAULT 'zh',
    "examMode" TEXT NOT NULL DEFAULT 'strict',
    "localDictEnabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
