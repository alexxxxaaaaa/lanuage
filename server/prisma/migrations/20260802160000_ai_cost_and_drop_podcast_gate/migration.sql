-- 两件事，都是为了「AI 用量」这块不再靠人工猜。
--
-- 1) 记下 prompt 里被缓存命中 / 写入缓存的 token 数。
--    gpt-5.6 的价目表把输入拆成四档（input / cached input / cache writes /
--    output），只存一个 promptTokens 就没法按官方价算钱。两列都是 promptTokens
--    的**拆分**而非附加项，计费时从中扣除，见 server/src/config/aiPricing.ts。
--    历史行没有这个数据，默认 0 —— 按未命中缓存计价，与当时的实际账单一致
--    （旧默认模型 gpt-4.1-mini 的 1K 以下 prompt 本来就不会进缓存）。
--
-- 2) 删掉 User.canSeePodcast。
--    C 端不再按账号隐藏页面，所有页面对所有人可见，这个开关连同管理后台的
--    权限接口一起下线。

ALTER TABLE "AiUsageLog" ADD COLUMN "cachedTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiUsageLog" ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User" DROP COLUMN "canSeePodcast";
