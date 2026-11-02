<script setup lang="ts">
/**
 * 场景式交互学习演示引擎。
 * 场景在构建期已由 .vitepress/decks.ts 渲染为 HTML（Mermaid 以占位符保留），
 * 这里负责：场景导航（目录/键盘/进度/深链接/总览）、按需渲染 Mermaid、跟随明暗主题、
 * 代码复制、图表双击放大、已读标记。
 */
import { useData, withBase } from 'vitepress';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import DiagramLightbox from './diagram-lightbox.vue';

interface Scene {
  kind: 'cover' | 'section' | 'content';
  title: string;
  html: string;
  mermaid: string[];
}
interface DeckParams {
  id: string;
  title: string;
  part: string;
  docLink: string;
  scenes: Scene[];
}

const { params, isDark } = useData();
const deck = computed(() => params.value as unknown as DeckParams);
const scenes = computed(() => deck.value.scenes ?? []);

const current = ref(0);
const sidebarOpen = ref(true);
const helpOpen = ref(false);
const gridOpen = ref(false);
const stageEl = ref<HTMLElement>();
/** 前进还是后退，决定入场动画方向 */
const forward = ref(true);
const visited = ref<Set<number>>(new Set([0]));
const zoomOpen = ref(false);
const zoomSvg = ref('');

const docHref = computed(() => withBase(deck.value.docLink));
const galleryHref = withBase('/slides/');
const progress = computed(() =>
  scenes.value.length <= 1 ? 100 : (current.value / (scenes.value.length - 1)) * 100
);
const currentScene = computed(() => scenes.value[current.value]);

/** 封面按「# 第 N 章 标题 + 副标题 + 元信息行」拆成结构化版式；拆不出来就原样渲染 */
const cover = computed(() => {
  const scene = scenes.value[0];
  if (!scene || scene.kind !== 'cover') return null;
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(scene.html)?.[1] ?? '';
  const quote = /<blockquote>[\s\S]*?<p>([\s\S]*?)<\/p>[\s\S]*?<\/blockquote>/.exec(
    scene.html
  )?.[1];
  const meta = /<p>([^<]*｜[^<]*)<\/p>\s*$/.exec(scene.html)?.[1] ?? '';
  const chapter = /第\s*(\d+)\s*章\s*([\s\S]*)$/.exec(stripTags(h1));
  if (!chapter) return null;
  return {
    no: chapter[1],
    title: chapter[2].trim(),
    sub: quote ? stripTags(quote).trim() : '',
    meta: meta
      .split('｜')
      .map(s => stripTags(s).trim())
      .filter(Boolean),
  };
});

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function navLabel(scene: Scene, i: number) {
  if (scene.kind === 'cover') return '封面';
  return scene.title || `场景 ${i + 1}`;
}

function go(to: number) {
  const next = Math.min(Math.max(to, 0), scenes.value.length - 1);
  if (next === current.value) return;
  forward.value = next > current.value;
  current.value = next;
  visited.value = new Set(visited.value).add(next);
  if (typeof history !== 'undefined') {
    history.replaceState(history.state, '', `#${next + 1}`);
  }
}

// 已渲染的 Mermaid SVG 缓存，键为 `场景-序号-主题`
const svgCache = new Map<string, string>();

async function renderMermaid() {
  const root = stageEl.value;
  const scene = scenes.value[current.value];
  if (!root || !scene?.mermaid.length) return;
  const slots = root.querySelectorAll<HTMLElement>('.deck-mermaid');
  if (!slots.length) return;
  const theme = isDark.value ? 'dark' : 'default';
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    // loose 允许 htmlLabels，使节点框按标签真实渲染高度自适应（图表源码均由本项目编写，可信）
    securityLevel: 'loose',
    theme,
    fontFamily: 'var(--vp-font-family-base)',
    flowchart: { useMaxWidth: true, htmlLabels: true, nodeSpacing: 40, rankSpacing: 46 },
    sequence: { useMaxWidth: true },
  });
  for (const slot of slots) {
    const index = Number(slot.dataset.index);
    const code = scene.mermaid[index];
    if (code == null) continue;
    const key = `${current.value}-${index}-${theme}`;
    let svg = svgCache.get(key);
    if (!svg) {
      try {
        ({ svg } = await mermaid.render(`deck-${deck.value.id}-${key}`, code));
      } catch (e) {
        svg = `<pre class="deck-mermaid__error">图表渲染失败：${String(
          (e as Error)?.message ?? e
        )
          .replace(/</g, '&lt;')
          .slice(0, 240)}</pre>`;
      }
      svgCache.set(key, svg);
    }
    slot.innerHTML = svg;
  }
}

/** 给场景里的代码块套一层外壳：语言标签 + 复制按钮 */
function setupCodeBlocks() {
  const root = stageEl.value;
  if (!root) return;
  for (const pre of root.querySelectorAll('pre.shiki')) {
    if (pre.parentElement?.classList.contains('deck-code')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'deck-code';
    // 行数很少的代码块标记出来：放在分栏里时可以让文字栏更宽，避免右栏大片留白
    const lineCount = (pre.querySelector('code')?.textContent ?? pre.textContent ?? '').split(
      '\n'
    ).length;
    if (lineCount <= 8) wrap.classList.add('is-compact');
    pre.parentElement?.insertBefore(wrap, pre);
    wrap.append(pre);

    const lang = pre.dataset.lang;
    if (lang) {
      const label = document.createElement('span');
      label.className = 'deck-code__lang';
      label.textContent = lang;
      wrap.append(label);
    }
    const btn = document.createElement('button');
    btn.className = 'deck-code__copy';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.addEventListener('click', () => {
      void navigator.clipboard
        ?.writeText(pre.querySelector('code')?.textContent ?? pre.textContent ?? '')
        .then(() => {
          btn.textContent = '已复制';
          btn.classList.add('is-done');
          window.setTimeout(() => {
            btn.textContent = '复制';
            btn.classList.remove('is-done');
          }, 1500);
        })
        .catch(() => {
          btn.textContent = '复制失败';
        });
    });
    wrap.append(btn);
  }
}

/**
 * 表格外面套一层滚动容器：表格本体要铺满可用宽度（`display:table` 才能按比例分列宽），
 * 就没法靠自己的 overflow 滚动，所以由这层外壳负责横向滚动与圆角。
 */
function setupTables() {
  const root = stageEl.value;
  if (!root) return;
  for (const table of root.querySelectorAll('.deck__scene table')) {
    if (table.parentElement?.classList.contains('deck-table')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'deck-table';
    table.parentElement?.insertBefore(wrap, table);
    wrap.append(table);

    // 首列若都是短标签（≤24 字符），让它收缩到内容宽度，富余宽度让给后面的长内容列
    const firstCells = [...table.querySelectorAll('tbody tr > td:first-child')];
    if (firstCells.length) {
      const maxLen = Math.max(
        ...firstCells.map(c => (c.textContent ?? '').trim().length)
      );
      if (maxLen > 0 && maxLen <= 24) wrap.classList.add('is-tight-first');
    }
  }
}

/**
 * 行内代码默认整块不折行（混在中文里最规整）。
 * 构建期只给 Markdown 反引号写法的代码打过长标记，直接写死在 HTML 组件里的 `<code>`
 * 拿不到标记，窄栏里会撑破版面。这里按实际渲染宽度兜底：超过父级可用宽度 70% 就放开折行。
 * 表格内的代码由表格自己的横向滚动和断行策略处理，跳过。
 */
function tuneInlineCode() {
  const root = stageEl.value;
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>('.deck__scene code')) {
    if (el.closest('pre') || el.closest('td') || el.closest('th')) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const cs = getComputedStyle(parent);
    const avail =
      parent.getBoundingClientRect().width -
      (Number.parseFloat(cs.paddingLeft) || 0) -
      (Number.parseFloat(cs.paddingRight) || 0);
    if (avail <= 0) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    if (range.getBoundingClientRect().width > avail * 0.7) el.dataset.long = '';
    else delete el.dataset.long;
  }
}

/**
 * 分栏版式：右栏内容明显比左栏矮时（典型是右栏只有一小段代码），并排会在右栏下方
 * 空出一大片。这种情况改为上下堆叠，宁可让页面短一点，也不要留一块空洞。
 * 阈值 0.7：右栏高度不足左栏的 70% 就判定为「悬殊」，改为上下布局。
 */
function tuneSplitLayout() {
  const root = stageEl.value;
  if (!root) return;
  for (const split of root.querySelectorAll<HTMLElement>('.deck__scene .split')) {
    const main = split.querySelector(':scope > .split__main');
    const aside = split.querySelector(':scope > .split__aside');
    if (!main || !aside) continue;
    // 先复位再量，否则量到的是上一次改成单列后的高度
    split.classList.remove('is-stacked');
    if (getComputedStyle(split).gridTemplateColumns.split(' ').length < 2) continue;
    const mainH = main.getBoundingClientRect().height;
    const asideH = aside.getBoundingClientRect().height;
    if (mainH > 0 && asideH < mainH * 0.7) split.classList.add('is-stacked');
  }
}

/** 双击场景里的架构图 → 全屏放大 */
function onStageDblClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  const svg = target?.closest('.deck-mermaid')?.querySelector('svg');
  if (!svg) return;
  zoomSvg.value = svg.outerHTML;
  zoomOpen.value = true;
}

async function afterSceneChange() {
  await nextTick();
  stageEl.value?.scrollTo({ top: 0 });
  await renderMermaid();
  setupCodeBlocks();
  setupTables();
  tuneInlineCode();
  tuneSplitLayout();
}

let resizeTimer: number | undefined;
function onResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    tuneInlineCode();
    tuneSplitLayout();
  }, 200);
}

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
      e.preventDefault();
      go(current.value + 1);
      break;
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault();
      go(current.value - 1);
      break;
    case 'Home':
      e.preventDefault();
      go(0);
      break;
    case 'End':
      e.preventDefault();
      go(scenes.value.length - 1);
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case 'm':
    case 'M':
      sidebarOpen.value = !sidebarOpen.value;
      break;
    case 'g':
    case 'G':
      gridOpen.value = !gridOpen.value;
      break;
    case '?':
      helpOpen.value = !helpOpen.value;
      break;
    case 'Escape':
      helpOpen.value = false;
      gridOpen.value = false;
      break;
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

watch(current, afterSceneChange);
watch(isDark, renderMermaid);

onMounted(() => {
  document.title = `演示 · ${deck.value.title}`;
  const fromHash = Number(location.hash.replace('#', ''));
  if (Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= scenes.value.length) {
    current.value = fromHash - 1;
    visited.value = new Set([current.value]);
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  // 窄屏默认收起目录
  if (window.innerWidth < 960) sidebarOpen.value = false;
  void afterSceneChange();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  window.clearTimeout(resizeTimer);
});
</script>

<template>
  <div class="deck" :class="{ 'deck--nav-open': sidebarOpen }">
    <header class="deck__bar">
      <button class="deck__icon-btn" title="目录（M）" @click="sidebarOpen = !sidebarOpen">
        ☰
      </button>
      <a class="deck__bar-link" :href="docHref">← 本章文档</a>
      <a class="deck__bar-link" :href="galleryHref">演示目录</a>
      <span class="deck__bar-title">{{ deck.title }}</span>
      <span class="deck__spacer" />
      <button class="deck__counter" title="场景总览（G）" @click="gridOpen = !gridOpen">
        {{ current + 1 }} / {{ scenes.length }}
      </button>
      <button class="deck__icon-btn" title="全屏（F）" @click="toggleFullscreen">⛶</button>
      <button class="deck__icon-btn" title="快捷键（?）" @click="helpOpen = !helpOpen">?</button>
    </header>

    <div class="deck__progress">
      <span :style="{ width: progress + '%' }" />
    </div>

    <div class="deck__body">
      <nav class="deck__nav" :aria-hidden="!sidebarOpen">
        <p class="deck__nav-part">{{ deck.part }}</p>
        <ol class="deck__nav-list">
          <li
            v-for="(scene, i) in scenes"
            :key="i"
            :class="{
              'is-active': i === current,
              'is-section': scene.kind === 'section',
              'is-cover': scene.kind === 'cover',
              'is-visited': visited.has(i),
            }"
          >
            <button @click="go(i)">
              <span class="deck__nav-no">{{ i + 1 }}</span>
              <span class="deck__nav-text">{{ navLabel(scene, i) }}</span>
            </button>
          </li>
        </ol>
      </nav>

      <main class="deck__stage" ref="stageEl" @dblclick="onStageDblClick">
        <template v-for="(scene, i) in scenes" :key="i">
          <article
            v-if="i === current"
            class="deck__scene"
            :class="[
              `deck__scene--${scene.kind}`,
              forward ? 'is-forward' : 'is-back',
            ]"
          >
            <!-- 封面：结构化版式 -->
            <div v-if="scene.kind === 'cover' && cover" class="cover">
              <span class="cover__grid" aria-hidden="true" />
              <div class="cover__inner">
                <p class="cover__eyebrow">
                  <span class="cover__chapter">CHAPTER {{ cover.no }}</span>
                  <span class="cover__dot">·</span>
                  <span>共 {{ scenes.length }} 个场景</span>
                </p>
                <h1 class="cover__title">{{ cover.title }}</h1>
                <p v-if="cover.sub" class="cover__sub">{{ cover.sub }}</p>
                <div v-if="cover.meta.length" class="cover__meta">
                  <span v-for="m in cover.meta" :key="m" class="cover__chip">{{ m }}</span>
                </div>
                <button class="cover__start" type="button" @click="go(1)">
                  开始学习
                  <span class="cover__start-arrow">→</span>
                </button>
              </div>
            </div>

            <!-- 其余场景：构建期渲染好的 HTML -->
            <div v-else class="deck__scene-body">
              <p v-if="scene.kind === 'content'" class="deck__kicker">
                <span class="deck__kicker-no">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="deck__kicker-total">/ {{ scenes.length }}</span>
              </p>
              <div v-html="scene.html" />
            </div>
          </article>
        </template>
      </main>
    </div>

    <footer class="deck__foot">
      <button class="deck__foot-btn" :disabled="current === 0" @click="go(current - 1)">
        ← 上一场景
      </button>
      <span class="deck__foot-title">{{ scenes[current]?.title || deck.title }}</span>
      <button
        class="deck__foot-btn deck__foot-btn--primary"
        :disabled="current === scenes.length - 1"
        @click="go(current + 1)"
      >
        下一场景 →
      </button>
    </footer>

    <!-- 场景总览 -->
    <div v-if="gridOpen" class="deck__grid" @click.self="gridOpen = false">
      <div class="deck__grid-panel">
        <header class="deck__grid-head">
          <h3>场景总览</h3>
          <span class="deck__grid-progress">已浏览 {{ visited.size }} / {{ scenes.length }}</span>
          <button class="deck__grid-close" type="button" aria-label="关闭" @click="gridOpen = false">
            ✕
          </button>
        </header>
        <ol class="deck__grid-list">
          <li v-for="(scene, i) in scenes" :key="i" :class="{ 'is-current': i === current }">
            <button type="button" @click="go(i); gridOpen = false">
              <span class="deck__grid-no">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="deck__grid-text">{{ navLabel(scene, i) }}</span>
              <span class="deck__grid-kind">{{
                scene.kind === 'cover' ? '封面' : scene.kind === 'section' ? '章节' : '内容'
              }}</span>
            </button>
          </li>
        </ol>
      </div>
    </div>

    <div v-if="helpOpen" class="deck__help" @click="helpOpen = false">
      <div class="deck__help-panel" @click.stop>
        <h3>快捷键</h3>
        <ul>
          <li><kbd>←</kbd> <kbd>→</kbd> 切换场景</li>
          <li><kbd>Home</kbd> <kbd>End</kbd> 首页 / 末页</li>
          <li><kbd>M</kbd> 显示 / 隐藏目录</li>
          <li><kbd>G</kbd> 场景总览</li>
          <li><kbd>F</kbd> 全屏</li>
          <li><kbd>?</kbd> 本帮助 · <kbd>Esc</kbd> 关闭</li>
        </ul>
        <p class="deck__help-tip">
          小提示：双击架构图可全屏放大，代码块右上角可一键复制。点击任意处关闭。
        </p>
      </div>
    </div>

    <DiagramLightbox :open="zoomOpen" :svg="zoomSvg" @close="zoomOpen = false" />
  </div>
</template>
