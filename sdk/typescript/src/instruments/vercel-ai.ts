import { SpanType } from '../types';
import { getGlobalClient, getGlobalSession } from '../index';

/**
 * Auto-instrumentation for the Vercel AI SDK (ai package).
 *
 * Wraps streamText and generateText to automatically create spans for each
 * LLM call, capturing model, token usage, input/output, and errors.
 *
 * @example
 * ```ts
 * import { instrumentVercelAI } from '@traceform/sdk';
 *
 * // Call once at startup to patch the `ai` module
 * instrumentVercelAI();
 *
 * // All subsequent streamText / generateText calls are traced
 * import { generateText, streamText } from 'ai';
 * const result = await generateText({ model: openai('gpt-4o'), prompt: 'Hello' });
 * ```
 */

interface VercelAIModule {
  streamText?: (...args: unknown[]) => Promise<unknown>;
  generateText?: (...args: unknown[]) => Promise<unknown>;
}

interface GenerateTextResult {
  text?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

let _instrumented = false;
let _originalStreamText: ((...args: unknown[]) => Promise<unknown>) | null = null;
let _originalGenerateText: ((...args: unknown[]) => Promise<unknown>) | null = null;

export function instrumentVercelAI(): void {
  if (_instrumented) return;

  let ai: VercelAIModule;
  try {
    ai = require('ai') as VercelAIModule;
  } catch {
    // ai package not installed, skip
    return;
  }

  // Wrap generateText
  if (ai.generateText) {
    _originalGenerateText = ai.generateText;
    const originalFn = _originalGenerateText;

    ai.generateText = async function tracedGenerateText(
      ...args: unknown[]
    ): Promise<unknown> {
      const client = getGlobalClient();
      const session = getGlobalSession();

      if (!client || !session) {
        return originalFn(...args);
      }

      const options = (args[0] ?? {}) as Record<string, unknown>;
      const modelId =
        typeof (options.model as Record<string, unknown>)?.modelId === 'string'
          ? ((options.model as Record<string, unknown>).modelId as string)
          : 'unknown';

      const span = session.createSpan('ai.generateText', SpanType.LLM);
      span.setModel(modelId);

      // Capture input (last message or prompt)
      const messages = options.messages as unknown[] | undefined;
      const prompt = options.prompt;
      if (messages && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        const inputStr = JSON.stringify(lastMsg).slice(0, 2000);
        span.setInput(inputStr);
      } else if (prompt) {
        const inputStr = String(prompt).slice(0, 2000);
        span.setInput(inputStr);
      }

      try {
        const result = (await originalFn(...args)) as GenerateTextResult;

        if (result.text) {
          span.setOutput(result.text.slice(0, 2000));
        }

        if (result.usage) {
          span.setTokens(
            result.usage.promptTokens ?? 0,
            result.usage.completionTokens ?? 0,
          );
        }

        span.end();
        return result;
      } catch (err) {
        span.setError(err instanceof Error ? err : new Error(String(err)));
        span.end();
        throw err;
      }
    };
  }

  // Wrap streamText
  if (ai.streamText) {
    _originalStreamText = ai.streamText;
    const originalFn = _originalStreamText;

    ai.streamText = async function tracedStreamText(
      ...args: unknown[]
    ): Promise<unknown> {
      const client = getGlobalClient();
      const session = getGlobalSession();

      if (!client || !session) {
        return originalFn(...args);
      }

      const options = (args[0] ?? {}) as Record<string, unknown>;
      const modelId =
        typeof (options.model as Record<string, unknown>)?.modelId === 'string'
          ? ((options.model as Record<string, unknown>).modelId as string)
          : 'unknown';

      const span = session.createSpan('ai.streamText', SpanType.LLM);
      span.setModel(modelId);

      const messages = options.messages as unknown[] | undefined;
      const prompt = options.prompt;
      if (messages && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        const inputStr = JSON.stringify(lastMsg).slice(0, 2000);
        span.setInput(inputStr);
      } else if (prompt) {
        const inputStr = String(prompt).slice(0, 2000);
        span.setInput(inputStr);
      }

      try {
        const result = await originalFn(...args);
        // For streaming, we end the span immediately since we cannot
        // easily wrap the async iterator without changing the return type.
        span.end();
        return result;
      } catch (err) {
        span.setError(err instanceof Error ? err : new Error(String(err)));
        span.end();
        throw err;
      }
    };
  }

  _instrumented = true;
}

export function uninstrumentVercelAI(): void {
  if (!_instrumented) return;

  try {
    const ai = require('ai') as VercelAIModule;

    if (_originalGenerateText) {
      ai.generateText = _originalGenerateText;
    }
    if (_originalStreamText) {
      ai.streamText = _originalStreamText;
    }
  } catch {
    // ai package not available
  }

  _originalGenerateText = null;
  _originalStreamText = null;
  _instrumented = false;
}
