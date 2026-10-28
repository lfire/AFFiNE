<script setup lang="ts">
/**
 * 场景式交互学习演示引擎。
 * 场景在构建期已由 .vitepress/decks.ts 渲染为 HTML（Mermaid 以占位符保留），
 * 这里负责：场景导航（目录/键盘/进度/深链接）、按需渲染 Mermaid、跟随明暗主题。
 */
import { useData, withBase } from 'vitepress';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

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
const stageEl = ref<HTMLElement>();

const docHref = computed(() => withBase(deck.value.docLink));
const galleryHref = withBase('/slides/');
const progress = computed(() =>
  scenes.value.length <= 1 ? 100 : (current.value / (scenes.value.length - 1)) * 100
);

// 已渲染的 Mermaid SVG 缓存，键为 `场景-序号-主题`
const svgCache = new Map<string, string>();

function navLabel(scene: Scene, i: number) {
  if (scene.kind === 'cover') return '封面';
  return scene.title || `场景 ${i + 1}`;
}

function go(to: number) {
  const next = Math.min(Math.max(to, 0), scenes.value.length - 1);
  if (next === current.value) return;
  current.value = next;
  if (typeof history !== 'undefined') {
    history.replaceState(history.state, '', `#${next + 1}`);
  }
}

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

async function afterSceneChange() {
  await nextTick();
  stageEl.value?.scrollTo({ top: 0 });
  await renderMermaid();
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
    case '?':
      helpOpen.value = !helpOpen.value;
      break;
    case 'Escape':
      helpOpen.value = false;
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
  }
  window.addEventListener('keydown', onKey);
  // 窄屏默认收起目录
  if (window.innerWidth < 960) sidebarOpen.value = false;
  void afterSceneChange();
});

onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="deck" :class="{ 'deck--nav-open': sidebarOpen }">
    <header class="deck__bar">
      <button class="deck__icon-btn" title="目录（M）" @click="sidebarOpen = !sidebarOpen">☰</button>
      <a class="deck__bar-link" :href="docHref">← 本章文档</a>
      <a class="deck__bar-link" :href="galleryHref">演示目录</a>
      <span class="deck__bar-title">{{ deck.title }}</span>
      <span class="deck__spacer" />
      <span class="deck__counter">{{ current + 1 }} / {{ scenes.length }}</span>
      <button class="deck__icon-btn" title="全屏（F）" @click="toggleFullscreen">⛶</button>
      <button class="deck__icon-btn" title="快捷键（?）" @click="helpOpen = !helpOpen">?</button>
    </header>

    <div class="deck__progress"><span :style="{ width: progress + '%' }" /></div>

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
            }"
          >
            <button @click="go(i)">
              <span class="deck__nav-no">{{ i + 1 }}</span>
              <span class="deck__nav-text">{{ navLabel(scene, i) }}</span>
            </button>
          </li>
        </ol>
      </nav>

      <main class="deck__stage" ref="stageEl">
        <article
          v-for="(scene, i) in scenes"
          v-show="i === current"
          :key="i"
          class="deck__scene"
          :class="`deck__scene--${scene.kind}`"
          v-html="scene.html"
        />
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

    <div v-if="helpOpen" class="deck__help" @click="helpOpen = false">
      <div class="deck__help-panel" @click.stop>
        <h3>快捷键</h3>
        <ul>
          <li><kbd>←</kbd> <kbd>→</kbd> 切换场景</li>
          <li><kbd>Home</kbd> <kbd>End</kbd> 首页 / 末页</li>
          <li><kbd>M</kbd> 显示 / 隐藏目录</li>
          <li><kbd>F</kbd> 全屏</li>
          <li><kbd>?</kbd> 本帮助 · <kbd>Esc</kbd> 关闭</li>
        </ul>
        <p class="deck__help-tip">点击任意处关闭</p>
      </div>
    </div>
  </div>
</template>
