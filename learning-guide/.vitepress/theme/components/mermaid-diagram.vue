<script setup lang="ts">
/**
 * 文档中的 Mermaid 图：仅在客户端渲染，并随明暗主题切换重新渲染。
 * `code` 为 encodeURIComponent 编码后的图表源码（由 config.mts 中的 fence 规则生成）。
 */
import { useData } from 'vitepress';
import { onMounted, ref, watch } from 'vue';

const props = defineProps<{ code: string }>();
const { isDark } = useData();

const svg = ref('');
const error = ref('');
const uid = `mmd-${Math.random().toString(36).slice(2, 10)}`;
let seq = 0;

async function render() {
  const source = decodeURIComponent(props.code);
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
      fontFamily: 'var(--vp-font-family-base)',
    });
    const result = await mermaid.render(`${uid}-${seq++}`, source);
    svg.value = result.svg;
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(render);
watch(isDark, render);
</script>

<template>
  <div class="mermaid-diagram">
    <div v-if="svg" class="mermaid-diagram__svg" v-html="svg" />
    <div v-else-if="!error" class="mermaid-diagram__loading">图表加载中…</div>
    <details v-if="error" class="mermaid-diagram__error">
      <summary>图表渲染失败，点击查看源码</summary>
      <pre>{{ decodeURIComponent(props.code) }}</pre>
      <p>{{ error }}</p>
    </details>
  </div>
</template>
