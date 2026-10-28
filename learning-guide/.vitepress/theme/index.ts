import './custom.css';

import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';

import ChapterSlideBanner from './components/chapter-slide-banner.vue';
import DeckGallery from './components/deck-gallery.vue';
import MermaidDiagram from './components/mermaid-diagram.vue';
import SlideDeck from './components/slide-deck.vue';

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // 在每一章正文顶部插入“打开本章演示”入口
      'doc-before': () => h(ChapterSlideBanner),
    }),
  enhanceApp({ app }) {
    app.component('MermaidDiagram', MermaidDiagram);
    app.component('SlideDeck', SlideDeck);
    app.component('DeckGallery', DeckGallery);
  },
} satisfies Theme;
