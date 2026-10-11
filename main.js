'use strict';
/*
 * Simple Mindmap — M0 加载验证（spike v2）
 *
 * M0 第一次尝试的结论（用户真机实测，2026-10-11）：
 *   vendor require 不可用：Cannot find module './vendor/probe.js'
 *   Require stack: - electron/js2c/renderer_init
 *   → Obsidian 里 require 只认 'obsidian' 与内置模块，**相对路径不解析到插件目录**。
 *
 * 本版改用「读文件 + new Function 执行」：
 *   · 用 require('fs') 读插件目录下的 CJS 构建（manifest.dir 是绝对路径）
 *   · 用 new Function('module','exports','require', code) 在插件上下文执行
 *   · 仍然懒加载：onload 不碰文件、不读磁盘
 */

const { Plugin, Notice, Modal } = require('obsidian');

const VENDOR_CJS = 'mind-map.core.cjs.js';

let libCache = null;

/** 在插件上下文里执行一段 CommonJS 源码，返回它的 module.exports */
function evaluateCjs(code, filename) {
  const module = { exports: {} };
  const shimRequire = (name) => {
    throw new Error('vendor 内部 require("' + name + '") 未被内联（' + filename + '）');
  };
  const fn = new Function('module', 'exports', 'require', code + '\n//# sourceURL=' + filename);
  fn(module, module.exports, shimRequire);
  return module.exports;
}

/** 懒加载上游库（第一次真正要用时才读盘+执行） */
function loadLibrary(plugin) {
  if (libCache) return libCache;
  const fs = require('fs');
  const path = require('path');
  const raw = (plugin.manifest && plugin.manifest.dir) || '';
  if (!raw) throw new Error('拿不到插件目录（manifest.dir 为空）');
  // ⚠️ manifest.dir 是**相对路径**（如 .obsidian/plugins/xxx），必须用 vault 绝对路径拼
  const adapter = plugin.app.vault.adapter;
  const base = (typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : adapter.basePath) || '';
  const dir = path.isAbsolute(raw) ? raw : path.join(base, raw);
  const file = path.join(dir, 'vendor', VENDOR_CJS);
  if (!fs.existsSync(file)) throw new Error('找不到 vendor 文件：' + file);
  const t0 = Date.now();
  const code = fs.readFileSync(file, 'utf8');
  const tRead = Date.now() - t0;
  const t1 = Date.now();
  libCache = evaluateCjs(code, file);
  const tEval = Date.now() - t1;
  console.log('[simple-mindmap] vendor 载入完成：读盘 ' + tRead + 'ms · 执行 ' + tEval + 'ms · ' + code.length + ' 字符');
  return libCache;
}

/** 从导出里取 MindMap 构造函数（不同构建形态不同，做兼容） */
function pickMindMapCtor(lib) {
  if (!lib) return null;
  if (typeof lib === 'function') return lib;
  if (typeof lib.MindMap === 'function') return lib.MindMap;
  if (lib.default) {
    if (typeof lib.default === 'function') return lib.default;
    if (typeof lib.default.MindMap === 'function') return lib.default.MindMap;
  }
  for (const k of Object.keys(lib)) {
    const v = lib[k];
    if (typeof v === 'function' && /mindmap/i.test(k)) return v;
  }
  return null;
}

/** 解析插件绝对目录（manifest.dir 是相对路径，必须与 vault 根拼接） */
function resolvePluginDir(plugin) {
  const path = require('path');
  const raw = (plugin.manifest && plugin.manifest.dir) || '';
  const adapter = plugin.app.vault.adapter;
  const base = (typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : adapter.basePath) || '';
  return path.isAbsolute(raw) ? raw : path.join(base, raw);
}

/** 懒注入上游库的 CSS（只插一次）——不注入的话节点文字会渲染异常 */
function ensureVendorCss(plugin) {
  if (document.getElementById('smmap-vendor-css')) return false;
  const fs = require('fs');
  const path = require('path');
  const base = resolvePluginDir(plugin);
  const readIf = (f) => {
    try {
      return fs.readFileSync(path.join(base, 'vendor', f), 'utf8');
    } catch (e) {
      console.warn('[simple-mindmap] missing css: ' + f);
      return '';
    }
  };
  // both are required: library styles (.smm-*) + bundle styles (quill)
  const css = readIf('mind-map.lib.css');
  const style = document.createElement('style');
  style.id = 'smmap-vendor-css';
  style.textContent = css;
  document.head.appendChild(style);
  console.log('[simple-mindmap] vendor CSS 已注入（' + css.length + ' 字符）');
  return true;
}


/* ============================================================================
 * M1：md ↔ 树 的纯函数（无副作用、可单测）
 *
 * 约定：
 *   · 一个 `smmap` 代码块装整个导图 —— 前半是缩进列表大纲，`---` 之后是样式 YAML
 *   · 缩进用 2/4 空格或 Tab（Tab 记 4 宽）；列表符号 - * +
 *   · 节点文字里的行内 markdown 原样保留（**粗体**、[[链接]] 等）
 *   · 以 `\` 转义行首的列表符号；其余内容不做任何改写
 *   · 多个顶层条目 → 视为"多个根"，需要时用 toSingleRoot 合成一个中心节点
 * ========================================================================== */

/** 行首缩进宽度（Tab 记 4） */
function outlineIndent(line) {
  const m = /^([ \t]*)/.exec(line);
  const s = m ? m[1] : '';
  let w = 0;
  for (let i = 0; i < s.length; i += 1) w += s[i] === '\t' ? 4 : 1;
  return w;
}

/** 节点文字转义/反转义（只处理行首列表符号，其余原样） */
function escapeNodeText(text) {
  return String(text == null ? '' : text).replace(/^([-*+]\s)/, '\\$1');
}
function unescapeNodeText(text) {
  return String(text == null ? '' : text).replace(/^\\([-*+]\s)/, '$1');
}

/** 解析缩进列表 → { roots, errors }（errors 记录不是列表项的行） */
function parseOutline(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const roots = [];
  const stack = [];
  const errors = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const indent = outlineIndent(raw);
    const body = raw.trim();
    const m = /^([-*+])\s+(.*)$/.exec(body);
    if (!m) {
      errors.push({ line: i + 1, text: raw });
      continue;
    }
    const node = { text: unescapeNodeText(m[2]), children: [] };
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent: indent, node: node });
  }
  return { roots: roots, errors: errors };
}

/** 树 → 规整缩进列表（每层 2 空格，行尾 \n；与 parseOutline 往返一致） */
function renderOutline(roots) {
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      out.push('  '.repeat(depth) + '- ' + escapeNodeText(n && n.text != null ? n.text : ''));
      if (n && n.children && n.children.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out.length ? out.join('\n') + '\n' : '';
}

/** 多根时合成一个中心节点；恰好一个根则原样返回 */
function toSingleRoot(roots, centerText) {
  const list = roots || [];
  if (list.length === 1) return list[0];
  return { text: centerText == null ? '中心主题' : centerText, children: list.slice() };
}

/** 解析 `smmap` 代码块内容 → { roots, errors, style }（style 为 `---` 之后的原文） */
function parseSmmapBlock(source) {
  const src = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  let splitAt = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '---' && i > 0) {
      splitAt = i;
      break;
    }
  }
  const outlineText = splitAt < 0 ? src : lines.slice(0, splitAt).join('\n');
  const styleText = splitAt < 0 ? '' : lines.slice(splitAt + 1).join('\n');
  const parsed = parseOutline(outlineText);
  return { roots: parsed.roots, errors: parsed.errors, style: styleText.replace(/\s+$/, '') };
}

/** 树 + 样式 → `smmap` 代码块内容（不含围栏本身） */
function renderSmmapBlock(roots, style) {
  const body = renderOutline(roots);
  const st = String(style == null ? '' : style).replace(/\s+$/, '');
  if (!st) return body.replace(/\n$/, '');
  return body + '---\n' + st + '\n';
}

/** 找出文档里所有 ```smmap 围栏：返回 [{ lang, startLine, endLine, source }]（行号 0 基，endLine 指收尾围栏那行） */
function findSmmapFences(doc) {
  const src = String(doc == null ? '' : doc).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out = [];
  let open = -1;
  let lang = '';
  let buf = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*(```+|~~~+)\s*([A-Za-z0-9_-]*)\s*$/.exec(lines[i]);
    if (open < 0) {
      if (m) {
        open = i;
        lang = m[2] || '';
        buf = [];
      }
      continue;
    }
    if (m) {
      out.push({ lang: lang, startLine: open, endLine: i, source: buf.join('\n') });
      open = -1;
      lang = '';
      buf = [];
      continue;
    }
    buf.push(lines[i]);
  }
  return out;
}

/** 只替换指定围栏的内容，其余行**逐字节保持**（返回新文档；找不到则原样返回） */
function replaceFenceSource(doc, fence, newSource) {
  const src = String(doc == null ? '' : doc).replace(/\r\n?/g, '\n');
  if (!fence || typeof fence.startLine !== 'number') return src;
  const lines = src.split('\n');
  const head = lines.slice(0, fence.startLine + 1);
  const tail = lines.slice(fence.endLine);
  const mid = String(newSource == null ? '' : newSource).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return head.concat(mid).concat(tail).join('\n');
}
/* ============================================================================
 * M2：把笔记里的 smmap 块渲染成图（只读）
 * ========================================================================== */

/** 我们的节点结构 → 上游库的数据结构 */
function toLibData(node) {
  const n = node || { text: '', children: [] };
  return {
    data: { text: String(n.text == null ? '' : n.text) },
    children: (n.children || []).map(toLibData),
  };
}

/** 极简样式解析：只认 `key: value` 行（够用即可，不引入完整 YAML 解析） */
function parseSimpleYaml(text) {
  const out = {};
  const lines = String(text == null ? '' : text).split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k) out[k] = v;
  }
  return out;
}

/** 在容器里渲染只读的图（懒加载库 + CSS；失败给可见提示，不静默）
 *  ⚠️ 代码块处理器是**同步**执行的，此时元素还没完成布局（clientWidth=0），
 *     而库要求容器构造时就有非零宽高 → 必须等元素真正有尺寸再挂载（有上限的延迟重试）。 */
function renderMapIn(plugin, container, roots, style, height) {
  const cfg = style || {};
  container.empty();
  container.addClass('smmap-canvas');
  container.style.height = (Number(height) > 80 ? Number(height) : 320) + 'px';

  let tries = 0;
  const mount = () => {
    if (!container.isConnected) return; // 块已被移除/重渲染，放弃
    if (!container.clientWidth || !container.clientHeight) {
      tries += 1;
      if (tries <= 40) {
        window.setTimeout(mount, 25); // 最多等 ~1s
        return;
      }
      container.createDiv({ cls: 'smmap-error', text: '容器一直没有尺寸，渲染放弃（clientWidth=0）' });
      return;
    }
    try {
      ensureVendorCss(plugin);
      const lib = loadLibrary(plugin);
      const Ctor = pickMindMapCtor(lib);
      if (!Ctor) throw new Error('找不到 MindMap 构造函数');
      const mm = new Ctor({
        el: container,
        data: toLibData(toSingleRoot(roots)),
        layout: cfg.layout || 'logicalStructure',
        theme: cfg.theme || 'classic',
        readonly: true,
      });
      if (typeof mm.render === 'function') mm.render();
      window.setTimeout(() => {
        try {
          if (mm && typeof mm.resize === 'function') mm.resize();
        } catch (e) {
          /* 重算失败不影响已渲染内容 */
        }
      }, 60);
    } catch (e) {
      container.empty();
      container.createDiv({ cls: 'smmap-error', text: '导图渲染失败：' + (e && e.message ? e.message : e) });
      console.error('[simple-mindmap] 渲染失败', e);
    }
  };

  window.setTimeout(mount, 0);
}

/* ============================================================================
 * M3：安全写回（纯函数，先测逻辑、再接 UI）
 *   纪律（沿用其他插件的既有教训）：
 *     · 只替换 smmap 围栏内的行，围栏之外**逐字节不变**
 *     · 样式段（`---` 之后）原样保留，不因写回而丢失
 *     · 没有围栏时，新块插在 **frontmatter 之后**（绝不放在第 1 行，那会顶掉 YAML）
 *     · 同一次写回重复执行必须幂等
 * ========================================================================== */

/** frontmatter 结束行（0 基的"下一个起始行"）；无 frontmatter 返回 0 */
function frontmatterEnd(doc) {
  const lines = String(doc == null ? '' : doc).replace(/\r\n?/g, '\n').split('\n');
  if (!lines.length || lines[0].replace(/^\uFEFF/, '').trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return i + 1;
  }
  return 0;
}

/** 树写回笔记：替换第 index 个 smmap 围栏（样式原样保留）；没有围栏则在 frontmatter 之后插入 */
function applyMapToNote(doc, roots, opts) {
  const src = String(doc == null ? '' : doc).replace(/\r\n?/g, '\n');
  const o = opts || {};
  const lang = o.lang || 'smmap';
  const fences = findSmmapFences(src).filter((f) => f.lang === lang);
  if (fences.length) {
    const idx = typeof o.index === 'number' ? o.index : 0;
    const f = fences[idx] || fences[0];
    const parsed = parseSmmapBlock(f.source);
    const block = renderSmmapBlock(roots, parsed.style); // 样式段原样保留
    return replaceFenceSource(src, f, block);
  }
  const block = renderSmmapBlock(roots, o.style || '');
  const fenced = '```' + lang + '\n' + block + '\n```';
  const at = frontmatterEnd(src);
  if (at > 0) {
    const lines = src.split('\n');
    return lines.slice(0, at).concat(['', fenced, '']).concat(lines.slice(at)).join('\n');
  }
  const prefix = src.replace(/\s+$/, '');
  return (prefix ? prefix + '\n\n' : '') + fenced + '\n';
}
/* ============================================================================
 * M3b：编辑 + 显式保存 + 关闭时提示（接到 M3a 的安全写回）
 * ========================================================================== */

/** 上游库的数据结构 → 我们的树（纯函数；写回笔记时用） */
/** 上游库的富文本节点文本是 HTML（如 `<p>文字</p>`）：写回 md 前必须剥掉包装。
 *  只在"整串看起来就是一个 HTML 片段"时才处理，避免误伤正文里的 < 符号。 */
function htmlToNodeText(text) {
  const s = String(text == null ? '' : text);
  const looksHtml = /^\s*<[a-zA-Z][^>]*>[\s\S]*<\/[a-zA-Z][^>]*>\s*$/.test(s) || /^\s*<br\s*\/?>\s*$/.test(s);
  if (!looksHtml) return s.trim();
  return s
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}
function fromLibData(node) {
  const n = node || {};
  const d = n.data || {};
  const text = typeof d.text === 'string' ? htmlToNodeText(d.text) : '';
  return { text: text, children: (n.children || []).map(fromLibData) };
}

/** 打开"编辑当前笔记的导图"窗口：改完点保存 → 只替换 smmap 围栏 */
/** 自建的文字编辑框：不依赖上游内联编辑器；确定后用官方路径写回节点文字。
 *  官方路径（在产物里查证过）：
 *    · 命令  mm.execCommand('SET_NODE_TEXT', node, text)      （command.add("SET_NODE_TEXT", setNodeText)）
 *    · 事件  mm.event.emit('node_text_edit_change', {node,text})（.on('node_text_edit_change', onNodeTextEditChange)）
 */

class SimpleMindmapPlugin extends Plugin {
  async onload() {
    // 刻意不读盘、不加载库（单测守这条）

    // ① 环境探测：fs 是否可用 + 插件绝对目录 + vendor 是否就位
    

    // ② spike：读文件 + new Function 执行 + 渲染
    

    // ②b 诊断：画图并导出关键事实
    

    // ③ smmap 代码块 → 笔记里内联渲染（只读；数据来自笔记本身）
    // ⑤ 插入 smmap 导图块（真正的用户命令）    // ⑤ 插入 smmap 导图块（不依赖编辑器上下文 → 命令面板里始终可见）
    this.addCommand({
      id: 'insert-smmap-block',
      name: '插入 smmap 导图块',
      callback: () => {
        const active = this.app.workspace.activeEditor;
        const editor = active && active.editor;
        if (!editor) {
          new Notice('先打开一篇 markdown 笔记，再执行这个命令');
          return;
        }
        const skeleton = '- 中心主题\n  - 分支 A\n    - 叶子 1\n  - 分支 B\n---\nlayout: logicalStructure\ntheme: classic\nheight: 360';
        editor.replaceRange('```smmap\n' + skeleton + '\n```\n', editor.getCursor('from'));
        new Notice('已插入 smmap 块：改里面的缩进列表即可，或用「编辑当前笔记的导图」', 8000);
      },
    });

    // ④ 编辑当前笔记的导图：改完点保存 → 只替换 smmap 围栏（安全写回）

    this.registerMarkdownCodeBlockProcessor('smmap', (source, el) => {
      const parsed = parseSmmapBlock(source);
      if (!parsed.roots.length) {
        el.createDiv({ cls: 'smmap-error', text: 'smmap 块里没有列表大纲（应以 - 开头的缩进列表）' });
        return;
      }
      const style = parseSimpleYaml(parsed.style);
      if (parsed.errors.length) console.warn('[simple-mindmap] 块内有非列表行（已跳过）：', parsed.errors);
      renderMapIn(this, el.createDiv({ cls: 'smmap-embed' }), parsed.roots, style, style.height);
    });
  }

  onunload() {
    libCache = null;
  }
}

module.exports = SimpleMindmapPlugin;

/* M1 绾嚱鏁板鍑猴紙浠呬緵鍗曟祴锛屼笉鍙備笌杩愯鏃堕€昏緫锛?*/
module.exports.__test = {
  outlineIndent: outlineIndent,
  escapeNodeText: escapeNodeText,
  unescapeNodeText: unescapeNodeText,
  parseOutline: parseOutline,
  renderOutline: renderOutline,
  toSingleRoot: toSingleRoot,
  parseSmmapBlock: parseSmmapBlock,
  renderSmmapBlock: renderSmmapBlock,
  findSmmapFences: findSmmapFences,
  replaceFenceSource: replaceFenceSource,
  toLibData: toLibData,
  parseSimpleYaml: parseSimpleYaml,
  frontmatterEnd: frontmatterEnd,
  applyMapToNote: applyMapToNote,
  fromLibData: fromLibData,
  htmlToNodeText: htmlToNodeText,
};
