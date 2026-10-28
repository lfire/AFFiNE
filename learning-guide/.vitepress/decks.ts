/**
 * 演示文稿（幻灯片）清单：供动态路由 `slides/[id].paths.mts` 与数据加载器 `decks.data.ts` 共用。
 * 仅在 Node 侧（构建期）运行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const guideRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const decksDir = path.join(guideRoot, 'slides', 'decks');

export interface DeckMeta {
  /** 两位章号，如 "05" */
  id: string;
  /** 章节标题（取自幻灯片封面的一级标题），如 "第 5 章 TypeScript 在 AFFiNE 中的应用" */
  title: string;
  /** 所属部分，如 "第 3 部分 · 编程语言与基础技术" */
  part: string;
  /** 横向幻灯片张数 */
  slides: number;
  /** 纵向子页张数 */
  subSlides: number;
  /** 对应章节文档的站内路径（不含 base），如 "/03-编程语言与基础技术/05-xxx.html" */
  docLink: string;
}

function findChapterDoc(id: string): { part: string; docLink: string } {
  for (const dir of fs.readdirSync(guideRoot).sort()) {
    if (!/^\d{2}-/.test(dir)) continue;
    const full = path.join(guideRoot, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    const file = fs.readdirSync(full).find(f => f.startsWith(`${id}-`) && f.endsWith('.md'));
    if (file) {
      const [num, ...rest] = dir.split('-');
      return {
        part: `第 ${Number(num)} 部分 · ${rest.join('-')}`,
        docLink: `/${dir}/${file.replace(/\.md$/, '.html')}`,
      };
    }
  }
  return { part: '', docLink: '/README.html' };
}

/** 统计分隔符：忽略代码块内部内容 */
function countSlides(raw: string): { slides: number; subSlides: number } {
  let inFence = false;
  let slides = 1;
  let subSlides = 0;
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trimEnd();
    if (text.startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    if (text === '---') slides++;
    else if (text === '--') subSlides++;
  }
  return { slides, subSlides };
}

export function readDeckRaw(id: string): string {
  return fs.readFileSync(path.join(decksDir, `${id}.md`), 'utf8');
}

export function listDecks(): DeckMeta[] {
  if (!fs.existsSync(decksDir)) return [];
  return fs
    .readdirSync(decksDir)
    .filter(f => /^\d{2}\.md$/.test(f))
    .sort()
    .map(file => {
      const id = file.slice(0, 2);
      const raw = readDeckRaw(id);
      const title = raw.match(/^#\s+(.+)$/m)?.[1].trim() ?? `第 ${Number(id)} 章`;
      return { id, title, ...findChapterDoc(id), ...countSlides(raw) };
    });
}
