# Word Sprint Admin

[Word Sprint](https://github.com/) 主站的管理后台 —— 管理员登录后可以跨用户查看 / 删除全部 folders、words、notes、expressions、AI 用量，以及给任意用户重置密码。

## 技术栈

- **React 19 + TypeScript + Vite**
- **Ant Design v6**（与主站 client 同源）
- **Zustand** 管理登录态
- **Axios** + JWT Bearer
- **React Router v7**

## 依赖的 server 改动

后台跑起来之前，需要 `language/server` 端已挂上 `/api/admin/*` 路由：

| 文件 | 作用 |
|---|---|
| `server/src/middleware/requireAdmin.ts` | 验证 JWT，并要求该用户名在 `ADMIN_USERNAMES` 中 |
| `server/src/services/adminService.ts` | 跨用户的统计 / 列表 / 删除 / 重置密码逻辑 |
| `server/src/routes/admin.ts` | `/api/admin/stats`、`/users`、`/folders`、`/words`、`/notes`、`/expressions`、`/ai-usage` |
| `server/.env` | 加 `ADMIN_USERNAMES="zyd"`（逗号分隔，小写，命中即视为管理员） |

> 没有 `ADMIN_USERNAMES` 或当前账号不在列表里，所有 `/api/admin/*` 调用会返回 403。

## 关于「看到账号密码」

主站 server 把密码存为 **bcrypt 哈希**（单向），后台只能：

1. **显示密码哈希** —— 用户列表上方的「显示密码哈希」开关，打开后哈希列才会拉取（接口参数 `includeHash=true`）。
2. **重置密码** —— 给某个用户设定新密码，server 端用 bcrypt 重新散列并覆盖原 hash。

没法显示「原密码」是哈希算法的物理限制，不是接口限制。

## 本地开发

```bash
# 1. 启动主站 server（另一个仓库）
cd ../language && npm run server:dev    # → http://localhost:3000

# 2. 启动后台
cd ../language-admin
npm install
npm run dev                              # → http://localhost:5174
```

打开 http://localhost:5174/login ，用 `ADMIN_USERNAMES` 中配置的账号密码登录即可。

### 切换 API 地址

默认开发期 vite proxy 把 `/api` 转到 `http://localhost:3000`。要直连远端：

```bash
cp .env.example .env
# 设置 VITE_API_BASE_URL=https://your-server.example.com
```

## 主要页面

| 路径 | 功能 |
|---|---|
| `/login` | 登录（管理员账号） |
| `/dashboard` | 全局概览：用户数、近 7 天新增、各类总数、AI Tokens 累计 |
| `/users` | 用户列表：查看哈希、重置密码、删除用户（级联删除全部数据） |
| `/folders` | 单词分类：按用户筛选 / 删除 |
| `/words` | 单词：按用户 / 关键词筛选 / 删除 |
| `/notes` | 课程笔记：按用户筛选 / 查看富文本 / 删除 |
| `/expressions` | 口语表达：按用户 / 关键词筛选 / 删除 |
| `/ai-usage` | AI 调用记录与汇总（可按用户筛选） |

## 构建

```bash
npm run build
```

产物输出到 `dist/`，可丢到 Cloudflare Pages / Vercel / 任意静态托管。生产环境记得：

- `VITE_API_BASE_URL` 设为 server 公网地址
- server 端把后台的来源加入 CORS 白名单（目前是 `cors()` 全开，需要更严格的话改 `server/src/app.ts`）
