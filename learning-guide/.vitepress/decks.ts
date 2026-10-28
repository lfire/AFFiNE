/**
 * 学习演示清单与构建期渲染：供动态路由 `slides/[id].paths.mts` 与数据加载器 `decks.data.ts` 共用。
 * 仅在 Node 侧（构建期）运行。
 *
 * 注意：这里使用**独立**的 markdown-it + shiki，不走 VitePress 的 createMarkdownRenderer。
 * 因为后者是全局单例（`if (md) return md`），在动态路由 paths() 阶段调用会污染文档页共用的渲染器，
 * 导致正文丢失 v-pre / Mermaid / 链接改写等配置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';
import { createHighlighter, type Highlighter } from 'shiki';

export const guideRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const decksDir = path.join(guideRoot, 'slides', 'decks');

export interface DeckMeta {
  id: string;
  title: string;
  part: string;
  scenes: number;
  docLink: string;
}

export type SceneKind = 'cover' | 'section' | 'content';

export interface Scene {
  kind: SceneKind;
  title: string;
  html: string;
  mermaid: string[];
}

const SEP = /^={3,}\s*$/;

const SHIKI_LANGS = [
  'ts', 'tsx', 'js', 'jsx', 'json', 'bash', 'shell', 'yaml', 'toml', 'rust',
  'sql', 'prisma', 'graphql', 'html', 'css', 'scss', 'vue', 'md', 'diff', 'text',
];

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

function splitScenes(raw: string): string[] {
  const scenes: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (!inFence && SEP.test(line)) {
      scenes.push(buf.join('\n').trim());
      buf = [];
    } else {
      buf.push(line);
    }
  }
  scenes.push(buf.join('\n').trim());
  return scenes.filter(Boolean);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 行内语法预处理（跳过代码围栏）：把 `代码` 与 **加粗** 预先转成 <code>/<strong>。
 * 原因有二：
 * 1. CommonMark 下 **紧贴中文全角标点（如 **“…”**）不构成强调，会原样显示；
 * 2. 写在 HTML 组件块（如 <ul class="takeaways"><li>…</li></ul>）内部的 Markdown 不会被解析。
 * 预转为 HTML 后，两种情况都能正确渲染，且在普通段落中与 Markdown 等价。
 */
function preprocessInline(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map(line => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const codes: string[] = [];
      // 先把行内代码保护起来，避免其内部的 ** 被误转
      let text = line.replace(/`([^`]+)`/g, (_m, code: string) => {
        codes.push(code);
        return `\uE000${codes.length - 1}\uE000`;
      });
      text = text.replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>');
      return text.replace(
        /\uE000(\d+)\uE000/g,
        (_m, i: string) => `<code>${escapeHtml(codes[Number(i)])}</code>`
      );
    })
    .join('\n');
}

function plainTitle(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_~]/g, '')
    .trim();
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
      return { id, title, ...findChapterDoc(id), scenes: splitScenes(raw).length };
    });
}

let mdPromise: Promise<MarkdownIt> | undefined;

async function getRenderer(): Promise<MarkdownIt> {
  mdPromise ??= (async () => {
    const highlighter: Highlighter = await createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: SHIKI_LANGS,
    });
    const md = new MarkdownIt({
      html: true,
      linkify: false,
      breaks: false,
      highlight(code, lang) {
        const language = SHIKI_LANGS.includes(lang) ? lang : 'text';
        return highlighter.codeToHtml(code, {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        });
      },
    });
    return md;
  })();
  return mdPromise;
}

function renderScene(md: MarkdownIt, raw: string): Scene {
  const mermaid: string[] = [];
  const withoutMermaid = raw.replace(/```mermaid[^\n]*\n([\s\S]*?)```/g, (_all, code: string) => {
    mermaid.push(code);
    return `\n<div class="deck-mermaid" data-index="${mermaid.length - 1}"></div>\n`;
  });

  let kind: SceneKind = 'content';
  let body = withoutMermaid;
  if (/^#\s+/.test(body.trimStart())) {
    kind = 'cover';
  } else if (/^<!--\s*section\s*-->/.test(body.trimStart())) {
    kind = 'section';
    body = body.replace(/^<!--\s*section\s*-->\s*/, '');
  }

  const headingMatch = body.match(/^#{1,2}\s+(.+)$/m);
  const title = headingMatch ? plainTitle(headingMatch[1]) : '';

  return { kind, title, html: md.render(preprocessInline(body)), mermaid };
}

export async function renderDeck(id: string): Promise<Scene[]> {
  const md = await getRenderer();
  return splitScenes(readDeckRaw(id)).map(raw => renderScene(md, raw));
}
