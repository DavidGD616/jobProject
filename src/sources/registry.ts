import { greenhouseSource } from "./greenhouse";

/**
 * The worker reads source cadence, identity, and request policy here instead
 * of baking a company list or rate limits into adapter implementations.
 */
export const sourceRegistry = {
  greenhouse: greenhouseSource,
} as const;
