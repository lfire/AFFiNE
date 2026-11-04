/**
 * 章节编号的单一真相源读取器。
 *
 * 不保存任何编号数据：顺序完全由 `NN-部分名/NN-章节.md` 的目录与文件名推导。
 * 因此插入、删除、交换章节后，只要文件名正确，所有编号自动跟着变。
 *
 * 消费者：
 *   - config.mts          侧边栏、语义引用展开
 *   - decks.ts            演示里的语义引用展开
 *   - scripts/numbering.mjs  编号一致性校验与批量重排
 *
 * 这是 .mjs 而非 .ts，因为 scripts/ 下的 Node 脚本也要用；类型见 outline.d.mts。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const guideRootPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const PART_RE = /^(\d{2})-(.+)$/;
const CHAPTER_RE = /^(\d{2})-(.+)\.md$/;

/** 读取一级标题，去掉「第 N 章 」前缀与反引号 */
function readChapterTitle(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^#\s+第\s*\d+\s*章\s+(.+)$/m);
  return match ? match[1].trim() : path.basename(file, '.md').slice(3);
}

/** 每次调用都重新扫描磁盘，保证 dev server 与脚本拿到的是最新顺序 */
export function loadOutline() {
  const parts = fs
    .readdirSync(guideRootPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && PART_RE.test(d.name))
    .map(d => ({
      no: Number(d.name.slice(0, 2)),
      dir: d.name,
      name: d.name.slice(3),
    }))
    .sort((a, b) => a.no - b.no);

  const chapters = [];
  for (const part of parts) {
    const files = fs
      .readdirSync(path.join(guideRootPath, part.dir))
      .filter(f => CHAPTER_RE.test(f))
      .sort();
    for (const file of files) {
      const no = Number(file.slice(0, 2));
      const abs = path.join(guideRootPath, part.dir, file);
      chapters.push({
        no,
        part: part.no,
        partName: part.name,
        partDir: part.dir,
        title: readChapterTitle(abs),
        file: abs,
        relPath: `${part.dir}/${file}`,
        pagePath: `/${part.dir}/${file.replace(/\.md$/, '')}`,
        deckId: String(no).padStart(2, '0'),
      });
    }
  }
  chapters.sort((a, b) => a.no - b.no);

  const byNo = new Map(chapters.map(c => [c.no, c]));
  return {
    parts,
    chapters,
    byNo,
    chapter: n => byNo.get(Number(n)),
    prev: n => byNo.get(Number(n) - 1),
    next: n => byNo.get(Number(n) + 1),
    partChapters: p => chapters.filter(c => c.part === Number(p)),
  };
}

/** 语义引用的目标文本：`第 9 章 TypeScript 在 AFFiNE 中的应用` */
export function chapterLabel(outline, n, { withTitle = false } = {}) {
  const c = outline.chapter(n);
  if (!c) return null;
  return withTitle ? `第 ${c.no} 章 ${c.title.replace(/`/g, '')}` : `第 ${c.no} 章`;
}

/** 章节页相对链接的基准目录（用于给语义引用生成 href） */
export function chapterHref(outline, n) {
  const c = outline.chapter(n);
  return c ? `${c.pagePath}.html` : null;
}
