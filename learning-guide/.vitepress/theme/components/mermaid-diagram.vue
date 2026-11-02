<script setup lang="ts">
/**
 * 文档中的 Mermaid 图：仅在客户端渲染，并随明暗主题切换重新渲染。
 * `code` 为 encodeURIComponent 编码后的图表源码（由 config.mts 中的 fence 规则生成）。
 * 双击图表（或点右上角的放大按钮）会在全屏弹层里放大查看。
 */
import { useData } from 'vitepress';
import { onMounted, ref, watch } from 'vue';

import DiagramLightbox from './diagram-lightbox.vue';

const props = defineProps<{ code: string }>();
const { isDark } = useData();

const svg = ref('');
const error = ref('');
const zoomed = ref(false);
const uid = `mmd-${Math.random().toString(36).slice(2, 10)}`;
let seq = 0;

async function render() {
  const source = decodeURIComponent(props.code);
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: isDark.value ? 'dark' : 'default',
      fontFamily: 'var(--vp-font-family-base)',
      flowchart: { useMaxWidth: true, htmlLabels: true },
      sequence: { useMaxWidth: true },
    });
    const result = await mermaid.render(`${uid}-${seq++}`, source);
    svg.value = result.svg;
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** 双击放大：点在图表内的链接上时不拦（让链接正常跳转） */
function onDoubleClick(event: MouseEvent) {
  if (!svg.value) return;
  if ((event.target as HTMLElement | null)?.closest('a')) return;
  // 双击会顺带选中一个词，打开弹层时清掉，避免背景里残留选区
  window.getSelection()?.removeAllRanges();
  zoomed.value = true;
}

onMounted(render);
watch(isDark, render);
</script>

<template>
  <div class="mermaid-diagram">
    <div v-if="svg" class="mermaid-diagram__svg" v-html="svg" @dblclick="onDoubleClick" />
    <div v-else-if="!error" class="mermaid-diagram__loading">图表加载中…</div>
    <details v-if="error" class="mermaid-diagram__error">
      <summary>图表渲染失败，点击查看源码</summary>
      <pre>{{ decodeURIComponent(props.code) }}</pre>
      <p>{{ error }}</p>
    </details>
    <button
      v-if="svg"
      type="button"
      class="mermaid-diagram__zoom"
      title="放大查看（也可双击图表）"
      aria-label="放大查看"
      @click="zoomed = true"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10 4a6 6 0 1 0 3.9 10.6l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-1 1v2H7v2h2v2h2v-2h2v-2h-2V7H9Z"
        />
      </svg>
      <span>放大</span>
    </button>
    <DiagramLightbox :open="zoomed" :svg="svg" @close="zoomed = false" />
  </div>
</template>
