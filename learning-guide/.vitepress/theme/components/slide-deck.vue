<script setup lang="ts">
/**
 * 幻灯片播放器（reveal.js 5）。
 * 幻灯片原文由动态路由 `slides/[id].paths.mts` 通过 params.raw 传入。
 * 为避免 reveal.js 的全局样式影响文档页，所有依赖与样式都在挂载后按需加载，
 * 且与文档页之间的跳转都使用整页刷新（链接带 target 属性，不经过 SPA 路由）。
 */
import { useData, withBase } from 'vitepress';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

interface DeckParams {
  id: string;
  title: string;
  part: string;
  docLink: string;
  raw: string;
}

const { params } = useData();
const deckParams = computed(() => params.value as DeckParams);

const revealEl = ref<HTMLElement>();
const slidesEl = ref<HTMLElement>();
const status = ref<'loading' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const showHelp = ref(false);

const docHref = computed(() => withBase(deckParams.value.docLink));
const galleryHref = withBase('/slides/');

// reveal.js 实例类型较复杂，这里只用到少量方法
let deck: { destroy?: () => void; layout: () => void; initialize: () => Promise<unknown> } | null =
  null;

const MERMAID_FENCE = /```mermaid[^\n]*\n([\s\S]*?)```/g;

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 行内语法预处理（跳过代码块内部）：
 * 1. reveal.js 内置的 marked 对中文全角标点的判断与 CommonMark 不一致，
 *    紧贴“：”“，”等全角标点的 **加粗** 会失效，这里统一转换为 <strong>；
 * 2. 以 HTML 标签开头的行（如 `<p class="small">来源：`x`</p>`）内部不会再解析 Markdown，
 *    需要额外把 `代码` 转换为 <code>。
 * 行内代码先替换为占位符保护起来，避免误伤 `**∕dist` 这类 glob 写法。
 */
function preprocessInline(markdown: string) {
  let inFence = false;
  return markdown
    .split('\n')
    .map(line => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      const isHtmlLine = /^\s*<(p|div|span|td|th|li|small)\b/.test(line);
      if (inFence || (!isHtmlLine && !line.includes('**'))) return line;
      const codes: string[] = [];
      // 占位符使用 Unicode 私用区字符 U+E000，正文中不会出现
      let text = line.replace(/`([^`]+)`/g, (_m, code: string) => {
        codes.push(code);
        return `\uE000${codes.length - 1}\uE000`;
      });
      text = text.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>');
      return text.replace(/\uE000(\d+)\uE000/g, (_m, i: string) =>
        isHtmlLine ? `<code>${escapeHtml(codes[Number(i)])}</code>` : `\`${codes[Number(i)]}\``
      );
    })
    .join('\n');
}

/** 预渲染 Mermaid：隐藏的幻灯片无法测量文字尺寸，因此先在可见容器中渲染成 SVG，再回填占位符 */
async function prerenderMermaid(raw: string) {
  const sources: string[] = [];
  const markdown = raw.replace(MERMAID_FENCE, (_all, code: string) => {
    sources.push(code);
    return `\n<div class="mermaid-slot" data-index="${sources.length - 1}"></div>\n`;
  });

  const svgs: string[] = [];
  if (sources.length) {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      fontFamily: 'var(--slide-font)',
      // 幻灯片画布为 1280×720，默认 16px 字号偏小
      themeVariables: { fontSize: '20px' },
      flowchart: { useMaxWidth: true, nodeSpacing: 40, rankSpacing: 50 },
      sequence: { useMaxWidth: true, actorFontSize: 18, messageFontSize: 17, noteFontSize: 16 },
    });
    for (const [index, code] of sources.entries()) {
      try {
        const { svg } = await mermaid.render(`slide-mmd-${index}`, code);
        svgs.push(svg);
      } catch (e) {
        svgs.push(
          `<pre class="mermaid-error">图表渲染失败：${String((e as Error)?.message ?? e)
            .replace(/</g, '&lt;')
            .slice(0, 300)}</pre>`
        );
      }
    }
  }
  return { markdown: preprocessInline(markdown), svgs };
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

/** 画布内可用区域（1280×720 去掉左右内边距、标题与下方说明文字的空间） */
const CANVAS_WIDTH = 1232;
const MAX_SCALE = 1.8;

/**
 * Mermaid 默认按图的原始尺寸输出（style="max-width: Npx"），在 1280 宽的画布上显得偏小。
 * 这里按可用空间等比放大：两栏布局中按半宽计算，并根据同页其他内容的多少收紧高度上限。
 * 幻灯片在隐藏状态下无法测量布局，因此依据 viewBox 计算尺寸。
 */
function fitSvg(slot: HTMLElement) {
  const svg = slot.querySelector('svg');
  const viewBox = svg?.getAttribute('viewBox')?.split(/\s+/).map(Number);
  if (!svg || !viewBox || viewBox.length !== 4) return;
  const [, , w, h] = viewBox;
  if (!w || !h) return;

  const inColumn = !!slot.closest('.cols');
  const section = slot.closest('section');
  // 同页除图以外的可见文字越多，留给图的高度越少（演讲者备注 aside.notes 不计入）
  let otherText = 0;
  section?.querySelectorAll('h2, h3, p, li, td, th, pre, blockquote').forEach(el => {
    if (!el.closest('aside.notes') && !el.closest('.mermaid-slot')) {
      otherText += (el.textContent ?? '').trim().length;
    }
  });
  const maxHeight = otherText > 220 ? 360 : otherText > 120 ? 420 : otherText > 40 ? 480 : 540;
  const maxWidth = inColumn ? (CANVAS_WIDTH - 28) / 2 : CANVAS_WIDTH;

  const scale = Math.min(maxWidth / w, maxHeight / h, MAX_SCALE);
  // 保留 max-width: 100% 兜底；viewBox 默认 meet 等比缩放，不会变形
  svg.style.maxWidth = '100%';
  svg.style.width = `${Math.round(w * scale)}px`;
  svg.style.height = `${Math.round(h * scale)}px`;
}

onMounted(async () => {
  document.title = `演示 · ${deckParams.value.title}`;
  const revealRoot = revealEl.value;
  const slidesRoot = slidesEl.value;
  if (!revealRoot || !slidesRoot) return;
  try {
    const [{ default: Reveal }, { default: Markdown }, { default: Highlight }, { default: Notes }] =
      await Promise.all([
        import('reveal.js'),
        import('reveal.js/plugin/markdown/markdown.esm.js'),
        import('reveal.js/plugin/highlight/highlight.esm.js'),
        import('reveal.js/plugin/notes/notes.esm.js'),
        import('reveal.js/dist/reveal.css'),
        import('reveal.js/dist/theme/white.css'),
        import('reveal.js/plugin/highlight/monokai.css'),
      ]);

    const { markdown, svgs } = await prerenderMermaid(deckParams.value.raw);

    // 按 reveal.js Markdown 插件的约定构造 <section data-markdown><textarea data-template>
    const section = document.createElement('section');
    section.dataset.markdown = '';
    section.dataset.separator = '^\\r?\\n---\\r?\\n$';
    section.dataset.separatorVertical = '^\\r?\\n--\\r?\\n$';
    section.dataset.separatorNotes = '^Note:';
    const template = document.createElement('textarea');
    template.dataset.template = '';
    template.textContent = markdown;
    section.append(template);
    slidesRoot.append(section);

    deck = new Reveal(revealRoot, {
      hash: true,
      history: false,
      controls: true,
      controlsTutorial: false,
      progress: true,
      slideNumber: 'c/t',
      center: false,
      width: 1280,
      height: 720,
      margin: 0.04,
      transition: 'slide',
      backgroundTransition: 'fade',
      plugins: [Markdown, Highlight, Notes],
    });
    await deck.initialize();

    revealRoot.querySelectorAll<HTMLElement>('.mermaid-slot').forEach(slot => {
      slot.innerHTML = svgs[Number(slot.dataset.index)] ?? '';
      fitSvg(slot);
    });
    deck.layout();
    status.value = 'ready';
  } catch (e) {
    console.error(e);
    errorMessage.value = String((e as Error)?.message ?? e);
    status.value = 'error';
  }
});

onBeforeUnmount(() => {
  deck?.destroy?.();
  deck = null;
});
</script>

<template>
  <div class="slide-shell">
    <header class="slide-toolbar">
      <a class="slide-toolbar__link" :href="docHref" target="_self">← 本章文档</a>
      <a class="slide-toolbar__link" :href="galleryHref" target="_self">演示目录</a>
      <span class="slide-toolbar__title">{{ deckParams.title }}</span>
      <span class="slide-toolbar__spacer" />
      <button class="slide-toolbar__btn" type="button" title="全屏（F）" @click="toggleFullscreen">全屏</button>
      <button class="slide-toolbar__btn" type="button" title="快捷键" @click="showHelp = !showHelp">?</button>
    </header>

    <div v-if="showHelp" class="slide-help" @click="showHelp = false">
      <div class="slide-help__panel">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>←</kbd> <kbd>→</kbd> / <kbd>空格</kbd> 翻页</li>
          <li><kbd>↑</kbd> <kbd>↓</kbd> 进出纵向子页</li>
          <li><kbd>F</kbd> 全屏</li>
          <li><kbd>S</kbd> 演讲者视图（含备注与计时）</li>
          <li><kbd>Esc</kbd> / <kbd>O</kbd> 幻灯片总览</li>
          <li><kbd>B</kbd> / <kbd>.</kbd> 黑屏暂停</li>
        </ul>
        <p>点击任意处关闭</p>
      </div>
    </div>

    <div v-if="status === 'loading'" class="slide-status">演示加载中…</div>
    <div v-else-if="status === 'error'" class="slide-status error">
      演示加载失败：{{ errorMessage }}
      <a :href="docHref" target="_self">返回本章文档</a>
    </div>

    <div ref="revealEl" class="reveal">
      <div ref="slidesEl" class="slides" />
    </div>
  </div>
</template>
