/*
 * simple-mindmap · M1 断言（md ↔ 树 纯函数 + smmap 围栏定位与替换）
 * 离线可跑：不需要 Obsidian —— 注入 obsidian 桩后 eval main.js，取 __test。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = readFileSync(join(ROOT, 'main.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log('  ✗ ' + label);
  }
}
function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) console.log('    实际：' + JSON.stringify(actual) + '\n    期望：' + JSON.stringify(expected));
  ok(same, label);
}

/* ---- obsidian 桩 + 载入 main.js ---- */
class StubPlugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest || { dir: '.obsidian/plugins/simple-mindmap' };
  }
  addCommand() {}
  registerMarkdownCodeBlockProcessor() {}
}
class StubModal {
  constructor(app) {
    this.app = app;
    this.contentEl = { empty() {}, createDiv() { return { style: {}, createDiv() { return {}; }, setText() {} }; }, style: {} };
  }
  open() {}
  close() {}
}
const obsidianStub = {
  Plugin: StubPlugin,
  Notice: function Notice() {},
  Modal: StubModal,
};
const moduleStub = { exports: {} };
const fakeRequire = (name) => {
  if (name === 'obsidian') return obsidianStub;
  if (name === 'fs') return { readFileSync: () => '', existsSync: () => false, statSync: () => ({ size: 0 }), writeFileSync: () => {} };
  if (name === 'path') return { join: (...p) => p.join('/'), isAbsolute: () => false };
  throw new Error('unexpected require: ' + name);
};
const fn = new Function('module', 'exports', 'require', SRC + '\n//# sourceURL=main.js');
fn(moduleStub, moduleStub.exports, fakeRequire);
const T = moduleStub.exports.__test || {};

ok(!!T.parseOutline, '__test 导出了 parseOutline');
ok(!!T.findSmmapFences, '__test 导出了 findSmmapFences');

/* ---- 1. 大纲解析 ---- */
const doc1 = ['- 中心主题', '  - 分支 A', '    - 叶子 1', '  - 分支 B'].join('\n');
const p1 = T.parseOutline(doc1);
eq(p1.roots.length, 1, '单根');
eq(p1.roots[0].text, '中心主题', '根文本');
eq(p1.roots[0].children.length, 2, '两个二级');
eq(p1.roots[0].children[0].children[0].text, '叶子 1', '三级文本');
eq(p1.errors.length, 0, '无解析错误');

/* ---- 2. 往返逐字节一致 ---- */
eq(T.renderOutline(p1.roots), doc1 + '\n', 'render(parse(x)) === x + 换行');
const p1b = T.parseOutline(T.renderOutline(p1.roots));
eq(T.renderOutline(p1b.roots), T.renderOutline(p1.roots), '二次往返稳定');

/* ---- 3. Tab / 4 空格 / 列表符号等价 ---- */
const tabDoc = '- 中心主题\n\t- 分支 A\n\t\t- 叶子 1';
const spaceDoc = '- 中心主题\n    - 分支 A\n        - 叶子 1';
eq(T.renderOutline(T.parseOutline(tabDoc).roots), T.renderOutline(T.parseOutline(spaceDoc).roots), 'Tab 与 4 空格等价');
const starDoc = '* 中心主题\n  + 分支 A';
eq(T.parseOutline(starDoc).roots[0].children[0].text, '分支 A', '支持 * 与 +');

/* ---- 4. 行内 markdown 原样保留 ---- */
const mdDoc = '- **粗体** 与 [[链接]] 与 *斜体*\n  - `代码`';
eq(T.renderOutline(T.parseOutline(mdDoc).roots), mdDoc + '\n', '行内 markdown 不被改写');

/* ---- 5. 转义与错误行 ---- */
const escDoc = '- 以 - 开头的文字';
const escParsed = T.parseOutline('- \\- 以 - 开头的文字');
eq(escParsed.roots[0].text, '- 以 - 开头的文字', '行首列表符号可转义');
eq(T.renderOutline(escParsed.roots), '- \\- 以 - 开头的文字\n', '转义后往返一致');
const badParse = T.parseOutline('- 好行\n这不是列表\n- 也好');
eq(badParse.errors.length, 1, '非列表行被记为错误');
eq(badParse.roots.length, 2, '错误行两侧仍解析为两个根');

/* ---- 6. 多根合成 ---- */
const two = T.parseOutline('- A\n- B').roots;
eq(T.toSingleRoot(two, '中心').children.length, 2, '多根合成中心节点');
eq(T.toSingleRoot(T.parseOutline('- A').roots).text, 'A', '单根不合成');

/* ---- 7. smmap 代码块（大纲 + --- + 样式）---- */
const block = ['- 中心主题', '  - 分支 A', '---', 'layout: logicalStructure', 'theme: classic13'].join('\n');
const pb = T.parseSmmapBlock(block);
eq(pb.roots[0].text, '中心主题', '块内大纲解析');
eq(pb.style, 'layout: logicalStructure\ntheme: classic13', '样式段原样取出');
eq(T.renderSmmapBlock(pb.roots, pb.style), block + '\n', '块往返一致');
const noStyle = T.parseSmmapBlock('- 只有大纲');
eq(noStyle.style, '', '无样式段');
eq(T.renderSmmapBlock(noStyle.roots, ''), '- 只有大纲', '无样式段不加 ---');

/* ---- 8. 围栏定位：frontmatter 的 --- 不能误判 ---- */
const file = [
  '---',
  'title: 测试',
  '---',
  '',
  '# 标题',
  '',
  '```smmap',
  '- 中心主题',
  '  - 分支 A',
  '---',
  'theme: classic13',
  '```',
  '',
  '后面的正文',
].join('\n');
const fences = T.findSmmapFences(file).filter((f) => f.lang === 'smmap');
eq(fences.length, 1, '只找到 1 个 smmap 围栏');
eq(fences[0].startLine, 6, '起始行 = 6（0 基）');
eq(fences[0].endLine, 11, '收尾围栏行 = 11');
eq(fences[0].source.indexOf('- 中心主题'), 0, '围栏内容取自源码');

/* ---- 9. 只替换围栏：其余行逐字节不变 ---- */
const newSource = '- 新中心\n  - 新分支\n---\ntheme: dark';
const replaced = T.replaceFenceSource(file, fences[0], newSource);
const before = file.split('\n').slice(0, 7);
const after = replaced.split('\n').slice(-3);
eq(before.join('\n'), replaced.split('\n').slice(0, 7).join('\n'), '围栏之前的行完全不变');
eq(after.join('\n'), ['```', '', '后面的正文'].join('\n'), '围栏之后的行完全不变');
eq(replaced.indexOf('title: 测试') >= 0, true, 'frontmatter 未被破坏');
eq(T.findSmmapFences(replaced).filter((f) => f.lang === 'smmap')[0].source, newSource, '替换后的块内容正确');

/* ---- 10. onload 仍不读盘（M0 纪律）---- */
const onloadIdx = SRC.indexOf('async onload()');
const onloadBody = SRC.slice(onloadIdx, SRC.indexOf('onUnload') > 0 ? SRC.length : SRC.length).slice(0, 1800);
ok(!/readFileSync/.test(onloadBody), 'onload 里没有 readFileSync');

console.log('');
console.log('M1：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail === 0) console.log('M1 自检通过 ✓');
/* ---- M2 additions: library data mapping + style parsing ---- */
const ld = T.toLibData({ text: 'root', children: [{ text: 'kid', children: [] }] });
eq(ld.data.text, 'root', 'toLibData: root text');
eq(ld.children.length, 1, 'toLibData: one child');
eq(ld.children[0].data.text, 'kid', 'toLibData: child text');
eq(T.toLibData(null).data.text, '', 'toLibData: null safe');
const y = T.parseSimpleYaml('layout: mindMap\ntheme: "dark"\n# comment\nheight: 420');
eq(y.layout, 'mindMap', 'yaml: layout');
eq(y.theme, 'dark', 'yaml: quotes stripped');
eq(y.height, '420', 'yaml: height');
eq(Object.keys(T.parseSimpleYaml('')).length, 0, 'yaml: empty');
/* ---- M3 additions: safe write-back ---- */
const noteWithFm = ['---', 'title: T', 'tags: [a]', '---', '', '正文一', '', '```smmap', '- 旧中心', '  - 旧分支', '---', 'theme: classic13', '```', '', '正文二'].join('\n');
eq(T.frontmatterEnd(noteWithFm), 4, 'frontmatterEnd = 4');
eq(T.frontmatterEnd('没有 frontmatter'), 0, '无 frontmatter -> 0');
const newRoots = T.parseOutline('- 新中心\n  - 新分支').roots;
const written = T.applyMapToNote(noteWithFm, newRoots);
eq(written.split('\n')[0], '---', 'YAML 首行仍是 ---');
eq(written.indexOf('title: T') >= 0, true, 'frontmatter 保留');
eq(written.indexOf('正文一') >= 0, true, '围栏前正文保留');
eq(written.indexOf('正文二') >= 0, true, '围栏后正文保留');
eq(written.indexOf('- 新中心') >= 0, true, '新内容写入');
eq(written.indexOf('- 旧中心') < 0, true, '旧内容被替换');
eq(written.indexOf('theme: classic13') >= 0, true, '样式段原样保留');
eq(written.split('\n').slice(0, 8).join('\n'), noteWithFm.split('\n').slice(0, 8).join('\n'), '围栏围栏行之前逐行不变');
eq(written.split('\n').slice(-2).join('\n'), ['', '正文二'].join('\n'), '围栏之后逐行不变');
eq(T.applyMapToNote(written, newRoots), written, '写回幂等');
const noFence = '# 标题\n\n一些文字\n';
const inserted = T.applyMapToNote(noFence, newRoots);
eq(inserted.indexOf('```smmap') > 0, true, '无围栏时新建块');
eq(inserted.indexOf('# 标题') >= 0, true, '原内容保留');
const fmOnly = ['---', 'title: X', '---', '', '正文'].join('\n');
const ins2 = T.applyMapToNote(fmOnly, newRoots);
eq(ins2.split('\n')[0], '---', '无围栏插入时 YAML 首行不被顶掉');
eq(ins2.split('\n')[2], '---', 'frontmatter 闭合行位置不变（索引 2）');
eq(ins2.indexOf('title: X') >= 0, true, '无围栏插入时 frontmatter 内容保留');
eq(T.applyMapToNote(ins2, newRoots), ins2, '插入后再次写回幂等');

/* ---- M3b additions: lib data -> our tree ---- */
const back = T.fromLibData({ data: { text: 'A' }, children: [{ data: { text: 'B' }, children: [] }] });
eq(back.text, 'A', 'fromLibData root');
eq(back.children.length, 1, 'fromLibData child count');
eq(back.children[0].text, 'B', 'fromLibData child text');
eq(T.fromLibData(null).text, '', 'fromLibData null safe');
const rt2 = T.toSingleRoot(T.parseOutline('- X\n  - Y').roots);
eq(JSON.stringify(T.fromLibData(T.toLibData(rt2))) === JSON.stringify(rt2), true, 'toLibData/fromLibData round trip');
/* ---- M3e additions: rich-text HTML stripping ---- */
eq(T.htmlToNodeText('<p>A</p>'), 'A', 'strip single p');
eq(T.htmlToNodeText('<p>A<br>B</p>'), 'A B', 'br becomes space');
eq(T.htmlToNodeText('<p><strong>A</strong> and <em>B</em></p>'), 'A and B', 'strip inline tags');
eq(T.htmlToNodeText('<p>a &amp; b</p>'), 'a & b', 'decode amp');
eq(T.htmlToNodeText('plain text'), 'plain text', 'plain text untouched');
eq(T.htmlToNodeText('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2', 'math symbols untouched');
eq(T.fromLibData({ data: { text: '<p>root</p>' }, children: [] }).text, 'root', 'fromLibData strips html');
process.exit(fail === 0 ? 0 : 1);
