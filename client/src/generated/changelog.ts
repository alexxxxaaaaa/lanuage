// 这个文件由 scripts/genChangelog.mjs 生成，不要手改。
// 重新生成：npm run changelog

export type ChangelogItem = { sha: string; subject: string }
export type ChangelogEntry = { date: string; items: ChangelogItem[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    "date": "2026-10-13",
    "items": [
      {
        "sha": "f0109b8",
        "subject": "词单可以暂停：不再往今日复习 / 新词里送词"
      },
      {
        "sha": "f883532",
        "subject": "加更新历史页：看得到「多久没更新了」和每天改了什么"
      }
    ]
  },
  {
    "date": "2026-10-09",
    "items": [
      {
        "sha": "6b00742",
        "subject": "字幕上传改成以选文件为主，不再把 SRT 原文灌进文本框"
      },
      {
        "sha": "ec3f58d",
        "subject": "建词时自动补全缺失的释义 / 例句，堵在唯一入口上"
      }
    ]
  },
  {
    "date": "2026-10-06",
    "items": [
      {
        "sha": "2c3bad2",
        "subject": "修复复习重做卡死：重做队列的下标按步骤顺序算，不写死"
      }
    ]
  },
  {
    "date": "2026-10-02",
    "items": [
      {
        "sha": "a9d36dc",
        "subject": "批量添加弹窗不再误触关闭，输入另存一份草稿"
      }
    ]
  },
  {
    "date": "2026-09-30",
    "items": [
      {
        "sha": "3d4778b",
        "subject": "播客切走就暂停：keep-alive 让多集音频叠在一起"
      }
    ]
  },
  {
    "date": "2026-09-29",
    "items": [
      {
        "sha": "44ff1c3",
        "subject": "模拟考试列表 + 考试模式接入多语言"
      },
      {
        "sha": "cf64ee8",
        "subject": "JLPT 首页接入多语言（此前整个模块一个 t() 都没有）"
      },
      {
        "sha": "f0c3e36",
        "subject": "查词卡片上的词单名可点，跳到那个词单里这个词的位置"
      }
    ]
  },
  {
    "date": "2026-09-25",
    "items": [
      {
        "sha": "0fd2b45",
        "subject": "补上点了没反馈的几处：置顶、删词、保存、改字幕行"
      }
    ]
  },
  {
    "date": "2026-09-17",
    "items": [
      {
        "sha": "4576c99",
        "subject": "复习三步可以自己排顺序，按词单记住"
      }
    ]
  },
  {
    "date": "2026-09-14",
    "items": [
      {
        "sha": "8cb2a5d",
        "subject": "朗读：拆掉会卡死引擎的哑语音，加开播看门狗"
      },
      {
        "sha": "30f51c8",
        "subject": "复习卡片不再是 <button>：button 套 button 是非法嵌套"
      }
    ]
  },
  {
    "date": "2026-09-11",
    "items": [
      {
        "sha": "ae45d13",
        "subject": "朗读失败时回退到本地音色；音色列表标出本地/联网"
      }
    ]
  },
  {
    "date": "2026-09-10",
    "items": [
      {
        "sha": "7829933",
        "subject": "getFolders 四次分组合成一条：读取行数降到约 1/5"
      },
      {
        "sha": "20f4e70",
        "subject": "降低每请求 CPU：Prisma 客户端改懒构造，进度保存走原生 D1"
      },
      {
        "sha": "8e0e6d8",
        "subject": "新学可选正序 / 倒序"
      },
      {
        "sha": "ede1cea",
        "subject": "GET 请求遇 5xx 自动重试；打开 Workers 日志留存"
      },
      {
        "sha": "4e5d301",
        "subject": "听力真题成套：按级别+年分组，详情页可跳前后场"
      }
    ]
  },
  {
    "date": "2026-09-09",
    "items": [
      {
        "sha": "70871e0",
        "subject": "按词单筛词的三处统一绕开 to-many 关系过滤"
      },
      {
        "sha": "a53a963",
        "subject": "词单详情 500 收尾：真凶是关系过滤，改用 id IN 分批取"
      },
      {
        "sha": "6f54e26",
        "subject": "词单详情仍 500：真凶是 orderBy 可空列，不是嵌套 include"
      },
      {
        "sha": "5f96f61",
        "subject": "词单详情打开是 0 条：拆掉四层嵌套 include，前端不再把报错吞成空词单"
      },
      {
        "sha": "257ec10",
        "subject": "语法页：意思和例句译文可逐条遮住自测，列表改分页，计数跟着级别走"
      }
    ]
  },
  {
    "date": "2026-08-21",
    "items": [
      {
        "sha": "a945a4f",
        "subject": "删词单 500：几千个词拼 IN 撑爆 D1 的绑定参数上限"
      }
    ]
  },
  {
    "date": "2026-08-20",
    "items": [
      {
        "sha": "3c323b8",
        "subject": "语法题库筛选加「已做 / 未做」两档"
      },
      {
        "sha": "5cb17b2",
        "subject": "语法题库：考点标注、手写备注、服务端分页"
      },
      {
        "sha": "2de3d0c",
        "subject": "SegmentedControl 标签不再折行"
      }
    ]
  },
  {
    "date": "2026-08-13",
    "items": [
      {
        "sha": "0f1d7fc",
        "subject": "查一个词读掉 57 万行：词典索引首列换成 word，几处列表的条数统计也不再扫全表"
      },
      {
        "sha": "aa7d46b",
        "subject": "长句表达不再顶出卡片：标题换掉词卡那套 nowrap，整张卡按 HeroUI 的 Card 重排"
      },
      {
        "sha": "309b134",
        "subject": "建表达时先说清要什么语域：场景标签改多选，再加润色和备注解析两个开关"
      },
      {
        "sha": "01b9cb4",
        "subject": "会调模型的接口单独给 90 秒超时：十秒掐掉的是已经付过钱的答案"
      },
      {
        "sha": "ba593a9",
        "subject": "表达页的分类终于删得掉了：卡片上一个按钮，连里面的表达一起清"
      },
      {
        "sha": "677a138",
        "subject": "笔记页多一个「询问 AI」：随便问，聊完一键存成笔记"
      }
    ]
  },
  {
    "date": "2026-08-12",
    "items": [
      {
        "sha": "5c95b26",
        "subject": "笔记去掉「课程」：分类叫标签，课程时间叫时间"
      },
      {
        "sha": "3b6be94",
        "subject": "查词建议弹窗认得出同一个词的两种写法：输入下さい，底下出ください"
      },
      {
        "sha": "b7f8140",
        "subject": "文解析：整段日文逐词拆开，点哪个词就按那句话讲哪个词"
      },
      {
        "sha": "9427a2f",
        "subject": "日语活用形不再问出四不像：查词页给辞書形建议，加词页直接还原"
      }
    ]
  },
  {
    "date": "2026-08-06",
    "items": [
      {
        "sha": "a699971",
        "subject": "JLPT AI 解析：非听力题都点得动了，四个选项一条都不落"
      },
      {
        "sha": "e2cfe32",
        "subject": "项目级 .mcp.json 入库：HeroUI v2→v3 的迁移文档服务器"
      },
      {
        "sha": "c84c29d",
        "subject": "登录页密码框加眼睛：输错了能看一眼，不用整行删掉重来"
      },
      {
        "sha": "2dfd46b",
        "subject": "iPhone PWA 安全区适配：顶部让开状态栏，底部那道黑边收掉"
      },
      {
        "sha": "3f43a03",
        "subject": "登录修复：PBKDF2 迭代数回落到 workerd 的 100k 上限"
      }
    ]
  },
  {
    "date": "2026-08-05",
    "items": [
      {
        "sha": "dbbdadf",
        "subject": "语法级别加一档「自建」：手工建的句型不再被迫挂 N1"
      },
      {
        "sha": "7597bb7",
        "subject": "账号系统加固：注册接口下线、token 可撤销、删用户不再删一半"
      },
      {
        "sha": "9e4cd00",
        "subject": "语法级别标签统一到 JlptChips：四处各写各的胶囊，收成一个组件"
      },
      {
        "sha": "9966953",
        "subject": "语法页级别筛选补回「全部」：placeholder 选完就回不去，改成列表首项"
      },
      {
        "sha": "495fe85",
        "subject": "解析/译文重新断行：入库时压平的换行，在渲染侧按说话人和词条认回来"
      },
      {
        "sha": "3c5aec2",
        "subject": "两份 JLPT 词表折算到同一把尺子：旧 3 級→N4、4 級→N5"
      },
      {
        "sha": "ca77fc5",
        "subject": "JLPT 标签并入第二份词表：Waller 的 N1-N5，词形 8041 → 8832"
      },
      {
        "sha": "9d54104",
        "subject": "接续图从页尾提到「接续」栏下，并按 0.4 缩放"
      },
      {
        "sha": "13957cf",
        "subject": "查词/词单/索引栏标出 JLPT 级别"
      },
      {
        "sha": "a83dc3c",
        "subject": "蓝宝书判重收紧：清掉 29 条重复条目，补录书里没收的 12 条"
      }
    ]
  },
  {
    "date": "2026-08-04",
    "items": [
      {
        "sha": "bcff826",
        "subject": "语法库装进蓝宝书 N1-N5 全套：811 条句型，带注音、朗读和真题出处"
      },
      {
        "sha": "dabd4fd",
        "subject": "登录页去掉输入框图标分隔线；语法题库分段按内容宽度排"
      },
      {
        "sha": "bef2f87",
        "subject": "R2 桶补 CORS 规则：文字稿跨域 fetch 修复"
      },
      {
        "sha": "3bbd366",
        "subject": "播客字幕划词加词：AI 还原原形，例句用字幕原句"
      },
      {
        "sha": "42ca2a7",
        "subject": "export:r2 / --render-only 不再强制要 config.json"
      },
      {
        "sha": "6fc39e4",
        "subject": "转写产物入库：1043 条完整 json"
      },
      {
        "sha": "515c181",
        "subject": "听力练习加文字稿模式；新增 hypertranscript 词级转写管线"
      },
      {
        "sha": "4f7e317",
        "subject": "DEPLOY.md: day-2 部署改成写实——push 触发，别手工 wrangler"
      },
      {
        "sha": "3217c9a",
        "subject": "server/.nvmrc: 给 Workers Builds 钉住 Node 24"
      },
      {
        "sha": "8260375",
        "subject": "撤掉 GitHub Actions 部署，改走 Cloudflare Workers Builds"
      },
      {
        "sha": "ad1c7c1",
        "subject": "加 GitHub Actions 自动部署 Worker，协作者不必登录 Cloudflare"
      },
      {
        "sha": "035c2fd",
        "subject": ".claude/settings.json: 补充 pdf/ocr/媒体拷贝等常用命令白名单"
      },
      {
        "sha": "5c3d742",
        "subject": "查词页方向整合成一个下拉框；索引栏去分栏；点索引跳错词修复"
      },
      {
        "sha": "1a873a9",
        "subject": "查词页以词头为中心重排；索引栏词数进 tab；分段控件改 HeroUI 默认 tab"
      }
    ]
  },
  {
    "date": "2026-08-03",
    "items": [
      {
        "sha": "fa91f29",
        "subject": "查词页加词前置查重；词单卡片加「详情」入口；JLPT tab 手机一屏"
      },
      {
        "sha": "6658d4b",
        "subject": "查词页去掉关闭态的「本地词库」概念；索引栏点击定位跳错行修复"
      },
      {
        "sha": "d25da5d",
        "subject": "老数据回填：单词库释义补进 AI 词典缓存（POST /api/dictionary/ai-backfill）"
      },
      {
        "sha": "3f46e55",
        "subject": "词库两层化：AI 释义落库当词典来源；设置随账号；词单多对多"
      },
      {
        "sha": "743a397",
        "subject": "apply.sh 改走 npx 调 wrangler，补失败重试与分片续跑"
      },
      {
        "sha": "67ae7ce",
        "subject": "JLPT 目录页改表格:三列压进手机屏不横滑,題型/年份用树形展开"
      },
      {
        "sha": "a129a69",
        "subject": "播客:暂停时点击字幕不再跳转(方便选中复制单词),光标改文本选择;播放时照常跳转"
      },
      {
        "sha": "fddbf5a",
        "subject": "词典数据清洗：抽词性、补读音、拆例句"
      },
      {
        "sha": "697e07e",
        "subject": "Folder 加 createdAt 列 + 迁移,支撑词单最新在前(修复上条 orderBy createdAt 因缺列 500)"
      },
      {
        "sha": "faf4adb",
        "subject": "词单列表改为最新在前(createdAt desc):新建词单排第一,加词选分类下拉同序"
      },
      {
        "sha": "683bce5",
        "subject": "词库改 gzip 落盘，脱离 Git LFS"
      },
      {
        "sha": "e8df300",
        "subject": "听力音频移出 git，改由 R2 单独承载"
      },
      {
        "sha": "55ed043",
        "subject": "整合日中与中日多来源词库"
      },
      {
        "sha": "e745bfb",
        "subject": "查英语时收起本地词库相关的 UI"
      },
      {
        "sha": "12558f7",
        "subject": "索引栏滚动条改用 HeroUI ScrollShadow 隐藏，边缘渐隐代替提示"
      },
      {
        "sha": "068ab4e",
        "subject": "索引栏改自实现虚拟化，修开列表卡死几秒"
      },
      {
        "sha": "3a1e64d",
        "subject": "查词页接上本地词库：结果按来源分块，右侧加词典索引栏"
      },
      {
        "sha": "9538f92",
        "subject": "新增日中/中日词库：从 Wiktextract 抽取，共 16.2 万词条"
      },
      {
        "sha": "069b44a",
        "subject": "修复线上 500:D1 的 _count 返回 BigInt 序列化崩溃;mp3 播客隐藏视频框 + 底部条 H5 适配"
      },
      {
        "sha": "c7affa1",
        "subject": "笔记重构：Tiptap 换成 BlockNote，课次改为课程时间，列表页换 HeroUI 表格"
      },
      {
        "sha": "a7b06e8",
        "subject": "tailwind-variants 锁回 3.2.2，修卡片 variant 串味导致的背景丢失"
      },
      {
        "sha": "eaeae8e",
        "subject": "查词页刷新白屏修掉，每个页面套上自己的错误边界"
      },
      {
        "sha": "e94cc95",
        "subject": "配色统一收进 theme.css，写死的调色板颜色全换成语义 token"
      },
      {
        "sha": "f5cbee8",
        "subject": "快速查词浮窗下线，侧边栏改为回到板块上次停留的位置"
      }
    ]
  },
  {
    "date": "2026-08-02",
    "items": [
      {
        "sha": "f433b59",
        "subject": "放开 git push 权限，补上 -f 简写的强推拦截"
      },
      {
        "sha": "28a6f2d",
        "subject": "清掉 client 全部 lint 错误，effect 里的派生 state 改成渲染期计算"
      },
      {
        "sha": "5eaa5af",
        "subject": "AI 默认模型换成 gpt-5.6-luna，用量按官方价算；页面权限开关下线"
      },
      {
        "sha": "e8bd008",
        "subject": "分歧题两个答案都判对，笔试题新增 AI 逐选项解析"
      },
      {
        "sha": "4e3c6d4",
        "subject": "JLPT 新增整卷模拟考试，真题/精读板块整体下线"
      },
      {
        "sha": "c154e0b",
        "subject": "JLPT 模块换成 HeroUI 组件，页内面包屑全站下线"
      },
      {
        "sha": "3e42a31",
        "subject": "分类改叫词单，学习/复习收进每个词单下"
      },
      {
        "sha": "fabb67a",
        "subject": "账户页并入首页，首页重排成三张仪表盘卡片"
      },
      {
        "sha": "eb0fe36",
        "subject": "左侧栏改成悬浮卡片，AI 用量并入账户页，新增设置页"
      },
      {
        "sha": "b93cdc3",
        "subject": "client 重构成管理后台架构：左侧栏取代顶栏+多 tab，补暗色/登录页"
      },
      {
        "sha": "105309e",
        "subject": "client 全量换到 HeroUI:移除 antd,App.css 5336 → 721 行"
      },
      {
        "sha": "b43d267",
        "subject": "图片名里的连续点压成一个：stem_1..png 传不上 R2"
      },
      {
        "sha": "ad9d426",
        "subject": "上传脚本修 bash 3.2 的变量名解析，补 --dry-run"
      },
      {
        "sha": "5148252",
        "subject": "qbank 上线脚本：建表并进 apply.sh，改成可重复跑"
      },
      {
        "sha": "c189e3a",
        "subject": "新增 JLPT 精练板块：3207 道真题拆成单题，按题型/年份练"
      },
      {
        "sha": "d315ff0",
        "subject": "N1 题库：31 套真题全量入库（纳豆 + mojidict 双源交叉校验）"
      }
    ]
  },
  {
    "date": "2026-08-01",
    "items": [
      {
        "sha": "b0cc34e",
        "subject": "依赖全量升级 + Prisma 7 迁移 + dashboard 并入 workspace"
      }
    ]
  },
  {
    "date": "2026-07-08",
    "items": [
      {
        "sha": "ff2dbf1",
        "subject": "新增真题题库表与导入脚本，导入 2020年12月 N1 整卷"
      },
      {
        "sha": "1a03674",
        "subject": "引入 language-admin 管理后台到 dashboard 目录"
      },
      {
        "sha": "75bb6d6",
        "subject": "真题模块 + 全站 antd 输入框 + 复习正确率 + 若干体验"
      }
    ]
  },
  {
    "date": "2026-07-31",
    "items": [
      {
        "sha": "2d823b3",
        "subject": "skill: 上传真题后把读解拆成「精读」独立篇(步骤5 + 可复用脚本)"
      },
      {
        "sha": "cc0c69b",
        "subject": "精读板块:真题阅读拆篇 + 题库去语法提示 + 真题上传 skill"
      }
    ]
  },
  {
    "date": "2026-07-30",
    "items": [
      {
        "sha": "3b005d1",
        "subject": "2011.12 N1 真题听力字幕"
      }
    ]
  },
  {
    "date": "2026-07-28",
    "items": [
      {
        "sha": "b2982bd",
        "subject": "移除 mp3 播客临时诊断标记 + console 日志"
      },
      {
        "sha": "2f15807",
        "subject": "修 mp3 播客控制失效: adapter 改命令式 ref-callback (+临时诊断标记)"
      }
    ]
  },
  {
    "date": "2026-07-23",
    "items": [
      {
        "sha": "b21c188",
        "subject": "mp3 podcast: audio ref → state 避免时序问题"
      },
      {
        "sha": "27cc110",
        "subject": "修播客底部工具栏播放键对 mp3 podcast 无效"
      },
      {
        "sha": "049a4a6",
        "subject": "语法选择题库 + 2011.7 真题(含音频/字幕) + 播客 mp3 导入 + 周回顾"
      }
    ]
  }
]
