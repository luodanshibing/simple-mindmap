# Simple Mindmap

把笔记里的 `smmap` 代码块渲染成思维导图 —— **数据只存在笔记里**，卸载插件不影响你的文档。

## 特点

- **数据就是 markdown**：一个 `smmap` 代码块，前半是**人类可读的缩进大纲**，`---` 之后是样式段
- **卸载安全**：删掉插件后，代码块退化成一段看得懂的大纲文本
- **直接在代码块里编辑**：改缩进列表就是改图（本插件**不做**图形化编辑，只做渲染）
- **启动零成本**：插件加载时**不读盘、不加载库**；渲染库（336 KB）只在首次渲染时载入
- **不碰原始文件**：插件从不写你的笔记（只读渲染）
- **离线可用**：无登录、无云、无 AI

## 用法

1. `Ctrl+P` → **「插入 smmap 导图块」**（在光标处插入一个可用骨架），或者手动写：

````markdown
```smmap
- 中心主题
  - 分支 A
    - 叶子 1
    - 叶子 2
  - 分支 B
---
layout: logicalStructure
theme: classic
height: 360
```
````

2. 阅读视图 / 实时预览里会**原位渲染**成导图
3. **要改图就改代码块里的列表** —— 缩进决定层级

### 格式要点

- 缩进 2/4 空格或 Tab 均可；列表符号支持 `-` `*` `+`
- 节点文字里的行内 markdown（`**粗体**`、`[[链接]]`）原样保留
- 样式段（`---` 之后）**可整段省略**，省略时用默认：`layout: mindMap`、高度 320px
- **`layout` 可选值（已在产物中逐个核实）**：`mindMap`（默认，左右对称）、`logicalStructure`（逻辑结构）、`organizationStructure`（组织架构）、`timeline`、`verticalTimeline`、`fishbone`
- **`height`**：渲染高度（px），如 `height: 360`
- **`theme`**：核心库只带默认主题，写别的值会被忽略（不报错）—— 因此实际只需 `layout` 与 `height`

## 安装

```
<你的库>/.obsidian/plugins/simple-mindmap/
├─ main.js  manifest.json  styles.css  versions.json
└─ vendor/  (mind-map.core.cjs.js · mind-map.lib.css)
```

然后在「设置 → 第三方插件」里启用。

## 已知限制

- **只读渲染**：图上不能直接拖拽/打字；编辑一律在代码块的文本里完成（有意为之，见上）
- **仅桌面版**：需要读取插件目录下的 vendor 文件

## 第三方

渲染库 [simple-mind-map](https://github.com/wanglin2/mind-map)（MIT · v0.14.0-fix.3），
`vendor/mind-map.core.cjs.js` 由本仓库 `build/entry-core.js` 经 esbuild 打包（**只引核心，不带交互插件**）。
许可证全文见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。

## 许可

[MIT](./LICENSE)
