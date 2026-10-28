import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type DefaultTheme, defineConfig } from 'vitepress';

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

/** 根据 `NN-部分名/NN-章节.md` 目录结构自动生成侧边栏 */
function buildSidebar(): DefaultTheme.SidebarItem[] {
  const parts = fs
    .readdirSync(guideRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{2}-/.test(d.name))
    .map(d => d.name)
    .sort();

  return [
    {
      text: '开始',
      items: [
        { text: '首页', link: '/' },
        { text: '学习路线与总目录', link: '/README' },
        { text: '配套演示总览', link: '/slides/' },
        { text: '站点部署与维护', link: '/DEPLOY' },
      ],
    },
    ...parts.map(part => {
      const [num, ...rest] = part.split('-');
      const chapters = fs
        .readdirSync(path.join(guideRoot, part))
        .filter(f => /^\d{2}-.+\.md$/.test(f))
        .sort();
      return {
        text: `第 ${Number(num)} 部分 · ${rest.join('-')}`,
        collapsed: false,
        items: chapters.map(file => ({
          text: readTitle(path.join(guideRoot, part, file)).replace(/^第\s*(\d+)\s*章\s*/, '$1. '),
          link: `/${part}/${file.replace(/\.md$/, '')}`,
        })),
      };
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

  markdown: {
    lineNumbers: true,
    config(md) {
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

      // 2. 行内代码加 v-pre，避免 `{{ x }}`、`<T>` 等内容被 Vue 模板编译器解析
      const codeInline = md.renderer.rules.code_inline;
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) =>
        (codeInline
          ? codeInline(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options)
        ).replace(/^<code/, '<code v-pre');

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
      { text: '配套演示', link: '/slides/' },
      { text: '源码仓库', link: `${repoUrl}/tree/${branch}` },
    ],
    sidebar: buildSidebar(),
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
