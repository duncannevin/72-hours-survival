// src/game.ts

import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { renderTextDescription } from 'langchain/tools/render';
import { ReActSingleInputOutputParser } from 'langchain/agents/react/output_parser';
import { formatLogToString } from 'langchain/agents/format_scratchpad/log';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { AgentExecutor, AgentStep, AgentAction } from 'langchain/agents';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MCPClientInfo, MCPServerConfig } from './types/game.js';

export class SurvivalGame {
  private llm: ChatAnthropic;
  private tools: DynamicStructuredTool[];
  private mcpClients: MCPClientInfo[];

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: 'claude-sonnet-4-5-20250929',
      temperature: 0.7,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 3,
    });

    this.tools = [];
    this.mcpClients = [];
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

      // Get tools from this server
      const toolsList = await client.listTools();

      // Convert MCP tools to LangChain tools
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
    // ReAct prompt template
    const toolNames = this.tools.map((t) => t.name).join(', ');

    const PROMPT_TEMPLATE = `You are a wilderness survival expert helping someone lost in the Pacific Northwest. 
Answer the following questions as best you can using the ReAct framework.

You have access to the following tools: {tools}

Use the following format EXACTLY:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [${toolNames}]
Action Input: the input to the action (must be valid JSON matching the tool's schema - use {{}} for tools that require no input)
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

CRITICAL: Action Input must be valid JSON. For tools with no required parameters, use an empty object: {{}}

Important survival priorities:
1. Shelter (hypothermia kills in 3 hours in PNW weather)
2. Water (dehydration kills in 3 days)
3. Fire (warmth, water purification, signaling)
4. Food (lowest priority for 72 hours)
5. Signaling (rescue)

Always check player status and environmental conditions before giving advice.
Be direct and realistic about dangers.

Begin!

Question: {input}
Thought: {agent_scratchpad}`;

    const prompt = PromptTemplate.fromTemplate(PROMPT_TEMPLATE);

    // Create the ReAct agent manually using RunnableSequence
    // Removed stop sequence to allow LLM to complete full Action/Action Input pairs
    const modelWithStop = this.llm.bind({
      stop: [],
    });

    const toolsDescription = renderTextDescription(this.tools);

    // Store the original input in a closure that persists across all iterations
    let originalInput: string = '';

    const agent = RunnableSequence.from([
      (input: Record<string, unknown> & { input?: string; steps?: AgentStep[] }) => {
        console.log('inputzzzzzzzzzzzzzzzz', input);
        // Always capture input when provided
        if (input.input && typeof input.input === 'string' && input.input.trim().length > 0) {
          originalInput = input.input;
        }

        // Ensure we always have a valid input
        const finalInput = (input.input && typeof input.input === 'string' && input.input.trim().length > 0)
          ? input.input
          : originalInput;

        // Ensure steps is AgentStep[] or provide a default initial step
        const defaultStep: AgentStep = {
          action: {
            tool: '_start',
            toolInput: '',
            log: 'Starting survival assistance in the Pacific Northwest.',
          },
          observation: 'Ready to help with survival priorities: shelter, water, fire, food, and signaling.',
        };
        const stepsArray = input.steps && input.steps.length > 0 ? input.steps : [defaultStep];
        const steps = formatLogToString(stepsArray);

        if (!finalInput || finalInput.trim().length === 0) {
          throw new Error('Input is required but was not provided');
        }

        return {
          input: finalInput,
          agent_scratchpad: steps,
          tools: toolsDescription,
        };
      },
      prompt,
      modelWithStop,
      new ReActSingleInputOutputParser({ toolNames: this.tools.map((t) => t.name) }),
    ]);

    // Create agent executor
    return new AgentExecutor({
      agent,
      tools: this.tools,
      verbose: process.env.NODE_ENV === 'development',
      maxIterations: 10,
      handleParsingErrors: (error) => {
        return `Error parsing agent output: ${error}. Please reformat your response and try again.`;
      },
    });
  }

  async cleanup(): Promise<void> {
    // Close all MCP clients
    for (const { client, transport } of this.mcpClients) {
      await client.close();
      await transport.close();
    }
  }
}
