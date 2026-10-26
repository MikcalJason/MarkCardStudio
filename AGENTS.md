# Repository Guide for Coding Agents

## Product Scope

MarkCard Studio is a local-first Markdown-to-social-card authoring application. Its core path is:

```text
Markdown source -> parse and paginate -> themed card preview -> PNG/JPG/PDF/long-PNG export
```

Keep changes aligned with this workflow. The app currently uses a 4-workspace shell (create / publish / assets / ops) plus an asset picker overlay on top of the shared asset browser; it does not use Vue Router, Pinia, or TypeScript. Unshipped surfaces (poster creation mode and the generate Inspector segment) are hidden behind `src/config/uiFlags.js` rather than deleted, so their components stay in the tree but never appear as dead entry points.

## Stack and Commands

- Package manager: `pnpm` (keep `pnpm-lock.yaml` authoritative).
- Frontend: Vue 3 `<script setup>`, JavaScript, Vite 6, Tailwind CSS 4, DaisyUI.
- Desktop: Tauri 2, Rust 2021, and reqwest for bounded remote image retrieval.
- Editor/rendering: CodeMirror 6, markdown-it, Highlight.js, KaTeX, Mermaid.
- Export: html-to-image and jsPDF.
- Internationalization: vue-i18n with Simplified Chinese and English resources.

```bash
pnpm install
pnpm dev
pnpm build
pnpm tauri dev
pnpm tauri build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

There is currently no JavaScript test, lint, or format script. The native asset store has Rust unit tests. Do not claim other checks ran unless a script is added and executed.

## Architecture

- `src/App.vue`: composes the 4-workspace shell and wires document, work, asset, and gallery state to UI events.
- `src/composables/useStudioDocument.js`: primary document state owner. Handles document lifecycle, undo/redo, settings/draft persistence, platform presets, parsing, measured-pagination orchestration, local image resolution, page metadata, and synthetic gallery pages.
- `src/composables/useWork.js`: Work/Variant/gallery metadata persisted to `markcard_works_v1`; transient image `src` values are hydrated from the asset library and never persisted.
- `src/composables/useAssetLibrary.js`: content-addressed asset index, import/dedupe, search, filters, usage references, trash, project mirrors, mounted scan folders, and browser/native storage adapters.
- `src/composables/useContentParser.js`: converts Markdown source into render blocks, renders block HTML, and hydrates Mermaid output.
- `src/composables/useMeasuredPagination.js`: mounts the shared card renderer offscreen, measures real DOM overflow, splits supported blocks, caches measurements, and marks unsplittable oversized blocks.
- `src/composables/useCardExport.js`: mounts the shared card renderer offscreen, prepares images/Mermaid/KaTeX for capture, composites Markdown images onto the result canvas, and writes PNG/JPG/PDF/long-PNG output. Native writes go through Tauri commands; browser mode downloads blobs. `renderPageToImage()` is the exported single-page renderer reused by publish bundles.
- `src/composables/usePublishPlan.js`: builds one channel `PublishPlan` per publish target from document pages, work variants, and `src/config/publishChannels.js` limits; runs `src/publish/preflight.js`; owns channel variant overrides.
- `src/config/sceneMockups.js`: bundled scene photos, per-scene screen quads normalized to the photo, screen lighting, and the scene categories used by the pickers.
- `src/utils/sceneMockup.js`: projective (per-pixel inverse homography) card-to-screen warp that area-averages each destination pixel's exact texel box, cover-crop coordinate mapping, `fill`/`contain`/`cover` surface preparation (`fill` paints the 3:4 card across a portrait pad's panel; `contain` continues the card's outermost row and column into the margin, so a light card never leaves the photo's blank plate showing as an empty band), alpha-masked lighting compositing, and `releaseSceneImage` for freeing decoded scene photos between batch composites.
- `src/storage/sceneMockupTemplates.js`: corner calibration persisted to `markcard_scene_mockups_v1` as a scene default plus per-image corrections (`{ version, scenes, images }`), versioned against the template quads so a shipped recalibration invalidates stale offsets.
- `src/components/mockup/SceneCalibrationDialog.vue`: the one calibration surface, used by the picker for the scene default and by the gallery for a single image's own corners.
- `src/components/mockup/SceneMockupDialog.vue`: scene selection, draggable corner calibration, and batch scene export.
- `src/components/mockup/ScenePickerDialog.vue`: searchable, categorized scene picker that sets the gallery `scene` look; shows live composited previews of the user's own card in each scene tile, and includes an inline four-corner calibration overlay for the selected scene.
- `src/composables/useGalleryScene.js`: runtime scene backdrops and thumbnails for every gallery image, with a blob-URL cache and abortable progressive generation; also drives the picker's live previews via `ensurePreviews()` (one shared decoded card, scene photo released after each composite) and invalidates previews on calibration.
- `src/composables/usePublishBundle.js`: renders plan pages through `renderPageToImage()` and writes the publish bundle via the native three-step commands, with a File System Access API fallback in browser mode.
- `src/publish/`: Markdown-to-copy extraction, preflight severities, and content hashing. `src/storage/publishHistory.js`: local publish log (`markcard_publish_history_v1`); titles and hashes only, never bodies or secrets.
- `src/components/publish/`: three-step quick publish dialog and the preflight checklist, shared by the publish workspace and Inspector.
- `src/components/workspaces/OpsWorkspace.vue`: the ops workspace (overview / calendar / reviews) plus the platform-data import dialog; it reads the local publish log and asset usage, never the network.
- `src/composables/useOps.js`: ops aggregates — 30-day KPIs, weekly publishing pace, channel mix, per-day summaries, and review CRUD.
- `src/utils/opsImport.js`: tolerant CSV/TSV parser (header keyword mapping, Chinese and Excel date formats, per-day aggregation) for exports from the WeChat console.
- `src/storage/opsMetrics.js` / `src/storage/opsReviews.js`: versioned local storage for imported day metrics and reviews, normalized on read.
- `src/components/preview/CardArtwork.vue`: canonical card markup used by single preview, overview, measured pagination, export, and gallery pages. Card content or metadata changes belong here.
- `src/components/assets/`: `AssetLibraryBrowser.vue` is the one management surface (folder tree + grid/list + detail + image editor) rendered as a modal picker overlay and, with `embedded`, as the assets workspace; `AssetFolderTree.vue` owns the folder navigation and mounted-folder actions; plus grid card, detail panel, lazy thumbnail, and the canvas-based image editor.
- `src/components/gallery/`: gallery sequence panel and gallery Inspector controls.
- `src/components/cover/`: Cover Studio dialog, cover preview, and canonical cover artwork.
- `src/config/coverTemplates.js`: cover templates, ratios, and default layout values.
- `src/composables/useCoverStudio.js`: cover design state, template application, and editing actions.
- `src/utils/coverBackgrounds.js`: deterministic CSS cover backgrounds from style, seed, and palette.
- `src/storage/assetRepository.js`: browser IndexedDB asset repository (used when not running in Tauri).
- `src/utils/imageFiles.js`: Data URL, SHA-256, dimensions, and thumbnail helpers.
- `src/utils/imageOverlay.js`: per-image decoration data (stickers + text lines), validation, and OpenMoji resolution for gallery pages.
- `src/utils/imageEditor.js`: canvas crop/focal/rotate/flip/filter pipeline.
- `src/components/preview/PreviewArtworkCard.vue`: responsive preview wrapper that scales `CardArtwork.vue` and owns preview-only controls.
- `src/components/preview/`: live preview canvas, navigation, overview, and shared card artwork.
- `src/components/settings/`: platform, pagination, background, header/footer, and export controls.
- `src/config/themes.js`: theme catalog and default theme.
- `src/config/coverStickers.js`: theme-to-OpenMoji sticker mapping.
- `src/i18n/`: one translation resource file per locale plus persisted language and appearance preferences.
- `src/styles/themes/`: shared card CSS, gallery/cover CSS, and one stylesheet per theme.
- `src-tauri/src/files.rs`: native dialogs, Markdown reads/writes, local and bounded remote image conversion, output folders, and export file writes.
- `src-tauri/src/channels.rs`: OS-keychain storage for channel credentials, masked status, a bounded token test, and a read-only interface-permission probe against the official WeChat endpoints.
- `src-tauri/src/assets.rs`: native asset picker, folder scan, JSON index, content-addressed file/thumbnail writes, asset reads, project mirrors, deletion, and storage unit tests.
- `src-tauri/src/publish/bundle.rs`: publish bundle sessions (begin / append / finish / cancel), temp-directory writes, bundle-relative path validation, atomic rename, and unit tests.
- `src-tauri/src/lib.rs`: Tauri plugin setup and command registration.

## Important Invariants

### Publish Bundles Reuse The Card Renderer

Every channel consumes the same bundle shape: `manifest.json` + `images/NN.<ext>` + `title.txt` / `body.txt` / `tags.txt`. `manifest.json` is the only source of truth for a channel adapter; adapters must not re-read Markdown. Bundle images come from `renderPageToImage()` in `useCardExport.js` — never a second hand-built card. Channel limits (image count, title and body length, tags, canvas, media format, minimum side) live in `src/config/publishChannels.js` and the UI plus preflight read only that config; platform limits change, so do not hard-code them elsewhere. Preflight validates technical fitness only and never promises a platform review outcome. Bundle writes go through the registered native session paths, so keep the relative-path rules (`images/<file>` or one root file, extension whitelist, no traversal, containment check after `canonicalize`) and the temp-directory cleanup on failure. Platform secrets belong in OS Keychain via Rust only — never `localStorage`, logs, manifests, or publish bundles. WeChat draft pushing takes the finished bundle folder as its only upload source: `src-tauri/src/wechat.rs` reads that folder's `manifest.json` plus `images/*` (rejecting any directory without the `markcard-studio` generator marker, reusing the bundle relative-path rules, and uploading only JPG/PNG inside the bundle), so a push can never render a second, different card. It creates drafts through `draft/add` only — never `freepublish/*`, never a broadcast — as a 图片消息 (`article_type: "newspic"`) whose cards are uploaded as permanent material (`material/add_material?type=image`) and referenced by `image_info.image_list[].image_media_id`; the article `content` is plain text, and progress goes out as `wechat-draft-progress` events carrying stage and counts only. Uploaded material ids are cached at `<app_data_dir>/markcard/wechat-media-cache.json` keyed by each image's manifest `sha256`, so re-publishing an unchanged card reuses its media id instead of spending the 5000-image permanent-material quota; a `40007` from `draft/add` drops the reused entries and retries once with fresh uploads. The cache holds no secrets and can be deleted at any time.

### Channel Secrets Live In The OS Keychain

`channels.rs` is the only place that reads or writes platform credentials. AppSecret is write-only from the frontend's perspective: status returns `{ configured, appIdMasked }`, never the secret, and the token test runs in Rust with a timeout and returns only `{ ok, expiresIn, message }` (never the token or the raw response body). WeChat's IP whitelist has no API and is not mirrored locally: the settings card only offers a one-click lookup of this machine's public egress IP so the user can add it in the WeChat console, and that lookup runs in Rust (`fetch_public_ip`) because the WebView may route through a different proxy or VPN than reqwest and would otherwise report the wrong IP. A passing token test proves credentials and the whitelist, never interface rights: WeChat grants those by account subject and verification status, so `probe_channel_permissions` calls read-only endpoints only (`get_api_domain_ip`, `menu/get`, `material/get_materialcount`, `draft/count`, `freepublish/batchget`, `datacube/getarticlesummary`, `datacube/getusersummary`, `user/get`), maps `48001` to not-granted, and returns just `{ key, status, errcode, message }` with the token stripped from messages and the text bounded — never add a write endpoint to that list, and never infer draft or publish capability from it. Do not add a command that returns a stored secret, do not pass credentials through the webview, and keep browser mode honest — it has no keychain, so the settings card only explains that configuration is desktop-only. The dependency is `keyring` with `apple-native`, `windows-native`, and `sync-secret-service` backends.

### Ops Numbers Are Imported, Never Fetched

`useOps.js`, `src/utils/opsImport.js`, and `src/storage/opsMetrics.js` own the ops workspace. WeChat's analytics (`datacube/*`), follower, and comment interfaces require a verified non-personal account, and the permission probe records that honestly — so the app must never claim to fetch platform numbers on its own. The user exports CSV from the console or pastes a spreadsheet range: the importer maps headers by keyword, aggregates rows into one record per day, skips unparseable rows such as totals, and on re-import replaces only the columns that import actually carries — a follower report must not wipe the day's reads, and a repeated import must not double-count. Metrics and reviews are versioned local keys, normalized on read, and never sent anywhere. Pacing, channel mix, and calendar markers stay derivable from the local publish log instead of being copied into metrics storage.

### Preview and Export Must Match

The live preview, pagination measurer, and exporter use separate DOM instances, but all must render card markup through `CardArtwork.vue`. Do not reintroduce hand-built export markup or duplicate card content in preview wrappers. Any change to card content, metadata visibility, dimensions, backgrounds, images, Mermaid, KaTeX, or theme styling must still be checked in preview, pagination, and export because their preparation and scaling steps differ.

Export capture deliberately inlines content images and CSS backgrounds, converts Mermaid SVGs, rasterizes KaTeX formulas and cover stickers, waits for decoded image dimensions, and composites Markdown images onto the final canvas. Full-bleed gallery photos are normalized to an opaque JPEG bounded by the export pixel size before capture, because a multi-megabyte PNG inside html-to-image's cloned SVG is silently dropped by WebKit and leaves a blank card. Local Markdown images are resolved to data URLs before pagination. Remote images use browser fetch first and the bounded Tauri resolver as a desktop fallback. Preserve these preparation steps unless the replacement is verified in Tauri on representative documents.

### Scene Mockups Reuse The Rendered Page

`SceneMockupDialog.vue` composites scene mockups from `renderPageToImage()`, never from preview DOM or a second card template. Quads live in the scene photo's normalized coordinates (0–1), so re-encoding a scene at another size keeps the calibration. Corner adjustments are device-local storage on two levels: a scene default (the panel inside the photo) and a per-image correction, resolved image → scene → template. Per-image corrections are not a nicety: one card can sit wrong in one photo, and moving the whole gallery to fix it is the wrong trade, which is why the gallery's sequence rows and the scene section of the Inspector both open `SceneCalibrationDialog` for the selected image while the picker only edits the scene default. Stored corrections carry the template quads' version; when the shipped calibration changes, the old values are dropped as stale offsets. The compositor warps per destination pixel rather than using an affine mesh, because mesh seams show across card text. Templates declare a `surface` (`screen` / `laptop` / `paper`) and a `fit` of `fill`, `contain`, or `cover`. A portrait pad's blank plate is a 3:4 panel, so those templates use `fill`: the card is painted across the whole quad and the projective warp supplies the foreshortening, which leaves zero margin and is what users expect of a device screen. `contain` is for surfaces that really are another physical shape (landscape monitors, laptops, sheets of paper); it keeps the whole card and paints the margin with the card's own outermost row and column stretched outwards plus a faint falloff. `cover` fills and crops, for flat prints already near 3:4. A margin must never stay transparent and must never be filled with a blurred copy of the whole card: a transparent margin shows the photo's blank white plate as an empty band (users reported 空白的部分 留白), and a blurred card smear reads as a rendering bug. Because the compositor can only paint inside the quad, every quad must hug the blank plate in the photo; a loose quad leaves a ring of the plate around the card. `lighting: null` keeps a print matte-clean instead of adding screen glare. Adding a scene means adding a photo under `public/mockups/`, a template in `src/config/sceneMockups.js`, and both locale labels — verify its quad against the rendered preview at 1536×2048.

The same compositor drives the gallery `scene` look: `useGalleryScene.js` generates one composite per `work.images` entry at runtime, keyed by `sceneId|size|assetId` in a blob-URL cache and never persisted (only `work.gallery.sceneId` reaches the work). Backdrops replace `page.gallery.src`, so preview, sequence thumbnails, export and publish all consume the composite; `ensureReady()` is wired as `ensurePagesReady` into `useCardExport.js` and `usePublishBundle.js` so a run never captures half-generated pages, and because backdrops arrive as blob URLs the exporter must normalize them through the same opaque-JPEG path as full-bleed photos.

### Scene Composites Keep The Card's Type Legible

A warped card must survive the trip to a small screen, so four steps are load-bearing and none of them may be traded for speed without re-checking a phone-sized screen at export size: the dialog renders its card at the 1536×2048 scene frame rather than the platform size (`html-to-image` keeps the 450px design layout and only raises the pixel ratio), `prepareCardSurface` sizes its intermediate to two texels per destination pixel but shrinks back instead of upsampling the card, `warpCardIntoQuad` averages the exact overlap box from the transform's local derivative (premultiplied, so the transparent rounded corners cannot darken the edges) rather than one bilinear tap, and the backdrop keeps one near-lossless JPEG generation because `rasterizeContentImage` re-encodes it again on the way into the clone. A single bilinear tap is sharper-looking on a coarse metric and worse on the screen: it breaks CJK strokes and drops thin body text, which is what users actually judge.

That per-pixel warp is the whole cost of a mockup, so its fast paths are load-bearing too. The homography is evaluated incrementally along a row (one divide per pixel, not three), the rounded-corner coverage is only computed near the corners, the inner box loop reads `Uint32` texels and gives interior texels weight 1 instead of a `min`/`max` per texel, and the result is written as one 32-bit store. Intermediate canvases and the card's decoded pixels are pooled (`acquireScratch`, `readCardPixels`, `releaseCardPixels`), because re-allocating a 1536×2048 scratch or re-reading the card through `getImageData` per frame is what made a corner drag drop frames. Measured on the bundled scenes: 1536×2048 composites went 160–195 ms → 93–108 ms, 480×620 picker tiles 22–28 ms → 9–11 ms, a reduced 380×490 drag frame 7 ms, and the rendered pixels are identical to the pre-optimization output (same scene, card and size produced a byte-identical PNG), so these are not quality trade-offs. The picker also caches tiles per `image|size|scene|corners`, so correcting one image's corners recomposites one tile instead of all 29. Going further means leaving this loop: a mip pyramid (downscale once, then four taps) or a WebGL pass would cut the remaining ~80 ms at export size, but both change the filter and need a pixel-diff and a CJK-legibility check against the current output first.

### Pagination Uses Real Card Measurements

Pagination is asynchronous and abortable. `useStudioDocument.js` creates a measured-pagination session for the selected platform, theme, and header/footer visibility settings. The session mounts `CardArtwork.vue` offscreen and uses actual `scrollHeight`/`clientHeight` values instead of estimated block heights.

Keep measurement hosts offscreen but rendered; do not use `display: none`, `visibility: hidden`, or inherited opacity. Wait for fonts, images, and Mermaid before trusting dimensions. When adding a splittable block type, update both the parser/rendering contract and `useMeasuredPagination.js`. Unsplittable oversized blocks must retain their `oversize` marker and visible warning.

### Gallery Pages Are Synthetic

Gallery mode builds one synthetic page per `work.images` entry in `useStudioDocument.js` and still renders through `CardArtwork.vue` (`page.gallery`). It intentionally skips measured Markdown pagination, but preview and export must use the same card markup. Gallery pages suppress the normal overflow warning because the full-bleed image is absolutely positioned beyond the scroll area. When changing gallery rendering, verify both the preview and an exported 1080×1440 PNG.

`work.gallery.mode` is either `template` or `raw`; new gallery works start in `raw` through `createDefaultGalleryLayout()` in `useWork.js`, which the Inspector prop defaults also reuse, while works stored before that default keep their own mode. `work.gallery.type` (`src/config/galleryTypography.js`) carries the title/caption font preset, weight, and width-relative sizes; they reach the card as `--gallery-*` custom properties computed in px from the design width, because `cqw` is unreliable in the export clone. Gallery surfaces (`page.gallery` and `page.coverDesign`) never receive the theme class and never render the themed header/footer or document wallpaper: a photo or a designed cover carries its own palette, so `background: "theme"` now means the neutral matte (`#0b1220`), and the toolbar theme picker is hidden in gallery mode for the same reason. Any gallery layout field added to `work.gallery` must also be copied in `buildGalleryPages()` in `useStudioDocument.js`, which whitelists the fields it forwards — a new field silently stays at its default otherwise. Raw mode additionally drops the card border, shade, title, caption, and page number so the imported image is the card; an empty gallery page shows the neutral matte with its add-image prompt (there is no image and no theme to draw). That suppression lives in `CardArtwork.vue` plus the unlayered `.poster-canvas-frame--raw` / `.card-canvas--raw` rules in `card-gallery.css`, which must stay unlayered and outrank `.card-canvas.theme-*` — otherwise a theme border and the canvas padding reappear.

`work.images[i].tint` (`src/utils/imageTint.js`) stores a tiny downsampled PNG plus the sampled average/accent colors; `work.gallery.background` picks the frame paint (`theme`, `blurred`, `tint`, or `scene`, which replaces the photo itself with a scene-mockup composite). The tint is computed when an image joins the gallery and backfilled the first time a backdrop mode is chosen, because CSS blur is unreliable in the export clone — the blurred layer is a plain `<img class="poster-backdrop">` at `z-index: -1` inside the frame, never a `backdrop-filter`, so header, footer, and card content always stay above it.

Gallery covers are the first image, so Cover Studio is only reachable for works that already stored a `coverDesign` (GalleryInspector and the sequence panel hide the entry otherwise), and the sequence panel only shows its separate cover slot in that case — without a design the first image *is* the cover, so a slot would repeat the same picture and its `封面` tag instead of adding a page. The toolbar OpenMoji picker is hidden in gallery mode because gallery stickers belong to `work.images[i].overlay`. Plain image export stays in the toolbar (`Export artwork`); the publish bundle is the channel artifact, not a second export button.

Per-image decorations live on `work.images[i].overlay` (`src/utils/imageOverlay.js`), never on the asset file, so the imported original stays clean and the decoration is removable. Stored overlay data is untrusted: validate through `normalizeOverlay` on both the write and the persist paths. Items render inside `CardArtwork.vue` as `.gallery-sticker` / `.gallery-overlay__text`, sized in px from the card design width because container-query units are unreliable in the export clone's foreignObject. Stickers reuse the cover-sticker export hooks (`rasterizeCoverStickersForExport`, `compositeCoverStickers`), so keep `img.gallery-sticker` in those selectors. Any decoration, fit, frame, mode, or typography change must move the publish `contentHash` — that is what `galleryDecor()` in `usePublishPlan.js` feeds into `buildContentSeed`.

### Cover Designs Stay Inside CardArtwork

Cover Studio stores a `work.coverDesign` and builds a synthetic cover page (`page.coverDesign`) before the gallery images. That page must render through `CardArtwork.vue`, using `CoverDesignArtwork.vue` inside the shared card. Theme CSS often targets `.card-canvas h1`; cover titles must keep their reset so the designed color/size survives export. Deterministic backgrounds are CSS-only (no SVG data URLs) because `html-to-image` inlines backgrounds and fails on data URLs. After changing cover rendering, verify a paper/grid background export and a 3-page gallery export.

### Document State Has One Main Owner

Add cross-panel document behavior to `useStudioDocument.js` and pass state/events through `App.vue`. Keep small UI-only state local to the owning component. Avoid introducing a global store for a narrow change.

Settings and draft data use versioned `localStorage` keys. Treat stored settings as untrusted, keep validation/defaults when adding fields, and add new persistent fields to both the restore and save paths.

### Browser Fallbacks Are Intentional

Frontend calls to Tauri may fail when the app runs under `pnpm dev` in a browser. Preserve graceful fallbacks for document import, file download, folder selection, and image fetching. Browser export remains subject to normal CORS rules; the remote-image Tauri command is a desktop fallback, not a browser proxy. Native-only behavior belongs in `src-tauri`, exposed through narrowly scoped commands.

### Folder Scans Never Delete User Files

`scan_image_folder` only lists candidates; the frontend imports them through the same `resolve_local_image` + `importFromDataUrl` path as a single-file import, so content addressing and dedupe stay identical. One asset can carry several `folders` entries because identical bytes found in two folders is still one asset — the folder rail is a view over those paths, not a file tree. A rescan marks an unseen path with `missingSince` and never removes the asset or the user's file, and detaching a root only unlinks path entries.

Keep the walker bounded (depth, file count, per-file size) and keep skipping dot folders and symlinks so `.obsidian`/`.git` and link cycles never enter the library. Bulk scans pass `skipSourceCache` so thousands of full data URLs are never retained in memory, and flush the index periodically rather than per file. Mounted roots are stored as an extra top-level `roots` array in the native index (Rust treats the index as opaque JSON) and under `markcard_asset_roots_v1` in browser mode; treat both as untrusted and normalize on read.

Relocating a moved or renamed vault must reuse the same `rootId` (`relocateRoot`), because entries are keyed by `rootId` + relative path and unchanged paths should relink instead of duplicating. There is no filesystem watcher on purpose: adding one needs a new native dependency or broad `fs:scope` grants, so `staleRoots` (older than a day, or holding `missingSince`) drives a manual rescan prompt instead.

### Asset Library Stays Windowed

A scanned vault can hold thousands of assets, so the browser renders at most `PAGE_SIZE` cards at a time and extends on scroll or on clicking the sentinel; `AssetThumbnail`'s IntersectionObserver only defers image bytes, never DOM creation, so it is not a substitute for windowing. Keep `visibleCount` reset whenever the filtered set changes.

The whole index is re-serialized and rewritten on every `flushPersist()` (native IPC plus atomic file write, or IndexedDB), so a scan batches its persist rather than writing per file, and any per-asset mutation rebuilds the entire `assets` array. Do not add loops that call `updateAsset()` once per asset on a large library — batch the changes and apply them in one pass. Mounted-folder state and folder paths are untrusted reads: normalize them through `normalizeRoot` / `normalizeFolderEntry`.

### Theme Changes Span Multiple Files

To add a theme:

1. Add its metadata to `src/config/themes.js`.
2. Add `src/styles/themes/theme-<name>.css`.
3. Import that stylesheet from `src/styles/themes/index.css`.
4. Add its cover stickers to `src/config/coverStickers.js`.

Use a stable `theme-<name>` id/class. Theme CSS must work for every platform ratio and in both preview and export. Do not remove OpenMoji attribution.

## Code Conventions

- Follow the existing JavaScript and Vue `<script setup>` style; do not convert isolated files to TypeScript.
- Use 2-space indentation, double quotes in JavaScript, semicolons, and trailing commas where the surrounding file uses them.
- Define component contracts with `defineProps` and `defineEmits`. Keep event names in kebab case in templates.
- Reuse `AppIcon.vue` and Lucide names for interface icons.
- Prefer computed state over duplicated state and composables over unrelated utility dumping grounds.
- Keep comments brief and reserve them for rendering constraints, compatibility behavior, or non-obvious algorithms.
- Put user-facing strings in the matching locale file under `src/i18n/`, keep locale resources synchronized, and use one file per locale. Preserve stable internal ids when translating labels.
- Use structured APIs for Markdown, URLs, paths, and serialized settings; do not parse structured data with brittle string slicing when an existing parser is available.

## Change Playbooks

### Markdown Syntax or Pagination

- Update parsing/rendering in `useContentParser.js`, measurement/splitting in `useMeasuredPagination.js`, and orchestration in `useStudioDocument.js` as needed.
- Render measurement candidates through `CardArtwork.vue`; do not add a second simplified measurement template.
- Check empty documents, long paragraphs, explicit delimiters, code blocks, tables, images, KaTeX, and Mermaid.
- Verify overflow at Xiaohongshu 3:4, Douyin 9:16, square, and a custom size.
- Confirm rapid edits or settings changes abort stale pagination work and do not replace newer pages.

### Native File Behavior

- Implement the command in `src-tauri/src/files.rs`.
- Register it in `src-tauri/src/lib.rs`.
- Add only the minimum capability permissions required in `src-tauri/capabilities/default.json`.
- Keep path validation and error messages at the native boundary.
- Keep remote image retrieval limited to HTTP/HTTPS, validate image content types, and retain explicit timeout, redirect, and response-size limits.
- Verify filenames and paths on macOS, Windows, and Linux semantics where relevant.

### Export Behavior

- Test PNG and JPG as multiple files, PDF as multiple pages, and long PNG as one stitched canvas.
- Test relative, absolute, and `file://` local Markdown images, including large PNG/JPEG/WebP files and multiple images across pages.
- Test a CORS-restricted remote Markdown image in Tauri, transparent output, built-in and custom wallpaper backgrounds, Mermaid, KaTeX, cover stickers, and all header/footer visibility toggles.
- Confirm local images are present in the saved files, not only in preview or the offscreen export DOM.
- Ensure output dimensions match the selected platform and that document-specific subfolder names are sanitized.

### Publish Behavior

- Change channel capabilities and limits in `src/config/publishChannels.js` first; `usePublishPlan.js`, `src/publish/preflight.js`, and both publish surfaces read that config instead of adding per-screen constants.
- Keep extraction in `src/publish/markdownToCopy.js` (title, plain-text body, hashtags) and severities in `preflight.js`; a new check needs a `blocker` / `warning` / `info` decision, a section, and synchronized keys in both locale files.
- Add or change bundle fields in `usePublishBundle.js` and keep `manifest.json` self-describing; an existing same-named directory may only be replaced when its manifest carries the `markcard-studio` generator marker.
- Verify a WeChat, Xiaohongshu, and local-bundle plan on a 13-page document: overrides inherit when empty, the selected cover moves to `images/01`, and a cancelled or failed run leaves no partial directory.
- Test browser mode separately from Tauri: the File System Access fallback needs a real user gesture, and folder writing is native-only.

## Validation Before Handoff

Run the smallest relevant checks, with these as the default baseline:

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

For visual or export work, also run `pnpm tauri dev` and manually inspect at least one short document and one multipage rich document. For asset/gallery changes, verify import, dedupe, usage references, gallery preview, and an exported gallery PNG. For cover/image-edit changes, verify a cover design, a paper/grid background export, and save-as-new-asset. For ops changes, import a CSV/TSV that contains a total row, confirm the skipped count and the KPI totals, then confirm a re-import does not double-count, and create, edit, and delete a review. Confirm that no card content overlaps, preview matches exported output, and exported pixel dimensions are correct.

Do not edit or commit generated directories such as `node_modules/`, `dist/`, or `src-tauri/target/`. Preserve unrelated user changes in a dirty worktree.

## Documentation and Licensing

- `README.md` is the default English GitHub document.
- `README.zh-CN.md` is the synchronized Simplified Chinese version.
- Result examples live in `imgs/`; update both READMEs when the gallery changes materially.
- Project code is licensed under GNU GPL v3.0. Bundled third-party assets retain their own licenses.
- OpenMoji SVGs are CC BY-SA 4.0; attribution lives in `public/stickers/openmoji/README.md`.
