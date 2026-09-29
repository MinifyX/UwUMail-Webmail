/**
 * The kinds of AI providers a person can add, mirroring the server's presets (see the server's
 * docs/llm.md): what each one needs and which models it suggests. The server has the last word
 * on all of it; this only shapes the form.
 */

import type { AssistProviderKind } from "@/backend/types";

export interface AssistKind {
  kind: AssistProviderKind;
  /** The provider's own name, shown as it is in every language. */
  label: string;
  /** Needs an API key; `optional` for OpenAI-compatible servers that may run without one. */
  key: "required" | "optional" | "none";
  /** Reached at an address the person gives (`ollama`, `openaiCompatible`). */
  baseUrl: boolean;
  /** An example for the address field; documentation addresses only. */
  baseUrlExample?: string;
  /** Suggested models for writing and for everything else. */
  model: string;
  fastModel: string;
  /** Signs in with a ChatGPT subscription instead of a key (experimental). */
  signIn?: boolean;
}

export const ASSIST_KINDS: readonly AssistKind[] = [
  { kind: "openai", label: "OpenAI", key: "required", baseUrl: false, model: "gpt-5-mini", fastModel: "gpt-5-nano" },
  {
    kind: "anthropic",
    label: "Anthropic (Claude)",
    key: "required",
    baseUrl: false,
    model: "claude-sonnet-4-5",
    fastModel: "claude-haiku-4-5",
  },
  {
    kind: "gemini",
    label: "Google Gemini",
    key: "required",
    baseUrl: false,
    model: "gemini-2.5-flash",
    fastModel: "gemini-2.5-flash-lite",
  },
  {
    kind: "mistral",
    label: "Mistral",
    key: "required",
    baseUrl: false,
    model: "mistral-medium-latest",
    fastModel: "mistral-small-latest",
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    key: "required",
    baseUrl: false,
    model: "openai/gpt-5-mini",
    fastModel: "mistralai/mistral-small-3.2-24b-instruct",
  },
  {
    kind: "ollama",
    label: "Ollama",
    key: "none",
    baseUrl: true,
    baseUrlExample: "http://192.0.2.10:11434",
    model: "llama3.1:8b",
    fastModel: "llama3.2:3b",
  },
  {
    kind: "openaiCompatible",
    label: "OpenAI-compatible",
    key: "optional",
    baseUrl: true,
    baseUrlExample: "https://llm.example.com/v1",
    model: "",
    fastModel: "",
  },
  {
    kind: "chatgpt",
    label: "ChatGPT",
    key: "none",
    baseUrl: false,
    model: "gpt-5",
    fastModel: "gpt-5-mini",
    signIn: true,
  },
];

export function assistKind(kind: AssistProviderKind): AssistKind {
  return ASSIST_KINDS.find((entry) => entry.kind === kind) ?? ASSIST_KINDS[ASSIST_KINDS.length - 2]!;
}
