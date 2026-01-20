import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'quickstart',
    'concepts',
    {
      type: 'category',
      label: 'Widget',
      collapsed: false,
      items: ['widget/installation', 'widget/configuration', 'widget/customization'],
    },
    {
      type: 'category',
      label: 'SDKs',
      items: ['sdk/nodejs', 'sdk/python'],
    },
    {
      type: 'category',
      label: 'Bridges',
      items: ['bridges/telegram', 'bridges/discord', 'bridges/slack', 'bridges/docker'],
    },
    'self-hosting',
    'ai-fallback',
    'api',
  ],
}

export default sidebars
