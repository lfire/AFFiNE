<script setup lang="ts">
/** 章节页顶部的“配套演示”入口：根据页面路径 NN-部分/NN-章节.md 匹配对应幻灯片 */
import { useData, withBase } from 'vitepress';
import { computed } from 'vue';

import { data as decks } from '../decks.data';

const { page } = useData();

const deck = computed(() => {
  const match = page.value.relativePath.match(/^\d{2}-[^/]+\/(\d{2})-[^/]+\.md$/);
  return match ? decks.find(d => d.id === match[1]) : undefined;
});
</script>

<template>
  <div v-if="deck" class="slide-banner">
    <div class="slide-banner__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22">
        <rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path d="M10 7.5v5l4.2-2.5z" fill="currentColor" />
        <path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </div>
    <div class="slide-banner__text">
      <strong>本章配套演示</strong>
      <span>
        共 {{ deck.slides }} 张幻灯片<template v-if="deck.subSlides">（另含 {{ deck.subSlides }} 张子页）</template>，
        建议先读文档，再用演示复习要点
      </span>
    </div>
    <a class="slide-banner__btn" :href="withBase(`/slides/${deck.id}.html`)" target="_blank" rel="noopener">
      打开演示 ↗
    </a>
  </div>
</template>
