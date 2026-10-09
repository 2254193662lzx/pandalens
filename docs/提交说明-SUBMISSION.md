# 提交说明 · Submission notes

## 1. 网页链接 · Live site

**https://2254193662lzx.github.io/pandalens/**

源代码仓库（public）：https://github.com/2254193662lzx/pandalens

打开即用，无需注册、无需安装。所有解析、统计与绘图都在浏览器本地完成，数据不会上传到任何服务器。
默认载入「零售订单」数据集，可直接体验；也可载入内置数据集或拖入自己的 CSV / JSON / Excel 文件。

*No installation required. Everything runs locally in the browser.*

## 2. 源代码压缩包 · Source archive

`PandaLens-source.zip`，结构如下：

```
PandaLens/
  web/                      网站源码（直接部署这一层即可）
    index.html              页面骨架
    css/styles.css          设计系统（浅色 / 深色）
    js/stats.js             统计内核（与 pandas/numpy 对齐）
    js/expr.js              表达式语言 + pandas 代码生成器
    js/dataframe.js         DataFrame 引擎（列式存储）
    js/ops.js               操作注册表：可视化表单 + 数据效果 + pandas 代码
    js/charts.js            图形注册表：参数 + ECharts 配置 + 自动洞察
    js/ui.js                表格、表单控件、菜单、弹窗、迷你图
    js/app.js               视图、状态、事件
    js/i18n.js              中英文文案（一条文案对应两种语言）
    data/                   10 个内置数据集
    vendor/                 ECharts / PapaParse / SheetJS（本地化，无 CDN 依赖）
  tools/                    开发与验证工具（非运行必需）
    probe.js                端到端回归测试（视图/数据集/图形/操作/双语/主题）
    verify-code.js          用真实 pandas 运行生成的代码并逐值比对
    verify-stats.js         620 项统计量与 pandas 比对
    gen-data.js             生成 sales / airquality / stocks 三个数据集
    record.js               录制讲解视频（TTS 旁白 + 字幕 + 屏幕录制）
    make-pdf.js             由 Markdown 生成 PDF
    make-docx.py            由 Markdown 生成 DOCX
    md.js / preview.js      文档工具链
    package.py              打包提交压缩包
  docs/                     关键亮点说明（md / pdf / docx）与页面预览图
  video/                    演示视频与字幕
```

本地运行（需要一个静态服务器，因为内置数据集通过 fetch 加载）：

```bash
cd PandaLens/web
python -m http.server 8899
# 浏览器打开 http://127.0.0.1:8899/index.html
```

## 3. 视频 · Demo video

`PandaLens-demo.mp4` — 时长 4 分 49 秒（限制 5 分钟），中文讲解，内嵌字幕。
字幕文件：`PandaLens-demo.zh.srt`。

讲解顺序：加载数据 → 数据表交互 → 列菜单生成 pandas 步骤 → 统计剖析 → 缺失值工具箱 →
操作流水线（现场搭建 4 步） → 自动生成的 pandas 代码 → 图形分析与下钻 → 双语与深色模式 → 导出与总结。

## 4. 文档 · Highlights document

`PandaLens-亮点说明.pdf`（6 页，推荐阅读）／`.docx`（Word）／`.md`（Markdown 源文件）。

内容涵盖：设计动机、23 种可视化 pandas 操作、自动生成可运行 pandas 代码的翻译规则与验证结果、
620 项统计量与 pandas 的比对结论、13 类图形的分析用途、交互细节、双语实现方式、技术实现与已知限制。

## 质量自述 · Verification

| 验证项 | 方法 | 结果 |
|---|---|---|
| 界面无运行时错误 | `node tools/probe.js` | 所有视图 / 10 个数据集 / 13 种图形 / 23 种操作 / 双语 / 深浅主题，0 错误 0 失败请求 |
| 生成的 pandas 代码可运行 | `node tools/verify-code.js` | 4 条流水线用真实 pandas 运行，形状、列名、数值完全一致 |
| 统计量正确 | `node tools/verify-stats.js` | 620 项比对，最大相对偏差 1.2 × 10⁻¹²，零处不一致 |
| 线上可用 | 对线上地址运行同一套回归测试 | 0 错误 0 失败请求 |
