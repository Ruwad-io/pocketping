module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow scopes like: widget, sdk-node, bridge, docs
    'scope-enum': [2, 'always', [
      'widget',
      'sdk-node',
      'sdk-python',
      'sdk-go',
      'sdk-php',
      'sdk-ruby',
      'bridge',
      'docs',
      'ci',
      'deps',
      'release'
    ]],
    'scope-empty': [1, 'never'], // Warn if no scope
  },
}
