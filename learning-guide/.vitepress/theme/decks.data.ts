import { type DeckMeta, decksDir, listDecks } from '../decks';

export type { DeckMeta };

declare const data: DeckMeta[];
export { data };

/** 构建期数据加载器：向页面提供全部演示文稿的元信息 */
export default {
  watch: [`${decksDir}/*.md`],
  load(): DeckMeta[] {
    return listDecks();
  },
};
