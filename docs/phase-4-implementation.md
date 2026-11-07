# Phase 4A 实施记录：发布变体、发布检查、发布包与小红书半自动

> 状态：已实施（2026-10-21）
> 范围：发布变体模型、渠道配置、文案抽取、发布检查、发布包落盘（桌面端 + 支持目录选择的浏览器）、小红书半自动、发布记录、发布中心与快速发布弹窗。
> 不包含：微信公众号 API 直连（Keychain、token、永久素材上传、`draft/add`、错误码映射）——拆为 Phase 4B。运营（Phase 5）与 Jaaz 生图（Phase 6）未动。

---

## 1. 已完成

| 能力 | 实现 |
| --- | --- |
| 渠道配置 | `src/config/publishChannels.js`：公众号图片消息 / 小红书图文 / 本地发布包，各自画布、图片数、标题与正文长度、标签数、图片格式与最短边。按产品决定，两个内容平台统一 **标题 ≤ 20 字、正文 ≤ 1000 字**（公众号接口本身允许更长，放宽只需改这一处配置） |
| 标签输入 | 输入框提示「以 # 开头、空格分隔」；已添加标签渲染成 `#标签` 胶囊并可单个移除；推荐标签来自 `TAG_SUGGESTIONS` 与文档中已抽取的 `#话题`，点击即加入，达到渠道上限后自动禁用。存储去 `#` 前缀，复制文案与 `tags.txt` 时统一补回 `#` |
| 发布变体 | 每个渠道一份 `work.variants` 覆盖项：标题、正文、标签、封面页、图片子集、发布模式；空值表示跟随作品，不复制一份内容 |
| 文案抽取 | `src/publish/markdownToCopy.js`：H1→H2→H3→首个正文行取标题；Markdown 转纯文本（去代码围栏、容器标记、图片、HTML、加粗、链接地址，保留段落与列表）；`#话题` 与小红书 `#话题[话题]#` 抽取为标签，代码块内的 `#` 不误判 |
| 发布检查 | `src/publish/preflight.js`：blocker / warning / info 三级，15 项技术校验（标题空或超长、正文超长或缺失、图片数量、缺图、封面未指定、标签超限或渠道不支持、画布与渠道不符、画布过小、内容溢出、JPG 透明背景、文档未保存） |
| 一键修复 | 画布不符时「去处理」直接把文档切到渠道画布（有预设选预设，否则自定义尺寸）；溢出问题跳回创作模式 |
| 发布包 | `manifest.json` + `images/01.jpg…` + `title.txt` / `body.txt` / `tags.txt`，目录名 `<文档名>-publish-<渠道>`；统一写入应用数据目录 `markcard/publish`（`get_publish_bundle_root` 解析），不再让用户选目录；先写临时目录再原子 rename |
| 渲染一致性 | 发布包不再拼第二套 DOM：`useCardExport.js` 导出 `renderPageToImage(page, options)`，与预览 / 分页 / 导出共用 `CardArtwork.vue` + 同一套图片、Mermaid、KaTeX、ECharts、贴纸准备步骤 |
| 原生写入 | `src-tauri/src/publish/bundle.rs`：`begin_publish_bundle` → `append_publish_bundle_file` → `finish_publish_bundle` / `cancel_publish_bundle` 三步 IPC，逐张落盘避免一次传 13 张图的内存峰值；会话路径注册表拒绝向前端任意路径写文件 |
| 路径安全 | 相对路径只允许 `images/<文件>` 或根级文件，拒绝 `..`、绝对路径、反斜杠、盘符、第三层目录与扩展名白名单外的文件；写入前 `canonicalize` 校验未逃逸出包目录；扩展名白名单 jpg/jpeg/png/json/txt/html/md；单文件上限 64 MB |
| 浏览器降级 | 桌面端固定写入应用自己的发布包目录，不弹目录选择；无 Tauri 时使用 File System Access API（`showDirectoryPicker`）写真实目录；两者都不可用时按钮禁用并说明原因，点击被浏览器拦截时给本地化提示而不是抛原始 DOMException |
| 小红书半自动 | 生成发布包后：复制标题 / 复制正文+标签 / 复制全部文案、打开 `creator.xiaohongshu.com` 创作平台、打开发布包目录、标记已发布。不做浏览器自动化、不做 OCR |
| 公众号 | 凭据在「设置 → 渠道接入」（Keychain），出口 IP 可在同一处一键查询（白名单仍须在微信后台手动添加）；`probe_channel_permissions` 只读探测接口权限；探测到草稿箱可用时，`publish_wechat_draft_from_bundle` 以刚生成的发布包为上传源：逐张 `media/uploadimg`、封面 `material/add_material`、再 `draft/add` 建草稿。`apiReady` 仍为 false，因为能否推送取决于账号权限探测结果 |
| 发布记录 | `markcard_publish_history_v1`：渠道、模式、状态、标题、图片数、包路径、内容 hash、时间。只存标题与 hash，不存正文全文 |
| 幂等提示 | `contentHash = sha256(渠道 + 画布 + 标题 + 正文 + 标签 + 页序)`，校验步骤里提示「同一内容已在 … 生成过发布包」 |
| 发布中心 | 一级页改为真实内容：作品与渠道摘要、变体列表与覆盖项计数、摘要指标、检查清单、发布记录（打开目录 / 删除记录） |
| 快速发布 | `PublishDialog.vue` 三步：渠道与内容（含图片勾选与封面指定）、预览与校验、生成与发布；窄屏抽屉里的 Inspector 共用同一份状态 |
| Inspector 发布段 | 由占位说明改为真实就绪度、当前渠道与页数画布摘要、Top 问题列表、快速发布入口 |

## 2. 数据模型

```js
work.variants = [{
  schemaVersion: 1,
  id: "variant_…",
  workId: "work_…",
  channelId: "xhs-note",
  status: "draft" | "ready" | "published",
  overrides: {
    title: "",            // 空 = 跟随作品
    body: "",             // 空 = 跟随 Markdown 抽取
    tags: [],             // 空 = 从 Markdown 的 #话题 抽取
    digest: "",
    coverIndex: null,     // 页号；不在选中集合内时忽略
    pageIndexes: null,    // null = 全部页
    mode: "draft" | "publish",
  },
  publishRecordId: null,
  updatedAt: "…",
}]
```

```json
{
  "schemaVersion": 1,
  "generator": "markcard-studio",
  "id": "20261021-223512-a1b2c3",
  "createdAt": "2026-10-21T22:35:12+08:00",
  "source": { "path": "/notes/post.md", "contentHash": "sha256:…" },
  "channel": { "id": "xhs-note", "mode": "assist", "canvas": { "width": 1080, "height": 1440 } },
  "content": { "title": "…", "body": "…", "tags": ["山里"], "digest": "" },
  "images": [{ "file": "images/01.jpg", "role": "cover", "pageIndex": 4, "width": 1080, "height": 1440, "bytes": 812345, "sha256": "…" }],
  "render": { "theme": "暖阳日记", "scale": 2, "format": "JPG" },
  "publish": { "mode": "draft", "openComment": true },
  "checks": { "ready": false, "counts": { "blocker": 0, "warning": 1, "info": 0 }, "issues": [{ "code": "page-overflow", "severity": "warning", "section": "images" }] }
}
```

- `manifest.json` 是发布包的唯一事实来源，渠道侧只读它，不再回读 Markdown。
- `generator` 用于安全判定：只有上一版由本应用生成的同名目录会被替换，用户自己的目录改为追加 `-1`、`-2` 后缀。
- 三个 localStorage key：`markcard_works_v1`（变体随作品）、`markcard_publish_ui_v1`（记住上次渠道）、`markcard_publish_history_v1`（发布记录）。读取时逐条校验并回退默认值。

## 3. 关键文件

**新增**

- `src/config/publishChannels.js`：渠道能力、限制、画布、外链
- `src/publish/markdownToCopy.js`：标题 / 纯文本正文 / 话题标签抽取
- `src/publish/preflight.js`：发布检查与就绪度
- `src/publish/contentHash.js`：文本与 Blob 的 SHA-256、计划内容指纹
- `src/composables/usePublishPlan.js`：文档 + 作品 + 渠道 → PublishPlan、检查、变体读写
- `src/composables/usePublishBundle.js`：逐页渲染 → 发布包写入、进度与取消
- `src/composables/usePublishHistory.js` + `src/storage/publishHistory.js`：发布记录
- `src/components/publish/PublishDialog.vue`、`src/components/publish/PublishChecklist.vue`
- `src-tauri/src/publish/mod.rs`、`src-tauri/src/publish/bundle.rs`
- `docs/phase-4-implementation.md`

**修改**

- `src/composables/useCardExport.js`：导出 `renderPageToImage` / `blobToBase64` / `createOutputFolderName`，渲染仍只有一条路径
- `src/composables/useWork.js`：变体归一化与 `upsertVariant` / `markVariantStatus` / `removeVariant`，替换未被使用的 `createVariant`
- `src/components/workspaces/PublishWorkspace.vue`：占位卡 → 发布中心
- `src/components/InspectorPanel.vue`：发布段真实摘要与快速发布；移除过期的 Phase 角标
- `src/App.vue`：装配三个发布 composable、弹窗接线、渠道画布切换
- `src/components/AppIcon.vue`：`message-square`、`folder-down`、`send`、`list-checks`、`clipboard-check`、`clock`
- `src/i18n/zh-CN.js`、`src/i18n/en-US.js`：新增 `publishFlow` 命名空间（751 条 key，两侧完全对齐）
- `src-tauri/src/lib.rs`：注册 4 个发布包命令
- `src-tauri/src/files.rs`：`expand_tilde` / `display_path` 改为 `pub(crate)` 复用

## 4. 与设计文档的偏差

1. **没有 `src/publish/channels/*` 适配器注册表**。当前三个渠道只有两种真实行为（写发布包、剪贴板 + 打开外链），微信 API 未接入，因此先在 `usePublishBundle` + 弹窗里实现，避免为尚不存在的第三个 API 客户端预建抽象。`publishChannels.js` 仍按设计把能力与限制配置化，Phase 4B 接微信时再引入 `wechat.js` 适配器与 `PublishError`。
2. **检查项中的图片体积 / 最短边**只在画布层面校验（`canvasTooSmall`）。逐图 `bytes` 已在 manifest 里，接微信时用它做 10 MB 上限判断，不需要重渲染。
3. **`preview.html`**（设计文档标为可选）未生成。

## 5. 验证

```bash
pnpm build                                              # 通过（仅既有 chunk size 警告）
cargo test --manifest-path src-tauri/Cargo.toml         # 10 passed（含 4 个新发布包用例）
```

新增 Rust 单测：`accepts_bundle_relative_paths`、`rejects_traversal_and_unsafe_bundle_paths`、`sanitizes_bundle_names_without_path_separators`、`finishes_bundle_atomically_and_replaces_only_own_output`。

纯函数校验（Node 直接 import 运行）：标题层级回退、代码围栏与容器标记剥离、`#山里[话题]#` 抽取、代码块内 `#` 不误判、标签去重与截断、小红书 3 blocker + 4 warning + 1 info、超限标签命中 `tags-too-many`、空文档 `title-missing` + `images-missing`。

浏览器（`pnpm dev`，13 页默认文档）手动验证：

- 发布中心显示 13 页 / 目标渠道 / 就绪度；切渠道后限制与检查结果随之变化；
- 检查清单命中「正文 1387 字超出 1000 字上限」阻塞与「1 页内容溢出」建议，并给出「去处理」；
- 公众号渠道读取到 标题 ≤20 / 正文 ≤1000 / 标签 ≤10，第 2 步出现「存草稿 / 直接发布」模式切换；
- 标签输入：空输入显示 `#` 格式提示，点击「#Markdown」推荐后写入变体 `tags: ["Markdown"]`，胶囊显示为 `#Markdown` 且可移除，文档无话题时推荐回落到静态清单；
- 快速发布弹窗三步可用：改标题与标签后变体写入 `markcard_works_v1`（`已覆盖 3 项内容`），发布图片勾选 `[0,1,2,4,5]` + 封面 `4` 后计划顺序为 `4(cover),0,1,2,5`，封面号不在集合内时回退首张，清空覆盖后回到 13 页；
- Inspector「发布」段在窄屏抽屉里渲染真实摘要与快速发布按钮；
- 通过 `renderPageToImage` 实际渲染一页得到 1080×1440 PNG（576 KB），确认发布路径与导出同源；
- 浏览器无用户手势时目录选择被拦截，界面显示本地化提示并保持可重试；
- 控制台无报错、无缺失 i18n key 警告。

## 6. 已知限制

1. 公众号草稿推送已落地但尚未在 `pnpm tauri dev` 里实跑验证（素材上传、`draft/add`、错误码映射）；直发（`freepublish/*`）按权限探测通常不可用，且 App 不代点群发。
2. 发布包写入的真实目录、文件名与 rename 行为未在 `pnpm tauri dev` 里跑通，需要原生验证（含中文文档名与 Windows 路径）。
3. 逐图体积 / 最短边校验依赖 manifest 的 `bytes`，接渠道 API 时再用于阻塞判断。
4. 封面裁切仍沿用图集画布；`cover_info.crop_percent_list` 之类的渠道专用裁切未实现。
5. 发布队列、定时发布、失败重试的素材缓存（`imageHash → media_id`）未做；同一时刻只允许一个生成任务，但没有跨作品队列。
6. `pageIndexes` 以页号为覆盖项存储，重新分页后原选中集合会随页数变化而重新解释（与图集/封面同一套 synthetic page 语义）；若 Phase 4B 需要更稳的键，应改用 section id 或内容 hash。
7. 发布历史只在本机 localStorage，不随 `.mcard` 打包迁移。

## 7. 下一阶段

1. **Phase 4B**：`src-tauri/src/publish/wechat.rs` + `secrets.rs`（Keychain）、token 缓存、永久素材上传（用 manifest 的 `bytes` 做 10 MB 校验）、`draft/add`、`freepublish/submit` 与 40001 / 40164 / 45009 / 48001 / 40007 错误映射；`xhs-note` 成功后写 `published` 记录。
2. `.mcard` 打包：把作品、封面设计、图集顺序与引用素材随项目迁移。
3. Phase 5：运营概览 / 日历 / 手动与 CSV 数据 / 复盘。
