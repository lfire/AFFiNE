export interface OutlinePart {
  no: number;
  dir: string;
  name: string;
}

export interface OutlineChapter {
  no: number;
  part: number;
  partName: string;
  partDir: string;
  title: string;
  file: string;
  relPath: string;
  pagePath: string;
  deckId: string;
}

export interface Outline {
  parts: OutlinePart[];
  chapters: OutlineChapter[];
  byNo: Map<number, OutlineChapter>;
  chapter(n: number): OutlineChapter | undefined;
  prev(n: number): OutlineChapter | undefined;
  next(n: number): OutlineChapter | undefined;
  partChapters(p: number): OutlineChapter[];
}

export declare const guideRootPath: string;
export declare function loadOutline(): Outline;
export declare function chapterLabel(
  outline: Outline,
  n: number,
  options?: { withTitle?: boolean }
): string | null;
export declare function chapterHref(outline: Outline, n: number): string | null;
