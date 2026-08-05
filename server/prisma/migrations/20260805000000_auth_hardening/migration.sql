-- 账号系统加固：token 可撤销 + 登录限流。
--
-- 1) User.tokenVersion —— 无状态 JWT 的老问题：签出去就收不回来。改密码、删账号
--    之后，已经泄露的旧 token 在 TTL 内（30 天）照样能用。token 里带一份代数，
--    requireAuth 每次和库里的比，改密码时 +1 就等于全端下线。
--
-- 2) LoginThrottle —— 登录接口此前不限速。配合「用户不存在就立刻返回」的时序差，
--    可以先枚举用户名再离线撞库。按来源 IP 计数，连错 8 次锁 15 分钟。
--
-- 密码哈希从 bcrypt 换到 PBKDF2 不需要迁移 SQL：passwordHash 是自描述格式，
-- 老的 `$2a$…` 和新的 `pbkdf2$…` 同列共存，登录验过一次就地重写，见
-- src/lib/password.ts。

ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "LoginThrottle" (
    "key"         TEXT     NOT NULL PRIMARY KEY,
    "failures"    INTEGER  NOT NULL DEFAULT 0,
    "firstFailAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" DATETIME
);
