---
name: upload-n1-exam
description: Upload a JLPT/N1 past exam (真题) with its listening audio and subtitles. Use when the user wants to add a new 真题 (e.g. "上传 2011.12 的 N1 真题和听力", "add the December 2011 N1 exam"). Covers the three parts — questions (via language-admin panel), audio (Cloudflare R2), and subtitles (git + D1 json_set).
---

# 上传 N1 真题 + 听力

一份真题由**三块**组成,分别走不同通道。管理后台的上传界面**只做第 1 块(题目)**,音频和字幕都要手动挂。

| 组成 | 存储位置 | 挂接方式 |
|------|----------|----------|
| 题目 + 选项 + 答案/解析 | `Exam.parsedData` (D1) | language-admin 后台上传 PDF,AI 视觉识别 |
| 听力音频 mp3 | Cloudflare R2 公共桶 `jlpt` | `wrangler r2 object put` + `UPDATE Exam.audioUrl` |
| 听力字幕 srt | `client/public/exam-media/` (走 git → Pages) | 提交推送 + `UPDATE parsedData.meta.subtitleUrl` |

> 为什么音频不放 client/public:GitHub Pages 单文件 25 MiB 上限,mp3 常常超,所以走 R2;srt 是小文本,放 git 没问题。

## 固定资源(project 常量)

- D1 数据库:`word-sprint-db`(线上加 `--remote`)
- R2 桶:`jlpt`,公共域名前缀 `https://pub-942012cb760d44d7a0c78abce8d4d0c5.r2.dev/`
- 后端:`server/`(Cloudflare Worker,`api.lgstudy.com`)
- 前端:`client/`,生产走 GitHub Pages,**`git push github main` 才更新线上**
- 管理后台:`../language-admin`(`npm run dev` 起本地,需管理员账号登录)

## 命名约定

统一用 `n1-YYYY-MM`,例:2011 年 12 月 → `n1-2011-12`
- mp3 → `n1-2011-12.mp3`(R2 对象名)
- srt → `client/public/exam-media/n1-2011-12.srt`
- 后台上传时:标题 `N1 2011年12月`、年份/期 `2011-12`、等级 `N1`
  (注意:历史数据 year 格式不统一,如 2011.7 那条 year 是 `2011-07`;新的一律用 `YYYY-MM`,方便下面按 year 定位。)

## 步骤

### 1. 上传题目(拿到 exam 行)

1. 起管理后台:`cd ../language-admin && npm run dev`,浏览器打开,用管理员账号登录。
2. 「真题库」→「上传真题」:
   - 标题、年份/期、等级 按上面约定填。
   - **题目 PDF(必填)**:题干+选项,末尾若有答案表会一起识别。
   - **解析 PDF(可选)**:听力原文 + 中文翻译 + 每题解析(交卷后展示)。
   - 「开始解析」→ AI 视觉识别通常 1–3 分钟。
3. 记下新建 exam 的 id:
   ```bash
   cd server
   npx wrangler d1 execute word-sprint-db --remote \
     --command "SELECT id, title, year, level, audioUrl FROM Exam ORDER BY createdAt;"
   ```

### 2. 上传音频到 R2 并挂 audioUrl

```bash
cd server
# 上传 mp3 到 jlpt 桶
npx wrangler r2 object put jlpt/n1-2011-12.mp3 \
  --file="/绝对路径/n1-2011-12.mp3" --remote

# 挂到 exam 行(按 year 定位;若 year 不唯一改用 id)
npx wrangler d1 execute word-sprint-db --remote \
  --command "UPDATE Exam SET audioUrl='https://pub-942012cb760d44d7a0c78abce8d4d0c5.r2.dev/n1-2011-12.mp3' WHERE year='2011-12';"
```

验证音频可公开访问(应返回 200/206):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -r 0-1 \
  "https://pub-942012cb760d44d7a0c78abce8d4d0c5.r2.dev/n1-2011-12.mp3"
```

### 3. 放字幕 + 挂 subtitleUrl

1. 把 srt 放到 `client/public/exam-media/n1-2011-12.srt`,提交并推送(触发 Pages 构建):
   ```bash
   git add client/public/exam-media/n1-2011-12.srt
   git commit -m "n1 2011.12 真题字幕"
   git push github main    # ← 必须 push 到 github 才会部署线上
   ```
2. 把字幕地址写进 `parsedData.meta.subtitleUrl`(用 `json_set`,不必重写整个 JSON):
   ```bash
   cd server
   npx wrangler d1 execute word-sprint-db --remote \
     --command "UPDATE Exam SET parsedData = json_set(parsedData, '\$.meta.subtitleUrl', '/exam-media/n1-2011-12.srt') WHERE year='2011-12';"
   ```

前端读取顺序见 [client/src/pages/ExamTakePage.tsx](../../../client/src/pages/ExamTakePage.tsx):
`subtitleUrl = parsedData?.meta?.subtitleUrl`,`audioUrl = exam.audioUrl`(列)。

### 4. 验收

```bash
cd server
npx wrangler d1 execute word-sprint-db --remote --command \
  "SELECT year, audioUrl, json_extract(parsedData,'\$.meta.subtitleUrl') AS sub FROM Exam WHERE year='2011-12';"
```
`audioUrl` 是 R2 地址、`sub` 是 `/exam-media/...srt` 即成功。等 Pages 构建完成后,进 App 的真题 → 该套 → 听力阶段,顶部会出现音频播放器 + 同步字幕。

## 注意事项 / 坑

- **srt 时间轴要对齐音频**。若 mp3 是重新剪辑/转码过的(历史上 2011.7 用的是 `n1-2011-07-fixed.mp3`),srt 时间戳必须匹配那一版音频,否则字幕高亮会漂。
- 后台上传 UI **不含音频/字幕入口**([../language-admin/src/pages/Exams.tsx](../../../../language-admin/src/pages/Exams.tsx) 只发 `pages`/`solutionPages`),所以第 2、3 步的 D1 更新不能省。
- `WHERE year=` 定位前先跑一次 SELECT 确认该 year **唯一**;不唯一就用 `WHERE id='...'`。
- 音频改不生效先查 R2 URL 是否 200;字幕不显示先确认 Pages 已重新部署(srt 能直接用浏览器打开 `https://<pages域名>/exam-media/xxx.srt`)。
- `json_set` 依赖 SQLite JSON1,D1 已内置,可用。
