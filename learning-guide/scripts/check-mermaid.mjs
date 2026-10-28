#!/usr/bin/env node
/**
 * 校验 Markdown 文件中的 Mermaid 图语法，并检查幻灯片分隔符的使用是否安全。
 *
 * 用法：
 *   node scripts/check-mermaid.mjs                 # 校验全部章节文档与幻灯片
 *   node scripts/check-mermaid.mjs a.md b.md       # 只校验指定文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Window } from 'happy-dom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.vitepress', 'scripts'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      out.push(full);
    }
  }
  return out;
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map(f => path.resolve(f))
  : walk(root);

// mermaid 依赖 DOM 环境，这里用 happy-dom 模拟
const win = new Window();
globalThis.window = win;
globalThis.document = win.document;
globalThis.DOMParser = win.DOMParser;
globalThis.Element = win.Element;
globalThis.HTMLElement = win.HTMLElement;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
} catch {
  // 某些 Node 版本中 navigator 不可重定义，忽略即可
}

const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false });

let diagrams = 0;
const errors = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const isDeck = rel.startsWith(path.join('slides', 'decks'));

  const fence = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let match;
  while ((match = fence.exec(text))) {
    diagrams++;
    const line = text.slice(0, match.index).split('\n').length;
    try {
      await mermaid.parse(match[1]);
    } catch (error) {
      const message = String(error?.message ?? error)
        .split('\n')
        .slice(0, 3)
        .join(' | ');
      errors.push(`${rel}:${line}  Mermaid 语法错误：${message}`);
    }
  }

  if (isDeck) {
    // 幻灯片：代码块内部不允许出现单独成行的 --- / --，否则会被误切分
    let inFence = false;
    text.split('\n').forEach((raw, index) => {
      const lineText = raw.trimEnd();
      if (lineText.startsWith('```')) inFence = !inFence;
      if (inFence && (lineText === '---' || lineText === '--')) {
        errors.push(`${rel}:${index + 1}  代码块内出现分隔符 "${lineText}"`);
      }
    });
    if (inFence) errors.push(`${rel}  存在未闭合的代码块`);
    const h1 = text.match(/^# .+$/gm) ?? [];
    if (h1.length !== 1) {
      errors.push(`${rel}  一级标题应恰好 1 个（封面），实际 ${h1.length} 个`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n✗ 共 ${files.length} 个文件、${diagrams} 张图，发现 ${errors.length} 处问题`);
  process.exit(1);
}
console.log(`✓ 共 ${files.length} 个文件、${diagrams} 张 Mermaid 图，全部通过`);
