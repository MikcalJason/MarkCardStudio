# 场景图资源指南（去水印 + 重新生图 + 导入）

场景图是 `public/mockups/<template-id>.jpg`，模板定义在 `src/config/sceneMockups.js` 的
`SCENE_MOCKUP_TEMPLATES`。每张图需要一块**纯白、无内容**的屏幕/纸张/画布区域，卡片会被合成进去。

## 1. 通用生图规则（所有场景通用）

- 写实生活方式摄影 / photorealistic lifestyle photography，不要插画、3D 渲染感。
- **竖构图 3:4**（portrait, 3:4 aspect ratio），分辨率 ≥ 1536×1972。
- 画面中部放一块**完全空白**的屏幕 / 纸张 / 海报 / 画布，占画面约 40–60%，**四角清晰、不被遮挡**。
- 屏幕/纸张必须**纯白或极浅灰**，不能有任何内容、图标、文字、反光文字。
- 画面中**不要任何文字、logo、水印、二维码、人物**（右下角尤其不能有水印）。
- 光线自然（窗光/台灯/日光），有景深，背景轻微虚化。
- 屏幕朝向按 `fit` 区分：
  - `fill`：屏幕本身接近 3:4 竖屏（平板/手机竖放）。
  - `contain`：屏幕比例与 3:4 不同（横屏显示器、笔记本、纸张、海报）。
- 生图工具会在右下角烧一个 `AI生成` 水印（prompt 里写 no watermark 也去不掉）。导入前必须裁掉：
  先裁掉底部 5%（水印就在这一条里），再按 `1536:1972` 居中裁掉左右两侧，最后重采样到
  `1536×1972`。裁完检查右下角确实没有残留，水印留在图上会直接出现在导出结果里。
- 生成出来的平板屏幕常常是 16:10（约 0.62–0.67）而不是卡片的 3:4。这时用 `contain`：
  `fill` 会把字横向压扁，`cover` 会裁掉卡片两侧；`contain` 用卡片自己的首尾行续出上下留白，
  白卡配白屏几乎看不出来。只有屏幕确实接近 3:4 时才用 `fill`。

### 通用 Prompt 模板

```
<scene description>, a completely blank white <screen|sheet of paper|poster|canvas>
positioned <centered|on the desk|taped on the wall>, <orientation and camera angle>,
<surrounding props and environment>, <lighting>, photorealistic lifestyle photography,
shallow depth of field, 3:4 portrait aspect ratio,
no text, no logo, no watermark, no people, no UI, empty blank surface
```

## 2. 已内置的 10 个场景（已去水印，可直接替换）

### studio-wall（print / paper / cover）
```
A framed blank white canvas on a warm beige plaster wall in a minimalist studio, thin
light-oak frame, front view with a slight angle, soft directional daylight from the left
casting a gentle shadow behind the frame, the canvas is completely blank and empty,
photorealistic interior photography, 3:4 portrait, no text, no logo, no watermark, no people
```

### tablet-stand（study / screen / contain）
```
A white tablet standing on an aluminum stand on a light oak desk in a bright home study,
the tablet screen is completely blank and white, a potted plant and a cappuccino cup beside
it, a bookshelf softly blurred in the background, soft morning window light, photorealistic
lifestyle photo, 3:4 portrait, no text, no logo, no watermark, no people, no UI
```

### bedroom（home / screen / fill）
```
A tablet with a completely blank white portrait screen standing on a wooden bedside table in
a cozy bedroom, warm morning light through sheer curtains, soft bedding and neutral tones in
the background, photorealistic lifestyle photography, 3:4 portrait, no text, no logo,
no watermark, no people
```

### cafe（lifestyle / screen / fill）
```
A tablet with a completely blank white screen standing on a wooden cafe table, a cup of
coffee and a window with green plants in the background, bright natural daylight, shallow
depth of field, photorealistic lifestyle photography, 3:4 portrait, no text, no logo,
no watermark, no people
```

### poster-wall（print / paper / contain）
```
A single blank white sheet of paper taped on a smooth grey plaster wall, slightly undulating
surface, soft side lighting revealing the paper texture, minimalist interior, photorealistic,
3:4 portrait, no text, no logo, no watermark, no people
```

### desk（study / screen / contain）
```
A slim silver-grey tablet propped upright in portrait orientation on a thin foldable case on a
light oak study desk, an open notebook and a pen lying flat beside it, a ceramic mug, a small
potted plant, a wooden bookshelf softly blurred in the background, warm desk lamp light mixed
with afternoon window light, the tablet screen is completely blank and pure white, all four
screen corners visible and unobstructed, photorealistic lifestyle photography, shallow depth of
field, 3:4 portrait, no people, no hands, no text, no logo, no watermark, no UI
```

### library（study / screen / contain）
```
A slim silver-grey tablet propped upright in portrait orientation on a warm wooden library
table, a small stack of hardcover books to one side, tall bookshelves full of books softly
blurred behind, a brass reading lamp, soft warm lamp light plus daylight from a high window,
the tablet screen is completely blank and pure white, all four screen corners visible and
unobstructed, photorealistic lifestyle photography, shallow depth of field, 3:4 portrait,
no people, no hands, no text, no logo, no watermark, no UI
```

### classroom（study / screen / contain）
```
A slim silver-grey tablet propped upright in portrait orientation on a light wooden student
desk in a classroom, a closed notebook and a pencil case resting beside it, rows of empty
desks and a green chalkboard softly blurred in the background, bright soft daylight through
tall windows, the tablet screen is completely blank and pure white, all four screen corners
visible and unobstructed, photorealistic lifestyle photography, shallow depth of field,
3:4 portrait, no people, no hands, no text, no logo, no watermark, no UI
```

### rail（travel / screen / contain）
```
A slim silver-grey tablet propped upright in portrait orientation against the seat back on the
small fold-down tray table of a high-speed train, a paper cup resting on the tray beside it, a
large window showing softly blurred passing green countryside, grey fabric seat, bright cool
daylight through the window, the tablet screen is completely blank and pure white, all four
screen corners visible and unobstructed, photorealistic travel lifestyle photography, shallow
depth of field, 3:4 portrait, no people, no hands, no text, no logo, no watermark, no brand
marks, no UI
```

### notebook（print / paper / cover）
```
One single blank white A4 sheet of paper lying flat on a warm oak study desk, shot from
slightly above, a black pen resting diagonally beside the sheet, a beige coffee cup and a
closed book softly blurred at the top edge, soft warm window light from the left, the sheet is
completely blank with crisp straight edges and all four corners fully visible, plain white with
no ruled lines and no grid, photorealistic lifestyle photography, shallow depth of field,
3:4 portrait, no people, no hands, no text, no logo, no watermark
```

## 3. 其余场景 Prompt（一行版，套用通用模板）

> 括号内是模板的 `category / surface / fit`。`fill` 用竖屏 3:4；`contain` 用横屏或纸张。

- **breakfast**（home/screen/fill）：`A tablet with a blank white portrait screen on a breakfast table, croissant, coffee, morning sunlight, blurred kitchen`
- **livingroom**（home/screen/fill）：`A tablet with a blank white portrait screen on a living room coffee table, sofa and plant softly blurred`
- **kitchen**（home/screen/fill）：`A tablet with a blank white portrait screen on a kitchen counter, warm lamp light, blurred utensils`
- **balcony**（home/screen/contain）：`A tablet with a blank white landscape screen on a small balcony table, railing, plants, daylight`
- **study**（study/screen/fill）：`A tablet with a blank white portrait screen on a study table, notebooks, pens, warm light`
- **office**（study/screen/contain）：`A tablet with a blank white landscape screen on an office desk, documents, plant, window light`
- **meeting**（study/screen/fill）：`A tablet with a blank white portrait screen on a meeting room table, whiteboard blurred`
- **dorm-desk**（study/laptop/contain）：`An open laptop with a completely blank white screen on a dorm desk, books, warm lamp`
- **teacher-desk**（study/screen/fill）：`A tablet with a blank white portrait screen on a teacher's podium, classroom blurred`
- **laptop**（study/laptop/contain）：`An open laptop with a completely blank white screen on a wooden desk, coffee cup, plant`
- **beach**（travel/screen/fill）：`A tablet with a blank white portrait screen on a beach blanket, sea and sky behind`
- **hotel**（travel/screen/contain）：`A tablet with a blank white landscape screen on a hotel bedside table, warm lamp`
- **airplane**（travel/screen/fill）：`A tablet with a blank white portrait screen on an airplane tray table, oval window`
- **bookstore**（lifestyle/screen/fill）：`A tablet with a blank white portrait screen on a bookstore table, shelves of books`
- **outdoor**（lifestyle/screen/contain）：`A tablet with a blank white landscape screen on a picnic table outdoors, soft daylight`
- **camping**（lifestyle/screen/fill）：`A tablet with a blank white portrait screen on a folding camp table, tent and forest`
- **garden**（lifestyle/screen/contain）：`A tablet with a blank white landscape screen on a garden table, flowers softly blurred`
- **print-desk**（print/paper/cover）：`A blank white sheet of paper on a wooden desk, pen and coffee cup, soft window light`
- **corkboard**（print/paper/contain）：`A blank white paper pinned on a corkboard, natural light, minimal pins`
- **magazine**（print/paper/contain）：`An open blank white magazine page on a table, soft light, shallow depth of field`
- **gallery**（print/paper/cover）：`A blank white framed canvas on a gallery wall, soft spot lighting, minimal`

## 4. 导入方法

1. **尺寸**：建议 ≥1536×1972（3:4 竖图）。程序按图片 `naturalWidth/Height` 计算，比例一致即可。
2. **命名**：文件名必须是模板 `id` + `.jpg`，放进 `public/mockups/`，例如
   `public/mockups/bedroom.jpg`。模板里的 `image: "/mockups/bedroom.jpg"` 即指向它。
3. **替换现有场景**：直接用同名文件覆盖即可，无需改代码。
4. **新增场景**：在 `src/config/sceneMockups.js` 的 `SCENE_MOCKUP_TEMPLATES` 增加一项：
   ```js
   {
     id: "my-scene",
     category: "home",
     surface: "screen",
     fit: "fill",
     labelKey: "sceneMockup.templates.myScene", // 需在 i18n 里补文案
     image: "/mockups/my-scene.jpg",
     quad: { tl: [0.2, 0.2], tr: [0.8, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] },
     cornerRadius: 0.01,
     lighting: null,
   }
   ```
5. **重新标定（必须做）**：新图的屏幕位置变了，`quad` 需要重新对齐。打开「校准四角」：
   - 先点「恢复默认角点」，再点「自动对齐」；
   - 自动对齐失败或不准时，手动微调四个角点；
   - `fill` 场景让四角贴住屏幕边缘；`contain` 场景贴住纸张/画布边缘。
   - 角点要贴屏幕的**直线边**，不要停在圆角弧上：沿弧线取点会让每条边都缩进一圈，
     合成后屏幕边缘露出一道白边。圆角交给 `cornerRadius`（约等于屏幕圆角半径 ÷ 屏幕宽度，
     竖屏平板一般 0.035–0.05），不要靠缩进角点去躲圆角。
6. **验证**：在场景选择器里看实时预览，卡片应完全落在屏幕/纸张内，边缘无白边或溢出。
   再放大看屏幕左上角：卡片圆角应和屏幕圆角重合，两者之间不能有白色月牙。

## 5. 注意事项

- 工作区现在有 10 张场景图（studio-wall、tablet-stand、desk、library、classroom、bedroom、
  cafe、rail、poster-wall、notebook），其余 20 个 Prompt 还只是文档，需要按本文档重新生成。
- 图片里的空白区域越干净、四角越清晰，自动对齐越准。
- 屏幕/纸张的边缘对比度越高（白屏 vs 深色边框），自动检测越可靠。
- 不要给场景图加装饰文字或边框文字，否则合成后会出现在卡片旁边。
