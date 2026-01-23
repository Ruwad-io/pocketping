const sidebars = {
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
            link: { type: 'doc', id: 'sdk/index' },
            items: ['sdk/nodejs', 'sdk/python'],
        },
        {
            type: 'category',
            label: 'Bridges',
            link: { type: 'doc', id: 'bridges/index' },
            items: ['bridges/telegram', 'bridges/discord', 'bridges/slack', 'bridges/docker'],
        },
        'self-hosting',
        'ai-fallback',
        'api',
    ],
};
export default sidebars;
//# sourceMappingURL=sidebars.js.map