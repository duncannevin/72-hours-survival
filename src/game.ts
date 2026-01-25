// src/game.ts

import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { RunnableSequence } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { AgentExecutor, AgentStep, AgentAction, AgentFinish } from 'langchain/agents';
import { BaseOutputParser } from '@langchain/core/output_parsers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MCPClientInfo, MCPServerConfig } from './types/game.js';

const MAX_ITERATIONS = 6;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 2000;
const MAX_RETRY_DELAY = 30000;

/**
 * Custom ReAct parser that's more forgiving than the default
 */
class FlexibleReActParser extends BaseOutputParser<AgentAction | AgentFinish> {
  private toolNames: string[];

  constructor(toolNames: string[]) {
    super();
    this.toolNames = toolNames;
  }

  lc_namespace = ['langchain', 'agents', 'react'];

  getFormatInstructions(): string {
    return `Use the following format:
Thought: your reasoning
Action: tool_name
Action Input: {"key": "value"}
OR
Thought: I now know the final answer
Final Answer: your final answer`;
  }

  async parse(text: string): Promise<AgentAction | AgentFinish> {
    // Clean up the text
    const cleanText = text.trim();

    // Check for Final Answer first (multiple patterns)
    const finalAnswerPatterns = [
      /Final Answer:\s*([\s\S]*?)$/i,
      /Final Answer\s*:\s*([\s\S]*?)$/i,
      /\*\*Final Answer\*\*:\s*([\s\S]*?)$/i,
    ];

    for (const pattern of finalAnswerPatterns) {
      const finalMatch = cleanText.match(pattern);
      if (finalMatch) {
        return {
          returnValues: { output: finalMatch[1].trim() },
          log: cleanText,
        };
      }
    }

    // Look for Action and Action Input
    // More flexible patterns that handle various formats
    const actionPatterns = [
      /Action:\s*([^\n]+)/i,
      /\*\*Action\*\*:\s*([^\n]+)/i,
      /Action\s*:\s*([^\n]+)/i,
    ];

    const actionInputPatterns = [
      /Action Input:\s*([\s\S]*?)(?=\n(?:Thought|Observation|Action:|Final Answer)|$)/i,
      /\*\*Action Input\*\*:\s*([\s\S]*?)(?=\n(?:Thought|Observation|Action:|Final Answer)|$)/i,
      /Action Input\s*:\s*([\s\S]*?)(?=\n(?:Thought|Observation|Action:|Final Answer)|$)/i,
    ];

    let action: string | null = null;
    let actionInput: string | null = null;

    // Find action
    for (const pattern of actionPatterns) {
      const match = cleanText.match(pattern);
      if (match) {
        action = match[1].trim();
        break;
      }
    }

    // Find action input
    for (const pattern of actionInputPatterns) {
      const match = cleanText.match(pattern);
      if (match) {
        actionInput = match[1].trim();
        break;
      }
    }

    if (action && actionInput !== null) {
      // Validate tool name
      const normalizedAction = action.toLowerCase().replace(/[^a-z0-9_]/g, '');
      const matchedTool = this.toolNames.find(
        (t) => t.toLowerCase() === normalizedAction || t.toLowerCase() === action.toLowerCase()
      );

      if (!matchedTool) {
        // Try to find a close match
        const closeMatch = this.toolNames.find((t) =>
          t.toLowerCase().includes(normalizedAction) || normalizedAction.includes(t.toLowerCase())
        );

        if (closeMatch) {
          action = closeMatch;
        } else {
          throw new Error(
            `Unknown tool: "${action}". Available tools: ${this.toolNames.join(', ')}`
          );
        }
      } else {
        action = matchedTool;
      }

      // Parse action input as JSON
      let parsedInput: Record<string, unknown>;

      // Clean up the action input
      let cleanInput = actionInput
        .replace(/^```json?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();

      // Handle empty input
      if (!cleanInput || cleanInput === '{}' || cleanInput === 'None' || cleanInput === 'none') {
        parsedInput = {};
      } else {
        try {
          parsedInput = JSON.parse(cleanInput);
        } catch {
          // Try to fix common JSON issues
          try {
            // Replace single quotes with double quotes
            const fixedInput = cleanInput
              .replace(/'/g, '"')
              // Fix trailing commas
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']');
            parsedInput = JSON.parse(fixedInput);
          } catch {
            // If it's a simple string, wrap it
            if (!cleanInput.startsWith('{') && !cleanInput.startsWith('[')) {
              // Try to infer the parameter name from the tool
              parsedInput = { input: cleanInput };
            } else {
              throw new Error(
                `Invalid JSON in Action Input: "${cleanInput}". Must be valid JSON like {"key": "value"} or {} for no parameters.`
              );
            }
          }
        }
      }

      return {
        tool: action,
        toolInput: parsedInput,
        log: cleanText,
      };
    }

    // If we can't parse, check if this looks like a direct answer
    if (
      !cleanText.toLowerCase().includes('action:') &&
      !cleanText.toLowerCase().includes('action input:')
    ) {
      // The model might be giving a direct answer without the format
      // Extract everything after the last "Thought:" if present
      const thoughtMatch = cleanText.match(/Thought:\s*([\s\S]*?)$/i);
      if (thoughtMatch && thoughtMatch[1].length > 50) {
        // Seems like a substantial response, treat it as final answer
        return {
          returnValues: { output: thoughtMatch[1].trim() },
          log: cleanText,
        };
      }
    }

    throw new Error(
      `Could not parse agent output: "${cleanText.substring(0, 200)}..."\n\n` +
        `Expected format:\n` +
        `Action: tool_name\n` +
        `Action Input: {"param": "value"}\n` +
        `OR\n` +
        `Final Answer: your answer`
    );
  }
}

export class SurvivalGame {
  private llm: ChatAnthropic;
  private tools: DynamicStructuredTool[];
  private mcpClients: MCPClientInfo[];

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: 'claude-sonnet-4-5-20250929',
      temperature: 0.3, // Even lower for more consistent formatting
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: MAX_RETRIES,
    });

    this.tools = [];
    this.mcpClients = [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isOverloadedError(error: unknown): boolean {
    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;

      if (err.error && typeof err.error === 'object') {
        const innerError = err.error as Record<string, unknown>;
        if (
          innerError.type === 'overloaded_error' ||
          innerError.message === 'Overloaded' ||
          (typeof innerError.message === 'string' &&
            innerError.message.toLowerCase().includes('overloaded'))
        ) {
          return true;
        }
      }

      if (
        err.type === 'overloaded_error' ||
        err.message === 'Overloaded' ||
        (typeof err.message === 'string' && err.message.toLowerCase().includes('overloaded'))
      ) {
        return true;
      }

      if (typeof err.message === 'string') {
        const msg = err.message.toLowerCase();
        if (
          msg.includes('overloaded') ||
          msg.includes('rate limit') ||
          msg.includes('429') ||
          msg.includes('too many requests') ||
          msg.includes('service is currently overloaded')
        ) {
          return true;
        }
      }

      const errorString = String(error).toLowerCase();
      if (
        errorString.includes('overloaded') ||
        errorString.includes('429') ||
        errorString.includes('rate limit') ||
        errorString.includes('too many requests')
      ) {
        return true;
      }
    }
    return false;
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = MAX_RETRIES,
    initialDelay: number = INITIAL_RETRY_DELAY
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (this.isOverloadedError(error) && attempt < maxRetries) {
          const delay = Math.min(initialDelay * Math.pow(2, attempt), MAX_RETRY_DELAY);
          console.warn(
            `API overloaded, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries + 1})`
          );
          await this.sleep(delay);
          continue;
        }

        if (!this.isOverloadedError(error)) {
          throw error;
        }

        if (attempt === maxRetries && this.isOverloadedError(error)) {
          const overloadError = new Error(
            'The AI service is currently overloaded. All retry attempts failed. Please wait a few minutes and try again.'
          );
          (overloadError as Record<string, unknown>).type = 'overloaded_error';
          throw overloadError;
        }
      }
    }

    throw lastError || new Error('Unknown error occurred after retries');
  }

  async initializeMCPServers(): Promise<void> {
    const servers: MCPServerConfig[] = [
      { name: 'state', script: 'src/mcp-servers/state-server.ts' },
      { name: 'environment', script: 'src/mcp-servers/environment-server.ts' },
      { name: 'knowledge', script: 'src/mcp-servers/knowledge-server.ts' },
    ];

    for (const server of servers) {
      const transport = new StdioClientTransport({
        command: 'tsx',
        args: [server.script],
      });

      const client = new Client(
        {
          name: 'survival-game-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await client.connect(transport);
      this.mcpClients.push({ name: server.name, client, transport });

      const toolsList = await client.listTools();

      for (const tool of toolsList.tools) {
        const langchainTool = new DynamicStructuredTool({
          name: `${server.name}_${tool.name}`,
          description: tool.description || '',
          schema: tool.inputSchema,
          func: async (input: Record<string, unknown>) => {
            try {
              const result = await client.callTool({
                name: tool.name,
                arguments: input,
              });
              const contentArray = result.content as Array<{ type: string; text?: string }>;
              const content = contentArray[0];
              if (content && content.type === 'text' && content.text) {
                return content.text;
              }
              return JSON.stringify(result.content);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return JSON.stringify({ error: errorMessage });
            }
          },
        });

        this.tools.push(langchainTool);
      }

      console.log(`✓ Connected to ${server.name} server (${toolsList.tools.length} tools)`);
    }

    console.log(`\n✓ Loaded ${this.tools.length} tools from ${servers.length} MCP servers\n`);
  }

  createAgent(): AgentExecutor {
    const toolNames = this.tools.map((t) => t.name);
    const toolNamesStr = toolNames.join(', ');

    // Simplified, cleaner prompt that's less likely to cause parsing issues
    const PROMPT_TEMPLATE = `You are a wilderness survival expert helping someone lost in Washington's Cascade Mountains.

Available tools: {tools}

FORMAT RULES - Follow exactly:

To use a tool:
Thought: [your reasoning]
Action: [tool name from list above]
Action Input: [valid JSON object, use empty braces if no params needed]

To give final answer:
Thought: I have enough information to answer.
Final Answer: [your helpful response]

TOOL LIST: ${toolNamesStr}

SURVIVAL PRIORITIES:
1. Shelter - hypothermia kills in 3 hours
2. Water - dehydration kills in 3 days  
3. Fire - warmth, purification, signaling
4. Food - lowest priority for 72 hours
5. Signaling - for rescue

EFFICIENCY: Most questions need only 1-2 tool calls. Get info, then give Final Answer immediately.

COMMON COORDINATES: lat: 47.5, lon: -121.0 (Cascade Mountains)

Begin!

Question: {input}
{agent_scratchpad}`;

    const prompt = PromptTemplate.fromTemplate(PROMPT_TEMPLATE);

    // Use stop sequences to help the model know when to stop
    const modelWithStop = this.llm.bind({
      stop: ['\nObservation:', '\nObservation :', 'Observation:'],
    });

    const toolsDescription = this.tools
      .map((t) => `${t.name}: ${t.description}`)
      .join('\n');

    let originalInput = '';

    const formatScratchpad = (steps: AgentStep[]): string => {
      if (!steps || steps.length === 0) {
        return '';
      }

      return steps
        .map((step) => {
          const action = step.action as AgentAction;
          const inputStr =
            typeof action.toolInput === 'string'
              ? action.toolInput
              : JSON.stringify(action.toolInput);

          return `Thought: ${action.log?.split('Action:')[0]?.replace('Thought:', '').trim() || 'Analyzing...'}
Action: ${action.tool}
Action Input: ${inputStr}
Observation: ${step.observation}`;
        })
        .join('\n\n');
    };

    const agent = RunnableSequence.from([
      (input: Record<string, unknown> & { input?: string; steps?: AgentStep[] }) => {
        if (input.input && typeof input.input === 'string' && input.input.trim().length > 0) {
          originalInput = input.input;
        }

        const finalInput =
          input.input && typeof input.input === 'string' && input.input.trim().length > 0
            ? input.input
            : originalInput;

        if (!finalInput || finalInput.trim().length === 0) {
          throw new Error('Input is required but was not provided');
        }

        const scratchpad = formatScratchpad(input.steps || []);
        // Add "Thought:" prefix if we have scratchpad content to guide the model
        const scratchpadWithPrompt = scratchpad ? `${scratchpad}\n\nThought:` : 'Thought:';

        return {
          input: finalInput,
          agent_scratchpad: scratchpadWithPrompt,
          tools: toolsDescription,
        };
      },
      prompt,
      modelWithStop,
      new FlexibleReActParser(toolNames),
    ]);

    return new AgentExecutor({
      agent,
      tools: this.tools,
      verbose: process.env.NODE_ENV === 'development',
      maxIterations: MAX_ITERATIONS,
      earlyStoppingMethod: 'generate', // Let model summarize if iterations run out
      handleParsingErrors: (error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Return a more helpful error that guides the model
        return `Parsing error: ${errorMsg}

Please respond in EXACTLY this format:
Thought: [your reasoning]
Action: [one of: ${toolNamesStr}]
Action Input: {"param": "value"}

Or if you're ready to answer:
Thought: I have the answer.
Final Answer: [your response]`;
      },
    });
  }

  async invokeAgentWithRetry(agent: AgentExecutor, input: { input: string }) {
    return this.retryWithBackoff(async () => {
      return await agent.invoke(input);
    });
  }

  async initializeGameDirectly(): Promise<string> {
    const stateClient = this.mcpClients.find((c) => c.name === 'state');
    const environmentClient = this.mcpClients.find((c) => c.name === 'environment');

    if (!stateClient) {
      throw new Error('State server not found');
    }

    try {
      const result = await stateClient.client.callTool({
        name: 'initialize_game',
        arguments: {},
      });

      const contentArray = result.content as Array<{ type: string; text?: string }>;
      const content = contentArray[0];
      if (!content || content.type !== 'text' || !content.text) {
        return JSON.stringify(result.content);
      }

      const data = JSON.parse(content.text);

      let weatherInfo = '';
      if (environmentClient) {
        try {
          const weatherResult = await environmentClient.client.callTool({
            name: 'get_weather_conditions',
            arguments: {
              lat: 47.5,
              lon: -121.0,
            },
          });

          const weatherContentArray = weatherResult.content as Array<{
            type: string;
            text?: string;
          }>;
          const weatherContent = weatherContentArray[0];
          if (weatherContent && weatherContent.type === 'text' && weatherContent.text) {
            const weather = JSON.parse(weatherContent.text);
            weatherInfo =
              `\nCurrent Weather:\n` +
              `- Temperature: ${weather.temperature}°${weather.temperature_unit}\n` +
              `- Conditions: ${weather.short_forecast}\n` +
              `- Wind: ${weather.wind_speed} ${weather.wind_direction || ''}\n` +
              `- Precipitation Chance: ${weather.precipitation_probability}%\n`;

            if (weather.detailed_forecast) {
              weatherInfo += `- Forecast: ${weather.detailed_forecast}\n`;
            }
          }
        } catch (weatherError) {
          console.warn(
            'Could not fetch weather conditions:',
            weatherError instanceof Error ? weatherError.message : String(weatherError)
          );
          weatherInfo = '\nWeather: Unable to fetch current conditions\n';
        }
      }

      return (
        `Game initialized! ${data.message}\n\nStarting Conditions:\n` +
        `- Core Temperature: ${data.starting_conditions.core_temperature_f}°F\n` +
        `- Hydration: ${data.starting_conditions.hydration_level}%\n` +
        `- Energy: ${data.starting_conditions.energy_level}%\n` +
        `- Fatigue: ${data.starting_conditions.fatigue}%\n` +
        `- Injuries: ${data.starting_conditions.injuries.join(', ')}\n` +
        weatherInfo +
        `\nInventory:\n` +
        `- Clothing: ${data.inventory.clothing.join(', ')}\n` +
        `- Gear: ${data.inventory.gear.join(', ')}\n` +
        `- Resources: ${data.inventory.resources.length > 0 ? data.inventory.resources.join(', ') : 'None'}\n` +
        `- Food: ${data.inventory.food.length > 0 ? data.inventory.food.join(', ') : 'None'}\n\n` +
        `You've been lost for 2 hours already. Your priority is to find shelter and water.`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize game: ${errorMessage}`);
    }
  }

  async cleanup(): Promise<void> {
    for (const { client, transport } of this.mcpClients) {
      await client.close();
      await transport.close();
    }
  }
}