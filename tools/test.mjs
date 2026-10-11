/*
 * simple-mindmap · M0 断言
 * 只钉三件事：① vendor 文件就位且大小正确 ② onload 不加载库 ③ 懒加载只出现在 loadLibrary 里
 */
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require_ = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass += 1;
    // console.log('  ✓ ' + label);
  } else {
    fail += 1;
    console.log('  ✗ ' + label);
  }
}
function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) console.log('    实际：' + JSON.stringify(actual) + '  期望：' + JSON.stringify(expected));
  ok(same, label);
}

const SRC = readFileSync(join(ROOT, 'main.js'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

/* ---------- 1. manifest ---------- */
eq(MANIFEST.id, 'simple-mindmap', 'id = simple-mindmap');
eq(MANIFEST.name, 'Simple Mindmap', 'name = Simple Mindmap');
ok(!!MANIFEST.version && /^\d+\.\d+\.\d+$/.test(MANIFEST.version), 'version 形如 x.y.z');
ok(!!MANIFEST.minAppVersion, '有 minAppVersion');
const desc = String(MANIFEST.description || '');
ok(desc.length > 0 && desc.indexOf('\n') < 0 && (desc.match(/。/g) || []).length <= 1, 'description 是一句话');

/* ---------- 2. vendor 就位（体积即完整性校验） ---------- */
const VENDOR = [
  ['vendor/mind-map.cjs.js', 1609621],
  ['vendor/mind-map.esm.js', 1605792],
  ['vendor/mind-map.css', 24470],
  ['vendor/probe.js', null],
];
for (const [rel, size] of VENDOR) {
  let exists = false;
  let actual = 0;
  try {
    actual = statSync(join(ROOT, rel)).size;
    exists = true;
  } catch (e) {
    exists = false;
  }
  ok(exists, 'vendor 文件存在：' + rel);
  if (exists && size !== null) eq(actual, size, rel + ' 体积正确（' + size + ' B）');
}

/* ---------- 3. onload 里不得加载库 ---------- */
function methodBody(text, signature) {
  const i = text.indexOf(signature);
  if (i < 0) return '';
  let depth = 0;
  let started = false;
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j];
    if (ch === '{') {
      depth += 1;
      started = true;
    } else if (ch === '}') {
      depth -= 1;
      if (started && depth === 0) return text.slice(i, j + 1);
    }
  }
  return '';
}
const onloadBody = methodBody(SRC, 'async onload()');
ok(onloadBody.length > 100, '取到 onload 源码');
eq((SRC.match(/readFileSync\(/g) || []).length, 2, '全文件两处读盘（库 + 上游 CSS，都在懒加载函数里）');
ok(!/readFileSync/.test(onloadBody), 'onload 不读盘（沿用零启动成本纪律）');
ok(/const fn = new Function\('module'/.test(SRC), 'CJS 通过 new Function 在插件上下文执行');
ok(SRC.indexOf('function loadLibrary') < SRC.indexOf('async onload()'), '载库函数定义在 onload 之外（文件上方）');
ok(!/loadLibrary\(/.test(onloadBody), 'onload 不调用 loadLibrary');

/* ---------- 4. 懒加载只出现在 loadLibrary ---------- */
const libBody = methodBody(SRC.replace('function loadLibrary()', 'function loadLibrary() {'), 'function loadLibrary()');
ok(/fs\.readFileSync\(file/.test(SRC), 'vendor 用 fs.readFileSync 读取');
ok(/if \(libCache\) return libCache/.test(SRC), '懒加载有缓存判断');
ok(/new Function\(/.test(SRC), 'CJS 用 new Function 在插件上下文执行');
ok(/manifest\.dir/.test(SRC), '用 manifest.dir 定位插件目录');

/* ---------- 5. 运行期线索（离线能拿到的证据） ---------- */
try {
  const probe = require_(join(ROOT, 'vendor/probe.js'));
  ok(probe && probe.ok === true, 'probe.js 可被 require 且导出正常');
} catch (e) {
  ok(false, 'probe.js 可被 require（' + e.message + '）');
}
let libNote = '';
try {
  const lib = require_(join(ROOT, 'vendor/mind-map.edit.cjs.js'));
  const keys = Object.keys(lib || {});
  libNote = 'Node 下可 require，导出键 ' + keys.length + ' 个：' + keys.slice(0, 8).join(', ');
} catch (e) {
  libNote = 'Node 下 require 抛错（Obsidian 有 DOM，可能仍可用）：' + e.message;
}

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('[info] 上游库：' + libNote);
if (fail === 0) console.log('M0 骨架自检通过 ✓');
process.exit(fail === 0 ? 0 : 1);
