import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type DefaultTheme, defineConfig } from 'vitepress';

import { loadOutline } from './outline.mjs';
import { expandRefs, stableSectionIds } from './semantic-refs.mjs';
import { tableLayoutPlugin } from './table-layout';

const guideRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 仓库信息：CI 中读取 GitHub 注入的环境变量，本地默认为 fork 仓库 */
const repo = process.env.GITHUB_REPOSITORY ?? 'lfire/AFFiNE';
const branch = process.env.GUIDE_BRANCH ?? process.env.GITHUB_REF_NAME ?? 'guide';
const repoUrl = `https://github.com/${repo}`;
/** 项目页部署在 https://<owner>.github.io/<repo>/ 下，可用 DOCS_BASE 覆盖 */
const base = process.env.DOCS_BASE ?? `/${repo.split('/')[1]}/`;

/** 学习指南在仓库中的目录（用于把指向源码的相对链接改写为 GitHub 链接） */
const guideDirInRepo = 'learning-guide';

function readTitle(file: string): string {
  const match = fs.readFileSync(file, 'utf8').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : path.basename(file, '.md');
}

/** 侧边栏由 outline（唯一真相源）生成：文件名变了，编号自动跟着变 */
function buildSidebar(): DefaultTheme.SidebarItem[] {
  const outline = loadOutline();

  return [
    {
      text: '开始',
      items: [
        { text: '首页', link: '/' },
        { text: '学习路线与总目录', link: '/README' },
        { text: '工程图谱 · 分层详解', link: `/${atlasDir}/README` },
        { text: '配套演示总览', link: '/slides/' },
        { text: '站点部署与维护', link: '/DEPLOY' },
      ],
    },
    ...outline.parts.map(part => ({
      text: `第 ${part.no} 部分 · ${part.name}`,
      collapsed: false,
      items: outline.partChapters(part.no).map(ch => ({
        text: `${ch.no}. ${ch.title.replace(/`/g, '')}`,
        link: ch.pagePath,
      })),
    })),
  ];
}

/** 工程图谱（engineering-atlas）目录 */
const atlasDir = 'engineering-atlas';
const atlasRoot = path.join(guideRoot, atlasDir);
/** 重点包精讲专区（位于工程图谱目录下） */
const atlasDeepDir = '重点包精讲';

/** 侧边栏文字：去掉标题中的反引号 */
function plainTitle(file: string): string {
  return readTitle(file).replace(/`/g, '');
}

/** L3 编辑器业务层包很多，按文件名前缀再细分 */
const atlasL3Groups: { text: string; match: (name: string) => boolean }[] = [
  { text: '内容块 blocks', match: n => n.startsWith('blocksuite-affine-block-') },
  { text: '图形元素 gfx', match: n => n.startsWith('blocksuite-affine-gfx-') },
  { text: '行内元素 inlines', match: n => n.startsWith('blocksuite-affine-inline-') },
  { text: '浮层控件 widgets', match: n => n.startsWith('blocksuite-affine-widget-') },
  { text: '宿主面板 fragments', match: n => n.startsWith('blocksuite-affine-fragment-') },
  { text: '聚合门面', match: n => n === 'blocksuite-affine.md' },
];

/** 根据 `L<N>-层名/*.md` 目录结构生成工程图谱侧边栏 */
function buildAtlasSidebar(): DefaultTheme.SidebarItem[] {
  const toItem = (layer: string, file: string): DefaultTheme.SidebarItem => ({
    text: plainTitle(path.join(atlasRoot, layer, file)),
    link: `/${atlasDir}/${layer}/${file.replace(/\.md$/, '')}`,
  });

  const layers = fs
    .readdirSync(atlasRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^L\d+-/.test(d.name))
    .map(d => d.name)
    .sort();

  return [
    {
      text: '工程图谱',
      items: [
        { text: '总览与分层地图', link: `/${atlasDir}/README` },
        { text: '单包文档模板', link: `/${atlasDir}/TEMPLATE` },
        { text: '← 返回学习指南', link: '/README' },
      ],
    },
    {
      text: '重点包精讲',
      collapsed: false,
      items: fs
        .readdirSync(path.join(atlasRoot, atlasDeepDir))
        .filter(f => /^\d{2}-.+\.md$/.test(f))
        .sort()
        .map(f => ({
          text: `${f.slice(0, 2)} · ${plainTitle(path.join(atlasRoot, atlasDeepDir, f)).replace(/^重点包精讲 · /, '').replace(/ 精讲/, '')}`,
          link: `/${atlasDir}/${atlasDeepDir}/${f.replace(/\.md$/, '')}`,
        })),
    },
    ...layers.map(layer => {
      const files = fs
        .readdirSync(path.join(atlasRoot, layer))
        .filter(f => f.endsWith('.md'))
        .sort();
      const [num, ...rest] = layer.split('-');
      const text = `${num} · ${rest.join('-')}（${files.length}）`;

      if (layer.startsWith('L3-')) {
        const grouped = new Set<string>();
        const subGroups = atlasL3Groups.map(group => {
          const matched = files.filter(group.match);
          matched.forEach(f => grouped.add(f));
          return { text: group.text, collapsed: true, items: matched.map(f => toItem(layer, f)) };
        });
        const base = files.filter(f => !grouped.has(f));
        return {
          text,
          collapsed: true,
          items: [
            { text: '基座', collapsed: true, items: base.map(f => toItem(layer, f)) },
            ...subGroups.filter(g => g.items.length > 0),
          ],
        };
      }

      return { text, collapsed: true, items: files.map(f => toItem(layer, f)) };
    }),
  ];
}

export default defineConfig({
  lang: 'zh-CN',
  title: 'AFFiNE 学习指南',
  description: 'AFFiNE 开源项目从零到精通：产品、项目管理、编程语言、编辑器内核、前后端、多端、测试与运维',
  base,
  // 演示文稿源文件与编写规范不作为独立页面输出
  srcExclude: ['slides/decks/**', 'node_modules/**', 'scripts/**'],
  lastUpdated: false,
  cleanUrls: false,
  // 文档中的 localhost 链接是本地开发环境示例，不做死链检查
  ignoreDeadLinks: 'localhostLinks',
  head: [['meta', { name: 'theme-color', content: '#1e96eb' }]],

  // 显式提供 esbuild 的 tsconfig，避免它向上读到仓库根 tsconfig.json
  // （根 tsconfig 的 "target": "ES2024" 是上游 AFFiNE 的配置，不应改动；
  //  但 VitePress 内置的 esbuild 版本不认识 ES2024，会反复打印告警）
  vite: {
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          target: 'es2022',
          useDefineForClassFields: true,
        },
      },
    },
  },

  markdown: {
    lineNumbers: true,
    config(md) {
      // 0. 语义引用展开（L2）：必须在 block 解析之前改写 state.src，
      //    否则 <p>/<div> 这类 HTML 块里的引用不会被 markdown-it 当作 Markdown 解析。
      //    展开结果统一输出 <a>，因此相对路径要直接写成 .html，不能依赖 linkPlugin 转换。
      md.core.ruler.after('normalize', 'semantic_refs', state => {
        state.src = expandRefs(state.src, {
          context: 'doc',
          relativePath: state.env?.relativePath ?? '',
        });
      });
      // 0.5 给「N.M / N.M.N」标题注入稳定锚点，使 #sec-N-M[-K] 可跳转；
      //     无编号标题（本章导读、常见坑…）保留 VitePress 默认锚点，避免打断已有链接。
      stableSectionIds(md);

      // 1. ```mermaid 围栏 → <MermaidDiagram> 组件（客户端渲染，跟随明暗主题）
      const fence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim().split(/\s+/)[0] === 'mermaid') {
          return `<MermaidDiagram code="${encodeURIComponent(token.content)}" />`;
        }
        return fence
          ? fence(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      };

      // 2. 行内代码加 v-pre，避免 `{{ x }}`、`<T>` 等内容被 Vue 模板编译器解析；
      //    过长的再补 data-long，让样式层只对长片段放开折行（短的整块不拆，版面更规整）
      const codeInline = md.renderer.rules.code_inline;
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
        const html = codeInline
          ? codeInline(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
        // 中日韩字符按两个西文字符宽估算，超过约 34 个西文字符宽度就不适合整体不换行
        let width = 0;
        for (const ch of tokens[idx].content) {
          width += /[\u1100-\u11FF\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(
            ch
          )
            ? 2
            : 1;
        }
        return html.replace(
          /^<code/,
          width > 34 ? '<code data-long v-pre' : '<code v-pre'
        );
      };

      // 2.5 GitHub 式任务列表：`- [ ]` / `- [x]` 渲染为复选框（VitePress 默认不支持）
      md.core.ruler.after('inline', 'gfm-task-lists', state => {
        const tokens = state.tokens;
        for (let i = 2; i < tokens.length; i++) {
          const inline = tokens[i];
          if (
            inline.type !== 'inline' ||
            tokens[i - 1].type !== 'paragraph_open' ||
            tokens[i - 2].type !== 'list_item_open' ||
            !inline.children?.length ||
            inline.children[0].type !== 'text' ||
            !/^\[[ xX]\][ \u00A0]/.test(inline.children[0].content)
          ) {
            continue;
          }
          const checked = /^\[[xX]\]/.test(inline.children[0].content);
          inline.children[0].content = inline.children[0].content.replace(
            /^\[[ xX]\][ \u00A0]/,
            ''
          );
          const checkbox = new state.Token('html_inline', '', 0);
          checkbox.content = `<input class="task-list-item-checkbox"${
            checked ? ' checked' : ''
          } disabled type="checkbox"> `;
          inline.children.unshift(checkbox);
          tokens[i - 2].attrJoin('class', 'task-list-item');
          // 给最外层 <ul> 标记，便于去掉默认项目符号
          for (let j = i - 2; j >= 0; j--) {
            if (tokens[j].type === 'bullet_list_open') {
              tokens[j].attrJoin('class', 'contains-task-list');
              break;
            }
          }
        }
      });

      // 3. 指向 learning-guide 之外（仓库源码、docs 等）的相对链接 → GitHub 源码链接
      const linkOpen =
        md.renderer.rules.link_open ??
        ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const href = token.attrGet('href');
        if (href && !/^([a-z]+:|#|\/)/i.test(href) && env?.relativePath) {
          const [target, hash = ''] = href.split('#');
          const resolved = path.posix.normalize(
            path.posix.join(guideDirInRepo, path.posix.dirname(env.relativePath), target)
          );
          if (!resolved.startsWith(`${guideDirInRepo}/`)) {
            const kind = /\.[a-z0-9]+$/i.test(resolved) ? 'blob' : 'tree';
            token.attrSet('href', `${repoUrl}/${kind}/${branch}/${resolved}${hash ? `#${hash}` : ''}`);
            token.attrSet('target', '_blank');
            token.attrSet('rel', 'noreferrer');
          }
        }
        return linkOpen(tokens, idx, options, env, self);
      };

      // 4. 表格列宽：按内容估算，短列不换行、长列给最小宽度、长路径只在分隔符处断行
      tableLayoutPlugin(md);
    },
  },

  /** 动态路由的演示页：用参数中的章节标题作为页面标题 */
  transformPageData(pageData) {
    const params = pageData.params as { title?: string } | undefined;
    if (params?.title) {
      pageData.title = `演示 · ${params.title}`;
    }
  },

  themeConfig: {
    nav: [
      { text: '学习路线', link: '/README' },
      { text: '工程图谱', link: `/${atlasDir}/README`, activeMatch: `^/${atlasDir}/` },
      { text: '配套演示', link: '/slides/' },
      { text: '源码仓库', link: `${repoUrl}/tree/${branch}` },
    ],
    // 工程图谱使用独立侧边栏；其余页面沿用学习指南侧边栏
    sidebar: {
      [`/${atlasDir}/`]: buildAtlasSidebar(),
      '/': buildSidebar(),
    },
    outline: { level: [2, 3], label: '本页目录' },
    socialLinks: [{ icon: 'github', link: repoUrl }],
    editLink: {
      pattern: `${repoUrl}/edit/${branch}/${guideDirInRepo}/:path`,
      text: '在 GitHub 上编辑此页',
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    footer: {
      message: '基于 AFFiNE v0.27.5 源码编写 · 仅供学习交流',
      copyright: 'AFFiNE 源码版权归 toeverything 所有',
    },
  },
});
