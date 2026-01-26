// Discord validation
export async function validateDiscordToken(token: string): Promise<{
  valid: boolean
  error?: string
  botName?: string
  clientId?: string
}> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bot ${token}`,
      },
    })

    if (!response.ok) {
      return { valid: false, error: 'Invalid token or API error' }
    }

    const data = await response.json() as { username: string; id: string }
    return {
      valid: true,
      botName: data.username,
      clientId: data.id,
    }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
}

export async function validateDiscordChannel(token: string, channelId: string): Promise<{
  valid: boolean
  error?: string
  channelName?: string
  channelType?: string
}> {
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: {
        Authorization: `Bot ${token}`,
      },
    })

    if (!response.ok) {
      if (response.status === 403) {
        return { valid: false, error: 'Bot does not have access to this channel' }
      }
      return { valid: false, error: 'Channel not found' }
    }

    const data = await response.json() as { name: string; type: number }
    const typeNames: Record<number, string> = {
      0: 'Text',
      15: 'Forum',
      4: 'Category',
    }

    return {
      valid: true,
      channelName: data.name,
      channelType: typeNames[data.type] || 'Unknown',
    }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
}

// Slack validation
export async function validateSlackToken(token: string): Promise<{
  valid: boolean
  error?: string
  teamName?: string
  botId?: string
}> {
  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    const data = await response.json() as { ok: boolean; error?: string; team?: string; bot_id?: string }

    if (!data.ok) {
      return { valid: false, error: data.error || 'Invalid token' }
    }

    return {
      valid: true,
      teamName: data.team,
      botId: data.bot_id,
    }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
}

export async function validateSlackChannel(token: string, channelId: string): Promise<{
  valid: boolean
  error?: string
  channelName?: string
  isPrivate?: boolean
}> {
  try {
    const response = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await response.json() as {
      ok: boolean
      error?: string
      channel?: { name: string; is_private: boolean }
    }

    if (!data.ok) {
      if (data.error === 'channel_not_found') {
        return { valid: false, error: 'Channel not found. Make sure the bot is invited.' }
      }
      return { valid: false, error: data.error || 'Could not access channel' }
    }

    return {
      valid: true,
      channelName: data.channel?.name,
      isPrivate: data.channel?.is_private,
    }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
}

// Telegram validation
export async function validateTelegramToken(token: string): Promise<{
  valid: boolean
  error?: string
  botUsername?: string
  botId?: number
}> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const data = await response.json() as {
      ok: boolean
      result?: { username: string; id: number }
      description?: string
    }

    if (!data.ok) {
      return { valid: false, error: data.description || 'Invalid token' }
    }

    return {
      valid: true,
      botUsername: data.result?.username,
      botId: data.result?.id,
    }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
}

export async function validateTelegramChat(token: string, chatId: string): Promise<{
  valid: boolean
  error?: string
  chatTitle?: string
  isForum?: boolean
}> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`)
    const data = await response.json() as {
      ok: boolean
      result?: { title: string; is_forum?: boolean }
      description?: string
    }

    if (!data.ok) {
      if (data.description?.includes('chat not found')) {
        return { valid: false, error: 'Chat not found. Make sure the bot is added to the group.' }
      }
      return { valid: false, error: data.description || 'Could not access chat' }
    }

    return {
      valid: true,
      chatTitle: data.result?.title,
      isForum: data.result?.is_forum,
    }
  } catch (error) {
    return { valid: false, error: String(error) }
  }
}
