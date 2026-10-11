# Simple Mindmap

把笔记里的 `smmap` 代码块渲染成思维导图 —— **数据只存在笔记里**，卸载插件不影响你的文档。

## 特点

- **数据就是 markdown**：一个 `smmap` 代码块，前半是**人类可读的缩进大纲**，`---` 之后是样式段
- **卸载安全**：删掉插件后，代码块退化成一段看得懂的大纲文本，不是乱码、不是私有格式
- **启动零成本**：插件加载时**不读盘、不加载库**；渲染库（575 KB）只在首次渲染时才载入
- **不碰原始文件**：写回时**只替换代码块内的行**，frontmatter 与正文逐字节不变（18 项断言守着）
- **离线可用**：无登录、无云、无 AI

## 用法

1. 在笔记里写一个 `smmap` 代码块：**缩进列表 = 树**
2. 阅读视图 / 实时预览里会**原位渲染**成导图
3. `Ctrl+P` → **「编辑当前笔记的导图（smmap 块）」** 打开编辑窗口
   - 选中节点后，点工具栏 **「编辑选中节点文字」** 改文字
4. 点 **「保存到笔记」** —— 只改代码块

### 格式

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

- 缩进用 2/4 空格或 Tab 均可；列表符号支持 `-` `*` `+`
- 节点文字里的行内 markdown（`**粗体**`、`[[链接]]`）原样保留
- 样式段（`---` 之后）**可整段省略**，省略时用默认：`logicalStructure` / `classic` / 320px

## 安装

```
<你的库>/.obsidian/plugins/simple-mindmap/
├─ main.js  manifest.json  styles.css  versions.json
└─ vendor/  (mind-map.edit.cjs.js · mind-map.edit.cjs.css · mind-map.lib.css)
```

然后在「设置 → 第三方插件」里启用。

## 已知限制

- **图上直接输入文字**：上游内联编辑器在 Obsidian 弹窗里焦点不稳定，因此**请用工具栏按钮**改节点文字（选中节点 → 「编辑选中节点文字」）
- **仅桌面版**：需要读取插件目录下的 vendor 文件

## 第三方

渲染库 [simple-mind-map](https://github.com/wanglin2/mind-map)（MIT · v0.14.0-fix.3）。
`vendor/` 下的构建产物由本仓库 `build/entry.js` 经 esbuild 打包（按需引入 RichText / Select / Drag / KeyboardNavigation 四个插件）。
许可证全文见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。

## 许可

[MIT](./LICENSE)