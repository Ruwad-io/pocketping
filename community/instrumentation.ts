/**
 * Next.js Instrumentation
 * Community Edition
 *
 * Initializes background services when the app starts.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize Discord Gateways if enabled
    // This allows receiving real-time messages from Discord
    console.log('🔧 [Instrumentation] ENABLE_DISCORD_GATEWAY =', process.env.ENABLE_DISCORD_GATEWAY)
    if (process.env.ENABLE_DISCORD_GATEWAY === 'true') {
      console.log('🚀 [Instrumentation] Starting Discord Gateway initialization...')
      const { initializeDiscordGateways } = await import('./lib/discord-gateway-service')
      initializeDiscordGateways()
        .then(() => console.log('✅ [Instrumentation] Discord Gateway initialized successfully'))
        .catch((err) => console.error('❌ [Instrumentation] Discord Gateway failed:', err))
    }
  }
}
