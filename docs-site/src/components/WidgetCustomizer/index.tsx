import React, { useState, useCallback } from 'react'
import styles from './styles.module.css'

interface WidgetConfig {
  endpoint: string
  operatorName: string
  operatorAvatar: string
  primaryColor: string
  welcomeMessage: string
  position: 'bottom-right' | 'bottom-left'
  theme: 'light' | 'dark' | 'auto'
  headerColor: string
  footerColor: string
  toggleColor: string
  chatBackground: 'whatsapp' | 'dots' | 'plain' | string
}

const defaultConfig: WidgetConfig = {
  endpoint: 'https://yoursite.com/pocketping',
  operatorName: 'Support',
  operatorAvatar: '',
  primaryColor: '#6366f1',
  welcomeMessage: 'Hi! How can we help you today?',
  position: 'bottom-right',
  theme: 'auto',
  headerColor: '',
  footerColor: '',
  toggleColor: '',
  chatBackground: 'whatsapp',
}

export default function WidgetCustomizer(): JSX.Element {
  const [config, setConfig] = useState<WidgetConfig>(defaultConfig)
  const [copied, setCopied] = useState(false)
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light')

  const handleChange = useCallback(
    <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const generateCode = useCallback((): string => {
    const options: Record<string, unknown> = {
      endpoint: config.endpoint,
    }

    if (config.operatorName && config.operatorName !== 'Support') {
      options.operatorName = config.operatorName
    }
    if (config.operatorAvatar) {
      options.operatorAvatar = config.operatorAvatar
    }
    if (config.primaryColor && config.primaryColor !== '#6366f1') {
      options.primaryColor = config.primaryColor
    }
    if (config.welcomeMessage) {
      options.welcomeMessage = config.welcomeMessage
    }
    if (config.position !== 'bottom-right') {
      options.position = config.position
    }
    if (config.theme !== 'auto') {
      options.theme = config.theme
    }
    if (config.headerColor) {
      options.headerColor = config.headerColor
    }
    if (config.footerColor) {
      options.footerColor = config.footerColor
    }
    if (config.toggleColor) {
      options.toggleColor = config.toggleColor
    }
    if (config.chatBackground && config.chatBackground !== 'whatsapp') {
      options.chatBackground = config.chatBackground
    }

    const optionsStr = JSON.stringify(options, null, 2)
      .replace(/"([^"]+)":/g, '$1:')
      .replace(/"/g, "'")

    return `<script src="https://cdn.pocketping.io/widget.js"></script>
<script>
  PocketPing.init(${optionsStr});
</script>`
  }, [config])

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(generateCode())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [generateCode])

  const isDark = previewTheme === 'dark'

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {/* Settings Panel */}
        <div className={styles.settings}>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Basic Settings</h3>

            <div className={styles.field}>
              <label className={styles.label}>Bridge Server URL</label>
              <input
                type="text"
                value={config.endpoint}
                onChange={(e) => handleChange('endpoint', e.target.value)}
                placeholder="https://yoursite.com/pocketping"
                className={styles.input}
              />
              <span className={styles.hint}>Your self-hosted bridge server URL</span>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Operator Name</label>
              <input
                type="text"
                value={config.operatorName}
                onChange={(e) => handleChange('operatorName', e.target.value)}
                placeholder="Support"
                className={styles.input}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Avatar URL</label>
              <input
                type="text"
                value={config.operatorAvatar}
                onChange={(e) => handleChange('operatorAvatar', e.target.value)}
                placeholder="https://example.com/avatar.png"
                className={styles.input}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Welcome Message</label>
              <textarea
                value={config.welcomeMessage}
                onChange={(e) => handleChange('welcomeMessage', e.target.value)}
                placeholder="Hi! How can we help?"
                rows={2}
                className={styles.textarea}
              />
            </div>
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Appearance</h3>

            <div className={styles.field}>
              <label className={styles.label}>Brand Color</label>
              <div className={styles.colorRow}>
                <input
                  type="color"
                  value={config.primaryColor}
                  onChange={(e) => handleChange('primaryColor', e.target.value)}
                  className={styles.colorPicker}
                />
                <input
                  type="text"
                  value={config.primaryColor}
                  onChange={(e) => handleChange('primaryColor', e.target.value)}
                  className={styles.colorInput}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Position</label>
              <select
                value={config.position}
                onChange={(e) =>
                  handleChange('position', e.target.value as 'bottom-right' | 'bottom-left')
                }
                className={styles.select}
              >
                <option value="bottom-right">Bottom Right</option>
                <option value="bottom-left">Bottom Left</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Theme</label>
              <select
                value={config.theme}
                onChange={(e) =>
                  handleChange('theme', e.target.value as 'light' | 'dark' | 'auto')
                }
                className={styles.select}
              >
                <option value="auto">Auto (follow system)</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Chat Background</label>
              <select
                value={
                  config.chatBackground.startsWith('http')
                    ? 'custom'
                    : config.chatBackground
                }
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    handleChange('chatBackground', '')
                  } else {
                    handleChange('chatBackground', e.target.value)
                  }
                }}
                className={styles.select}
              >
                <option value="whatsapp">WhatsApp Pattern</option>
                <option value="dots">Dots Pattern</option>
                <option value="plain">Plain Color</option>
                <option value="custom">Custom URL</option>
              </select>
              {(config.chatBackground === '' ||
                config.chatBackground.startsWith('http')) && (
                <input
                  type="text"
                  value={config.chatBackground}
                  onChange={(e) => handleChange('chatBackground', e.target.value)}
                  placeholder="https://example.com/background.jpg"
                  className={styles.input}
                  style={{ marginTop: '0.5rem' }}
                />
              )}
            </div>
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Advanced Colors (Optional)</h3>
            <span className={styles.hint}>Leave empty to use defaults</span>

            <div className={styles.field}>
              <label className={styles.label}>Header Color</label>
              <div className={styles.colorRow}>
                <input
                  type="color"
                  value={config.headerColor || '#7c5cff'}
                  onChange={(e) => handleChange('headerColor', e.target.value)}
                  className={styles.colorPicker}
                />
                <input
                  type="text"
                  value={config.headerColor}
                  onChange={(e) => handleChange('headerColor', e.target.value)}
                  placeholder="#7c5cff"
                  className={styles.colorInput}
                />
              </div>
              <span className={styles.hint}>Default: gradient #36e3ff → #7c5cff</span>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Footer Color</label>
              <div className={styles.colorRow}>
                <input
                  type="color"
                  value={config.footerColor || '#f0f2f5'}
                  onChange={(e) => handleChange('footerColor', e.target.value)}
                  className={styles.colorPicker}
                />
                <input
                  type="text"
                  value={config.footerColor}
                  onChange={(e) => handleChange('footerColor', e.target.value)}
                  placeholder="#f0f2f5"
                  className={styles.colorInput}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Toggle Button Color</label>
              <div className={styles.colorRow}>
                <input
                  type="color"
                  value={config.toggleColor || '#7c5cff'}
                  onChange={(e) => handleChange('toggleColor', e.target.value)}
                  className={styles.colorPicker}
                />
                <input
                  type="text"
                  value={config.toggleColor}
                  onChange={(e) => handleChange('toggleColor', e.target.value)}
                  placeholder="#7c5cff"
                  className={styles.colorInput}
                />
              </div>
              <span className={styles.hint}>Default: gradient #36e3ff → #7c5cff</span>
            </div>
          </div>
        </div>

        {/* Preview Panel */}
        <div className={styles.previewPanel}>
          <div className={styles.card}>
            <div className={styles.previewHeader}>
              <h3 className={styles.cardTitle}>Preview</h3>
              <div className={styles.themeToggle}>
                <button
                  onClick={() => setPreviewTheme('light')}
                  className={`${styles.themeBtn} ${previewTheme === 'light' ? styles.themeBtnActive : ''}`}
                >
                  Light
                </button>
                <button
                  onClick={() => setPreviewTheme('dark')}
                  className={`${styles.themeBtn} ${previewTheme === 'dark' ? styles.themeBtnActive : ''}`}
                >
                  Dark
                </button>
              </div>
            </div>

            <div
              className={styles.previewContainer}
              style={{
                background: isDark
                  ? 'linear-gradient(135deg, #1f2937 0%, #111827 100%)'
                  : 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
              }}
            >
              {/* Widget Preview */}
              <div
                className={styles.widgetPreview}
                style={{
                  [config.position === 'bottom-left' ? 'left' : 'right']: '1rem',
                }}
              >
                {/* Chat Window */}
                <div
                  className={styles.chatWindow}
                  style={{ background: isDark ? '#111b21' : '#ffffff' }}
                >
                  {/* Header */}
                  <div
                    className={styles.chatHeader}
                    style={{
                      background:
                        config.headerColor || (isDark ? '#202c33' : 'linear-gradient(to right, #36e3ff, #7c5cff)'),
                    }}
                  >
                    <div className={styles.chatHeaderContent}>
                      {config.operatorAvatar ? (
                        <img
                          src={config.operatorAvatar}
                          alt=""
                          className={styles.avatar}
                        />
                      ) : (
                        <div
                          className={styles.avatarPlaceholder}
                          style={{ background: 'rgba(255,255,255,0.2)' }}
                        >
                          <svg
                            width="20"
                            height="20"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                          </svg>
                        </div>
                      )}
                      <div>
                        <div className={styles.operatorName}>
                          {config.operatorName || 'Support'}
                        </div>
                        <div className={styles.onlineStatus}>Online</div>
                      </div>
                    </div>
                    <button className={styles.closeBtn}>
                      <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </div>

                  {/* Messages */}
                  <div
                    className={styles.chatMessages}
                    style={{
                      background: isDark ? '#0b141a' : '#e5ddd5',
                      backgroundImage:
                        config.chatBackground === 'plain'
                          ? 'none'
                          : config.chatBackground.startsWith('http')
                            ? `url(${config.chatBackground})`
                            : undefined,
                    }}
                  >
                    {config.welcomeMessage && (
                      <div className={styles.messageBubbleContainer}>
                        <div
                          className={styles.messageBubble}
                          style={{
                            background: isDark ? '#202c33' : '#ffffff',
                            color: isDark ? '#e9edef' : '#111b21',
                          }}
                        >
                          {config.welcomeMessage}
                        </div>
                      </div>
                    )}
                    <div className={styles.visitorBubbleContainer}>
                      <div
                        className={styles.visitorBubble}
                        style={{ background: isDark ? '#005c4b' : config.primaryColor }}
                      >
                        Hi, I have a question
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div
                    className={styles.chatFooter}
                    style={{
                      background: config.footerColor || (isDark ? '#202c33' : '#f0f2f5'),
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Type a message..."
                      className={styles.chatInput}
                      style={{
                        background: isDark ? '#2a3942' : '#ffffff',
                        color: isDark ? '#e9edef' : '#111b21',
                      }}
                      readOnly
                    />
                    <button
                      className={styles.sendBtn}
                      style={{ background: isDark ? '#7c5cff' : config.primaryColor }}
                    >
                      <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Toggle Button */}
                <div
                  className={styles.toggleBtn}
                  style={{
                    background:
                      config.toggleColor || 'linear-gradient(to right, #36e3ff, #7c5cff)',
                    [config.position === 'bottom-left' ? 'left' : 'right']: 0,
                  }}
                >
                  <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Code Output */}
          <div className={styles.card}>
            <div className={styles.codeHeader}>
              <h3 className={styles.cardTitle}>Installation Code</h3>
              <button onClick={copyToClipboard} className={styles.copyBtn}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className={styles.codeBlock}>
              <code>{generateCode()}</code>
            </pre>
            <span className={styles.hint}>
              Add this code before the closing &lt;/body&gt; tag
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
