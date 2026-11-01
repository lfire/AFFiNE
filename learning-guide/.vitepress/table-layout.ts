/**
 * 表格列宽自适应（构建期）
 *
 * 浏览器的自动表格布局会让"含长路径/长代码"的列吃掉全部宽度，其余列被压到最小内容宽度，
 * 中文按单字换行，出现"一行一个字"的竖排。这里在 markdown-it 阶段估算每列内容宽度：
 *
 * - 短列（最长单元格不超过阈值）整列不换行，如"编号""指标""结论"；
 * - 长列给一个合理的最小宽度；表格拥挤时，按各列平均文字量分配宽度，文字多的列分得多；
 * - 长行内代码只在分隔符、驼峰边界处断行（插入 wbr），不再以"整条路径"撑开列宽；
 *   短行内代码整体不断行，避免 `@affine-` / `test/kit` 这种断法；
 * - 单元格里"、"分隔的多段代码之间补一个断行机会（浏览器不会在 `、/` 之间断行）。
 *
 * 宽度单位为 px，按正文 14px、表格内行内代码约 12px 等宽字体粗略估算，只用于分档，不追求精确。
 */

interface Token {
  type: string;
  tag: string;
  content: string;
  children: Token[] | null;
  meta: Record<string, unknown> | null;
  attrJoin(name: string, value: string): void;
  attrSet(name: string, value: string): void;
}

interface MarkdownItLike {
  core: { ruler: { push(name: string, fn: (state: { tokens: Token[] }) => void): void } };
  utils: { escapeHtml(text: string): string };
  renderer: {
    rules: Record<string, ((...args: any[]) => string) | undefined>;
  };
}

/** 整列不换行的阈值：约 12 个汉字；5 列及以上的表收紧到约 8 个汉字 */
const NOWRAP_MAX_FEW_COLS = 168;
const NOWRAP_MAX_MANY_COLS = 112;
/** 行内代码不超过这个字符数时整体不断行 */
const CODE_NOWRAP_CHARS = 16;
/** 超过这个长度的标识符允许在驼峰边界断行（与短代码阈值一致） */
const CAMEL_BREAK_CHARS = 16;
/** 正文里超过这个长度、含 `/` 的英文串允许在 `/` 后断行 */
const TEXT_SLASH_BREAK_CHARS = 12;
/** 长列最小宽度：约 8～9 个汉字；列多时约 7 个 */
const WRAP_MIN_FEW_COLS = 120;
const WRAP_MIN_MANY_COLS = 96;
/** 超出预算时长列最小宽度可压缩到的下限：约 5 个汉字 */
const WRAP_MIN_FLOOR = 72;
/** 不可断片段撑开最小宽度的上限 */
const UNBREAKABLE_CAP = 220;
/** 桌面端正文区宽度（VitePress 有大纲栏时为 688px） */
const DESKTOP_CONTENT_WIDTH = 688;
/** 列宽分配预算：正文宽度留出估算误差 */
const CONTENT_BUDGET = 660;
/** 单元格左右内边距之和，与 custom.css 中的 padding 保持一致 */
const CELL_PADDING_X = 24;

/** 按全角宽度计的字符：中日韩文字与标点、全角符号、箭头/星号等符号、emoji */
const WIDE = /[\u2190-\u2BFF\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\uAC00-\uD7AF\u{1F000}-\u{1FAFF}]/u;
/** 文本中可在其前后断行的字符 */
const TEXT_BREAKABLE = /[\s\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]+/;
const CODE_CHAR_PX = 7.3;
const CODE_PADDING_PX = 12;
/** 代码断行标记：先插在原始内容里，转义后再换成 wbr */
const MARK = '\u0001';

function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += WIDE.test(ch) ? 14 : ch === ' ' ? 4 : 7.4;
  return w;
}

/**
 * 给表格正文标出额外的断行位置：
 * - 较长英文串里的 `/` 之后（`docSync/blobSync/indexerSync`、`packages/frontend/core/src/`）；
 * - `、` `，` `；` 之后（浏览器不会在 `、/collection` 这类组合中间断行）。
 */
function markTextBreaks(text: string): string {
  return text
    .replace(/[^\s\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]+/g, run =>
      run.length > TEXT_SLASH_BREAK_CHARS ? run.replace(/(?<=\/)(?=.)/g, MARK) : run
    )
    .replace(/(?<=[、，；])(?=.)/g, MARK);
}

/** 文本里最长的不可断片段：连续的非中文、非空白字符（已考虑 markTextBreaks 的断行位置） */
function textUnbreakable(text: string): number {
  let max = 0;
  for (const word of markTextBreaks(text).split(new RegExp(`${MARK}|${TEXT_BREAKABLE.source}`))) {
    max = Math.max(max, textWidth(word));
  }
  return max;
}

/**
 * 给长行内代码标出断行位置：
 * - `/` `_` `-` `,` `、` `(` `{` 之后，`=` 之后（`=>` `==` 除外），`:` 之前；
 * - `.` 之后，但扩展名（`.ts` `.tsx` `.json`）不断；
 * - 超过 CAMEL_BREAK_CHARS 的标识符在驼峰边界断。
 */
function markCodeBreaks(code: string): string {
  // `.` 规则要在驼峰规则之前，否则驼峰处插入的标记会让 `.getEngine` 被误判为扩展名 `.get`
  return code
    .replace(/(?<=\.)(?![a-z]{1,4}\b)(?=[A-Za-z_$])/g, MARK)
    .replace(/[A-Za-z0-9$]{17,}/g, word =>
      word.length > CAMEL_BREAK_CHARS ? word.replace(/(?<=[a-z0-9])(?=[A-Z])/g, MARK) : word
    )
    .replace(/(?<=[/_\-,、({])(?=.)/g, MARK)
    .replace(/(?<==)(?![=>\s])(?=.)/g, MARK)
    .replace(/(?<=.)(?=:)/g, MARK);
}

function codeUnbreakable(code: string): number {
  let max = 0;
  for (const seg of markCodeBreaks(code).split(new RegExp(`${MARK}|\\s+|(?<=[\\u2E80-\\u9FFF])`))) {
    max = Math.max(max, seg.length);
  }
  return max * CODE_CHAR_PX + CODE_PADDING_PX;
}

interface CellMetric {
  /** 单行排完所需宽度（多行时取最长一行） */
  width: number;
  /** 最长的不可断片段宽度 */
  unbreakable: number;
}

function measureCell(inline: Token | undefined): CellMetric {
  const children = inline?.children ?? [];
  let line = 0;
  let width = 0;
  let unbreakable = 0;
  children.forEach((child, k) => {
    if (child.type === 'text') {
      line += textWidth(child.content);
      unbreakable = Math.max(unbreakable, textUnbreakable(child.content));
      if (markTextBreaks(child.content) !== child.content) {
        child.meta = { ...child.meta, tableTextBreaks: true };
      }
    } else if (child.type === 'code_inline') {
      const w = child.content.length * CODE_CHAR_PX + CODE_PADDING_PX;
      line += w;
      const meta: Record<string, unknown> = { ...child.meta, inTable: true };
      if (child.content.length <= CODE_NOWRAP_CHARS) {
        meta.tableNowrap = true;
        unbreakable = Math.max(unbreakable, w);
      } else {
        meta.tableBreakable = true;
        unbreakable = Math.max(unbreakable, codeUnbreakable(child.content));
      }
      // 前面是分隔标点（、，；/ 等）时补一个断行机会，否则 `a`、`/b` 会粘成一整段
      const prev = children[k - 1];
      if (prev?.type === 'text' && /[、，；,;／/|]\s*$/.test(prev.content)) meta.breakBefore = true;
      child.meta = meta;
    } else if (
      child.type === 'softbreak' ||
      child.type === 'hardbreak' ||
      (child.type === 'html_inline' && /^<br\s*\/?>$/i.test(child.content))
    ) {
      width = Math.max(width, line);
      line = 0;
    }
  });
  return { width: Math.max(width, line), unbreakable };
}

type Cell = { open: Token; metric: CellMetric; header: boolean };

function layoutTable(tokens: Token[], start: number): number {
  // 收集本表的单元格：[行][列]
  const rows: Cell[][] = [];
  let i = start + 1;
  for (; i < tokens.length && tokens[i].type !== 'table_close'; i++) {
    const t = tokens[i];
    if (t.type === 'tr_open') rows.push([]);
    if (t.type === 'th_open' || t.type === 'td_open') {
      const inline = tokens[i + 1]?.type === 'inline' ? tokens[i + 1] : undefined;
      rows[rows.length - 1]?.push({ open: t, metric: measureCell(inline), header: t.type === 'th_open' });
    }
  }
  const colCount = Math.max(0, ...rows.map(r => r.length));
  if (colCount < 2) return i;

  const many = colCount >= 5;
  const nowrapMax = many ? NOWRAP_MAX_MANY_COLS : NOWRAP_MAX_FEW_COLS;
  const wrapMin = many ? WRAP_MIN_MANY_COLS : WRAP_MIN_FEW_COLS;

  // 第一遍：分档。短列整列不换行；长列算出最小宽度、单行宽度和平均文字量
  let fixed = 0;
  const wrapCols: { head?: Cell; min: number; floor: number; max: number; avg: number }[] = [];
  for (let c = 0; c < colCount; c++) {
    const cells = rows.map(r => r[c]).filter(Boolean);
    const body = cells.filter(cell => !cell.header);
    const head = cells.find(cell => cell.header);
    const colWidth = Math.max(0, ...cells.map(cell => cell.metric.width));
    const colUnbreakable = Math.max(0, ...cells.map(cell => cell.metric.unbreakable));

    if (colWidth <= nowrapMax) {
      for (const cell of cells) cell.open.attrJoin('class', 'tc-nw');
      fixed += colWidth + CELL_PADDING_X;
      continue;
    }
    // 表头较短时不拆行
    const headNowrap = !!head && head.metric.width <= nowrapMax;
    if (headNowrap) head.open.attrJoin('class', 'tc-nw');
    const bodyWidth = Math.max(0, ...body.map(cell => cell.metric.width));
    const floor = Math.min(Math.max(colUnbreakable, headNowrap ? head.metric.width : 0), UNBREAKABLE_CAP);
    const avg = body.length
      ? body.reduce((s, cell) => s + cell.metric.width, 0) / body.length
      : colWidth;
    wrapCols.push({
      head,
      min: Math.max(Math.min(bodyWidth, wrapMin), floor),
      floor,
      max: Math.max(bodyWidth, floor),
      avg,
    });
  }
  if (!wrapCols.length) return i;

  // 第二遍：在正文宽度内分配长列宽度
  const room = CONTENT_BUDGET - fixed - wrapCols.length * CELL_PADDING_X;
  const minTotal = wrapCols.reduce((s, col) => s + col.min, 0);
  const maxTotal = wrapCols.reduce((s, col) => s + col.max, 0);
  let widths: number[];

  if (maxTotal <= room) {
    // 不拥挤：各列都能单行排下，交给浏览器自然布局，只兜底最小宽度
    widths = wrapCols.map(col => col.min);
  } else if (minTotal >= room) {
    // 连最小宽度都放不下：按比例压缩（不低于不可断片段和下限），剩下的交给横向滚动
    const factor = Math.max(room, 0) / minTotal;
    widths = wrapCols.map(col =>
      Math.max(col.min * factor, col.floor, Math.min(col.min, WRAP_MIN_FLOOR))
    );
  } else {
    // 拥挤但放得下：先满足最小宽度，剩余宽度按平均文字量分配，单列不超过它单行排完的宽度
    widths = wrapCols.map(col => col.min);
    let extra = room - minTotal;
    for (let round = 0; round < 4 && extra > 1; round++) {
      const open = wrapCols.map((col, k) => (widths[k] < col.max ? col.avg : 0));
      const weight = open.reduce((s, w) => s + w, 0);
      if (!weight) break;
      let used = 0;
      wrapCols.forEach((col, k) => {
        if (!open[k]) return;
        const add = Math.min((extra * open[k]) / weight, col.max - widths[k]);
        widths[k] += add;
        used += add;
      });
      extra -= used;
    }
  }

  // 以上按桌面端正文宽度算出。正文变窄时（中等屏幕约 560～624px），长列按可用宽度等比缩小：
  // 表格是 inline-size 容器，100cqw 即表格宽度；扣掉不换行列和内边距后按比例分给各长列。
  // 第一个 min-width 是不支持容器单位时的回退。
  const fixedPart = DESKTOP_CONTENT_WIDTH - room;
  wrapCols.forEach((col, k) => {
    const px = Math.floor(widths[k]);
    const lo = Math.min(px, WRAP_MIN_FLOOR);
    const style =
      room > 0
        ? `min-width:${px}px;min-width:clamp(${lo}px, (100cqw - ${fixedPart}px) * ${(px / room).toFixed(4)}, ${px}px)`
        : `min-width:${px}px`;
    // 自动表格布局下，列的最小宽度取该列所有单元格 min-width 的最大值，设在表头上即可
    col.head?.open.attrSet('style', style);
  });
  return i;
}

export function tableLayoutPlugin(md: MarkdownItLike) {
  md.core.ruler.push('table-column-layout', state => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'table_open') i = layoutTable(tokens, i);
    }
  });

  // 表格正文：在标出的位置插入 wbr（只处理带标记的 text token，其余走原渲染）
  const text = md.renderer.rules.text;
  md.renderer.rules.text = (tokens: Token[], idx: number, ...rest: unknown[]) => {
    const token = tokens[idx];
    if (token.meta?.tableTextBreaks) {
      return md.utils.escapeHtml(markTextBreaks(token.content)).replaceAll(MARK, '<wbr>');
    }
    return text ? text(tokens, idx, ...rest) : md.utils.escapeHtml(token.content);
  };

  // 行内代码：短的整体不断行，长的只在标出的位置断行
  // 已有规则（含 config.mts 里加 v-pre 的那层）优先；没有时退回 markdown-it 的默认输出
  const prevCodeInline = md.renderer.rules.code_inline;
  const codeInline = (tokens: Token[], idx: number, ...rest: unknown[]): string =>
    prevCodeInline
      ? prevCodeInline(tokens, idx, ...rest)
      : `<code>${md.utils.escapeHtml(tokens[idx].content)}</code>`;
  md.renderer.rules.code_inline = (tokens: Token[], idx: number, ...rest: unknown[]) => {
    const token = tokens[idx];
    const meta = token.meta;
    if (!meta?.inTable) return codeInline(tokens, idx, ...rest);

    let html: string;
    if (meta.tableBreakable) {
      const original = token.content;
      token.content = markCodeBreaks(original);
      html = codeInline(tokens, idx, ...rest).replaceAll(MARK, '<wbr>');
      token.content = original;
    } else {
      html = codeInline(tokens, idx, ...rest).replace(/^<code/, '<code class="tc-nw"');
    }
    return meta.breakBefore ? `<wbr>${html}` : html;
  };
}
