import type { LlmProvider, LlmTask } from "./types";

export interface LlmProviderRouter {
  providersFor(task: LlmTask): readonly LlmProvider[];
}

const defaultChains: Record<LlmTask, readonly string[]> = {
  extract: ["claude", "codex"],
  rerank: ["claude", "codex"],
  expand_query: ["claude", "codex"],
  tailor: ["claude", "codex"],
};

export function createRouter(
  providers: readonly LlmProvider[],
  chains: Partial<Record<LlmTask, readonly string[]>> = {},
): LlmProviderRouter {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return {
    providersFor(task) {
      const ids = chains[task] ?? defaultChains[task];
      return ids.flatMap((id) => {
        const provider = byId.get(id);
        return provider ? [provider] : [];
      });
    },
  };
}
