# 交互和接入规范

## 安装短入口

用 `$guanmao-design-review` 调用完整名称，或用 `$gm-review` 调用短入口。例如「用 $gm-review 给这份 HTML 报告加逐章评审」。

分享时提供整个 `guanmao-design-review` 目录，其中包含 `aliases/gm-review/`。收到后先安装主 Skill。在 macOS 或 Linux 上，进入完整源码目录并执行一次下面的命令，把短入口注册到本机的 Codex Skills 目录。

```sh
mkdir -p "$HOME/.agents/skills"
guanmao_short_link="$HOME/.agents/skills/gm-review"
if [ ! -e "$guanmao_short_link" ] && [ ! -L "$guanmao_short_link" ]; then
  ln -s "$(pwd -P)/aliases/gm-review" "$guanmao_short_link"
fi
```

短入口的显示名是「GM 评审」，显式选择或输入 `$gm-review` 时启用。主入口负责按需求自动匹配。若同名入口已存在，先核对它是否指向本 Skill 的 `aliases/gm-review/`。

## 给现有 HTML 加评审

对普通单页 HTML 运行以下命令。输入输出使用不同文件。如果原文依赖同目录素材，评审副本也应放在同一目录。

```sh
python3 /path/to/guanmao-design-review/scripts/build_html.py report.html report-review.html --attach-review ops-report
```

默认使用 `document.title` 作为显示名称，定位键为 `document`。可以给正文中的按钮或链接加 `data-review-target="overview"` 和 `data-review-title="运营概览"`。点击这些入口时更新评审上下文，同时保留原导航。初始章节可以在 `body` 上用同样两个属性指定。章节自动滚动时保持正在填写的上下文。

已有分页逻辑的 HTML 可以内联 `page-review.css` 与 `image-attachments.css`，按顺序加载 `image-attachments.js`、`review-package.js`、`page-review.js`。在原脚本初始化后挂载一次，并在实际切页、切场景或打开需要单独评审的弹窗时调用 `setContext(context)`。

```js
const review = PageReview.attachDrawer({
  project: "ops-report",
  context: {id: "summary", title: "方案概览", section: "运营报告"}
});
review.setContext({id: "rollout", title: "上线步骤", section: "运营报告"});
```

对原型，把模块、页面和按需区分的场景组成评审 ID。普通报告按文档或章节定位，幻灯片和静态图按页定位。项目和评审 ID 使用稳定键。页码、标题、日期、文件名和排序用于显示。生成 PPT 评审 HTML 时，可嵌入幻灯片预览图，按实际翻页调用组件。已有 `PageReview` 的文档沿用其项目键、评审 ID 和挂载方式。沙箱 iframe 可沿用 `PageReview.broker(frame, project)`，固定评审入口宜放在最外层视口。

评审记录与场景关联，写入当前浏览器。切页和刷新后应能找回草稿。写入失败时保留当前会话的记录并提示尽快导出。「仅导出文字」保留 Markdown 工作流。JSON 备份携带原图，仅合并同一项目的记录，同一条保留较新的修改。修改回执可用 `PageReview.configure({project, receipts})` 加入，根据评审 ID 和完整意见匹配。跨 iframe 使用新版 `PageReview.broker` 时，父级也应加载 `image-attachments.js`，由父级保存并提供图片原始数据。

## 图片附件与带图交接

- 两种输入区均支持一次上传多张图片。在正文里按 Ctrl+V 或 Cmd+V 可贴截图，普通文字粘贴照常处理。图号随意见或说明保存，删除其他图片时保留已有图号。每图可选填说明。点击缩略图可查看原图、切换图片或切到原始大小。
- 研发说明的只读和可编辑 HTML 都内嵌图片，发一个文件即可离线查看。原型的图片草稿保存在浏览器。移动交付文件前，先导出带图交接或备份。
- 「下载带图评审包」生成 ZIP，包含 `review.md` 和 `images/` 原图。解压后一起给智能体。文档按照模块、页面和场景定位，列出每条意见对应的图号、图片说明和相对路径。智能体先读正文，再打开相应原图核对；不明确的图片要求应结合正文确认。只有图片的意见也会导出。

## 生成或改造低保真原型

`assets/prototype-template/` 提供导航、场景切换和挂载示例。把模板目录与相邻的 `assets/components/` 一起复制到交付工作目录，按需求替换 `pages.js` 的示例数据和页面。首次创建时设置稳定且唯一的项目键。模块 ID、页面 ID 和场景 ID 使用固定字符串，方便后续打开和定位。桌面、报告和终端的业务逻辑各自放在原型页面内。

新建后台原型复用 `app.css` 的浅灰导航与页面底色、白底内容区、蓝色 `#1456F0` 主操作和浅蓝 `#F0F4FF` 选中态。列表页参考 `pages.js` 设备列表的工具栏、状态标签和右侧行操作。按需求取用统计区、搜索和行选择等组件。窄屏可横向滚动表格。模板依赖原生 HTML、CSS、JS，可离线打开。已有项目视觉体系或用户指定样式优先，已有 HTML 加评审时保留原页面样式。

在脚本全部进入 DOM、生成动态页面之前创建研发说明组件，便于导出捕获完整的初始 HTML。保留模板中的 `<script id="dn-data" type="application/json">null</script>`。导航状态可用交接文件中记录的 `initialView` 恢复。每次渲染后提供当前画布和工具栏。

```js
const notes = DevNotes.create({project: "ops-review", fileName: "运维原型"});
notes.mount({
  pageId: "devices/list",
  title: "设备列表",
  stage: document.querySelector("#canvas"),
  controls: document.querySelector("#prototype-actions"),
  view: {page: "devices", scenario: "normal"}
});
```

页面的画布要有可测量的尺寸，父元素包裹画布并容纳标注层，工具栏放在画布外。留出可滚动的画布区域，避免给画布父容器加影响坐标定位的 CSS 变换。研发说明按页面共享，`pageId` 不使用场景 ID 或横竖屏。不同场景的内容重排会影响比例落点与控件的相对位置，交付前检查典型场景。

- 开启「研发说明」才显示橙底白字编号。点「新增说明」后可在画布任意位置落点，点业务按钮也只落点。单击编号打开说明，拖动编号更新位置。
- 标题默认空白，可选填。留空时取正文首行前 24 个字，超出用省略号。两者都空时显示「空白草稿」。使用「保存并继续添加」先保存再进入下一次落点，失败留在编辑区并保留标题和正文。
- 每页从 `01` 编号。同一页的各场景共用说明，列表整行可拖动排序，编号随之更新，位置保持。编辑区顶部并排提供「返回说明列表」和红色「删除这条说明」。逐条或当前页批量删除前须确认。
- 浮窗默认贴右，宽屏默认 560 px。拖标题栏移动，拖底部两角缩放，原型画布不因浮窗开关而移位。只读查看版和可编辑版均可移动和缩放。
- 浏览器草稿保存标题、正文、落点和顺序。只读 HTML 携带已填写的说明，可以操作原型、查看说明和返回列表。可编辑 HTML 还携带空白草稿，接收者可继续填写、拖动编号并再次导出。本页意见另行导出。

接手旧原型时保留旧项目及页面映射。已保存的坐标可以沿用。`DevNotes.create` 支持传 `legacyStorageKey` 读取相同浏览器存储范围内的旧草稿，并用可选的 `resolveLegacyAnchor(target, stage, pageId)` 将旧控件或区域标识解析成元素。解析不出时使用画布内的备用落点，保留标题、正文及顺序。文件路径或浏览器发生变化前先导出。查看和编辑导出文件时，用实际浏览器配置检查可用性。

## 离线构建与验收

```sh
python3 /path/to/guanmao-design-review/scripts/build_html.py path/to/prototype-template/index.html path/to/prototype-review.html
```

默认构建模式内联本地经典脚本、CSS、CSS 中引用的本地素材和 HTML 图片。素材使用相对路径、内联内容或 data URL。模板使用经典脚本，复杂应用由项目自己的构建器产出自包含 HTML 后接入组件。直接加评审模式保留原报告的资源引用。

生成后的 HTML 从浏览器打开。确认评审入口跟随页面、章节或场景，切换后可返回原草稿，并检查保存失败提示和导出文件。验证研发标注的连续添加、拖动、排序以及两种导出。离线和换浏览器验收用全新会话打开实际导出的 HTML。研发说明导出需要自包含源稿，使接收者可直接离线打开。
