// Bridge types

export type { DiscordBotOptions, DiscordWebhookOptions } from './discord';
export { DiscordBridge } from './discord';
export type { SlackBotOptions, SlackWebhookOptions } from './slack';
export { SlackBridge } from './slack';
export type { TelegramBridgeOptions } from './telegram';
// Bridge implementations
export { TelegramBridge } from './telegram';
export type { Bridge, BridgeMessageResult } from './types';
