/*
 * 真数据冒烟：扫描某个目录下所有 .md，找出 smmap 代码块，逐块校验
 *   ① 能解析出大纲  ② render(parse(x)) 与 x 逐字节一致  ③ 样式段原样取出
 * 用法： node tools/smoke-smmap.mjs <目录或文件…>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = readFileSync(join(ROOT, 'main.js'), 'utf8');

/* 用桩载入 main.js，取 __test 纯函数 */
const obsidianStub = {
  Plugin: class {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest || { dir: '.obsidian/plugins/simple-mindmap' };
    }
    addCommand() {}
    registerMarkdownCodeBlockProcessor() {}
  },
  Notice: function Notice() {},
  Modal: class {
    constructor() {
      this.contentEl = { empty() {}, createDiv: () => ({ style: {}, createDiv: () => ({}) }) };
    }
  },
};
const moduleStub = { exports: {} };
const fakeRequire = (name) => {
  if (name === 'obsidian') return obsidianStub;
  throw new Error('unexpected require: ' + name);
};
new Function('module', 'exports', 'require', SRC + '\n//# sourceURL=main.js')(moduleStub, moduleStub.exports, fakeRequire);
const T = moduleStub.exports.__test;

const targets = process.argv.slice(2);
if (!targets.length) {
  console.log('用法: node tools/smoke-smmap.mjs <目录或文件…>');
  process.exit(2);
}

function collect(target, out) {
  let st;
  try {
    st = statSync(target);
  } catch (e) {
    return;
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(target)) {
      if (name === '.git' || name === 'node_modules') continue;
      collect(join(target, name), out);
    }
  } else if (extname(target).toLowerCase() === '.md') {
    out.push(target);
  }
}

const files = [];
for (const t of targets) collect(t, files);

let blocks = 0;
let okBlocks = 0;
let badBlocks = 0;
const filesWithBlocks = [];

for (const f of files) {
  let text = '';
  try {
    text = readFileSync(f, 'utf8');
  } catch (e) {
    continue;
  }
  const fences = T.findSmmapFences(text).filter((x) => x.lang === 'smmap');
  if (!fences.length) continue;
  filesWithBlocks.push(f);
  for (const fence of fences) {
    blocks += 1;
    const parsed = T.parseSmmapBlock(fence.source);
    const rendered = T.renderSmmapBlock(parsed.roots, parsed.style);
    const inOut = rendered.replace(/\n$/, '') === fence.source.replace(/\n$/, '');
    if (parsed.roots.length && !parsed.errors.length && inOut) {
      okBlocks += 1;
    } else {
      badBlocks += 1;
      console.log('  [FAIL] ' + f + ' 行 ' + (fence.startLine + 1));
      console.log('         roots=' + parsed.roots.length + ' errors=' + parsed.errors.length + ' roundtrip=' + inOut);
      if (parsed.errors.length) console.log('         ' + JSON.stringify(parsed.errors.slice(0, 3)));
    }
  }
}

console.log('扫描 ' + files.length + ' 个 md，其中 ' + filesWithBlocks.length + ' 个含 smmap 块');
console.log('共 ' + blocks + ' 个块：通过 ' + okBlocks + ' · 失败 ' + badBlocks);
if (filesWithBlocks.length) console.log('含块文件示例：' + filesWithBlocks.slice(0, 5).join(' | '));
if (!blocks) {
  console.log('（没有找到 smmap 块 —— 先用「插入 smmap 导图块」命令建一个）');
}
process.exit(badBlocks === 0 ? 0 : 1);
