import { listDecks, readDeckRaw } from '../.vitepress/decks';

/** 动态路由：为每一套幻灯片生成 /slides/NN 页面，幻灯片原文通过 params 传给播放器 */
export default {
  paths() {
    return listDecks().map(deck => ({
      params: {
        id: deck.id,
        title: deck.title,
        part: deck.part,
        docLink: deck.docLink,
        raw: readDeckRaw(deck.id),
      },
    }));
  },
};
