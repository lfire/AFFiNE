#!/usr/bin/env node
/**
 * 章节编号一致性校验与批量重排（L1）+ 语义引用迁移（L2）。
 *
 * 真相源：.vitepress/outline.mjs —— 只认 `NN-部分名/NN-章节.md` 的目录与文件名，
 * 不保存任何编号数据。插入 / 删除 / 交换章节后，只要文件名正确，跑一次 --fix 即可。
 *
 *   node scripts/numbering.mjs --check                  校验，不写文件（CI 用）
 *   node scripts/numbering.mjs --fix                    重排标题编号 / 页脚 / README / 演示封面
 *   node scripts/numbering.mjs --fix --refs             再叠加：硬编码引用迁移为语义引用（L2）
 *   node scripts/numbering.mjs --fix --dry-run          只打印将改动的文件与样本 diff
 *
 * 编号规则：
 *   - 带编号的 h2 依次编为 N.1、N.2…（含中文数字「一、二、」）；
 *   - 其下的**每一个** h3 都编为 N.1.1、N.1.2…，无论原文是否带编号。
 *     （早期只给「原本带编号」的 h3 重排，导致 05/07/08/35 等章的目录里
 *      一半小节有 5.1.x、另一半完全没有三级编号，体例不一致。）
 *   - 「本章导读 / 学习目标 / 知识地图 / 动手实践 / 自测题 …」等无编号 h2
 *     下的 h3（练习 1/2/3、步骤 1/2/3）刻意保持无编号。
 *   - H1「第 N 章」、页脚导航、README 总目录、演示封面的章号一律由文件名推导。
 *   - 正文中裸编号引用与语义引用（#ch-N / #sec-N-M）随标题重排自动重映射；
 *     --check 额外校验 #sec-* 是否指向真实存在的小节。
 *
 * L2 语义引用形如：
 *   <a href="./09-xxx.md#ch-9">第 9 章</a>
 *   <a href="../03-.../09-xxx.md#sec-9-1">9.1 节</a>
 * 在 GitHub / IDE 里是真实可点的链接，站点构建时由 .vitepress/semantic-refs.mjs
 * 按 outline 重算标签并改写为 .html 链接。
 */
import fs from 'node:fs';
import path from 'node:path';

import { guideRootPath, loadOutline } from '../.vitepress/outline.mjs';
import { findBrokenRefs, LINK_WITH_MARKER, makeFenceTracker } from '../.vitepress/semantic-refs.mjs';

const args = new Set(process.argv.slice(2));
const isFix = args.has('--fix');
const withRefs = args.has('--refs');
const dryRun = args.has('--dry-run');
const verbose = args.has('--verbose');

// 中文数字节号后通常没有空格（「一、声明式 UI」），阿拉伯编号后有空格（「5.1 tsconfig」）
const H2_NUM = /^##\s+(\d+)\.(\d+)\s+(.+)$/;
const H2_CN = /^##\s+([零一二三四五六七八九十]+)、\s*(.+)$/;
const H3 = /^###\s+(\d+)\.(\d+)(?:\.(\d+))?\s+(.+)$/;
const H3_ANY = /^###\s+(.+)$/;
const REF = /(?<![\d.])(\d+)\.(\d+)(?:\.(\d+))?\s*节/g;
// 「见 5.1.5。」「按 15.6 的步骤」这类不带「节」字的裸编号引用。
// 必须用提示词锚定 + 目标章节真实存在的小节号做校验，否则会误伤大量版本号
// （Semantic Versioning 2.0.0、MPL 2.0、typescript@7.0.2、yjs 13.6.21 …）。
const CUE_REF = /((?:参见|详见|对照|对应|参考|回到|见|按)\s*)(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?(?![\d.]|\s*节|\s*版)/g;
const CH_REF = /第\s*(\d+)\s*章/g;
const CH_RANGE = /第\s*\d+\s*[–—~～-]\s*\d+\s*章/g;
const HEADING = /^\s*#{1,6}\s/;
const HTML_COMMENT = /^\s*<!--/;
const P_LINK = '\uE000';
const P_RANGE = '\uE001';
const P_CODE = '\uE002';

const outline = loadOutline();
const files = new Map(); // abs path -> { before, after, reasons[] }
const report = [];

/** 登记一处改动；同一个文件多次处理时保留累计 reasons */
function apply(file, fn, reason) {
  if (!fs.existsSync(file)) return;
  const cur = files.get(file);
  const base = cur?.after ?? fs.readFileSync(file, 'utf8');
  const after = fn(base);
  if (after === base) return;
  files.set(file, {
    before: cur?.before ?? base,
    after,
    reasons: [...(cur?.reasons ?? []), reason],
  });
}

/** 跳过代码围栏 / 标题 / HTML 注释，并保护已有链接、区间章号、行内代码 */
function mapBody(text, fn) {
  const fence = makeFenceTracker();
  return text
    .split('\n')
    .map(line => {
      if (fence.feed(line) || fence.inside || HEADING.test(line) || HTML_COMMENT.test(line)) {
        return line;
      }

      const links = [];
      const ranges = [];
      const codes = [];
      let masked = line
        .replace(/\[[^\]]*\]\([^)]*\)|<a\s[^>]*>[^<]*<\/a>/g, m => {
          links.push(m);
          return `${P_LINK}${links.length - 1}${P_LINK}`;
        })
        .replace(CH_RANGE, m => {
          ranges.push(m);
          return `${P_RANGE}${ranges.length - 1}${P_RANGE}`;
        })
        .replace(/`[^`\n]*`/g, m => {
          codes.push(m);
          return `${P_CODE}${codes.length - 1}${P_CODE}`;
        });

      masked = fn(masked);

      return masked
        .replace(new RegExp(`${P_CODE}(\\d+)${P_CODE}`, 'g'), (_m, i) => codes[Number(i)])
        .replace(new RegExp(`${P_RANGE}(\\d+)${P_RANGE}`, 'g'), (_m, i) => ranges[Number(i)])
        .replace(new RegExp(`${P_LINK}(\\d+)${P_LINK}`, 'g'), (_m, i) => links[Number(i)]);
    })
    .join('\n');
}

// ---------- 第一遍：算出所有章的标题重排与「旧编号 → 新编号」映射 ----------

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function cnToNum(s) {
  if (s === '十') return '10';
  const i = CN.indexOf(s);
  return i >= 0 ? String(i) : null;
}

function planHeadings(ch, text) {
  const lines = text.split('\n');
  const oldToNew = new Map();
  const labels = new Set(); // 本章实际存在的规范小节号，用来区分「见 9.4」与「版本 9.4」
  const fence = makeFenceTracker();
  let sec = 0;
  let sub = 0;
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence.feed(line) || fence.inside) continue;

    // H1 章号同样由文件名决定。交换 / 插入章节后若只改文件名，标题里的
    // 「第 N 章」会停在旧值；这里一并校准，避免页眉与侧边栏对不上。
    const h1 = line.match(/^#\s+第\s*(\d+)\s*章\s+(.+)$/);
    if (h1) {
      const next = `# 第 ${ch.no} 章 ${h1[2].trim()}`;
      if (next !== line) {
        lines[i] = next;
        count += 1;
      }
      continue;
    }

    const num = line.match(H2_NUM);
    const cn = line.match(H2_CN);
    if (num || cn) {
      sec += 1;
      sub = 0;
      const old = num ? `${num[1]}.${num[2]}` : cnToNum(cn[1]);
      const rest = num ? num[3] : cn[2];
      const next = `## ${ch.no}.${sec} ${rest}`;
      labels.add(`${ch.no}.${sec}`);
      if (old !== null) oldToNew.set(old, `${ch.no}.${sec}`);
      if (next !== line) {
        lines[i] = next;
        count += 1;
      }
      continue;
    }

    // 无编号 h2（本章导读 / 动手实践 / 自测题 …）：其下的 h3 一律不编号。
    // 必须把 sec 清零，否则会沿用上一节的编号，把「练习 1/2/3」编成 N.M.K。
    if (/^##\s/.test(line)) {
      sec = 0;
      sub = 0;
      continue;
    }

    const h3 = line.match(H3_ANY);
    if (h3) {
      const numbered = line.match(H3);
      if (sec === 0) {
        // 无编号 h2 下的 h3 保持无编号；若这里出现带编号的，多半是残留的旧编号
        if (numbered) {
          report.push(
            `  ${path.basename(ch.file)}:${i + 1} 带编号 h3 不在编号 h2 下：${line.slice(0, 60)}`
          );
        }
        continue;
      }
      sub += 1;
      const old = numbered
        ? `${numbered[1]}.${numbered[2]}${numbered[3] ? `.${numbered[3]}` : ''}`
        : null;
      const rest = numbered ? numbered[4] : h3[1];
      const label = `${ch.no}.${sec}.${sub}`;
      const next = `### ${label} ${rest}`;
      labels.add(label);
      if (old !== null) oldToNew.set(old, label);
      if (next !== line) {
        lines[i] = next;
        count += 1;
      }
    }
  }
  return { text: lines.join('\n'), oldToNew, labels, count };
}

const plans = new Map();
const validSections = new Map();
for (const ch of outline.chapters) {
  const before = fs.readFileSync(ch.file, 'utf8');
  const plan = planHeadings(ch, before);
  plans.set(ch.no, { ...plan, before });
  validSections.set(ch.no, plan.labels);
  apply(ch.file, () => plan.text, `标题重排 ${plan.count} 处`);
}

/**
 * 旧编号 → 新编号。只在标签确实出现在某张旧表里时才改写，天然幂等：
 * 已经是新编号的引用（如 9.1）不会被当成第 13 章的旧编号二次改写。
 * 同一行若有「第 N 章」，优先用目标章的映射，处理「第 17 章 13.10 节」这类跨章引用。
 */
function mapForLine(line, ch) {
  const hints = [...line.matchAll(/第\s*(\d+)\s*章/g)];
  if (hints.length) {
    const target = outline.chapter(Number(hints[hints.length - 1][1]));
    if (target) return plans.get(target.no).oldToNew;
  }
  return plans.get(ch.no).oldToNew;
}

function rewriteRefs(text, ch) {
  let changed = 0;
  const out = mapBody(text, line => {
    const map = mapForLine(line, ch);
    // 1) 裸编号「见 24.9」「按 15.6 的步骤」：只认确实在旧编号表里的标签
    let s = line.replace(CUE_REF, (all, cue, n, m, k) => {
      const label = `${n}.${m}${k ? `.${k}` : ''}`;
      const next = map.get(label);
      if (!next || next === label) return all;
      changed += 1;
      return `${cue}${next}`;
    });
    // 2) 带「节」字的引用「5.4 节」
    s = s.replace(REF, (all, n, m, k) => {
      const label = `${n}.${m}${k ? `.${k}` : ''}`;
      const next = map.get(label);
      if (!next || next === label) return all;
      changed += 1;
      return `${next} 节`;
    });
    return s;
  });
  return { text: out, changed };
}

// ---------- 第二遍：正文里的小节引用同步 ----------
for (const ch of outline.chapters) {
  const cur = files.get(ch.file);
  const base = cur?.after ?? fs.readFileSync(ch.file, 'utf8');
  const { text, changed } = rewriteRefs(base, ch);
  if (changed) apply(ch.file, () => text, `小节引用同步 ${changed} 处`);
}

// ---------- 第三遍：页脚导航统一（每一章都跑，不依赖前面是否产生改动） ----------
function normalizeFooter(text, ch) {
  const prev = outline.prev(ch.no);
  const next = outline.next(ch.no);
  // 页脚必须是在 GitHub 与站点都能直接用的真实相对链接，不依赖构建期展开
  const link = c => {
    const rel = path.relative(path.dirname(ch.file), c.file).replace(/\\/g, '/');
    return `[第 ${c.no} 章 ${c.title.replace(/`/g, '')}](${rel})`;
  };
  const footer = `上一章：${prev ? link(prev) : '无'} ｜ 下一章：${next ? link(next) : '无'} ｜ [返回目录](../README.md)`;
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.startsWith('上一章：') || l.startsWith('| [← 第'));
  if (idx < 0) {
    report.push(`  ${path.basename(ch.file)} 未找到页脚导航行`);
    return text;
  }
  // 表格式页脚占 2 行（表头 + 分隔行），行内式占 1 行
  const end = lines[idx].startsWith('| [← 第') ? idx + 2 : idx + 1;
  if (lines.slice(idx, end).join('\n') === footer) return text;
  lines.splice(idx, end - idx, footer);
  return lines.join('\n');
}

for (const ch of outline.chapters) {
  apply(ch.file, text => normalizeFooter(text, ch), '页脚导航统一为行内式');
}

// ---------- 第四遍：演示封面章号 ----------
const deckFiles = [];
for (const ch of outline.chapters) {
  const file = path.join(guideRootPath, 'slides', 'decks', `${ch.deckId}.md`);
  if (!fs.existsSync(file)) {
    report.push(`  第 ${ch.no} 章缺少演示 ${path.basename(file)}`);
    continue;
  }
  deckFiles.push(file);
  apply(file, text => text.replace(/^#\s+第\s*\d+\s*章\s+(.+)$/m, `# 第 ${ch.no} 章 $1`), '封面章号校准');
}

// ---------- 第五遍：README 总目录与根页面 ----------
const readmeFile = path.join(guideRootPath, 'README.md');
const rootDocs = ['README.md', 'index.md', 'DEPLOY.md']
  .map(f => path.join(guideRootPath, f))
  .filter(f => fs.existsSync(f));

function syncReadme(text) {
  const lines = text.split('\n');
  let partIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 「全书 **11 个部分 · 35 章 · 约 3.8 万行**」
    if (line.includes('个部分 ·') && line.includes('章 ·')) {
      lines[i] = line.replace(/\*\*\d+ 个部分 · \d+ 章/, `**${outline.parts.length} 个部分 · ${outline.chapters.length} 章`);
      continue;
    }
    const pm = line.match(/^###\s+第\s*(\d+)\s*部分\s*·\s*(.+)$/);
    if (pm) {
      partIdx += 1;
      if (Number(pm[1]) !== partIdx) {
        lines[i] = `### 第 ${partIdx} 部分 · ${pm[2]}`;
      }
      continue;
    }
    // | 09 | [标题](./03-.../09-xxx.md) | … |
    const rm = line.match(/^\|\s*(\d{1,2})\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.*)$/);
    if (rm) {
      const ch = outline.chapter(Number(rm[1]));
      if (!ch) {
        report.push(`  README 第 ${i + 1} 行章号 ${rm[1]} 无对应章节`);
        continue;
      }
      const expected = `./${ch.relPath}`;
      if (rm[3] !== expected) {
        lines[i] = `| ${String(ch.no).padStart(2, '0')} | [${rm[2]}](${expected}) |${rm[4]}`;
      }
    }
  }
  return lines.join('\n');
}

if (rootDocs.includes(readmeFile)) {
  apply(readmeFile, syncReadme, '总目录章号与链接校准');
}

// ---------- 第六遍：语义引用迁移（可选，仅 --fix --refs） ----------

/** 从源文件目录到目标章节 .md 的相对路径：GitHub 上直接可点 */
function relHref(sourceFile, ch) {
  const rel = path
    .relative(path.dirname(sourceFile), path.join(guideRootPath, ch.relPath))
    .replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** 生成一条小节语义引用；目标小节不存在时返回 null，避免把版本号误当章节号 */
function sectionRef(sourceFile, n, m, k, { suffix = false } = {}) {
  const ch = outline.chapter(Number(n));
  if (!ch) return null;
  const sec = Number(m);
  const sub = k ? Number(k) : null;
  const label = `${ch.no}.${sec}${sub !== null ? `.${sub}` : ''}`;
  if (!validSections.get(ch.no)?.has(label)) return null;
  const marker = `sec-${ch.no}-${sec}${sub !== null ? `-${sub}` : ''}`;
  return `<a href="${relHref(sourceFile, ch)}#${marker}">${label}${suffix ? ' 节' : ''}</a>`;
}

function migrateRefs(text, sourceFile) {
  const out = mapBody(text, line => {
    // 1) 章引用
    let s = line.replace(CH_REF, (all, n) => {
      const ch = outline.chapter(Number(n));
      if (!ch) {
        report.push(`  ${path.basename(sourceFile)} 章号引用无对应章节：${all}`);
        return all;
      }
      return `<a href="${relHref(sourceFile, ch)}#ch-${ch.no}">第 ${ch.no} 章</a>`;
    });
    // 2) 裸小节号「见 28.9」「按 19.6 的步骤」——只在目标小节真实存在时转换
    s = s.replace(CUE_REF, (all, cue, n, m, k) => {
      const ref = sectionRef(sourceFile, n, m, k);
      return ref ? `${cue}${ref}` : all;
    });
    // 3) 带「节」字的小节引用
    s = s.replace(REF, (all, n, m, k) => {
      const ref = sectionRef(sourceFile, n, m, k, { suffix: true });
      if (!ref) {
        report.push(`  ${path.basename(sourceFile)} 小节引用无法映射到现有标题：${all.trim()}`);
        return all;
      }
      return ref;
    });
    return s;
  });
  return out;
}

// 工程图谱里的「N.M 节」和多数「第 N 章」指的是精讲文档自己的章节，不是全书章节，
// 只对明确写了 learning-guide 前缀的引用做迁移；_FORMAT.md 是格式规范示例，不迁移。
const ATLAS_CH_REF = /(learning-guide\s*)第\s*(\d+)\s*章/g;
const atlasRootPath = path.join(guideRootPath, 'engineering-atlas');
const atlasFiles = [];
function collectAtlas(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectAtlas(full);
    else if (entry.name.endsWith('.md')) atlasFiles.push(full);
  }
}
if (fs.existsSync(atlasRootPath)) collectAtlas(atlasRootPath);

function migrateAtlasRefs(text, sourceFile) {
  return mapBody(text, line =>
    line.replace(ATLAS_CH_REF, (all, prefix, n) => {
      const ch = outline.chapter(Number(n));
      if (!ch) {
        report.push(`  ${path.basename(sourceFile)} 章号引用无对应章节：${all}`);
        return all;
      }
      return `${prefix}<a href="${relHref(sourceFile, ch)}#ch-${ch.no}">第 ${ch.no} 章</a>`;
    })
  );
}

const migrateTargets = [
  ...outline.chapters.map(c => c.file),
  ...deckFiles,
  ...rootDocs,
];

if (isFix && withRefs) {
  for (const file of new Set(migrateTargets)) {
    apply(
      file,
      text => migrateRefs(text, file),
      '硬编码引用迁移为语义引用'
    );
  }
  for (const file of atlasFiles) {
    apply(file, text => migrateAtlasRefs(text, file), '工程图谱教程引用迁移为语义引用');
  }
}

// ---------- 第七遍：语义引用随编号自动重映射 + 有效性校验 ----------

/**
 * 语义引用里的 href 指向哪一章。
 * 按「去掉 NN- 前缀后的文件名主体」匹配，而不是直接读 NN-：整章插入会让后续
 * 文件编号整体顺延，此时 href 里的旧前缀正好需要被校准，先用主体找到「现在是哪一章」，
 * 才能算出新的章号与链接路径。
 */
function chapterFromHref(href) {
  const base = path.posix.basename(href.split('#')[0].split('?')[0]);
  const stem = base.replace(/^\d{1,2}-/, '');
  return (
    outline.chapters.find(
      c => path.posix.basename(c.relPath).replace(/^\d{1,2}-/, '') === stem
    ) ?? null
  );
}

/** 每章「旧节序号 → 新节序号」（剥掉章号前缀），因此章号变化不影响节内顺延 */
const sectionMaps = new Map();
for (const [no, plan] of plans) {
  const m = new Map();
  for (const [oldLabel, newLabel] of plan.oldToNew) {
    const oldSec = oldLabel.replace(/^\d+\./, '');
    const newSec = newLabel.replace(/^\d+\./, '');
    if (oldSec !== newSec) m.set(oldSec, newSec);
  }
  sectionMaps.set(no, m);
}

const REF_LINK = new RegExp(LINK_WITH_MARKER.source, 'g');

/**
 * 把源码里的语义引用同步到重排后的编号。
 *
 * 缺了这一遍，插入 / 删除小节后标题虽然自动顺延，但
 * `<a href="./05-xxx.md#sec-5-3">5.3 节</a>` 的编号与锚点会停在旧值，
 * 站点上就变成文案错误且跳不到的链接。mapBody() 会遮掉 <a>，所以这里单独扫行。
 */
function remapSemanticRefs(text, sourceFile) {
  const fence = makeFenceTracker();
  let changed = 0;
  const out = text
    .split('\n')
    .map(line => {
      if (fence.feed(line) || fence.inside || HEADING.test(line) || HTML_COMMENT.test(line)) {
        return line;
      }
      const codes = [];
      let s = line.replace(/`[^`\n]*`/g, m => {
        codes.push(m);
        return `${P_CODE}${codes.length - 1}${P_CODE}`;
      });
      REF_LINK.lastIndex = 0;
      s = s.replace(REF_LINK, (all, mdLabel, mdHref, mdMarker, aHref, aMarker, aLabel) => {
        const href = mdHref ?? aHref;
        const marker = mdMarker ?? aMarker;
        const label = mdLabel ?? aLabel ?? '';
        const ch = chapterFromHref(href);
        if (!ch) return all; // 定位不到目标章：交给 findBrokenRefs 报告，不猜测

        const parts = marker.split('-');
        // 文件名前缀顺延（整章插入）时才重写 href，否则原样保留，避免无意义的批量改动
        const hrefNeedsFix = path.posix.basename(href) !== path.posix.basename(ch.relPath);
        let newMarker;
        let newLabel;

        if (parts[0] === 'ch') {
          newMarker = `ch-${ch.no}`;
          newLabel = label.replace(/第\s*\d+\s*章/, `第 ${ch.no} 章`);
        } else {
          const oldSec = `${parts[2]}${parts[3] ? `.${parts[3]}` : ''}`;
          const newSec = sectionMaps.get(ch.no)?.get(oldSec) ?? oldSec;
          newMarker = `sec-${ch.no}-${newSec.replace(/\./g, '-')}`;
          // 只替换编号，保留原文「5.1.4 节」与「24.5」这两种措辞
          newLabel = label.replace(`${parts[1]}.${oldSec}`, `${ch.no}.${newSec}`);
        }

        if (newMarker === marker && newLabel === label && !hrefNeedsFix) return all;
        changed += 1;
        const finalHref = hrefNeedsFix ? relHref(sourceFile, ch) : href;
        return `<a href="${finalHref}#${newMarker}">${newLabel}</a>`;
      });
      return s.replace(new RegExp(`${P_CODE}(\\d+)${P_CODE}`, 'g'), (_m, i) => codes[Number(i)]);
    })
    .join('\n');
  return { text: out, changed };
}

const scanTargets = [
  ...migrateTargets,
  ...atlasFiles,
  ...fs.readdirSync(path.join(guideRootPath, 'slides', 'decks'))
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .map(f => path.join(guideRootPath, 'slides', 'decks', f)),
];

for (const file of new Set(scanTargets)) {
  if (!fs.existsSync(file)) continue;
  const { text, changed: n } = remapSemanticRefs(
    files.get(file)?.after ?? fs.readFileSync(file, 'utf8'),
    file
  );
  if (n) apply(file, () => text, `语义引用重映射 ${n} 处`);
}

for (const file of new Set(scanTargets)) {
  if (!fs.existsSync(file)) continue;
  const text = files.get(file)?.after ?? fs.readFileSync(file, 'utf8');
  const broken = findBrokenRefs(text, outline, validSections);
  for (const b of broken) {
    report.push(
      `  ${path.relative(guideRootPath, file)}:${b.line} 语义引用无法解析 ${b.marker}` +
        (b.reason ? `：${b.reason}` : b.expect ? `（应指向 ${b.expect}）` : '')
    );
  }
}

// ---------- 输出 ----------
const changed = [...files.entries()].filter(([, v]) => v.before !== v.after);
const continuous = outline.chapters.every((c, i) => c.no === i + 1);
console.log(
  `真相源：${outline.parts.length} 个部分 / ${outline.chapters.length} 章（章号连续：${continuous}）`
);
console.log(`模式：${isFix ? (dryRun ? 'fix（dry-run）' : 'fix') : 'check'}${withRefs ? ' + refs' : ''}`);
console.log(`待改动文件：${changed.length} 个`);
if (report.length) {
  console.log(`\n需要人工确认 ${report.length} 条：`);
  for (const r of report.slice(0, 30)) console.log(r);
  if (report.length > 30) console.log(`  … 另有 ${report.length - 30} 条`);
}
if (verbose || dryRun) {
  console.log('\n改动明细（前 15 个文件）：');
  for (const [file, v] of changed.slice(0, 15)) {
    const reason = v.reasons.filter(Boolean).join('；') || '（无说明）';
    console.log(`  ${path.relative(guideRootPath, file)} — ${reason}`);
  }
  const sample = changed.find(([f]) => f.endsWith('09-TypeScript在AFFiNE中的应用.md'));
  if (sample) {
    console.log('\n第 9 章标题 diff 样本：');
    const a = sample[1].before.split('\n').filter(l => /^##\s/.test(l)).slice(0, 6);
    const b = sample[1].after.split('\n').filter(l => /^##\s/.test(l)).slice(0, 6);
    a.forEach((l, i) => console.log(`  - ${l}\n  + ${b[i] ?? ''}`));
  }
}

if (isFix && !dryRun) {
  for (const [file, v] of changed) fs.writeFileSync(file, v.after, 'utf8');
  console.log(`\n已写入 ${changed.length} 个文件。运行 node scripts/numbering.mjs --check 复核。`);
} else if (!isFix) {
  process.exitCode = changed.length || report.length || !continuous ? 1 : 0;
}
