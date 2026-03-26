import type {
  AiProviderAdapter,
  AiProviderGenerationResult,
  AiProviderName,
  AiProviderOverride,
  AiProviderRequestContext
} from "../types";
import { nanoBananaProvider } from "./nano_banana";
import { openAiProvider } from "./openai";
import { siliconFlowProvider } from "./silicon_flow";

// Provider registry.
// This file is the single lookup table for all AI adapters inside `src/ai/providers`.

// Test overrides let the suite replace one provider at a time without changing production code paths.
const providerOverridesForTests: Partial<Record<AiProviderName, AiProviderOverride | null>> = {};

// The real provider implementations.
const baseProviders: Record<AiProviderName, AiProviderAdapter> = {
  openai: openAiProvider,
  nano_banana: nanoBananaProvider,
  silicon_flow: siliconFlowProvider
};

// Wraps a provider so tests can intercept only its `generate()` call while leaving
// name/capabilities/config logic untouched.
function withOverride(provider: AiProviderAdapter): AiProviderAdapter {
  return {
    ...provider,
    async generate(context: AiProviderRequestContext): Promise<AiProviderGenerationResult> {
      const override = providerOverridesForTests[provider.name];
      if (override) {
        return override(context);
      }

      return provider.generate(context);
    }
  };
}

// Public provider registry used by the router and wrapper.
export const aiProviders: Record<AiProviderName, AiProviderAdapter> = {
  openai: withOverride(baseProviders.openai),
  nano_banana: withOverride(baseProviders.nano_banana),
  silicon_flow: withOverride(baseProviders.silicon_flow)
};

// Returns one provider adapter by name.
export function getAiProvider(provider: AiProviderName): AiProviderAdapter {
  return aiProviders[provider];
}

// Test helper for swapping a single provider implementation with a deterministic fake.
export function setAiProviderOverrideForTests(
  provider: AiProviderName,
  override: AiProviderOverride | null
): void {
  providerOverridesForTests[provider] = override;
}

export { openAiProvider, nanoBananaProvider, siliconFlowProvider };
