# PandaLens · 浏览器里的可视化 pandas

PandaLens is a **visual pandas workbench that runs entirely in the browser**. Load any table, explore it
with statistics and charts, chain pandas operations visually, and get the equivalent pandas code back —
in Chinese and English.

**PandaLens 是一个完全运行在浏览器中的可视化 pandas 数据分析工作台。** 加载任意数据表，用统计与图形探索，
以可视化方式组合 pandas 操作，并自动得到等价的 pandas 代码，支持中英双语。

**在线演示 · Live demo：<https://2254193662lzx.github.io/pandalens/>**

## Highlights / 核心亮点

| | |
|---|---|
| **23 pandas operations as visual steps** | 23 种 pandas 操作可视化搭建：筛选、排序、去重、缺失值填充、类型转换、计算列、文本处理、日期拆分、分箱、移动窗口、分组聚合、透视表、melt、关联、相关系数矩阵…… |
| **Live pipeline** | 每一步实时显示输出行数与增减量，可拖拽排序、停用、复制；某一步出错只影响该步并给出原因，后续步骤自动暂停 |
| **Runnable pandas code** | 流水线自动翻译成可直接运行的 pandas 脚本（已与真实 pandas 逐值比对） |
| **13 chart families** | 直方图 / 柱状 / 折线 / 散点 / 箱线 / 饼图 / 相关热力图 / 透视热力图 / 缺失值地图 / 散点矩阵 / 平行坐标 / 矩形树图 / 雷达图，每个图都带自动洞察与点击下钻 |
| **Missing-data toolkit** | 缺失矩阵（按缺失程度排序）、按列缺失条形图、缺失相关性热力图（missingno 风格） |
| **Statistics verified against pandas** | 620 项统计量与 pandas 逐项比对，最大相对偏差 1.2 × 10⁻¹² |
| **Bilingual, offline, private** | 中英文内容完全一致（一条文案对应两种语言）；无需服务器，数据不出浏览器 |

## Run locally / 本地运行

```bash
python -m http.server 8899
# open http://127.0.0.1:8899/index.html
```

A static server is required (the built-in datasets are fetched as CSV). 需要静态服务器（内置数据集以 CSV 形式加载）。

## Layout / 目录

```
index.html         page shell
css/styles.css     design system (light + dark)
js/stats.js        statistics kernel (pandas/numpy compatible)
js/expr.js         sandboxed expression language + pandas code generator
js/dataframe.js    the pandas-like DataFrame
js/ops.js          operation registry: visual form + apply + pandas code
js/charts.js       chart registry: params + ECharts option + automatic insight
js/i18n.js         bilingual strings (KEY: [en, zh])
js/ui.js           grid, form controls, menus, modals, sparklines
js/app.js          views, state, event wiring
js/icons.js        hand-built stroke icon set
data/              10 built-in datasets
vendor/            ECharts, PapaParse, SheetJS (bundled, no CDN)
tools/             verification & recording harnesses (not needed to run the site)
docs/              highlights document (md / pdf / docx) and submission notes
```

## Verification / 验证

The harnesses live in `tools/` and need Node, Chrome and one `npm install`. They print their own results,
so every claim in the highlights document can be reproduced:

```bash
cd tools && npm install

node probe.js          # walks every view, dataset, chart type and operation, in both languages and themes
node verify-code.js    # runs the generated pandas code with real pandas and compares the results
node verify-stats.js   # compares 620 statistics with pandas
node record.js         # re-records the narrated demo video (Windows TTS + ffmpeg)
python package.py      # rebuilds the submission archive
```

Latest results / 最近一次结果:

- `probe.js` — 0 runtime errors, 0 failed requests (also when run against the deployed site);
- `verify-code.js` — 4 pipelines identical to pandas (shape, column names and values);
- `verify-stats.js` — 620 comparisons, worst relative deviation 1.2 × 10⁻¹², zero mismatches.

## How the visual interface and the code stay in sync / 界面与代码为何不会脱节

Every operation is declared once in `js/ops.js`, holding three things together: the form controls it shows,
the function that transforms the frame, and the pandas code it stands for. The palette, the step editor,
the step summary and the generated script all read from that single declaration, so they cannot drift
apart. The same idea drives the 13 chart families in `js/charts.js`.
