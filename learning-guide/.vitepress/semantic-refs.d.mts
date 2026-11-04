import type MarkdownIt from 'markdown-it';

import type { Outline } from './outline.mjs';

export interface ExpandRefsOptions {
  context?: 'doc' | 'deck';
  relativePath?: string;
  outline?: Outline;
}

export declare function makeFenceTracker(): {
  readonly inside: boolean;
  feed(line: string): boolean;
};
export declare function expandRefs(src: string, options?: ExpandRefsOptions): string;
export declare function stableSectionIds(md: MarkdownIt): void;
export declare function findBrokenRefs(
  src: string,
  outline?: Outline,
  validSections?: Map<number, Set<string>> | null
): {
  line: number;
  marker: string;
  href: string;
  expect?: string;
  reason?: string;
}[];
export declare const LINK_WITH_MARKER: RegExp;
