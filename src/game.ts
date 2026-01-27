// src/game.ts

import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { RunnableSequence } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { AgentExecutor, AgentStep, AgentAction, AgentFinish } from 'langchain/agents';
import { BaseOutputParser } from '@langchain/core/output_parsers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import axios from 'axios';
import { z } from 'zod';
import type { MCPClientInfo, MCPServerConfig } from './types/game.js';

const MAX_ITERATIONS = 10;

interface UserLocation {
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
  description: string;
}
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 2000;
const MAX_RETRY_DELAY = 30000;

/**
 * Extract JSON from a string, handling extra content after it
 */
function extractJSON(str: string): string {
  const trimmed = str.trim();
  
  if (trimmed === '{}' || trimmed.startsWith('{}')) {
    return '{}';
  }
  
  if (trimmed === '[]' || trimmed.startsWith('[]')) {
    return '[]';
  }
  
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      return extractJSON(jsonMatch[1]);
    }
    return trimmed;
  }
  
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          return trimmed.substring(0, i + 1);
        }
      }
    }
  }
  
  return trimmed.split('\n')[0].trim();
}

/**
 * Custom ReAct parser
 */
class FlexibleReActParser extends BaseOutputParser<AgentAction | AgentFinish> {
  private toolNames: string[];

  constructor(toolNames: string[]) {
    super();
    this.toolNames = toolNames;
  }

  lc_namespace = ['langchain', 'agents', 'react'];

  getFormatInstructions(): string {
    return `Thought: reasoning\nAction: tool_name\nAction Input: {"key": "value"}`;
  }

  async parse(text: string): Promise<AgentAction | AgentFinish> {
    let cleanText = text.trim();
    
    // Remove XML-like tags
    cleanText = cleanText.replace(/<tool_output>[\s\S]*?<\/tool_output>/gi, '');
    cleanText = cleanText.replace(/<observation>[\s\S]*?<\/observation>/gi, '');
    cleanText = cleanText.replace(/<r>[\s\S]*?<\/result>/gi, '');
    
    // Check for Final Answer
    const finalAnswerMatch = cleanText.match(/Final Answer:\s*([\s\S]*?)$/i);
    if (finalAnswerMatch) {
      return {
        returnValues: { output: finalAnswerMatch[1].trim() },
        log: cleanText,
      };
    }

    // Look for Action
    const actionMatch = cleanText.match(/Action:\s*([^\n<]+)/i);
    const actionInputMatch = cleanText.match(/Action Input:\s*([\s\S]*)/i);

    let action: string | null = actionMatch ? actionMatch[1].trim() : null;
    let actionInput: string | null = null;
    
    if (actionInputMatch) {
      actionInput = extractJSON(actionInputMatch[1]);
    }

    if (action && actionInput !== null) {
      // Clean action name
      action = action.replace(/[^a-zA-Z0-9_-]/g, '');
      
      const matchedTool = this.toolNames.find(
        (t) => t.toLowerCase() === action!.toLowerCase()
      );

      if (!matchedTool) {
        const closeMatch = this.toolNames.find((t) =>
          t.toLowerCase().includes(action!.toLowerCase()) || 
          action!.toLowerCase().includes(t.toLowerCase())
        );

        if (closeMatch) {
          action = closeMatch;
        } else {
          throw new Error(`Unknown tool: "${action}". Available: ${this.toolNames.join(', ')}`);
        }
      } else {
        action = matchedTool;
      }

      // Parse JSON
      let parsedInput: Record<string, unknown>;
      let cleanInput = actionInput
        .replace(/^```json?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();

      if (!cleanInput || cleanInput === '{}' || cleanInput === 'None' || cleanInput === 'none') {
        parsedInput = {};
      } else {
        try {
          parsedInput = JSON.parse(cleanInput);
        } catch {
          try {
            const fixedInput = cleanInput
              .replace(/'/g, '"')
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']');
            parsedInput = JSON.parse(fixedInput);
          } catch {
            if (!cleanInput.startsWith('{') && !cleanInput.startsWith('[')) {
              parsedInput = { input: cleanInput };
            } else {
              throw new Error(`Invalid JSON: "${cleanInput.substring(0, 100)}"`);
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

    // Check for direct answer
    if (!cleanText.toLowerCase().includes('action:')) {
      const thoughtMatch = cleanText.match(/Thought:\s*([\s\S]*?)$/i);
      if (thoughtMatch && thoughtMatch[1].length > 50) {
        return {
          returnValues: { output: thoughtMatch[1].trim() },
          log: cleanText,
        };
      }
    }

    throw new Error(
      `Could not parse: "${cleanText.substring(0, 200)}..."\n` +
      `Expected: Action: tool_name\\nAction Input: {}`
    );
  }
}

export class SurvivalGame {
  private llm: ChatAnthropic;
  private tools: DynamicStructuredTool[];
  private mcpClients: MCPClientInfo[];
  private userLocation: UserLocation | null = null;

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: 'claude-sonnet-4-5-20250929',
      temperature: 0.3,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: MAX_RETRIES,
    });

    this.tools = [];
    this.mcpClients = [];
  }

  /**
   * Set the user's location manually
   */
  setLocation(location: {
    lat: number;
    lon: number;
    city: string;
    region: string;
    country: string;
    description: string;
  }): void {
    this.userLocation = location;
  }

  async detectUserLocation(): Promise<UserLocation> {
    try {
      const response = await axios.get('http://ip-api.com/json/', { timeout: 5000 });
      if (response.data.status === 'success') {
        const { lat, lon, city, regionName, country } = response.data;
        this.userLocation = {
          lat, lon, city,
          region: regionName,
          country,
          description: `Wilderness near ${city}, ${regionName}`,
        };
        return this.userLocation;
      }
    } catch (error) {
      console.warn('Could not detect location:', error instanceof Error ? error.message : String(error));
    }

    this.userLocation = {
      lat: 47.5, lon: -121.0,
      city: 'North Bend',
      region: 'Washington',
      country: 'United States',
      description: 'Cascade Mountains, Washington',
    };
    return this.userLocation;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isOverloadedError(error: unknown): boolean {
    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;
      const errStr = String(err.message || '').toLowerCase();
      if (errStr.includes('overloaded') || errStr.includes('rate limit') || errStr.includes('429')) {
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
          console.warn(`API overloaded, retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }
        if (!this.isOverloadedError(error)) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Unknown error after retries');
  }

  async initializeMCPServers(): Promise<void> {
    const servers: MCPServerConfig[] = [
      { name: 'state', script: 'src/mcp-servers/state-server.ts' },
      { name: 'environment', script: 'src/mcp-servers/environment-server.ts' },
      { name: 'knowledge', script: 'src/mcp-servers/knowledge-server.ts' },
      { name: 'scenario', script: 'src/mcp-servers/scenario-server.ts' },
      { name: 'wildlife', script: 'src/mcp-servers/wildlife-server.ts' },
    ];

    for (const server of servers) {
      try {
        const transport = new StdioClientTransport({
          command: 'tsx',
          args: [server.script],
        });

        const client = new Client(
          { name: 'survival-game-client', version: '1.0.0' },
          { capabilities: {} }
        );

        await client.connect(transport);
        this.mcpClients.push({ name: server.name, client, transport });

        const toolsList = await client.listTools();

        for (const tool of toolsList.tools) {
          const permissiveSchema = z.object({}).passthrough();

          const langchainTool = new DynamicStructuredTool({
            name: `${server.name}_${tool.name}`,
            description: tool.description || '',
            schema: permissiveSchema,
            func: async (input: Record<string, unknown>) => {
              try {
                const expectedProps = Object.keys(
                  (tool.inputSchema as { properties?: Record<string, unknown> })?.properties || {}
                );
                
                const filteredInput: Record<string, unknown> = {};
                for (const prop of expectedProps) {
                  if (input[prop] !== undefined) {
                    filteredInput[prop] = input[prop];
                  }
                }

                const result = await client.callTool({
                  name: tool.name,
                  arguments: filteredInput,
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
      } catch (error) {
        console.warn(`⚠ Could not connect to ${server.name} server:`, error instanceof Error ? error.message : String(error));
      }
    }

    console.log(`\n✓ Loaded ${this.tools.length} tools from MCP servers\n`);
  }

  createAgent(
    playerContext: string = '',
    getConversationHistory: () => string = () => ''
  ): AgentExecutor {
    const toolNames = this.tools.map((t) => t.name);
    const toolNamesStr = toolNames.join(', ');

    const toolsDescription = this.tools
      .map((t) => `• ${t.name}: ${t.description}`)
      .join('\n');

    const buildPromptTemplate = (): string => {
      const historyContext = getConversationHistory();
      
      return `You are a wilderness survival expert simulating a realistic 72-hour survival scenario.

CRITICAL NARRATIVE RULES:
1. NEVER restart or re-introduce the scenario
2. ALWAYS continue from where the story left off
3. React specifically to the player's current action
4. Keep the narrative consistent and immersive
5. Reference previous events when relevant
6. Do NOT repeat information the player already knows

${playerContext ? `PLAYER CONTEXT:\n${playerContext}\n` : ''}
${historyContext}

AVAILABLE TOOLS:
{tools}

RESPONSE FORMAT (follow exactly):

To use a tool:
Thought: [your reasoning]
Action: [exact tool name from list]
Action Input: [valid JSON - use {{}} for tools with no required parameters]

To give final answer:
Thought: I have enough information.
Final Answer: [your response continuing the narrative]

TOOLS: ${toolNamesStr}

YOUR FINAL ANSWER SHOULD:
1. Describe what happened as a result of their action (be specific and immersive)
2. Present the new situation or challenge they face
3. Optionally suggest 2-3 possible next actions

SURVIVAL PRIORITIES: Shelter > Water > Fire > Food

Question: {input}
{agent_scratchpad}`;
    };

    const prompt = PromptTemplate.fromTemplate(buildPromptTemplate());

    const modelWithStop = this.llm.bind({
      stop: ['\nObservation:', 'Observation:'],
    });

    let originalInput = '';

    const formatScratchpad = (steps: AgentStep[]): string => {
      if (!steps || steps.length === 0) {
        return 'Thought:';
      }

      const formatted = steps
        .map((step) => {
          const action = step.action as AgentAction;
          const inputStr =
            typeof action.toolInput === 'string'
              ? action.toolInput
              : JSON.stringify(action.toolInput);

          const thoughtPart = action.log?.match(/Thought:\s*([^\n]*)/i)?.[1]?.trim() || 'Processing...';

          return `Thought: ${thoughtPart}
Action: ${action.tool}
Action Input: ${inputStr}
Observation: ${step.observation}`;
        })
        .join('\n\n');

      return `${formatted}\n\nThought:`;
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
          throw new Error('Input is required');
        }

        return {
          input: finalInput,
          agent_scratchpad: formatScratchpad(input.steps || []),
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
      handleParsingErrors: (error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return `Error: ${errorMsg}

Use this EXACT format:
Thought: [reasoning]
Action: [tool from: ${toolNamesStr}]
Action Input: {"param": "value"} or {}

Or give final answer:
Thought: Done.
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
    const scenarioClient = this.mcpClients.find((c) => c.name === 'scenario');

    if (!stateClient) {
      throw new Error('State server not found');
    }

    if (!this.userLocation) {
      await this.detectUserLocation();
    }

    try {
      const result = await stateClient.client.callTool({
        name: 'initialize_game',
        arguments: {
          lat: this.userLocation?.lat,
          lon: this.userLocation?.lon,
          location_description: this.userLocation?.description,
        },
      });

      const contentArray = result.content as Array<{ type: string; text?: string }>;
      const content = contentArray[0];
      if (!content || content.type !== 'text' || !content.text) {
        return JSON.stringify(result.content);
      }

      const data = JSON.parse(content.text);

      let scenarioText = '';
      if (scenarioClient) {
        try {
          const scenarioResult = await scenarioClient.client.callTool({
            name: 'generate_scenario',
            arguments: {
              hours_survived: 0,
              core_temperature_f: data.starting_conditions.core_temperature_f,
              hydration_level: data.starting_conditions.hydration_level,
              energy_level: data.starting_conditions.energy_level,
              fatigue: data.starting_conditions.fatigue,
              injuries: data.starting_conditions.injuries,
              has_shelter: false,
              has_fire: false,
              has_water: false,
              inventory_summary: [...data.inventory.gear, ...data.inventory.resources],
            },
          });

          const scenarioContentArray = scenarioResult.content as Array<{ type: string; text?: string }>;
          const scenarioContent = scenarioContentArray[0];
          if (scenarioContent && scenarioContent.type === 'text' && scenarioContent.text) {
            const scenario = JSON.parse(scenarioContent.text);
            if (scenario.scenario) {
              scenarioText = `\n\n${scenario.scenario.title}\n\n${scenario.scenario.description}`;
            }
          }
        } catch (scenarioError) {
          console.warn('Could not generate scenario:', scenarioError instanceof Error ? scenarioError.message : String(scenarioError));
        }
      }

      return `${data.message} Your priority is to find shelter and water.${scenarioText}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize: ${errorMessage}`);
    }
  }

  async getCurrentStatus(): Promise<{
    vitals: {
      core_temperature_f: number;
      hydration_level: number;
      energy_level: number;
      fatigue: number;
      injuries: string[];
    };
    inventory: {
      clothing: string[];
      gear: string[];
      resources: string[];
      food: string[];
    };
  }> {
    const stateClient = this.mcpClients.find((c) => c.name === 'state');
    if (!stateClient) {
      throw new Error('State server not found');
    }

    const result = await stateClient.client.callTool({
      name: 'check_status',
      arguments: {},
    });

    const contentArray = result.content as Array<{ type: string; text?: string }>;
    const content = contentArray[0];
    if (!content || content.type !== 'text' || !content.text) {
      throw new Error('Invalid status response');
    }

    const status = JSON.parse(content.text);
    return {
      vitals: status.vitals,
      inventory: status.inventory,
    };
  }

  /**
   * Get full game status including hours survived and flags
   */
  async getFullStatus(): Promise<{
    hours_survived: number;
    vitals: {
      core_temperature_f: number;
      hydration_level: number;
      energy_level: number;
      fatigue: number;
      injuries: string[];
    };
    inventory: {
      clothing: string[];
      gear: string[];
      resources: string[];
      food: string[];
    };
    shelter_built: boolean;
    fire_active: boolean;
  }> {
    const stateClient = this.mcpClients.find((c) => c.name === 'state');
    if (!stateClient) {
      throw new Error('State server not found');
    }

    const result = await stateClient.client.callTool({
      name: 'check_status',
      arguments: {},
    });

    const contentArray = result.content as Array<{ type: string; text?: string }>;
    const content = contentArray[0];
    if (!content || content.type !== 'text' || !content.text) {
      throw new Error('Invalid status response');
    }

    const status = JSON.parse(content.text);
    return {
      hours_survived: status.hours_survived || 0,
      vitals: status.vitals,
      inventory: status.inventory,
      shelter_built: status.shelter_built || false,
      fire_active: status.fire_active || false,
    };
  }

  /**
   * Restore game state from a saved game
   */
  async restoreGameState(savedState: {
    hours_survived: number;
    player_vitals: {
      core_temperature_f: number;
      hydration_level: number;
      energy_level: number;
      fatigue: number;
      injuries: string[];
    };
    inventory: {
      clothing: string[];
      gear: string[];
      resources: string[];
      food: string[];
    };
    location: {
      lat: number;
      lon: number;
      description: string;
    };
    shelter_built: boolean;
    fire_active: boolean;
  }): Promise<void> {
    const stateClient = this.mcpClients.find((c) => c.name === 'state');
    if (!stateClient) {
      throw new Error('State server not found');
    }

    // Try restore_state tool first
    try {
      await stateClient.client.callTool({
        name: 'restore_state',
        arguments: savedState,
      });
    } catch {
      // Fallback: initialize then manually set state
      console.warn('restore_state not available, using fallback...');
      
      await stateClient.client.callTool({
        name: 'initialize_game',
        arguments: {
          lat: savedState.location.lat,
          lon: savedState.location.lon,
          location_description: savedState.location.description,
        },
      });
    }

    // Update internal location
    this.userLocation = {
      lat: savedState.location.lat,
      lon: savedState.location.lon,
      city: '',
      region: '',
      country: '',
      description: savedState.location.description,
    };
  }

  async getCurrentScenario(): Promise<{
    has_active_scenario: boolean;
    scenario: {
      id: string;
      type: string;
      title: string;
      description: string;
      options: Array<{
        id: number;
        action: string;
        risk_level: string;
        energy_cost: string;
        time_estimate: string;
      }>;
    } | null;
  }> {
    const scenarioClient = this.mcpClients.find((c) => c.name === 'scenario');
    if (!scenarioClient) {
      return { has_active_scenario: false, scenario: null };
    }

    try {
      const result = await scenarioClient.client.callTool({
        name: 'get_current_scenario',
        arguments: {},
      });

      const contentArray = result.content as Array<{ type: string; text?: string }>;
      const content = contentArray[0];
      if (content && content.type === 'text' && content.text) {
        return JSON.parse(content.text);
      }
    } catch {
      // No active scenario
    }

    return { has_active_scenario: false, scenario: null };
  }

  async generateNewScenario(): Promise<{
    scenario: {
      id: string;
      type: string;
      title: string;
      description: string;
      options: Array<{
        id: number;
        action: string;
        risk_level: string;
        energy_cost: string;
        time_estimate: string;
      }>;
    } | null;
  }> {
    const scenarioClient = this.mcpClients.find((c) => c.name === 'scenario');
    const stateClient = this.mcpClients.find((c) => c.name === 'state');
    
    if (!scenarioClient || !stateClient) {
      return { scenario: null };
    }

    try {
      const statusResult = await stateClient.client.callTool({
        name: 'check_status',
        arguments: {},
      });

      const statusContent = (statusResult.content as Array<{ type: string; text?: string }>)[0];
      const status = statusContent?.text ? JSON.parse(statusContent.text) : {};

      const result = await scenarioClient.client.callTool({
        name: 'generate_scenario',
        arguments: {
          hours_survived: status.hours_survived || 0,
          core_temperature_f: status.vitals?.core_temperature_f || 98.6,
          hydration_level: status.vitals?.hydration_level || 80,
          energy_level: status.vitals?.energy_level || 70,
          fatigue: status.vitals?.fatigue || 30,
          injuries: status.vitals?.injuries || [],
          has_shelter: status.shelter_built || false,
          has_fire: status.fire_active || false,
          has_water: false,
          inventory_summary: [
            ...(status.inventory?.gear || []),
            ...(status.inventory?.resources || []),
          ],
        },
      });

      const contentArray = result.content as Array<{ type: string; text?: string }>;
      const content = contentArray[0];
      if (content && content.type === 'text' && content.text) {
        const data = JSON.parse(content.text);
        return { scenario: data.scenario };
      }
    } catch (error) {
      console.warn('Could not generate scenario:', error instanceof Error ? error.message : String(error));
    }

    return { scenario: null };
  }

  parseOptionsFromResponse(response: string): Array<{ id: number; text: string }> {
    const options: Array<{ id: number; text: string }> = [];
    
    const optionRegex = /^(\d+)\.\s*\*?\*?([^*\n]+)\*?\*?\s*[-–—]?\s*(.*)$/gm;
    
    let match;
    while ((match = optionRegex.exec(response)) !== null) {
      const id = parseInt(match[1], 10);
      const title = match[2].trim();
      const description = match[3]?.trim() || '';
      
      const text = description ? `${title} - ${description}` : title;
      
      if (id >= 1 && id <= 5 && title.length > 3) {
        options.push({ id, text });
      }
    }
    
    if (options.length === 0) {
      const simpleRegex = /^(\d+)\.\s+(.+)$/gm;
      while ((match = simpleRegex.exec(response)) !== null) {
        const id = parseInt(match[1], 10);
        const text = match[2].trim().replace(/\*\*/g, '');
        
        if (id >= 1 && id <= 5 && text.length > 10) {
          options.push({ id, text });
        }
      }
    }
    
    return options;
  }

  getActionForOption(response: string, optionNumber: number): string | null {
    const options = this.parseOptionsFromResponse(response);
    const option = options.find(o => o.id === optionNumber);
    return option?.text || null;
  }

  async getCurrentWeather(): Promise<string> {
    const environmentClient = this.mcpClients.find((c) => c.name === 'environment');
    const stateClient = this.mcpClients.find((c) => c.name === 'state');
    
    if (!environmentClient) {
      return '🌤️ Weather: Unable to fetch\n';
    }

    let lat = this.userLocation?.lat || 47.5;
    let lon = this.userLocation?.lon || -121.0;

    if (stateClient) {
      try {
        const locationResult = await stateClient.client.callTool({
          name: 'get_location',
          arguments: {},
        });
        const locationContentArray = locationResult.content as Array<{ type: string; text?: string }>;
        const locationContent = locationContentArray[0];
        if (locationContent && locationContent.type === 'text' && locationContent.text) {
          const location = JSON.parse(locationContent.text);
          lat = location.lat;
          lon = location.lon;
        }
      } catch {
        // Use fallback
      }
    }

    try {
      const weatherResult = await environmentClient.client.callTool({
        name: 'get_weather_conditions',
        arguments: { lat, lon },
      });

      const weatherContentArray = weatherResult.content as Array<{ type: string; text?: string }>;
      const weatherContent = weatherContentArray[0];
      if (weatherContent && weatherContent.type === 'text' && weatherContent.text) {
        const weather = JSON.parse(weatherContent.text);
        return (
          `🌤️ Weather:\n` +
          `  • Temperature: ${weather.temperature}°${weather.temperature_unit}\n` +
          `  • Conditions: ${weather.short_forecast}\n` +
          `  • Wind: ${weather.wind_speed} ${weather.wind_direction || ''}\n` +
          `  • Precipitation: ${weather.precipitation_probability}%\n`
        );
      }
    } catch (error) {
      console.warn('Weather fetch failed:', error instanceof Error ? error.message : String(error));
    }

    return '🌤️ Weather: Unable to fetch\n';
  }

  formatConditions(
    vitals: {
      core_temperature_f: number;
      hydration_level: number;
      energy_level: number;
      fatigue: number;
      injuries: string[];
    },
    label: 'Starting Conditions' | 'Current Conditions' = 'Current Conditions'
  ): string {
    const emoji = label === 'Starting Conditions' ? '🏁' : '🧭';
    return (
      `${emoji} ${label}:\n` +
      `  • Core Temp: ${vitals.core_temperature_f.toFixed(1)}°F\n` +
      `  • Hydration: ${vitals.hydration_level}%\n` +
      `  • Energy: ${vitals.energy_level}%\n` +
      `  • Fatigue: ${vitals.fatigue}%\n` +
      `  • Injuries: ${vitals.injuries.length > 0 ? vitals.injuries.join(', ') : 'None'}\n`
    );
  }

  formatInventory(inventory: {
    clothing: string[];
    gear: string[];
    resources: string[];
    food: string[];
  }): string {
    return (
      `🎒 Inventory:\n` +
      `  • Clothing: ${inventory.clothing.join(', ')}\n` +
      `  • Gear: ${inventory.gear.join(', ')}\n` +
      `  • Resources: ${inventory.resources.length > 0 ? inventory.resources.join(', ') : 'None'}\n` +
      `  • Food: ${inventory.food.length > 0 ? inventory.food.join(', ') : 'None'}\n`
    );
  }

  async cleanup(): Promise<void> {
    for (const { client, transport } of this.mcpClients) {
      await client.close();
      await transport.close();
    }
  }
}