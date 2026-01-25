// Bridge types
export type { Bridge, BridgeMessageResult } from './types';

// Bridge implementations
export { TelegramBridge } from './telegram';
export type { TelegramBridgeOptions } from './telegram';

export { DiscordBridge } from './discord';
export type { DiscordWebhookOptions, DiscordBotOptions } from './discord';

export { SlackBridge } from './slack';
export type { SlackWebhookOptions, SlackBotOptions } from './slack';
