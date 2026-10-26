# dsh-prompt-enricher

> A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that turns prompt writing into a separate, deliberate step: **write first, send once**.
>
> 把「写提示词」从输入框里独立出来：先写清楚，再发出去。

DeepSeek Harness（DSH）的输入框适合快速发一句话，不适合推敲一段长提示词。这个插件在输入框上方加了一块提示词工作台：草稿、历史、Markdown 编辑、技能补全，以及一条「先追问、再定稿」的澄清流程。

## 功能

- **两个入口，同一块面板**：会话里切到顶部的「提示词」tab；新开的空白会话没有 tab 条，由输入框工具行里的「提示词」按钮就地打开（与权限、模型控件同一行）。
- **已发送历史**：直接读会话自己的完整日志，按 `seq` 合并成只增不减的列表。不是「最近一页消息」——长会话也不会缺条目。
- **草稿**：可编辑、可发送、可删除；按会话持久化在浏览器 `localStorage`，重启 DSH 后还在。
- **Markdown 编辑器**：回车只换行，**不发送**；输入 `/` 调出技能补全（与 shell 同一份技能目录）。
- **澄清提升（elicitation）**：把当前草稿交给一个子会话，按 `grill-me` 的方式逐条追问，每个问题带推荐答案；你逐条裁决后，产出一份消解了歧义的完整提示词，**回填为草稿**（不会自动发送）。
- **中英双语**：跟随 DSH 的 locale。

## 安装

### 前置

- DSH 桌面版（host `0.2.x`；`0.1.x` 也兼容，见[兼容性](#兼容性)）。

### 步骤

1. 把仓库放到一个长期保留的目录：

   ```powershell
   git clone https://github.com/msciu/dsh-prompt-enricher.git D:\tools\dsh-prompt-enricher
   ```

2. 在 DSH profile 的 `package.json` 里加依赖与 bundle。Windows 下 profile 目录一般是
   `C:\Users\<you>\.dsh\profiles\desktop`，macOS / Linux 是 `~/.dsh/profiles/desktop`：

   ```json
   {
     "dependencies": {
       "dsh-prompt-enricher": "file:D:/tools/dsh-prompt-enricher"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-prompt-enricher"
         ]
       }
     }
   }
   ```

   `dsh.profile.bundles` 里原有的两行不要删，只追加插件那一行。

3. 在 profile 目录里安装：

   ```powershell
   cd C:\Users\<you>\.dsh\profiles\desktop
   pnpm install
   ```

4. 重启 DSH。

`lib/` 已随仓库提供，安装时不需要构建。

### 装进去的必须是链接，不能是拷贝

`pnpm install` 对 `file:` 依赖**可能拷一份目录**而不是建链接。拷贝一旦发生，之后每次改代码 + 重建都只更新源目录，桌面版读的还是那份旧拷贝——表现为「界面完全没变」。

```powershell
$link = 'C:\Users\<you>\.dsh\profiles\desktop\node_modules\dsh-prompt-enricher'
(Get-Item $link -Force).LinkType          # 期望 Junction / SymbolicLink
Get-ChildItem "$link\lib" | Select Name,Length,LastWriteTime
```

如果类型是空、且时间戳和源目录不一致，就删掉重建：

```powershell
Remove-Item $link -Recurse -Force
New-Item -ItemType Junction -Path $link -Target D:\tools\dsh-prompt-enricher
```

### 卸载

从 profile 的 `bundles` 与 `dependencies` 各删一行，`pnpm install`，重启 DSH。草稿不会自动清除：浏览器 `localStorage` 的 `dsh.prompt-enricher` 键下还留着它们。

## 构建（可选）

仓库里的 `lib/` 是构建产物；改完 `src/` 后：

```powershell
pnpm install
pnpm build
```

产出两个独立产物：

- `lib/index.js` — host 半，ESM。`@deepseek-ai/*` 保持为 import，由安装环境提供。
- `lib/client.js` — 浏览器半。闭包工厂形式的 CJS，包在 `window.__ModuleLoader__.load({ id, factory })` 里，外部依赖只走 shell 的模块表。

构建工具是 `tsdown`（devDependency）。配置用普通对象而不是 `defineConfig`，这样把包链进 DSH monorepo 构建时，也不会因为配置自身的 import 解析不到 monorepo 的 `node_modules`。

## 工作原理

### 已发送历史：为什么必须读宿主

浏览器里的 `eventSource` 只是会话控制器的一页：`PAGE_MESSAGES = 50` 条**消息**，不是事件日志。会话一长，页外的提示词根本没进过浏览器；而且重开会话 / 换 binding 时整页会被 `replace`，派生列表跟着收缩。

实测一份 9065 条事件的真实会话：日志里有 **65** 条用户提示词，而「最后 50 条消息」里只有 **2** 条。这就是只看窗口时列表「数据不全」的原因。

所以历史由宿主提供：

```
GET /_dsh/prompt-enricher/sent?sessionId=<id>
```

- 活会话直接读 `Session.events`——完整的 append-only 日志，包含 write-behind 尚未落盘的尾部；
- 非活会话回退到 `sessionPersistence.inspect`。

宿主与客户端共用同一条折叠规则（`src/sent-fold.ts`）：只认 `surfaceOp === 'append'`、`data.source.kind === 'user'`、有数字 `seq`、文本非空（只含图片的提示词保留，显示为 `[N 张图片的提示词]`）。runtime-context、skill-catalog、compact checkpoint 等以 `user/message` 形式出现的注入内容因此不会被误算成你写的提示词。

客户端 `SentFeed`（`src/client/sent.ts`）把这批数据按 `seq` 合并进本地索引：

- **只增不减**：窗口被替换、请求失败、binding 消失，都不会让列表变短；
- 首屏先用 `localStorage` 里最近 300 条兜底，全量响应到达后补齐；
- 只有 `user/message` 的增量才触发通知——流式输出的每个 chunk 不再重算列表、不再让 React 重渲染。

### 澄清会话

浏览器不能创建子会话（`subagents` 的启动方法只在宿主侧），也不能读子会话的 transcript（子会话不在会话列表里）。所以 host 半负责：建子会话、把它的消息折叠成结构化轮次、通过插件自己的 HTTP 路由提供给你。子会话的指令正文内嵌在 `src/grill-protocol.ts`，不依赖本地是否装了 `grill-me` 技能。

## 兼容性

DSH 0.2.1 改了 subagent 生命周期方法名。host 半做运行时特性检测，同时兼容两代：

| 动作 | 0.1.x | 0.2.x |
|---|---|---|
| 建子会话 | `startContinuable` | `startActivation`（优先） |
| 释放 | `drainContinuableChildren` | `drainChildren`（优先） |

两版都没有时，`start` 路由返回说明性的不兼容错误，而不是抛栈。

## 测试

```powershell
pnpm install
pnpm test
```

- `tools/sent-feed.test.ts`：过滤规则、迟到的 binding、只增不减、窗口替换、全量历史并入、`seq` 去重、绑定消失、请求失败、脏数据清洗、图片提示词——10 组断言。
- `tools/sent-route.test.mjs`：直接加载 `lib/index.js`，用 fake ctx 跑 `/sent` 的活会话日志、持久化回退、503、400。

### 排查工具

`tools/` 下的浏览器探针通过 argv 接收带 token 的实例 URL，不写死任何环境路径。默认使用 `puppeteer-core` 和系统 Chrome 的默认安装位置；不同环境用两个环境变量覆盖：

```powershell
$env:PUPPETEER_CORE = 'C:\path\to\node_modules\puppeteer-core'
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tools\client-smoke.cjs "http://127.0.0.1:<port>/?token=<token>"
```

| 脚本 | 用途 |
|---|---|
| `client-smoke.cjs` | 无头浏览器确认 client bundle 真的 materialize，收集 console / 失败请求 |
| `blank-entry-probe.cjs` | 空白会话入口 → 看板 → 返回的往返 |
| `header-probe.cjs` | 探测 view tab 条是否存在 |
| `answer-visibility-probe.cjs` | 澄清卡片「回答」按钮在各分辨率下是否可见（前/后 CSS 对比） |
| `chip-layout.cjs` / `composer-probe.cjs` / `clarify-probe.cjs` / `session-probe.cjs` / `toolrow-probe.cjs` / `verify-3.cjs` | 各座位、布局与交互的定点探测 |
| `asar-extract.cjs` | 从 `app.asar` 取宿主真实实现（只有编译后 JS） |
| `sent-feed.test.ts` | 已发送列表的过滤 / 合并 / 稳定性回归 |
| `sent-route.test.mjs` | `/sent` 路由的宿主回归 |
| `sent-log-check.ts` | 统计并折叠一份真实 `session.v4.jsonl.zstd`，用于核对「数据不全」 |

## 已知限制

- 已发送列表一次返回该会话的全部提示词，面板渲染也还没有虚拟化；数万条以上的超长会话需要时再加。
- `engines.dsh` 目前只是声明，宿主是否用它拦截安装未验证。
- 0.1.x 宿主只做过静态兼容，本机没有可运行的 0.1 实例。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE)
