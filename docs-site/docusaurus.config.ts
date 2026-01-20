import { themes as prismThemes } from 'prism-react-renderer'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const config: Config = {
  title: 'PocketPing',
  tagline: 'Customer chat that pings your phone',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.pocketping.io',
  baseUrl: '/',

  organizationName: 'pocketping',
  projectName: 'pocketping',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/ruwad-io/pocketping/tree/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'PocketPing',
      logo: {
        alt: 'PocketPing Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://pocketping.io',
          label: 'Website',
          position: 'right',
        },
        {
          href: 'https://app.pocketping.io',
          label: 'Dashboard',
          position: 'right',
        },
        {
          href: 'https://github.com/ruwad-io/pocketping',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Quick Start', to: '/quickstart' },
            { label: 'Widget', to: '/widget/installation' },
            { label: 'Self-Hosting', to: '/self-hosting' },
          ],
        },
        {
          title: 'Bridges',
          items: [
            { label: 'Telegram', to: '/bridges/telegram' },
            { label: 'Discord', to: '/bridges/discord' },
            { label: 'Slack', to: '/bridges/slack' },
          ],
        },
        {
          title: 'SDKs',
          items: [
            { label: 'Node.js', to: '/sdk/nodejs' },
            { label: 'Python', to: '/sdk/python' },
          ],
        },
        {
          title: 'Links',
          items: [
            { label: 'Website', href: 'https://pocketping.io' },
            { label: 'GitHub', href: 'https://github.com/ruwad-io/pocketping' },
            { label: 'Dashboard', href: 'https://app.pocketping.io' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} PocketPing. Open source under MIT license.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'python', 'typescript', 'json', 'yaml'],
    },
    // Algolia search - configure when ready
    // algolia: {
    //   appId: 'YOUR_APP_ID',
    //   apiKey: 'YOUR_SEARCH_API_KEY',
    //   indexName: 'pocketping',
    //   contextualSearch: true,
    //   searchPagePath: 'search',
    // },
  } satisfies Preset.ThemeConfig,
}

export default config
