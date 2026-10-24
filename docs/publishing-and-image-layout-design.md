# MarkCard Studio 发布链路与图片排版改造方案

> 状态：部分实施（发布链路 P2 已完成，见 [`phase-4-implementation.md`](./phase-4-implementation.md)；P0/P1 图片排版与 P3 微信 API 未做）
> 日期：2026-10-20
> 范围：微信公众号「图片消息 / 贴图」发布、小红书图文发布、卡片内图片排版
> 非目标：视频发布、直播、多账号矩阵、云端同步、AI 生图
>
> 后续扩展：在本文的渲染/排版/发布包基础上，新增图片生成（含 Jaaz 接入）、素材管理、运营闭环与「作品 → 变体」模型，见 [`image-content-suite-design.md`](./image-content-suite-design.md)。本文原列的「非目标：AI 生图」已被扩展文档取代。
>
> 实现说明：本文写于渲染器拆分/真实测量分页之前；`useCardRenderer`、`estimateBlockHeight` 等是当时的概念名。当前实现以 `CardArtwork.vue` + `useMeasuredPagination.js` + `useCardExport.js` 为准；图片组必须接入真实测量，不要恢复估算分页。

---

## 0. 结论先行

这件事不是「加两个发布按钮」，而是要补三层能力：

1. **渲染层**：把「页面 → Canvas/Blob」从导出流程里拆出来，成为可复用渲染器；
2. **物料层**：定义统一的 **发布包（Publish Bundle）**，包含图片、标题、正文、标签、manifest；
3. **渠道层**：用渠道适配器分别对接微信 API、小红书半自动流程、本地发布包。

图片排版必须先行，因为它同时影响 **分页、预览、导出、发布图片集** 四条链路；如果先接发布，后面排版一改，发布侧全部要返工。

平台现实决定了自动化程度不同：

- **微信**：公众号「图片消息」有官方草稿箱/发布 API，可以做到「上传图片 → 建草稿 → 发布」，但有账号资质、IP 白名单、`appsecret` 保管等前置条件。
- **小红书**：面向个人创作者的官方发布 API 基本不可得；开放平台 API 面向有资质的商家/服务商。MVP 应做「发布包 + 一键复制 + 打开创作平台 + 文件夹」的半自动流程，浏览器自动化只作为可选实验能力。

因此建议的落地顺序是：

```text
P0 拆渲染器（无用户可见变化）
  → P1 图片排版引擎（预览/导出/分页）
  → P2 发布包 + 小红书半自动
  → P3 微信官方 API 直连（草稿优先）
  → P4（可选）小红书浏览器自动化桥
```

---

## 1. 需求拆解与平台约束

### 1.1 名词与假设

| 名词 | 本方案中的含义 |
| --- | --- |
| 微信「贴图」 | 微信公众号的**图片消息**（社区常称「小绿书」），不是朋友圈、不是聊天表情包 |
| 小红书图文 | 小红书创作服务平台的图文笔记（1–18 张图 + 标题 + 正文 + 标签） |
| 图片排版 | ① 单个卡片内多图版式；② 跨页套图的顺序与封面；③ 发布侧图片集/封面裁切 |
| 发布包 | 一次发布所需的全部物料：`manifest.json` + 图片 + 文案，是导出与各渠道的共同输入 |

> 如果「微信贴图」实际指朋友圈或视频号，图片规格、入口和自动化方式都会变化，需要先确认（见第 11 节）。

### 1.2 平台能力矩阵

| 渠道 | 可用发布方式 | 前置条件 | 图片 | 文本 | 可自动化程度 |
| --- | --- | --- | --- | --- | --- |
| 微信公众号·图片消息 | 官方 API：永久素材上传 → 草稿箱 → 发布 | 具备接口权限的公众号/服务号（通常需认证）、IP 白名单、AppID/AppSecret | 最多 20 张，首图为封面，永久 `media_id` | 标题必填；正文纯文本；支持评论开关 | 高（草稿/发布均可 API） |
| 微信公众号·图文消息 | 官方 API：正文内图片需先上传，封面用永久素材 | 同上 | 正文图需走 `uploadimg`，封面需永久素材 | HTML 正文 < 20,000 字符 | 高，但排版映射复杂 |
| 小红书·图文笔记 | 创作服务平台网页/APP；开放平台 API 仅面向有资质合作方 | 登录态；开放平台需资质与 OAuth | 1–18 张，推荐 3:4；标题 ≤ 20 字，正文 ≤ 1000 字 | 标签独立于正文 | 个人号低；有资质合作方中 |
| 本地发布包 | 文件系统 | 无 | 不限 | 不限 | 完全 |

> 微信侧字段与限制来自官方 `draft/add` 文档；小红书限制为社区通行值，必须做成可配置并在发布前校验，不能硬编码为永久事实。
>
> 实施说明（2026-10-21）：`src/config/publishChannels.js` 里两个内容平台按产品决定统一为「标题 ≤ 20 字、正文 ≤ 1000 字」，比公众号接口本身允许的长度更严；放宽只改该配置，UI 与发布检查会同步。

### 1.3 现状差距

| 能力 | 当前实现 | 缺口 |
| --- | --- | --- |
| 平台预设 | `src/composables/useStudioDocument.js` 中 `platforms` 只有小红书/抖音/微博/方形/自定义 | 缺「微信公众号」画布预设，更缺渠道概念 |
| 图片块 | `useContentParser.js` 中 `image` 是单张块，高度固定 236px | 无多图组、无版式、无 caption、无焦点裁切 |
| 分页 | `splitBlocksIntoPages()` 按块估算高度，图片固定高度 | 多图组会被拆散；无法按版式精确计算高度 |
| 预览 | `PreviewArtworkCard.vue` 用 `renderBlocksToHtml()` 渲染 | 与导出共用字符串渲染器（这是优点），但图片块能力太弱 |
| 导出 | `useCardExport.js` 内 `renderPageToCanvas()` 直接写盘 | 渲染与写盘耦合，发布侧无法复用；没有「发布包」 |
| 文案 | 只有 Markdown 原文 | 没有标题/正文/标签抽取，没有长度校验 |
| 网络/凭据 | 无 | 没有 HTTP 客户端、没有安全凭据存储、没有 token 缓存 |
| 发布 UI | 只有导出面板 | 没有渠道选择、校验清单、进度与失败恢复 |

---

## 2. 目标架构

### 2.1 分层

```text
┌─────────────────────────────────────────────────────────────┐
│ UI                                                          │
│ PublishDialog / SettingsLayout / PreviewArtworkCard          │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ 应用编排层                                                   │
│ useStudioDocument（文档、分页、布局默认值）                    │
│ usePublishPlan（渠道约束、文案、图片选择、校验）               │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ 渲染与物料层                                                 │
│ useCardRenderer（Page → Canvas/Blob）                         │
│ usePublishBundle（Bundle 读写、manifest、hash）               │
│ useImageLayout（版式定义、度量、HTML）                         │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ 渠道适配层 src/publish/channels/*                            │
│ WeChatApiChannel │ XiaohongshuAssistChannel │ LocalBundle     │
└───────────────┬─────────────────────────────────────────────┘
                │ invoke
┌───────────────▼─────────────────────────────────────────────┐
│ Tauri / Rust                                                 │
│ publish/wechat.rs（reqwest、token、上传、草稿、发布）          │
│ publish/secrets.rs（OS Keychain）                             │
│ publish/bundle.rs（原子写、路径校验）                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 四条设计原则

1. **单一渲染器**：预览与导出继续共用 `renderBlocksToHtml()`；发布图片必须来自同一个 `useCardRenderer`，禁止再写第二套 DOM 拼接。
2. **发布包是唯一中间产物**：所有渠道都消费同一个 `bundle/`；微信 API 读本地文件而不是前端 base64，避免 18 张图的内存峰值。
3. **渠道能力配置化**：图片数量、标题长度、正文长度、图片格式、画布比例、是否支持标签，全部放进 `publishChannels.js`，UI 只读配置。
4. **内容内嵌排版优先**：版式写在 Markdown 指令里（`::: gallery`），设置面板只提供默认值；这样分页、编辑、撤销、重新打开都不会丢失版式。

### 2.3 端到端数据流

```text
Markdown
  → parseBlocks()                      生成 image-group 块
  → splitBlocksIntoPages()             用版式度量做分页
  → pages                              预览 / 缩略图
  → useCardRenderer.renderPages()      Canvas / Blob
  → usePublishBundle.write()           bundle/ + manifest.json
  → channel adapter
      ├─ WeChat API      → 永久素材 → 草稿 →（可选）发布
      ├─ XHS assist      → 复制文案 + 打开创作平台 + 显示文件夹
      └─ local bundle    → 仅落盘，供手动上传
```

---

## 3. 图片排版引擎

### 3.1 三个层次

| 层级 | 内容 | 实现位置 |
| --- | --- | --- |
| L1 页内多图 | 双列、三列、宫格、左图右文、胶片条、拍立得 | `parseBlocks` + `useImageLayout` + CSS |
| L2 跨页套图 | 封面用大图、内容页统一版式、页序、每页覆盖 | `useStudioDocument` + `SettingsLayout.vue` |
| L3 发布侧图片集 | 选哪些页、封面用哪张、渠道裁切、顺序 | `usePublishPlan.js` |

### 3.2 块模型

现有单图块保留兼容，新增 `image-group`：

```js
// 单图（兼容旧文档）
{ type: "image", alt: "海边", src: "assets/sea.jpg" }

// 多图组
{
  type: "image-group",
  preset: "grid-2",          // 版式 id
  gap: 10,                   // 设计视口 px（450 宽基准）
  radius: 12,
  fit: "cover",              // cover | contain
  ratio: "1:1",              // 单元格比例，版式默认值，可覆盖
  captions: "none",          // none | overlay | below
  items: [
    {
      src: "assets/sea.jpg",
      alt: "海边",
      caption: "清晨的海",
      focal: { x: 0.5, y: 0.4 }, // object-position
      span: 1,                   // 占几列
    },
  ],
}
```

`items` 里的 `src` 仍由 `resolveLocalImages()` 在解析阶段转成 data URL 或 `http(s)`，与现有图片处理保持一致。

### 3.3 Markdown 语法

显式容器（推荐，语义清晰、可携带参数）：

```md
::: gallery preset=grid-2 gap=10 radius=12 ratio=1:1 captions=overlay
![海边](assets/sea.jpg)
![城市](assets/city.jpg)
![山脉](assets/mountain.jpg)
:::
```

隐式成组（降低写作成本，可在设置中关闭）：

```md
![海边](assets/sea.jpg)
![城市](assets/city.jpg)
```

规则：

- 连续多行 `![...](...)` 且中间没有空行、没有其他块 → 自动合成一个 `image-group`，`preset=auto`；
- 空行分隔的两张图 → 仍是两个单图块；
- `::: gallery` 内的图片必须全部进入同一组；
- 单图指令也可以强制指定版式：`::: gallery preset=single`；
- 图片标题 `![alt](src "caption")` 中的 `"caption"` 作为 caption；
- 解析失败时降级为普通 `image` 块，不能让整页解析失败。

### 3.4 版式预设

首批建议 7 个，足够覆盖 90% 场景：

| id | 名称 | 图片数 | 布局 | 单元格比例 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `single` | 单图 | 1 | 1 列 | 4:3（可覆盖） | 大图，兼容旧行为 |
| `grid-2` | 双列 | 2–4 | 2 列 | 1:1 | 最常用对比/并列 |
| `grid-3` | 三列 | 3–9 | 3 列 | 1:1 | 步骤、清单、九宫格 |
| `hero` | 主图 + 副图 | 2–5 | 1 大 + 3 列 | 16:9 + 1:1 | 封面/首图强调 |
| `split` | 左右对比 | 2 | 2 列 | 4:3 | Before/After |
| `strip` | 胶片条 | 3–5 | N 列 | 3:4 | 氛围图、截图序列 |
| `polaroid` | 拍立得 | 1–3 | 1–2 列 | 4:5 + 白边 | 生活/手帐风 |

后续可加 `masonry`（固定行高 + span，不做真瀑布流，保证分页可计算）、`full-bleed`（满版出血）、`cover-story`（封面 + 目录缩略图）。

预设定义放在 `src/config/imageLayouts.js`：

```js
export const IMAGE_LAYOUTS = [
  {
    id: "grid-2",
    minItems: 2,
    maxItems: 4,
    columns: 2,
    ratio: 1,          // 宽/高
    defaultGap: 10,
    captions: "overlay",
  },
  // ...
];
```

### 3.5 布局度量（关键）

分页要准，必须让「估算高度」和「真实渲染高度」来自同一个函数。所有版式都使用**固定单元格比例 + CSS `aspect-ratio`**，不依赖图片原始尺寸，因此高度是确定的。

每个版式自己实现 `measure()`，不要用一个公式硬套所有版式（`hero`、跨列、拍立得的高度规则不同）：

```js
// src/composables/useImageLayout.js
export function computeGridLayout({
  columns,
  itemCount,
  contentWidth,   // 设计视口下的正文宽度（450 宽基准约 410）
  gap = 10,
  ratio,          // 宽/高
  captionMode = "none",
  captionLines = 1,
}) {
  const rows = Math.ceil(itemCount / columns);
  const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
  const cellHeight = cellWidth / ratio;
  const captionHeight = captionMode === "below" ? captionLines * 18 + 6 : 0;
  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    height: rows * (cellHeight + captionHeight) + (rows - 1) * gap,
  };
}

// 每个预设暴露 measure，内部可复用 computeGridLayout 或自定义
export function measureLayout(preset, options) {
  return preset.measure(options);
}
```

`hero` 这类含跨列的版式必须单独计算：第一行高度 = `contentWidth / heroRatio`，第二行才是三列小图高度；`polaroid` 还要加白边和 caption 区。`span` 只允许出现在预设明确支持的版式中，避免通用公式与真实网格不一致。

`estimateBlockHeight(block)` 需要新增上下文参数：

```js
// 旧：estimateBlockHeight(block)
// 新：estimateBlockHeight(block, { contentWidth, themeClass })
```

调用点只有 `splitBlocksIntoPages()`（`useStudioDocument.js:609`），改动面可控，但必须同步修改：

- `splitBlocksIntoPages(blocks, maxHeight, context)`；
- `getCardContentHeight()` 的常量要重新标定（新增 caption 行高、组间距）；
- 图片组是**原子块**，不允许在组中间分页；
- 组高度超过单页可用高度时，按行拆成多个子组（`splitImageGroupToFit()`），或降级为 `grid-3`；
- 封面页的版式可以独立（`preset=hero` / `single`），但也要参与高度校验。

### 3.6 渲染与预览/导出一致性

新增 `renderBlockToHtml` 的 `image-group` 分支，输出纯 HTML + CSS 变量：

```html
<figure class="card-image-layout layout-grid-2"
        style="--cols:2;--gap:10px;--ratio:1;--radius:12px">
  <div class="layout-cell" style="--span:1">
    <img src="..." alt="..." style="object-position:50% 40%" loading="eager" />
    <figcaption>清晨的海</figcaption>
  </div>
</figure>
```

配套 `src/styles/themes/image-layout.css`：

```css
.card-image-layout {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: var(--gap);
  margin: 10px 0;
}
.layout-cell {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius);
  aspect-ratio: var(--ratio);
  grid-column: span var(--span, 1);
}
.layout-cell > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: var(--focal-x, 50%) var(--focal-y, 50%);
}
```

关键点：

- **预览和导出都用 `renderBlocksToHtml()`**，不新增 Vue 渲染组件，避免两套 DOM；
- `aspect-ratio` + `object-fit` 在 WKWebView / WebView2 均可用，html-to-image 能正确捕获；
- caption 建议 MVP 用 `overlay`（绝对定位，不参与高度），`below` 用固定行高 + `line-clamp`，否则高度不可预测；
- 所有图片继续走 `inlineImagesForExport()`；新增的 `figure` 内 `img` 会被同一选择器命中，无需改导出准备步骤；
- 新增 CSS 必须在 `src/styles/themes/index.css` 中、`base-card.css` 之后、各主题之前引入（主题仍可覆盖细节），离线导出容器依赖全局样式；

### 3.7 图片素材与交互

当前编辑器只支持拖入 Markdown 文本，不支持图片粘贴/拖入。图片排版要可用，必须补：

- **粘贴/拖拽图片**：`MarkdownEditor.vue` 监听 `paste` / `drop`，把图片写入文档同目录 `assets/`，插入 `![](assets/xxx.png)`；
- **Tauri 命令**：`import_image_asset(sourcePath, documentPath)`，按内容 hash 命名，避免重复；浏览器模式降级为 `blob:` URL；
- **组内交互**：在 `PreviewArtworkCard.vue` 上用事件委托处理 `.layout-cell` 的点击，提供「上移/下移/设为封面/替换/焦点」操作；
- **焦点裁切**：点击图片位置换算成 `focal.x/y`，写入块数据；
- **缩略图**：`PreviewStrip.vue` 当前只显示 `page.imageUrl`，改为使用组内第一张图的 `imageUrl`（`useStudioDocument` 已经解析 `imageUrl`）。

### 3.8 设置与持久化

新增「排版」设置页（第 5 个 tab）：

- 默认版式（`auto` / `single` / `grid-2` / `grid-3` / `hero` / `split` / `strip` / `polaroid`）；
- 默认间距、圆角、图片填充方式（cover/contain）、caption 模式；
- 「连续图片自动成组」开关；
- 「应用到当前页 / 全部页」；
- 当前页图片组列表（可重排、改版式、设封面）。

当前设置持久化在 `SETTINGS_KEY = "markcard_studio_settings_v1"`（`useStudioDocument.js:187`）。新增字段必须同时加到 **restore** 和 **save** 两处；建议顺手升级为 `v2` 并保留 v1 读取逻辑：

```js
// v2 新增
layoutDefaults: {
  preset: "auto",
  gap: 10,
  radius: 12,
  fit: "cover",
  captions: "none",
  autoGroup: true,
}
```

注意：`SettingsTabs.vue` 现在是 `grid-cols-4` 硬编码，加第 5 个 tab 要改为动态列数；`App.vue` 里右侧栏和抽屉各有一份 `SettingsPanel` 的 props/emits，新增字段必须**两处都加**。

---

## 4. 发布链路

### 4.1 发布计划（PublishPlan）

`usePublishPlan.js` 负责把「文档 + 页面 + 渠道配置」变成可校验、可发布的计划：

```js
{
  channelId: "wechat-newspic",
  canvas: { width: 1080, height: 1440 },
  content: {
    title: "把今天的想法变成作品",
    body: "正文纯文本……",
    tags: ["#Markdown", "#排版"],
    digest: "",
  },
  images: [
    { pageIndex: 0, role: "cover", fit: "cover", crop: null },
    { pageIndex: 1, role: "content" },
  ],
  options: {
    mode: "draft",          // draft | publish
    openComment: true,
    onlyFansCanComment: false,
  },
}
```

职责边界：

- **标题**：优先取文档 H1；没有则取第一页标题；允许用户在发布面板改写；
- **正文**：把 Markdown 转纯文本（去标题标记、图片、代码围栏），保留段落与列表；
- **标签**：从正文中的 `#话题` 抽取 + 用户手动补充，去重、限个数；
- **图片选择**：默认全部页；支持排除封面、选择区间、拖拽排序、指定封面；
- **校验**：渠道限制、图片尺寸/体积、标题/正文长度、空内容、重复图片；
- **透明背景**：透明画布在 JPG/部分平台会变黑或变白。发布计划必须检查 `transparentBackground`：微信支持 PNG 但体积大，小红书建议不透明 JPG；默认提示用户改用不透明背景，或按渠道强制 PNG；
- **内容 hash**：`sha256(标题 + 正文 + 图片 hash 列表)`，用于幂等和历史记录。

### 4.2 渠道配置

`src/config/publishChannels.js`：

```js
export const PUBLISH_CHANNELS = [
  {
    id: "wechat-newspic",
    labelKey: "publishFlow.channels.wechatNewspic",
    mode: "api",                  // api | assist | bundle
    platformName: "微信公众号",
    canvas: { width: 1080, height: 1440 },
    limits: {
      images: { min: 1, max: 20 },
      title: { min: 1, max: 64 },
      body: { min: 0, max: 20000 },
      tags: { max: 0 },
    },
    media: { format: "JPG", maxBytes: 10 * 1024 * 1024, minSide: 320 },
    capabilities: { draft: true, publish: true, schedule: false, tags: false },
  },
  {
    id: "xhs-note",
    labelKey: "publishFlow.channels.xhsNote",
    mode: "assist",
    platformName: "小红书",
    canvas: { width: 1080, height: 1440 },
    limits: {
      images: { min: 1, max: 18 },
      title: { min: 1, max: 20 },
      body: { min: 0, max: 1000 },
      tags: { max: 10 },
    },
    media: { format: "JPG", maxBytes: 32 * 1024 * 1024, minSide: 720 },
    capabilities: { draft: false, publish: false, schedule: false, tags: true },
  },
];
```

渠道画布与现有平台预设解耦：选择渠道时自动把 `selectedPlatformName` 切到对应画布（需要新增「微信公众号」平台预设），但不强制覆盖用户主题。

### 4.3 适配器接口

```js
// src/publish/channels/types.js（JS 项目用注释表达契约）
export function createChannelAdapter(id) {
  return {
    id,
    async validate(plan) {},                    // → Issue[]
    async prepare(plan, ctx) {},                // → bundlePath
    async publish(bundlePath, options, ctx) {}, // → PublishResult
    async openManual(bundlePath) {},            // → void
  };
}
```

`ctx` 提供 `onProgress({ stage, current, total, message })`、`signal`（取消）、`i18n`。所有渠道的失败都抛 `PublishError { code, message, hint, retryable }`，UI 只负责展示。

### 4.4 微信「图片消息」直连

#### 前置条件

- 公众号/服务号具备草稿箱与发布接口权限（通常需要认证）；
- 公众号后台配置 **IP 白名单**；
- 用户提供 AppID / AppSecret；
- 图片为永久素材（`material/add_material?type=image`），不是临时素材。

> 微信官方文档建议这类接口在服务端调用。桌面端直连适用于用户自用场景，但需要自行评估合规性与 IP 稳定性；团队/动态 IP 场景优先使用第 4.4 节末尾的「中继」模式。

#### 调用流程

```text
1. GET  /cgi-bin/token?grant_type=client_credential&appid=...&secret=...
2. POST /cgi-bin/material/add_material?access_token=...&type=image   （每张图一次，multipart）
3. POST /cgi-bin/draft/add?access_token=...                          （article_type=newspic）
4. POST /cgi-bin/freepublish/submit?access_token=...                 （可选，mode=publish）
5. POST /cgi-bin/freepublish/get?access_token=...                    （轮询发布状态）
```

`draft/add` 的关键字段：

```json
{
  "articles": [{
    "article_type": "newspic",
    "title": "标题",
    "content": "正文纯文本",
    "need_open_comment": 1,
    "only_fans_can_comment": 0,
    "image_info": {
      "image_list": [{ "image_media_id": "PERMANENT_MEDIA_ID" }]
    },
    "cover_info": {
      "crop_percent_list": [{
        "ratio": "1_1",
        "x1": "0.166454", "y1": "0",
        "x2": "0.833545", "y2": "1"
      }]
    }
  }]
}
```

#### Rust 命令

```rust
wechat_set_credentials(app_id, app_secret) -> Result<(), String>
wechat_credential_status() -> Result<CredentialStatus, String>
wechat_clear_credentials() -> Result<(), String>
wechat_test_account() -> Result<WechatAccount, String>
wechat_publish_bundle(bundle_path, mode) -> Result<WechatPublishResult, String>
wechat_publish_status(publish_id) -> Result<WechatPublishStatus, String>
```

`wechat_publish_bundle` 在 Rust 内读 `manifest.json` 和图片文件，完成上传/草稿/发布，并通过 `publish://progress` 事件回报进度。**前端不接触 AppSecret，也不把 18 张图 base64 进 IPC。**

#### 错误映射

| 微信错误码 | 含义 | UI 提示 |
| --- | --- | --- |
| 40001 / 42001 | access_token 无效/过期 | 自动刷新一次，仍失败则重新授权 |
| 40164 | IP 不在白名单 | 引导到公众号后台添加当前出口 IP |
| 45009 | 接口调用超限 | 显示配额与重试时间 |
| 48001 | API 未授权 | 提示账号类型/认证/权限问题 |
| 40007 | media_id 无效 | 重新上传该图，跳过缓存 |
| 53404–53406 | 商品/带货能力问题 | 提示与当前图片消息无关，检查商品配置 |

#### 直连 vs 中继

桌面端直连的最大问题是 **出口 IP 会变**，而公众号 API 依赖 IP 白名单。两种模式：

- **直连（默认）**：适合固定网络/企业出口；AppSecret 存 OS Keychain；实现简单、数据不出本机。
- **中继（可选）**：用户自建云函数/Worker，AppSecret 只存在中继；桌面端只上传发布包。适合动态 IP、团队协作，但破坏「纯本地」承诺，必须显式开启。

MVP 先做直连，中继作为后续配置项。

### 4.5 小红书图文

#### MVP：半自动（推荐）

```text
校验 → 生成发布包 → 复制标题/正文/标签 → 打开创作服务平台 → 显示图片文件夹 → 清单引导
```

能力点：

- 「复制文案」一次写入标题、正文、标签（分段复制，避免平台富文本污染）；
- 「打开创作平台」用 `tauri-plugin-opener` 打开 `https://creator.xiaohongshu.com/publish/publish`；
- 「打开图片文件夹」复用 `open_export_folder`；
- 发布清单：图片数量、标题字数、正文长度、标签数量、封面建议；
- 记住上次选择，减少重复操作。

这条路 100% 可控，不碰账号风控，也不违反平台条款。

#### 可选：浏览器自动化桥（P4）

如果确实要「一键发布」，建议做成**独立可选组件**，不塞进主应用：

- 本地 `127.0.0.1` 桥接进程（Playwright + 持久化浏览器 Profile）；
- 用户手动登录一次，应用只发送 `bundlePath`；
- 选择器集中在一个 `selectors.js`，平台改版时单独修；
- 明确标注「实验性、可能触发风控、账号风险自负」；
- 不保存密码、不绕过验证码、不做批量矩阵。

#### 未来：官方开放平台 API

小红书开放平台对有资质的商家/服务商提供 OAuth2.0 与笔记相关接口。若目标用户是品牌/机构，可新增 `xhs-openapi` 适配器；个人创作者不应作为默认路径。

### 4.6 发布包格式

```text
<exportRoot>/<document-stem>-publish/
├── manifest.json
├── images/
│   ├── 01.jpg
│   ├── 02.jpg
│   └── ...
├── title.txt
├── body.txt
├── tags.txt
└── preview.html          # 可选：离线预览/排障
```

`manifest.json`：

```json
{
  "schemaVersion": 1,
  "id": "20261020-153012-a1b2c3",
  "createdAt": "2026-10-20T15:30:12+08:00",
  "source": {
    "path": "/Users/me/notes/post.md",
    "contentHash": "sha256:..."
  },
  "channel": {
    "id": "wechat-newspic",
    "canvas": { "width": 1080, "height": 1440 }
  },
  "content": {
    "title": "标题",
    "body": "正文纯文本",
    "tags": ["#Markdown"],
    "digest": ""
  },
  "images": [
    {
      "file": "images/01.jpg",
      "role": "cover",
      "width": 1080,
      "height": 1440,
      "bytes": 812345,
      "sha256": "..."
    }
  ],
  "render": {
    "theme": "theme-swiss-grid",
    "scale": 2,
    "format": "JPG"
  },
  "publish": {
    "mode": "draft",
    "openComment": true
  }
}
```

约束：

- `manifest.json` 是唯一事实来源，渠道适配器不得再读 Markdown；
- 图片文件名使用固定序号，避免中文/空格/特殊字符；
- 写入采用 `begin_publish_bundle` → `append_bundle_image`（逐张 base64 落盘）→ `finish_publish_bundle`（写 manifest + rename）三步，避免一次 IPC 传 18 张图导致内存峰值；
- 原子写入：先写临时目录，成功后 rename；
- 所有路径在 Rust 边界校验，拒绝 `..`、绝对路径逃逸、符号链接逃逸；
- 发布包可单独导出/分享，作为「手动发布」的交付物。

### 4.7 幂等、历史与失败恢复

- **幂等键**：`contentHash + channelId + imageHashes`；同一内容重复点击发布时提示「已发布/是否重试」。
- **素材缓存**：`imageHash → media_id` 缓存在本地（非敏感），避免重复上传；微信素材有数量上限，需提供清理入口。
- **发布历史**：`markcard_publish_history_v1`（localStorage）记录渠道、时间、草稿 `media_id`、`publish_id`、状态、包路径；不记录 AppSecret。
- **失败恢复**：上传到第 N 张失败时，保留已上传 `media_id`，重试只补缺失图片；草稿创建失败则保留素材缓存。
- **取消**：`signal` 传到 Rust（Tauri 命令取消或状态标记），已发出的请求不可回滚，但停止后续步骤。
- **并发锁**：同一时间只允许一个发布任务；UI 禁用按钮并显示进度。

### 4.8 发布 UI

建议用**独立弹窗**（`PublishDialog.vue`），不要塞进右侧设置栏：

```text
Step 1 渠道与内容
  ├─ 渠道卡片（微信贴图 / 小红书图文 / 仅导出发布包）
  ├─ 标题、正文、标签（可编辑，显示字数）
  ├─ 图片选择（全部/区间/排除封面，拖拽排序）
  └─ 封面选择 + 渠道画布提示

Step 2 预览与校验
  ├─ 手机预览（封面 + 图片序列 + 文案）
  ├─ 校验清单（红/黄/绿）
  └─ 发布模式（微信：存草稿 / 直接发布）

Step 3 发布
  ├─ 进度条 + 阶段日志
  ├─ 成功：打开草稿箱/创作平台、复制链接
  └─ 失败：错误码、重试、打开发布包目录
```

入口：`AppToolbar.vue` 增加「发布」主按钮；`SettingsExport.vue` 增加「仅导出发布包」。

---

## 5. 改造清单

### 5.1 前端：修改现有文件

| 文件 | 改动 | 优先级 |
| --- | --- | --- |
| `src/composables/useContentParser.js` | 新增 `image-group` 解析；`estimateBlockHeight` 增加上下文；新增组渲染 HTML；caption/属性解析 | P1 |
| `src/composables/useStudioDocument.js` | 布局默认值与持久化；分页传入宽度上下文；新增「微信公众号」平台预设；页面级图片组元数据 | P1 |
| `src/composables/useCardExport.js` | 拆出渲染器；改为消费 `useCardRenderer` 的 Blob；新增「导出发布包」 | P0/P2 |
| `src/App.vue` | 接线发布弹窗、排版设置、两处 `SettingsPanel` 的新 props/emits | P1/P2 |
| `src/components/SettingsPanel.vue` | 引入 `SettingsLayout`；新增 props/emits | P1 |
| `src/components/settings/SettingsTabs.vue` | tab 从 4 个变 5 个，`grid-cols-4` 改动态 | P1 |
| `src/components/settings/SettingsExport.vue` | 增加「导出发布包」入口 | P2 |
| `src/components/AppToolbar.vue` | 增加「发布」按钮 | P2 |
| `src/components/preview/PreviewArtworkCard.vue` | 图片组点击/重排/焦点交互；保持共享 HTML 渲染 | P1 |
| `src/components/preview/PreviewStrip.vue` | 缩略图使用图片组首图 | P1 |
| `src/components/MarkdownEditor.vue` | 图片粘贴/拖入，调用导入命令并插入 Markdown | P1 |
| `src/components/AppIcon.vue` | 新增 `send`、`image-plus`、`copy`、`shield-check` 等图标映射 | P2 |
| `src/i18n/zh-CN.js` / `en-US.js` | 新增 `layout`、`publishFlow`、`channels`、错误码文案；两边同步 | P1/P2 |
| `src/styles/themes/index.css` | 引入 `image-layout.css` | P1 |
| `src/styles/themes/base-card.css` | 图片组与主题变量的兼容（间距、圆角、caption 字体） | P1 |

### 5.2 前端：新增文件

| 文件 | 职责 | 优先级 |
| --- | --- | --- |
| `src/config/imageLayouts.js` | 版式预设、默认参数、适用图片数 | P1 |
| `src/composables/useImageLayout.js` | 归一化、度量、HTML 片段、组拆分 | P1 |
| `src/composables/useCardRenderer.js` | `renderPageToCanvas` / `renderPagesToBlobs`，从 `useCardExport` 抽出 | P0 |
| `src/composables/usePublishPlan.js` | 标题/正文/标签抽取、图片选择、校验、hash | P2 |
| `src/composables/usePublishBundle.js` | 调 Rust 写包、读 manifest、清理临时目录 | P2 |
| `src/config/publishChannels.js` | 渠道能力与限制 | P2 |
| `src/publish/index.js` | 适配器注册与调度 | P2 |
| `src/publish/contract.js` | 用 JSDoc 定义 `PublishPlan` / `Issue` / `PublishError` / 适配器契约 | P2 |
| `src/publish/channels/wechat.js` | 微信渠道：校验、准备、调用 Rust、进度 | P3 |
| `src/publish/channels/xiaohongshu.js` | 小红书半自动：剪贴板、打开平台、清单 | P2 |
| `src/publish/channels/localBundle.js` | 仅导出发布包 | P2 |
| `src/publish/markdownToCopy.js` | Markdown → 纯文本正文/标题/标签 | P2 |
| `src/components/settings/SettingsLayout.vue` | 排版设置面板 | P1 |
| `src/components/publish/PublishDialog.vue` | 三步发布弹窗 | P2 |
| `src/components/publish/PublishPreview.vue` | 手机预览 | P2 |
| `src/components/publish/PublishChecklist.vue` | 校验清单 | P2 |
| `src/components/publish/PublishProgress.vue` | 进度与错误提示 | P2 |
| `src/styles/themes/image-layout.css` | 图片组 CSS | P1 |

### 5.3 Rust / Tauri

| 文件 | 改动 | 优先级 |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | 注册新命令；管理 token/凭据状态 | P2/P3 |
| `src-tauri/src/files.rs` | 新增 `import_image_asset`；发布包写入可复用路径校验 | P1/P2 |
| `src-tauri/src/publish/mod.rs` | 发布命令入口、进度事件、错误类型 | P2 |
| `src-tauri/src/publish/wechat.rs` | `reqwest` 客户端、token 缓存、素材上传、草稿、发布、状态轮询 | P3 |
| `src-tauri/src/publish/secrets.rs` | OS Keychain 读写（`keyring`） | P3 |
| `src-tauri/src/publish/bundle.rs` | 原子写、manifest 校验、路径安全 | P2 |
| `src-tauri/Cargo.toml` | 新增 `reqwest`（rustls/multipart/json）、`keyring`、`sha2`、`uuid` | P2/P3 |
| `src-tauri/capabilities/default.json` | 如前端直接打开外链，补 `opener:allow-open-url`；网络请求放在 Rust 则无需新增 http 权限 | P2 |

### 5.4 配置、文档、测试

| 文件 | 改动 |
| --- | --- |
| `package.json` | 如使用剪贴板插件则新增依赖；如引入 Vitest 则新增 `test` 脚本 |
| `AGENTS.md` | 更新架构：新增发布层、图片组、发布包约束 |
| `README.md` / `README.zh-CN.md` | 增加发布配置说明（AppID、IP 白名单、账号资质、半自动流程） |
| `tests/imageLayout.test.js`（新增） | 版式度量、组拆分、分页边界 |
| `tests/publishPlan.test.js`（新增） | 标题/正文/标签抽取、渠道限制、hash |

> 仓库当前没有测试脚本。建议只为纯函数（布局度量、文案抽取、校验）引入 Vitest，不追求组件/E2E 测试；否则发布链路的边界条件很难回归。

---

## 6. 状态、持久化与迁移

| 数据 | 存储 | 说明 |
| --- | --- | --- |
| 设置 | `localStorage` `markcard_studio_settings_v2` | 新增 `layoutDefaults`、`publishChannel`、`publishOptions`；保留 v1 读取 |
| 草稿 | `localStorage` `markcard_studio_draft_v1` | 不变 |
| 发布历史 | `localStorage` `markcard_publish_history_v1` | 只存渠道、时间、ID、状态、包路径 |
| AppSecret | OS Keychain（Rust） | 绝不进 `localStorage`、日志、发布包 |
| 素材 `media_id` 缓存 | 应用数据目录 JSON | 非敏感；提供清理 |
| 发布包 | 用户导出目录 | 可删除；manifest 自描述 |

迁移规则：

- 恢复设置时对每个新字段做类型/范围校验，坏值回退默认；
- 保存设置时只写已知字段，避免把未来字段覆盖掉；
- 发布历史做 `schemaVersion`，未来可迁移；
- 页面级布局覆盖不要用「页码」做 key（分页一变就错位），优先写进 Markdown 指令；如果必须做页面级覆盖，用 `sectionId` 或内容 hash。

---

## 7. 安全、隐私与合规

1. **AppSecret 只进 Keychain**：Rust 读取，前端只有「已配置/未配置」状态；日志脱敏；错误信息不回显 secret。
2. **不保存平台密码**：小红书只做半自动；自动化桥用持久化浏览器 Profile，由用户自己登录。
3. **本地优先**：默认不经过任何中转服务器；中继模式必须显式开启并说明数据流向。
4. **平台条款**：微信 API 按其文档使用；小红书自动化存在风控与条款风险，默认不启用，并在 UI 明确提示。
5. **频率限制**：素材上传、草稿创建、发布都要有节流与重试上限；微信 `45009` 要显示配额。
6. **路径安全**：发布包写入与读取都在 Rust 侧校验，禁止 `..` 和符号链接逃逸。
7. **内容合规**：发布前只做技术校验（长度/数量/格式），不做内容审查承诺；提示用户自行确认平台规范。
8. **数据最小化**：发布历史不存正文全文，只存 hash 和标题摘要。

---

## 8. 分阶段计划

| 阶段 | 范围 | 交付物 | 预估 | 退出标准 |
| --- | --- | --- | --- | --- |
| P0 | 拆渲染器 | `useCardRenderer.js`；`useCardExport` 行为不变 | 2–3 天 | 现有 PNG/JPG/PDF/长图导出回归通过 |
| P1 | 图片排版 | 版式配置、解析、度量、CSS、排版设置、图片导入 | 5–7 天 | 7 种版式在 4 种画幅下预览/导出一致，无溢出 |
| P2 | 发布包 + 小红书半自动 | `usePublishPlan`、`usePublishBundle`、发布弹窗、复制/打开/清单 | 4–6 天 | 一键生成 bundle；小红书手动发布 ≤ 60 秒 |
| P3 | 微信 API | Keychain、token、素材、草稿、发布、错误映射 | 5–8 天 | 测试号成功建草稿（N 图）；错误码可读；无 secret 泄漏 |
| P4 | 小红书自动化（可选） | 本地桥、选择器、登录态 | 8–12 天 | 单账号稳定发布；失败可回退半自动 |

一个人开发，P0–P3 大约 3 周；P4 是否要做取决于对「全自动」的硬需求。

---

## 9. 验收标准

### 9.1 图片排版

- [ ] 7 种版式 × 小红书 3:4 / 抖音 9:16 / 方形 1:1 / 自定义尺寸，预览与导出像素级一致；
- [ ] 2/3/4/6/9/18 张图的组都能正确分页，组不被拆散；
- [ ] 组高于单页时按行拆分或降级，不出现内容裁切；
- [ ] `cover` / `contain`、焦点裁切、caption 三种模式均正确；
- [ ] 图片加载失败时有占位，不阻塞整页导出；
- [ ] 导出 1080×1440 PNG 的实际尺寸准确（沿用现有 pixelRatio 逻辑）。

### 9.2 发布

- [ ] 微信测试号：20 张图以内成功创建 `newspic` 草稿；`mode=publish` 能拿到 `publish_id`；
- [ ] 40164/40001/45009/48001 都有可操作的中文提示；
- [ ] 小红书：bundle 生成、文案复制、平台打开、文件夹显示全链路可用；
- [ ] 发布包可脱离应用手动使用（manifest 完整、图片可打开）；
- [ ] 重复发布有幂等提示；失败重试不重复上传已成功图片。

### 9.3 安全与跨平台

- [ ] `localStorage`、日志、bundle、崩溃报告中都不出现 AppSecret；
- [ ] macOS / Windows 路径、文件名、中文标题均正常；
- [ ] 发布包写入失败不会留下半成品目录；
- [ ] 浏览器模式（`pnpm dev`）下所有按钮有降级提示，不白屏。

---

## 10. 风险与备选方案

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 公众号账号无 API 权限 / 个人订阅号 | 微信直连不可用 | 默认提供「仅导出发布包 + 手动上传」；UI 检测 48001 后自动降级 |
| 出口 IP 变化导致 40164 | 直连频繁失败 | 错误页给出白名单指引；提供可选自建中继 |
| Linux Keychain 不可用（无 Secret Service） | AppSecret 无法安全保存 | 检测失败时提示用户改用直连中继，或仅本次会话内存保存并明确告知 |
| 微信 API 变更 | 发布失败 | 适配器隔离；错误码兜底；保留 bundle 手动路径 |
| 小红书自动化触发风控 | 账号风险 | 默认不做；独立可选组件；明确风险提示 |
| 版式高度估算与真实渲染偏差 | 内容溢出 | 固定 `aspect-ratio`；caption 固定行高；预览/导出共用渲染器；加溢出检测 |
| html-to-image 对 grid/aspect-ratio 支持差异 | 导出白块/错位 | 在 Tauri WKWebView/WebView2 实测；必要时用绝对定位兜底 |
| 18 张图内存峰值 | 卡顿/崩溃 | 发布走 bundle 文件，Rust 读文件；渲染逐页释放 canvas；限制并发 |
| 两处 SettingsPanel 漏改 | 抽屉里功能缺失 | 把 props/emits 抽成共享常量或组件；验收覆盖窄屏 |
| 页码作为布局 key | 编辑后错位 | 版式写进 Markdown；页面覆盖用 section id/hash |
| i18n 两侧不同步 | 英文界面缺 key | 新增 key 时同 PR 改两个 locale；加校验脚本（可选） |

备选方案：

- **不做微信 API，只做发布包**：最快、最稳，适合个人号；后续再加 API。
- **不做小红书自动化，只做半自动**：推荐默认。
- **把发布做成独立 CLI/插件**：如果主应用要保持轻量，可让 CLI 消费 bundle；但桌面端体验会割裂，不建议 MVP。

---

## 11. 需要确认的决策

1. **「微信贴图」具体指哪个入口？** 公众号图片消息（本方案假设）、朋友圈、还是视频号图文？三者图片规格与自动化方式不同。
2. **微信发布要「存草稿」还是「直接发布」？** 建议默认存草稿，用户在公众号后台确认后再发。
3. **小红书是否接受半自动？** 如果必须全自动，需要接受浏览器自动化的维护成本与账号风险。
4. **账号资质**：公众号是否已认证、是否有 API 权限？小红书是个人号还是品牌/机构（是否有开放平台资质）？
5. **是否需要多账号/定时发布？** 这会显著影响凭据存储、任务队列和 UI 复杂度。

---

## 参考资料

- 微信公众号 `draft/add`（图片消息 `newspic`、最多 20 图、永久 `media_id`、封面裁切）：<https://developers.weixin.qq.com/doc/subscription/en/api/draftbox/draftmanage/api_draft_add.html>
- 微信公众号草稿箱能力说明：<https://developers.weixin.qq.com/doc/service/guide/product/draft.html>
- 微信公众号发布接口 `freepublish/submit`：<https://developers.weixin.qq.com/doc/subscription/en/api/public/api_freepublish_submit.html>
- 小红书开放平台 API 资质与 OAuth 实践（第三方文章，2026-09）：<https://cloud.tencent.cn/developer/article/2735161>
- 小红书图文限制与发布流程（社区经验，需以平台为准）：<https://raw.githubusercontent.com/majiayu000/claude-arsenal/main/skills/xiaohongshu/SKILL.md>
- 小红书浏览器自动化参考实现（仅作技术评估，不建议直接集成）：<https://github.com/mcp-service/xiaohongshu-mcp>
