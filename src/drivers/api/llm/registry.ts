import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderSettings, Settings } from "../../../config/types.ts";
import { isDir } from "../../../util/fs.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import type { ModelProvider } from "./types.ts";

export interface ModelRef {
  provider: string;
  model: string;
}

/** `moonshot/kimi-k2.7-code` → provider `moonshot`; a bare `claude-…` id belongs to `anthropic`. */
export function parseModelRef(ref: string): ModelRef {
  const slash = ref.indexOf("/");
  if (slash > 0) return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
  return { provider: "anthropic", model: ref };
}

export class MissingCredentialsError extends Error {}

/** Every source the Anthropic SDK can read credentials from (env vars, `ant auth login` profiles, federation). */
const ANTHROPIC_CREDENTIAL_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID"];

export function defaultAnthropicProfileDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = [join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "anthropic")];
  if (env.APPDATA) dirs.push(join(env.APPDATA, "anthropic"));
  return dirs;
}

interface RegistryOptions {
  env?: NodeJS.ProcessEnv;
  overrides?: Record<string, ModelProvider>;
  /** Where `ant auth login` keeps profiles; overridable for tests. */
  anthropicProfileDirs?: string[];
}

/** Builds providers lazily from `providers:` in the config; API keys only ever come from the environment. */
export class ProviderRegistry {
  private readonly settings: Settings;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cache = new Map<string, ModelProvider>();
  private readonly overrides: Record<string, ModelProvider>;
  private readonly anthropicProfileDirs: string[];

  constructor(settings: Settings, options: RegistryOptions = {}) {
    this.settings = settings;
    this.env = options.env ?? process.env;
    this.overrides = options.overrides ?? {};
    this.anthropicProfileDirs = options.anthropicProfileDirs ?? defaultAnthropicProfileDirs(this.env);
  }

  resolve(ref: string): { provider: ModelProvider; model: string } {
    const { provider, model } = parseModelRef(ref);
    return { provider: this.provider(provider), model };
  }

  /** Fails early, before a climb starts, when a provider in use has no credentials. */
  checkCredentials(refs: readonly string[]): string[] {
    const problems = new Set<string>();
    for (const ref of refs) {
      try {
        this.resolve(ref);
      } catch (error) {
        problems.add((error as Error).message);
      }
    }
    return [...problems];
  }

  private provider(name: string): ModelProvider {
    const override = this.overrides[name];
    if (override) return override;
    const cached = this.cache.get(name);
    if (cached) return cached;
    const settings = this.settings.providers[name];
    if (!settings) throw new MissingCredentialsError(`provedor "${name}" não está em providers: no mohs.yaml`);
    const provider = this.build(name, settings);
    this.cache.set(name, provider);
    return provider;
  }

  private hasAnthropicCredentials(): boolean {
    return ANTHROPIC_CREDENTIAL_ENV.some((name) => this.env[name]) || this.anthropicProfileDirs.some(isDir);
  }

  private build(name: string, settings: ProviderSettings): ModelProvider {
    const apiKey = settings.apiKeyEnv ? this.env[settings.apiKeyEnv] : undefined;
    const { effort, fallbacks } = this.settings.agents;
    if (settings.type === "anthropic") {
      if (!apiKey && !this.hasAnthropicCredentials()) {
        throw new MissingCredentialsError("Anthropic sem credenciais: defina ANTHROPIC_API_KEY ou rode `ant auth login`");
      }
      return new AnthropicProvider({ apiKey, baseURL: settings.baseUrl, effort, fallbacks });
    }

    if (!settings.baseUrl) throw new MissingCredentialsError(`provedor "${name}" precisa de base_url`);
    if (!apiKey) throw new MissingCredentialsError(`defina a variável ${settings.apiKeyEnv ?? "de API"} para usar o provedor "${name}"`);
    return new OpenAICompatibleProvider({ name, baseUrl: settings.baseUrl, apiKey });
  }
}
