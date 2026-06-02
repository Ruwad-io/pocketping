import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'quickstart',
    'cli',
    'concepts',
    {
      type: 'category',
      label: 'Widget',
      collapsed: false,
      items: [
        'widget/installation',
        'widget/configuration',
        'widget/customization',
        'widget/wordpress',
        'widget/customize',
      ],
    },
    {
      type: 'category',
      label: 'SDKs',
      link: { type: 'doc', id: 'sdk/index' },
      // TODO: add a 'sdk/react' entry here once a docs page exists for the
      // shipped @pocketping/react package (packages/react). No page yet, so
      // referencing it would break the build — do not add until the page lands.
      items: ['sdk/nodejs', 'sdk/python', 'sdk/go', 'sdk/php', 'sdk/ruby'],
    },
    {
      type: 'category',
      label: 'Bridges',
      link: { type: 'doc', id: 'bridges/index' },
      items: ['bridges/telegram', 'bridges/discord', 'bridges/slack', 'bridges/docker'],
    },
    'serverless',
    'self-hosting',
    'community-edition',
    'ai-fallback',
    'webhooks',
    'api',
    {
      type: 'category',
      label: 'Compare',
      collapsed: true,
      items: ['vs-intergram', 'vs-tawk', 'vs-crisp'],
    },
  ],
}

export default sidebars
