/**
 * 把 vite build 的产物内联成**单文件** standalone.html
 * —— 双击即可在浏览器打开，无需本地服务器、无需联网。
 *
 * 用法：npm run standalone
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

const htmlPath = path.join(dist, 'index.html');
if (!fs.existsSync(htmlPath)) {
  console.error('[standalone] 找不到 dist/index.html，请先运行 vite build');
  process.exit(1);
}

let html = fs.readFileSync(htmlPath, 'utf8');

// 1) 内联 CSS：<link rel="stylesheet" href="./assets/xxx.css">
html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const m = tag.match(/href=["']([^"']+)["']/i);
  if (!m) return tag;
  const file = path.join(dist, m[1].replace(/^\.\//, ''));
  const css = readIfExists(file);
  if (css === null) {
    console.warn('[standalone] 未找到样式文件：', m[1]);
    return '';
  }
  console.log('[standalone] 内联 CSS:', m[1], `${(css.length / 1024).toFixed(1)} KB`);
  return `<style>\n${css}\n</style>`;
});

// 2) 内联 JS：入口 <script src="./assets/three-body.js">
//    注意：必须放到 </body> 之前。原始产物是 type="module"（天然 defer），
//    内联成普通 <script> 后若留在 <head> 会先于 DOM 执行，
//    导致 document.getElementById('scene-root') 拿到 null。
let inlinedScript = '';
html = html.replace(/<script[^>]+src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
  const file = path.join(dist, src.replace(/^\.\//, ''));
  const js = readIfExists(file);
  if (js === null) {
    console.warn('[standalone] 未找到脚本文件：', src);
    return tag;
  }
  console.log('[standalone] 内联 JS :', src, `${(js.length / 1024).toFixed(1)} KB`);
  // IIFE 包体里若出现 </script> 字面量会提前闭合标签
  const safe = js.replace(/<\/script>/gi, '<\\/script>');
  inlinedScript += `<script>\n${safe}\n</script>\n`;
  return '';
});

// 3) 清掉模块预加载等无用标签
html = html.replace(/<link[^>]+rel=["']modulepreload["'][^>]*>/gi, '');

// 4) 把脚本插到 </body> 之前（等效于 module 的 defer 语义）
//
//    注意：**必须用函数式替换**。若传字符串，替换串里的 `$&` 会被
//    String.replace 解释成「整个匹配项」——而 three.js 压缩产物里恰好含有
//    `$&&u(_.transmissionMap.channel)` 这样的代码，会被替换成 `</body>&...`，
//    直接导致脚本语法错误。
if (inlinedScript) {
  html = html.includes('</body>')
    ? html.replace('</body>', () => `${inlinedScript}</body>`)
    : html + inlinedScript;
}

// 5) 加一行单文件标记
html = html.replace(
  /<title>([^<]*)<\/title>/,
  '<title>$1 · 单文件版</title>\n    <!-- 本文件由 scripts/build-standalone.js 自动生成，请勿手工编辑 -->'
);

const out = path.join(root, 'standalone.html');
fs.writeFileSync(out, html, 'utf8');

const size = fs.statSync(out).size;
console.log(`[standalone] 已生成 ${path.relative(root, out)}  ${(size / 1024 / 1024).toFixed(2)} MB`);
