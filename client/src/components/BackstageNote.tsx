// "按 Z 弹出"的全屏 Modal 内容 —— 一篇手记。硬编码中文,不走 i18n。
// 要改文字 / 加段落 / 调结构,改 `noteHtml` 这一个字符串就行,
// 不用动 JSX。任何标准 HTML 标签都能用:h1/h2/h3/h4、p、ul/ol/li、
// blockquote、pre、code、strong、table(class="backstage-note-table")、hr。
const noteHtml = `
<header>
  <h1>把团队默契装进 Claude Code —— 本周做的四件事</h1>
  <p class="backstage-note-meta">zyd · 2026-05-29</p>
  <p>
    接 Michael 的 AI harness(<code>michael-collab-framework</code> 分支已落地),
    这篇主要讲:怎么把团队里"心知肚明"的操作,真正沉淀成项目级命令。
  </p>
</header>

<hr />

<h2>一、问题</h2>
<ul>
  <li>每改一个文件都要点确认按钮,必须盯屏不能离手</li>
  <li>新建主题要在 <code>k-football</code> / <code>k-expert-admin</code> / <code>waiter-admin</code> 三个仓库分别建目录、填配置,半小时起步</li>
  <li>commit message 风格不统一</li>
  <li>同样的项目结构,每次新对话都要让 AI 重新摸一遍</li>
</ul>
<p>但项目里没有任何痕迹:</p>
<ul>
  <li>AI 不知道</li>
  <li>新同事不知道</li>
  <li>规范只能靠口口相传</li>
</ul>
<p>所以这周做的核心事情只有一句话:</p>
<blockquote>把团队默契沉淀成项目级命令,让 Claude Code 强制执行。</blockquote>

<hr />

<h2>二、四件事</h2>
<pre><code>项目根/
├── .claude/
│   ├── settings.json          # ① 权限白名单 + hooks
│   ├── commands/
│   │   ├── new-theme.md       # ② 三仓库同名主题骨架
│   │   └── auto-commit.md     # ③ 提交规范
│   ├── repo-paths.json        # 三仓库绝对路径(gitignore)
│   └── repo-paths.example.json
└── CLAUDE.md                  # ④ 项目快照(待办)</code></pre>

<hr />

<h2>① <code>.claude/settings.json</code> + <code>/fewer-permission-prompts</code></h2>
<p>对应的是:</p>
<blockquote>"每改一个文件都要确认"的痛点。</blockquote>
<p>Claude Code 默认对:</p>
<ul>
  <li>写文件</li>
  <li>跑命令</li>
  <li>修改内容</li>
</ul>
<p>全部弹窗确认。它的逻辑其实很合理:</p>
<blockquote>"安全优先。"</blockquote>
<p>因为 Claude 并不知道:哪些命令在你的项目里是绝对安全的。</p>

<h3>permissions.allow</h3>
<p><code>permissions.allow</code> 本质上就是项目级白名单。在里面的操作:</p>
<ul>
  <li>Claude Code 不再弹窗</li>
  <li>直接执行</li>
</ul>
<pre><code>{
  "permissions": {
    "allow": [
      "Edit",
      "Write",
      "Bash(yarn:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(grep:*)",
      "Bash(ls:*)"
    ]
  }
}</code></pre>

<h3>最大的问题:人记不住</h3>
<p>每天你可能点了几十次"允许"。但回头真让你列:</p>
<blockquote>"哪些命令应该进白名单?"</blockquote>
<p>大部分人其实记不全。</p>

<h3><code>/fewer-permission-prompts</code> 干的事</h3>
<p>这是 Anthropic 提供的内置 skill。原理很简单:</p>
<ol>
  <li><strong>扫历史会话</strong>:统计你在本项目里点过哪些"允许"。</li>
  <li><strong>聚类 + 排序</strong>:按频率排序,并过滤危险命令(<code>rm</code>, <code>sudo</code>, <code>git push --force</code>)。</li>
  <li><strong>推荐合入 settings.json</strong>:最后给出推荐列表。</li>
</ol>
<pre><code>建议加入 permissions.allow:

✓ Bash(yarn:*)                    点了 47 次
✓ Bash(git status:*)              点了 31 次
✓ Bash(git log:*)                 点了 28 次
✓ Bash(jq:*)                      点了 19 次
✓ Bash(find .:*)                  点了 14 次

⚠ Bash(rm:*)                      点了 6 次
⚠ Bash(sudo:*)                    点了 3 次</code></pre>
<p>危险命令默认只提示,不自动加入。安全命令可以一键合入。</p>

<h3>hooks(进阶)</h3>
<p>光减少弹窗还不够。更重要的是:</p>
<blockquote>让 AI 主动做事。</blockquote>

<h4>Stop hook</h4>
<p>AI 回复完成后:</p>
<pre><code>yarn type-check</code></pre>
<p>类型不过,当场打回。</p>

<h4>PostToolUse(Edit|Write)</h4>
<p>每次改 <code>.tsx</code>:</p>
<pre><code>prettier --write</code></pre>
<p>自动格式化。</p>

<h4>PreToolUse(Bash)</h4>
<p>拦截危险命令:</p>
<ul>
  <li><code>rm -rf</code></li>
  <li><code>git push --force</code></li>
</ul>
<p>强制人工确认。</p>

<h4>UserPromptSubmit</h4>
<p>每次发问前自动注入:</p>
<ul>
  <li>当前主题</li>
  <li>当前环境</li>
  <li>当前仓库上下文</li>
</ul>
<p>避免每次重新解释。</p>

<h3>边界</h3>
<p>需要入 git 的:</p>
<pre><code>.claude/settings.json</code></pre>
<p>每个人本地私有的:</p>
<pre><code>.claude/settings.local.json</code></pre>
<p>后者已 gitignore。原则:</p>
<table class="backstage-note-table">
  <thead>
    <tr>
      <th>文件</th>
      <th>内容</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>settings.json</code></td>
      <td>团队共识</td>
    </tr>
    <tr>
      <td><code>settings.local.json</code></td>
      <td>个人偏好</td>
    </tr>
  </tbody>
</table>
<p>不要把个人配置塞进团队配置。</p>

<hr />

<h2>② <code>/new-theme</code> —— 三仓库同名主题骨架</h2>
<p>对应:</p>
<blockquote>"每次建主题都要手工操作三个仓库"</blockquote>
<p>最终沉淀成:</p>
<pre><code>/new-theme &lt;主题名&gt; [基模板=ldty]</code></pre>

<h3>做的事情</h3>
<p>命令会:</p>
<ol>
  <li>读取 <code>.claude/repo-paths.json</code></li>
  <li>找到三个仓库路径</li>
  <li>检查主题目录是否已存在</li>
  <li>检查当前是否处于保护分支</li>
  <li>自动生成主题骨架</li>
  <li>自动修改配置</li>
  <li>输出待补字段</li>
</ol>

<h3>5 道安全守卫</h3>
<ol>
  <li><strong>主题名格式校验</strong> —— 仅允许 <code>[a-z0-9-]</code></li>
  <li><strong>目录冲突检查</strong> —— 避免覆盖已有主题。</li>
  <li><strong>分支检查</strong> —— 禁止 release / master / main。</li>
  <li><strong>路径配置检查</strong> —— 确认 <code>repo-paths.json</code> 存在且有效。</li>
  <li><strong>不自动 rollback</strong> —— 失败不自动 cleanup,避免误删已编辑内容。</li>
</ol>

<h3>实战结果</h3>
<p><code>fengbaobifen</code> 主题:30 秒完成三仓库骨架初始化。</p>
<p>完整链路:</p>
<pre><code>/new-theme
→ /theme-config-fill
→ /theme-image-pipeline</code></pre>
<p>结果:</p>
<ul>
  <li>自动建三仓库目录</li>
  <li>自动填配置</li>
  <li>自动补图</li>
  <li>10 个文件</li>
  <li>图片体积:<code>1.79 MB → 568 KB</code></li>
  <li>压缩率: <strong>68%</strong></li>
</ul>

<h3>核心思想</h3>
<p>这个 slash command 的设计理念,其实和 Michael 那套 <code>/spec</code> 一样:</p>
<blockquote>"描述流程,而不是写死脚本。"</blockquote>
<p>AI 负责执行流程。遇到边界情况时:</p>
<ul>
  <li>能暂停</li>
  <li>能提问</li>
  <li>能继续推理</li>
</ul>
<p>而不是传统 shell script 那种:</p>
<blockquote>"一步报错,整个退出。"</blockquote>

<hr />

<h2>③ <code>/auto-commit</code> —— 提交规范</h2>
<p>今天团队确认:</p>
<blockquote>以后统一走 <code>/auto-commit</code>,不再手工 <code>git commit</code>。</blockquote>

<h3>四级闸门</h3>
<table class="backstage-note-table">
  <thead>
    <tr><th>等级</th><th>行为</th></tr>
  </thead>
  <tbody>
    <tr><td>🚫 release-v2</td><td>直接拒绝</td></tr>
    <tr><td>🔴 严重问题</td><td>阻止提交</td></tr>
    <tr><td>🟡 潜在问题</td><td>用户确认</td></tr>
    <tr><td>🟢 审查通过</td><td>自动提交</td></tr>
  </tbody>
</table>

<h3>严重问题包括</h3>
<ul>
  <li>语法错误</li>
  <li>空引用</li>
  <li>安全漏洞</li>
</ul>

<h3>审查通过后</h3>
<p>自动生成:</p>
<pre><code>feat(scope): 中文描述</code></pre>
<p>并补充:</p>
<ul>
  <li>改动内容</li>
  <li>影响范围</li>
</ul>

<h3>收益</h3>
<ol>
  <li><strong>commit message 统一</strong> —— 不再中英混乱 / prefix 混乱 / 风格混乱。</li>
  <li><strong>提交前强制 review</strong> —— 提前挡掉低级错误。</li>
  <li><strong>生产分支保护</strong> —— <code>release-v2</code> 误提交直接拦截。</li>
</ol>

<h3>重点</h3>
<p>这不是"建议"。而是:</p>
<blockquote>团队统一提交流程。</blockquote>
`

export function BackstageNote() {
  return (
    <article
      className="backstage-note"
      dangerouslySetInnerHTML={{ __html: noteHtml }}
    />
  )
}
