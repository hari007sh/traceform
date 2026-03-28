import { SpanType } from '../types';
import { getGlobalClient, getGlobalSession } from '../index';

/**
 * Auto-instrumentation for the OpenAI Agents SDK (@openai/agents).
 *
 * Wraps the Runner.run() method to automatically create spans for each
 * agent execution, capturing agent name, model, and outputs.
 *
 * @example
 * ```ts
 * import { instrumentOpenAIAgents } from '@traceform/sdk';
 *
 * // Call once at startup to patch the agents runner
 * instrumentOpenAIAgents();
 *
 * // All subsequent Runner.run() calls are traced
 * import { Runner } from '@openai/agents';
 * const result = await Runner.run(agent, 'Hello');
 * ```
 */

interface AgentsModule {
  Runner?: {
    run?: (...args: unknown[]) => Promise<unknown>;
  };
}

interface RunResult {
  output?: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

let _instrumented = false;
let _originalRun: ((...args: unknown[]) => Promise<unknown>) | null = null;

export function instrumentOpenAIAgents(): void {
  if (_instrumented) return;

  let agents: AgentsModule;
  try {
    agents = require('@openai/agents') as AgentsModule;
  } catch {
    // @openai/agents package not installed, skip
    return;
  }

  if (agents.Runner?.run) {
    _originalRun = agents.Runner.run;
    const originalFn = _originalRun;

    agents.Runner.run = async function tracedRun(
      ...args: unknown[]
    ): Promise<unknown> {
      const client = getGlobalClient();
      const session = getGlobalSession();

      if (!client || !session) {
        return originalFn(...args);
      }

      // First arg is typically the agent definition
      const agent = (args[0] ?? {}) as Record<string, unknown>;
      const agentName =
        typeof agent.name === 'string' ? agent.name : 'agent';
      const model =
        typeof agent.model === 'string' ? agent.model : 'unknown';

      const span = session.createSpan(
        `openai.agents.${agentName}`,
        SpanType.AGENT,
      );
      span.setModel(model);

      // Capture the input (second arg is usually the prompt/messages)
      if (args.length > 1) {
        const input = args[1];
        const inputStr =
          typeof input === 'string'
            ? input.slice(0, 2000)
            : JSON.stringify(input).slice(0, 2000);
        span.setInput(inputStr);
      }

      try {
        const result = (await originalFn(...args)) as RunResult;

        if (result.output !== undefined) {
          const outputStr =
            typeof result.output === 'string'
              ? result.output.slice(0, 2000)
              : JSON.stringify(result.output).slice(0, 2000);
          span.setOutput(outputStr);
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

  _instrumented = true;
}

export function uninstrumentOpenAIAgents(): void {
  if (!_instrumented) return;

  try {
    const agents = require('@openai/agents') as AgentsModule;

    if (_originalRun && agents.Runner) {
      agents.Runner.run = _originalRun;
    }
  } catch {
    // package not available
  }

  _originalRun = null;
  _instrumented = false;
}
