<script setup lang="ts">
/** 演示总览页：按部分分组展示全部幻灯片 */
import { withBase } from 'vitepress';
import { computed } from 'vue';

import { data as decks } from '../decks.data';

const groups = computed(() => {
  const map = new Map<string, typeof decks>();
  for (const deck of decks) {
    const list = map.get(deck.part) ?? [];
    list.push(deck);
    map.set(deck.part, list);
  }
  return [...map.entries()].map(([part, items]) => ({ part, items }));
});

const total = computed(() => decks.reduce((sum, d) => sum + d.scenes, 0));

function shortTitle(title: string) {
  return title.replace(/^第\s*\d+\s*章\s*/, '');
}
</script>

<template>
  <p class="deck-summary">共 {{ decks.length }} 套学习演示、{{ total }} 个场景。</p>
  <section v-for="group in groups" :key="group.part" class="deck-group">
    <h2 :id="group.part">{{ group.part }}</h2>
    <div class="deck-grid">
      <article v-for="deck in group.items" :key="deck.id" class="deck-card">
        <div class="deck-card__no">{{ deck.id }}</div>
        <h3 class="deck-card__title">{{ shortTitle(deck.title) }}</h3>
        <p class="deck-card__meta">{{ deck.scenes }} 个场景</p>
        <div class="deck-card__actions">
          <a class="deck-card__btn primary" :href="withBase(`/slides/${deck.id}.html`)" target="_blank" rel="noopener">
            开始学习 ↗
          </a>
          <a class="deck-card__btn" :href="withBase(deck.docLink)">阅读文档</a>
        </div>
      </article>
    </div>
  </section>
</template>
