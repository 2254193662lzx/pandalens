# PandaLens · 浏览器里的可视化 pandas

PandaLens is a **visual pandas workbench that runs entirely in the browser**. Load any table,
explore it with statistics and charts, chain pandas operations visually, and get the equivalent
pandas code back — in Chinese and English.

**PandaLens 是一个完全运行在浏览器中的可视化 pandas 数据分析工作台。** 加载任意数据表，用统计与图形探索，
以可视化方式组合 pandas 操作，并自动得到等价的 pandas 代码，支持中英双语。

## Highlights / 核心亮点

| | |
|---|---|
| **23 pandas operations as visual steps** | 23 种 pandas 操作可视化搭建：筛选、排序、去重、填充、类型转换、分组聚合、透视表、关联、分箱、移动窗口…… |
| **Live pipeline** | 每一步实时显示输出行数与变化量，可拖拽排序、启用/停用、复制，出错只影响该步 |
| **Runnable pandas code** | 流水线自动翻译成可直接运行的 pandas 脚本（已与真实 pandas 逐值比对） |
| **12 chart families** | 直方图/柱状/折线/散点/箱线/饼图/相关热力图/透视热力图/缺失地图/散点矩阵/平行坐标/矩形树图/雷达图 |
| **Missing-data toolkit** | 缺失矩阵、按列缺失条形图、缺失相关性热力图（missingno 风格） |
| **Statistics verified against pandas** | 620 项统计量与 pandas 逐项比对，最大相对偏差 1.2e-12 |
| **Bilingual, offline, private** | 中英文内容完全一致；无需服务器，数据不出浏览器 |

## Run locally / 本地运行

```bash
cd web
python -m http.server 8899
# open http://127.0.0.1:8899/index.html
```
A static server is required (the app fetches the built-in CSV files).

需要静态服务器（内置数据集以 CSV 形式加载）。

## Layout / 目录

```
web/
  index.html         shell
  css/styles.css     design system (light + dark)
  js/stats.js        statistics kernel (pandas/numpy compatible)
  js/expr.js         sandboxed expression language + pandas code generator
  js/dataframe.js    the pandas-like DataFrame
  js/ops.js          operation registry (visual form + apply + pandas code)
  js/charts.js       chart registry (params + ECharts option + insight)
  js/i18n.js         bilingual strings (KEY: [en, zh])
  js/ui.js           table grid, form controls, menus, modals, sparklines
  js/app.js          views, state, event wiring
  data/              built-in datasets
  vendor/            ECharts, PapaParse, SheetJS
tools/               generators and verification harnesses (dev only)
```

## Verification / 验证

```bash
node tools/probe.js          # every view, dataset, chart type and operation
node tools/verify-code.js    # runs the generated pandas code and compares results
node tools/verify-stats.js   # 620 statistics compared with pandas
```
