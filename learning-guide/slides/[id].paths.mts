import { listDecks, renderDeck } from '../.vitepress/decks';

/** 动态路由：为每套演示生成 /slides/NN 页面，构建期渲染好的场景通过 params 传给播放器 */
export default {
  async paths() {
    const decks = listDecks();
    const out = [];
    for (const deck of decks) {
      out.push({
        params: {
          id: deck.id,
          title: deck.title,
          part: deck.part,
          docLink: deck.docLink,
          scenes: await renderDeck(deck.id),
        },
      });
    }
    return out;
  },
};
