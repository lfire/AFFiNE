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

import { expandRefs } from './semantic-refs.mjs';

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
 * 估算行内代码的显示宽度（中日韩字符按两个西文字符算）。
 * 超过阈值的片段由样式层放开折行，短的则整块不拆行，中文段落里看起来更规整。
 */
const INLINE_CODE_WIDTH_LIMIT = 34;
const CJK = /[\u1100-\u11FF\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

function isLongInlineCode(text: string): boolean {
  let width = 0;
  for (const ch of text) width += CJK.test(ch) ? 2 : 1;
  return width > INLINE_CODE_WIDTH_LIMIT;
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
      return text.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => {
        const code = codes[Number(i)];
        const long = isLongInlineCode(code) ? ' data-long' : '';
        return `<code${long}>${escapeHtml(code)}</code>`;
      });
    })
    .join('\n');
}

/**
 * 去掉“独占一行的闭合标签”的缩进（跳过代码围栏）。
 *
 * 富组件的写法是：`<div class="compare__col">` 里放一个 Markdown 列表，末尾再写 `  </div>`。
 * 列表项 `- ` 的内容缩进正好是 2 格，缩进了的 `  </div>` 会被 markdown-it 当成列表项续行，
 * 于是列表不闭合、`</ul>` 被推到下一栏，出现「左栏没圆点、右栏有圆点，两栏缩进不一致」的错版。
 * 闭合标签顶格写即可让列表正常结束，对 HTML 本身没有影响。
 */
function dedentClosingTags(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map(line => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return /^\s+(<\/(?:div|section|ul|ol|li|aside|figure)>)\s*$/.exec(line)?.[1] ?? line;
    })
    .join('\n');
}

/**
 * 去掉标题里的 Markdown 记号，用于左侧目录与底部标题。
 * 注意不要把下划线一起删掉：目录里大量 snake_case（如 pull_request_target）会被读成
 * 连在一起的一串字母，反而看不懂。
 */
function plainTitle(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*~]/g, '')
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
        const html = highlighter.codeToHtml(code, {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        });
        // 把语言写进 data-lang，播放器据此显示语言标签
        return html.replace(/^<pre/, `<pre data-lang="${language}"`);
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

  return {
    kind,
    title,
    html: md.render(
      // 语义引用（L2）必须在行内语法预处理之前展开：
      // 页面挂在 /slides/NN.html，链接要按「../部分/章节.html」重写。
      preprocessInline(dedentClosingTags(expandRefs(body, { context: 'deck' })))
    ),
    mermaid,
  };
}

export async function renderDeck(id: string): Promise<Scene[]> {
  const md = await getRenderer();
  return splitScenes(readDeckRaw(id)).map(raw => renderScene(md, raw));
}
