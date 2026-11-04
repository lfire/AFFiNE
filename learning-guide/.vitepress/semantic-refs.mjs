/**
 * 语义引用（L2）的构建期展开。
 *
 * 源文件里的写法是**普通链接**，只是在 URL 片段里带一个稳定的语义标记：
 *
 *   <a href="./09-TypeScript在AFFiNE中的应用.md#ch-9">第 9 章</a>
 *   <a href="../03-编程语言与基础技术/09-TypeScript在AFFiNE中的应用.md#sec-9-1">9.1 节</a>
 *   [第 9 章](./09-TypeScript在AFFiNE中的应用.md#ch-9)      ← 等价的 Markdown 写法
 *
 * 语义标记：
 *   #ch-N           章引用
 *   #sec-N-M[-K]    第 N 章的第 M 个小节（及其第 K 个子小节）
 * 其中 N 只是可读的兜底，真正的目标由 href 指向的 `NN-章节.md` 文件确定。
 *
 * 为什么用「真实 .md 链接 + 片段标记」，而不是 `@ch:09` 自定义协议：
 *   后者会让 982 处引用在 GitHub 上全部变成死链；前者在 GitHub / IDE 里直接就能点开。
 * 为什么用内联 <a> 而不是 Markdown 链接：
 *   文档里大量引用位于 `<p class="custom-block-title">…</p>`、`<div class="takeaways">…</div>`
 *   这类 HTML 块内部，markdown-it 不解析其中的 Markdown 语法；内联 <a> 在任何上下文都有效。
 *
 * 关键实现点：在 markdown-it **解析源码之前**改写 `state.src`，而不是在 token 层做规则，
 * 这样普通段落、列表、表格、HTML 块里的引用都能被统一处理。
 *
 * 消费者：
 *   - config.mts              md.core.ruler.after('normalize', …) 改写 state.src
 *   - decks.ts                在 preprocessInline() 之前调用 expandRefs()
 *   - scripts/numbering.mjs   --check 校验标记是否都能解析
 */
import path from 'node:path';

import { loadOutline } from './outline.mjs';

const MARKER = 'ch-\\d{1,2}|sec-\\d{1,2}-\\d{1,2}(?:-\\d{1,2})?';
/** 两种等价写法：Markdown 链接 / 内联 <a>（组 1-3 与 4-6 分别对应） */
export const LINK_WITH_MARKER = new RegExp(
  `\\[([^\\]\\n]*)\\]\\(([^)\\s]+?)#(${MARKER})\\)|<a\\s+href="([^"]+?)#(${MARKER})"[^>]*>([^<]*)</a>`,
  'g'
);
const INLINE_CODE = /`[^`\n]*`/g;
const HEADING = /^\s*#{1,6}\s/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * 代码围栏状态机。
 *
 * 不能用简单的「见到 ``` 就翻转」：第 5 章里有一段用 ````` 嵌套演示 Markdown 的示例，
 * 围栏标记数量是奇数但结构是配对的，简单翻转会让后半章整段被误判成代码，引用全部漏改。
 * 这里按 CommonMark 规则记录开启标记（` 或 ~、长度），只有同类型且更长的空 info 行才闭合。
 *
 * @returns {{feed(line: string): boolean, inside: boolean}}
 */
export function makeFenceTracker() {
  let opener = null;
  return {
    get inside() {
      return opener !== null;
    },
    /** @returns 该行是否是围栏行（围栏行本身不应被改写） */
    feed(line) {
      const m = FENCE_LINE.exec(line);
      if (!m) return false;
      const [, marker, rest] = m;
      const ch = marker[0];
      const len = marker.length;
      if (opener) {
        if (ch === opener.ch && len >= opener.len && rest.trim() === '') opener = null;
        return true;
      }
      // 反引号围栏的 info 里不能再出现反引号，否则不是合法的开启行
      if (ch === '`' && rest.includes('`')) return false;
      opener = { ch, len };
      return true;
    },
  };
}

/** 从 URL 路径里读出章节号（文件名 NN- 前缀），比片段里的数字更可信 */
function chapterNoFromHref(href) {
  const base = path.posix.basename(href.split('#')[0].split('?')[0]);
  const m = base.match(/^(\d{1,2})-/);
  return m ? Number(m[1]) : null;
}

/** 把相对路径补成浏览器可解析的形式（不带前导 / 时需要 ./） */
function toRelativeHref(fromDir, targetRel) {
  let rel = path.posix.relative(fromDir, targetRel).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 解析一条引用，返回 { ch, label, href }；无法解析返回 null */
export function resolveRef(href, marker, { context, fromDir, outline }) {
  const parts = marker.split('-');
  const markerNo = Number(parts[1]);
  const no = chapterNoFromHref(href) ?? markerNo;
  const ch = outline.chapter(no) ?? outline.chapter(markerNo);
  if (!ch) return null;

  const label =
    parts[0] === 'ch'
      ? `第 ${ch.no} 章`
      : `${ch.no}.${parts[2]}${parts[3] ? `.${parts[3]}` : ''} 节`;

  const target = ch.relPath.replace(/\.md$/, '.html');
  const finalHref =
    context === 'deck' ? `../${target}` : toRelativeHref(fromDir, target);

  // #sec-* 对应 stableSectionIds() 注入的稳定锚点；#ch-* 只是章引用的标记，
  // 页面顶部没有对应 id，输出时去掉，避免留下一个永远跳不到的片段。
  const hash = parts[0] === 'sec' ? `#${marker}` : '';
  return { ch, label, href: `${finalHref}${hash}` };
}

/**
 * 展开一份 Markdown 源码中的语义引用。
 *
 * @param {string} src 原始 Markdown
 * @param {{context?: 'doc'|'deck', relativePath?: string, outline?: ReturnType<typeof loadOutline>}} [options]
 * @returns {string}
 */
export function expandRefs(src, { context = 'doc', relativePath = '', outline = loadOutline() } = {}) {
  const fromDir = context === 'doc' ? path.posix.dirname(relativePath) : '';
  const fence = makeFenceTracker();

  return src
    .split('\n')
    .map(line => {
      if (fence.feed(line) || fence.inside || HEADING.test(line)) return line;

      // 行内代码里的括号/标记不参与展开
      const codes = [];
      let text = line.replace(INLINE_CODE, m => {
        codes.push(m);
        return `\uE001${codes.length - 1}\uE001`;
      });

      text = text.replace(LINK_WITH_MARKER, (all, _mdLabel, mdHref, mdMarker, aHref, aMarker) => {
        const href = mdHref ?? aHref;
        const marker = mdMarker ?? aMarker;
        const resolved = resolveRef(href, marker, { context, fromDir, outline });
        if (!resolved) return all; // 未解析：原样保留，由 --check 报错
        return `<a href="${escapeAttr(resolved.href)}">${escapeText(resolved.label)}</a>`;
      });

      return text.replace(/\uE001(\d+)\uE001/g, (_m, i) => codes[Number(i)]);
    })
    .join('\n');
}

/** 给带编号的标题注入稳定锚点 id，让 #sec-N-M[-K] 能真正跳到对应小节 */
export function stableSectionIds(md) {
  md.core.ruler.push('stable-section-ids', state => {
    for (let i = 0; i < state.tokens.length - 1; i++) {
      const open = state.tokens[i];
      if (open.type !== 'heading_open') continue;
      const inline = state.tokens[i + 1];
      if (!inline?.children) continue;
      const text = inline.children
        .filter(t => t.type === 'text' || t.type === 'code_inline')
        .map(t => t.content)
        .join('')
        .trim();
      const m = text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?\s/);
      if (!m) continue;
      open.attrSet('id', `sec-${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''}`);
    }
  });
}

/**
 * 供 --check 使用：列出源码里所有无法解析、指向错误文件、或指向不存在小节的语义标记。
 *
 * @param {string} src
 * @param {ReturnType<typeof loadOutline>} [outline]
 * @param {Map<number, Set<string>> | null} [validSections]
 *        每章实际存在的规范小节号（`N.M` / `N.M.K`）。传入时额外校验 #sec-* 是否指向真实标题，
 *        这样插入 / 删除小节后残留的旧编号引用会被 CI 拦下，而不是变成跳不到的死锚点。
 */
export function findBrokenRefs(src, outline = loadOutline(), validSections = null) {
  const broken = [];
  const re = new RegExp(LINK_WITH_MARKER.source, 'g');
  const fence = makeFenceTracker();
  src.split('\n').forEach((line, i) => {
    if (fence.feed(line) || fence.inside) return;
    // 与 expandRefs() 保持一致：行内代码里的写法示例不参与展开，也不该被当成坏引用。
    // DEPLOY.md 就用 `<a href="…#ch-9">…</a>` 这种行内代码演示语义引用的写法。
    const clean = line.replace(INLINE_CODE, '');
    re.lastIndex = 0;
    for (const m of clean.matchAll(re)) {
      const href = m[2] ?? m[4];
      const marker = m[3] ?? m[5];
      const parts = marker.split('-');
      const no = chapterNoFromHref(href) ?? Number(parts[1]);
      const ch = outline.chapter(no);
      if (!ch) {
        broken.push({ line: i + 1, marker, href });
        continue;
      }
      const target = href.split('#')[0].split('?')[0];
      if (!target.endsWith(path.posix.basename(ch.relPath))) {
        broken.push({ line: i + 1, marker, href, expect: ch.relPath });
        continue;
      }
      if (parts[0] === 'sec' && validSections) {
        const label = `${ch.no}.${parts[2]}${parts[3] ? `.${parts[3]}` : ''}`;
        if (!validSections.get(ch.no)?.has(label)) {
          broken.push({
            line: i + 1,
            marker,
            href,
            reason: `第 ${ch.no} 章没有 ${label} 节（可能是编号重排后遗留的旧引用）`,
          });
        }
      }
    }
  });
  return broken;
}
