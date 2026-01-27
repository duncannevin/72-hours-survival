// src/mcp-servers/scenario-server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Types for scenario system
interface ActionOption {
  id: number;
  action: string;
  risk_level: 'low' | 'medium' | 'high';
  energy_cost: 'low' | 'medium' | 'high';
  time_estimate: string;
}

interface ScenarioEvent {
  id: string;
  type: 'challenge' | 'opportunity' | 'discovery' | 'danger' | 'weather_event' | 'wildlife';
  title: string;
  description: string;
  options: ActionOption[];
  timestamp_hours: number;
  resolved: boolean;
  outcome?: string;
  player_response?: string;
}

interface NarrativeState {
  current_location: string;
  time_of_day: 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk' | 'night';
  mood: 'hopeful' | 'neutral' | 'tense' | 'desperate' | 'critical';
  story_arc: 'beginning' | 'rising_action' | 'climax' | 'falling_action' | 'resolution';
  major_achievements: string[];
  major_failures: string[];
}

interface GameContext {
  hours_survived: number;
  vitals: {
    core_temperature_f: number;
    hydration_level: number;
    energy_level: number;
    fatigue: number;
    injuries: string[];
  };
  has_shelter: boolean;
  has_fire: boolean;
  has_water: boolean;
  inventory_summary: string[];
}

// Scenario storage
let scenarioHistory: ScenarioEvent[] = [];
let narrativeState: NarrativeState = {
  current_location: 'Dense forest clearing',
  time_of_day: 'afternoon',
  mood: 'tense',
  story_arc: 'beginning',
  major_achievements: [],
  major_failures: [],
};

// Scenario templates by category
const scenarioTemplates = {
  beginning: [
    {
      type: 'discovery' as const,
      templates: [
        {
          title: 'Rocky Outcrop Spotted',
          description: 'Through the trees, you spot a rocky outcrop about 200 yards away. A large fallen tree leans against it, creating what looks like a natural shelter. This could be your chance to get out of the elements.',
        },
        {
          title: 'Stream Sound',
          description: 'You hear the faint sound of running water somewhere to your left. Fresh water could save your life, but it means venturing off your current path.',
        },
        {
          title: 'Trail Markers',
          description: 'You notice what appears to be old trail blazes on a nearby tree - faded orange paint marks. They might lead to a maintained trail, or they could be decades old and lead nowhere.',
        },
      ],
    },
    {
      type: 'challenge' as const,
      templates: [
        {
          title: 'Fading Light',
          description: 'The sun is getting lower, and you estimate you have about 2 hours of useful daylight left. Whatever you plan to do for shelter, you need to decide now.',
        },
        {
          title: 'Ankle Pain Worsening',
          description: 'Your ankle is starting to throb more intensely. Every step sends a jolt of pain up your leg. You need to rest it, but stopping could mean exposure to the cold.',
        },
      ],
    },
  ],
  rising_action: [
    {
      type: 'wildlife' as const,
      templates: [
        {
          title: 'Bear Sign',
          description: 'You notice fresh bear scat on the ground and claw marks on a nearby tree. A black bear has been through here recently. You need to be careful about food storage and noise.',
        },
        {
          title: 'Deer Sighting',
          description: 'A doe and fawn are grazing about 50 yards away. They haven\'t noticed you yet. While you can\'t hunt them, their presence suggests water is nearby.',
        },
        {
          title: 'Distant Howling',
          description: 'Coyote calls echo through the valley as dusk approaches. They sound far away, but their presence is a reminder that you\'re not alone in these woods.',
        },
      ],
    },
    {
      type: 'opportunity' as const,
      templates: [
        {
          title: 'Dry Wood Cache',
          description: 'Beneath a dense evergreen, you find a pile of dry branches and pine needles protected from the elements. This would make excellent fire-starting material.',
        },
        {
          title: 'Berry Patch',
          description: 'You come across a patch of what looks like huckleberries. They\'re slightly past peak season but still edible. A small amount of food could boost your energy.',
        },
        {
          title: 'Abandoned Camp Remains',
          description: 'You stumble upon the remains of an old campsite - a fire ring made of stones and some scattered debris. Someone camped here before, which means this spot has advantages.',
        },
      ],
    },
    {
      type: 'danger' as const,
      templates: [
        {
          title: 'Unstable Ground',
          description: 'The ground beneath your feet feels soft and unstable. You might be walking on a covered ravine or unstable slope. One wrong step could be disastrous.',
        },
        {
          title: 'Temperature Drop',
          description: 'A cold wind picks up from the north. You can feel the temperature dropping rapidly. The forecast mentioned temps falling to 25°F - you need to get warm soon.',
        },
      ],
    },
  ],
  climax: [
    {
      type: 'weather_event' as const,
      templates: [
        {
          title: 'Storm Rolling In',
          description: 'Dark clouds are building over the mountain peaks to the west. The wind is picking up, and you can smell rain or snow in the air. You have maybe an hour before it hits.',
        },
        {
          title: 'Sudden Snow Squall',
          description: 'Snow begins falling heavily, reducing visibility to just a few dozen yards. The temperature is plummeting. This is a life-threatening situation.',
        },
      ],
    },
    {
      type: 'danger' as const,
      templates: [
        {
          title: 'Hypothermia Symptoms',
          description: 'Your fingers are numb and you\'ve started shivering uncontrollably. These are the early signs of hypothermia. You need warmth immediately - fire, shelter, or both.',
        },
        {
          title: 'Lost Bearings',
          description: 'In the fading light and falling snow, you\'ve lost track of your landmarks. Every direction looks the same. Panic is your enemy right now.',
        },
      ],
    },
    {
      type: 'opportunity' as const,
      templates: [
        {
          title: 'Rescue Helicopter',
          description: 'You hear the distant thump of helicopter rotors! Search and rescue might be looking for you. But they\'re far away, and you have no way to signal them effectively.',
        },
      ],
    },
  ],
  falling_action: [
    {
      type: 'discovery' as const,
      templates: [
        {
          title: 'Trail Found',
          description: 'You\'ve found a maintained trail! There are boot prints in the mud - other hikers use this path. Following it in either direction should eventually lead to civilization.',
        },
        {
          title: 'Ranger Station Sign',
          description: 'A weathered sign points to a ranger station, though the distance has worn off. It could be miles away, but it\'s a clear destination.',
        },
      ],
    },
    {
      type: 'challenge' as const,
      templates: [
        {
          title: 'River Crossing',
          description: 'The trail leads to a river crossing. The water is fast-moving and knee-deep at least. Crossing is risky, but it might be the fastest route to help.',
        },
        {
          title: 'Final Push',
          description: 'You\'re exhausted, dehydrated, and your body is failing. But you can see smoke in the distance - a cabin, a campsite, help. Can you make it?',
        },
      ],
    },
  ],
  resolution: [
    {
      type: 'discovery' as const,
      templates: [
        {
          title: 'Signs of Civilization',
          description: 'You can hear traffic in the distance! The low rumble of vehicles on a road somewhere nearby. You\'re close to getting out of this.',
        },
        {
          title: 'Rescue Approaching',
          description: 'Voices call out in the distance - your name! Search and rescue has found your trail. Wave, shout, make yourself known!',
        },
      ],
    },
  ],
};

// Helper functions
function generateId(): string {
  return `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getTimeOfDay(hours: number): NarrativeState['time_of_day'] {
  const hourOfDay = hours % 24;
  if (hourOfDay >= 5 && hourOfDay < 7) return 'dawn';
  if (hourOfDay >= 7 && hourOfDay < 11) return 'morning';
  if (hourOfDay >= 11 && hourOfDay < 14) return 'midday';
  if (hourOfDay >= 14 && hourOfDay < 17) return 'afternoon';
  if (hourOfDay >= 17 && hourOfDay < 20) return 'dusk';
  return 'night';
}

function getMood(context: GameContext): NarrativeState['mood'] {
  const { vitals, has_shelter, has_fire } = context;
  
  if (vitals.core_temperature_f < 95 || vitals.hydration_level < 20 || vitals.energy_level < 15) {
    return 'critical';
  }
  if (vitals.core_temperature_f < 97 || vitals.hydration_level < 40 || vitals.fatigue > 80) {
    return 'desperate';
  }
  if (!has_shelter && !has_fire && context.hours_survived > 6) {
    return 'tense';
  }
  if (has_shelter && has_fire) {
    return 'hopeful';
  }
  return 'neutral';
}

function getStoryArc(hours: number, achievements: string[], failures: string[]): NarrativeState['story_arc'] {
  if (hours >= 60) return 'resolution';
  if (hours >= 36) return 'falling_action';
  if (hours >= 12 || failures.length >= 2) return 'climax';
  if (hours >= 4 || achievements.length >= 1) return 'rising_action';
  return 'beginning';
}

// Generate context-appropriate action options for a scenario
function generateOptions(
  scenarioType: ScenarioEvent['type'],
  scenarioTitle: string,
  context: GameContext
): ActionOption[] {
  const options: ActionOption[] = [];
  
  // Base options that apply to many scenarios
  const baseOptions: Record<string, ActionOption[]> = {
    discovery: [
      { id: 1, action: 'Investigate carefully, watching for hazards', risk_level: 'low', energy_cost: 'medium', time_estimate: '30 min' },
      { id: 2, action: 'Approach quickly to save time', risk_level: 'medium', energy_cost: 'high', time_estimate: '15 min' },
      { id: 3, action: 'Observe from a distance first', risk_level: 'low', energy_cost: 'low', time_estimate: '10 min' },
      { id: 4, action: 'Mark the location and continue current path', risk_level: 'low', energy_cost: 'low', time_estimate: '5 min' },
    ],
    challenge: [
      { id: 1, action: 'Address the problem directly', risk_level: 'medium', energy_cost: 'high', time_estimate: '1 hour' },
      { id: 2, action: 'Find a workaround or alternative', risk_level: 'low', energy_cost: 'medium', time_estimate: '45 min' },
      { id: 3, action: 'Rest and reassess the situation', risk_level: 'low', energy_cost: 'low', time_estimate: '30 min' },
      { id: 4, action: 'Push through despite the difficulty', risk_level: 'high', energy_cost: 'high', time_estimate: '20 min' },
    ],
    opportunity: [
      { id: 1, action: 'Take full advantage of this opportunity', risk_level: 'low', energy_cost: 'medium', time_estimate: '30 min' },
      { id: 2, action: 'Gather what you can quickly and move on', risk_level: 'low', energy_cost: 'low', time_estimate: '15 min' },
      { id: 3, action: 'Set up here and make use of the resources', risk_level: 'low', energy_cost: 'high', time_estimate: '2 hours' },
      { id: 4, action: 'Note the location for later, prioritize other needs', risk_level: 'low', energy_cost: 'low', time_estimate: '5 min' },
    ],
    danger: [
      { id: 1, action: 'Retreat slowly and find another route', risk_level: 'low', energy_cost: 'medium', time_estimate: '20 min' },
      { id: 2, action: 'Proceed with extreme caution', risk_level: 'high', energy_cost: 'medium', time_estimate: '30 min' },
      { id: 3, action: 'Stop and assess the danger carefully', risk_level: 'low', energy_cost: 'low', time_estimate: '10 min' },
      { id: 4, action: 'Look for a way around the hazard', risk_level: 'medium', energy_cost: 'high', time_estimate: '45 min' },
    ],
    wildlife: [
      { id: 1, action: 'Back away slowly and quietly', risk_level: 'low', energy_cost: 'low', time_estimate: '10 min' },
      { id: 2, action: 'Make noise to scare it off', risk_level: 'medium', energy_cost: 'low', time_estimate: '5 min' },
      { id: 3, action: 'Stay still and wait for it to leave', risk_level: 'low', energy_cost: 'low', time_estimate: '15 min' },
      { id: 4, action: 'Take a wide detour around', risk_level: 'low', energy_cost: 'medium', time_estimate: '30 min' },
    ],
    weather_event: [
      { id: 1, action: 'Seek immediate shelter', risk_level: 'low', energy_cost: 'high', time_estimate: '15 min' },
      { id: 2, action: 'Build an emergency shelter where you are', risk_level: 'medium', energy_cost: 'high', time_estimate: '1 hour' },
      { id: 3, action: 'Try to outrun the weather to better ground', risk_level: 'high', energy_cost: 'high', time_estimate: '30 min' },
      { id: 4, action: 'Hunker down and protect yourself with what you have', risk_level: 'medium', energy_cost: 'low', time_estimate: '10 min' },
    ],
  };

  // Get base options for this scenario type
  options.push(...(baseOptions[scenarioType] || baseOptions.challenge));

  // Adjust options based on context
  if (context.vitals.energy_level < 30) {
    // Low energy - add rest option
    options.push({
      id: 5,
      action: 'Rest first to regain energy before acting',
      risk_level: 'low',
      energy_cost: 'low',
      time_estimate: '1 hour',
    });
  }

  if (context.vitals.hydration_level < 40) {
    // Dehydrated - prioritize water if scenario allows
    options.push({
      id: 6,
      action: 'Search for water sources nearby',
      risk_level: 'medium',
      energy_cost: 'medium',
      time_estimate: '45 min',
    });
  }

  // Renumber options
  return options.map((opt, idx) => ({ ...opt, id: idx + 1 }));
}

function selectScenario(
  context: GameContext,
  narrative: NarrativeState,
  recentTypes: string[]
): ScenarioEvent | null {
  const arcTemplates = scenarioTemplates[narrative.story_arc];
  if (!arcTemplates || arcTemplates.length === 0) return null;

  // Weight selection based on context
  const weights: Record<string, number> = {
    challenge: 1,
    opportunity: 1,
    discovery: 1,
    danger: 1,
    weather_event: 1,
    wildlife: 1,
  };

  // Adjust weights based on game state
  if (context.vitals.core_temperature_f < 97) weights.danger += 2;
  if (context.vitals.hydration_level < 50) weights.opportunity += 1;
  if (!context.has_shelter && context.hours_survived > 4) weights.challenge += 2;
  if (narrative.mood === 'critical') weights.danger += 3;
  if (narrative.mood === 'hopeful') weights.opportunity += 2;

  // Reduce weight for recently used types
  for (const type of recentTypes) {
    if (weights[type]) weights[type] *= 0.3;
  }

  // Filter available templates and apply weights
  const availableCategories = arcTemplates.filter(cat => {
    // Don't repeat exact scenarios from recent history
    return cat.templates.some(t => 
      !scenarioHistory.slice(-3).some(h => h.title === t.title)
    );
  });

  if (availableCategories.length === 0) return null;

  // Weighted random selection
  const totalWeight = availableCategories.reduce((sum, cat) => sum + (weights[cat.type] || 1), 0);
  let random = Math.random() * totalWeight;
  
  let selectedCategory = availableCategories[0];
  for (const cat of availableCategories) {
    random -= weights[cat.type] || 1;
    if (random <= 0) {
      selectedCategory = cat;
      break;
    }
  }

  // Select random template from category
  const availableTemplates = selectedCategory.templates.filter(t =>
    !scenarioHistory.slice(-5).some(h => h.title === t.title)
  );
  
  if (availableTemplates.length === 0) return null;
  
  const template = availableTemplates[Math.floor(Math.random() * availableTemplates.length)];
  const options = generateOptions(selectedCategory.type, template.title, context);

  return {
    id: generateId(),
    type: selectedCategory.type,
    title: template.title,
    description: template.description,
    options,
    timestamp_hours: context.hours_survived,
    resolved: false,
  };
}

// Create server instance
const server = new Server(
  {
    name: 'scenario-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'generate_scenario',
        description: 'Generate a new scenario/challenge based on current game state and narrative history. Returns a situation the player must respond to.',
        inputSchema: {
          type: 'object',
          properties: {
            hours_survived: { type: 'number', description: 'Current hours survived in game' },
            core_temperature_f: { type: 'number', description: 'Player core temperature' },
            hydration_level: { type: 'number', description: 'Player hydration percentage' },
            energy_level: { type: 'number', description: 'Player energy percentage' },
            fatigue: { type: 'number', description: 'Player fatigue percentage' },
            injuries: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Current injuries' 
            },
            has_shelter: { type: 'boolean', description: 'Whether player has built shelter' },
            has_fire: { type: 'boolean', description: 'Whether player has active fire' },
            has_water: { type: 'boolean', description: 'Whether player has water source' },
            inventory_summary: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Summary of key inventory items' 
            },
          },
          required: ['hours_survived'],
        },
      },
      {
        name: 'resolve_scenario',
        description: 'Mark a scenario as resolved and record the outcome. Call this after the player responds to a scenario.',
        inputSchema: {
          type: 'object',
          properties: {
            scenario_id: { type: 'string', description: 'ID of the scenario to resolve' },
            player_response: { type: 'string', description: 'What the player did in response' },
            outcome: { 
              type: 'string', 
              enum: ['success', 'partial_success', 'failure', 'avoided'],
              description: 'How the scenario was resolved' 
            },
            outcome_description: { type: 'string', description: 'Narrative description of what happened' },
          },
          required: ['scenario_id', 'outcome'],
        },
      },
      {
        name: 'get_narrative_context',
        description: 'Get the current narrative state including story arc, mood, and recent events for context-aware responses.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_scenario_history',
        description: 'Get the history of scenarios that have occurred, useful for maintaining narrative continuity.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum number of recent scenarios to return (default 5)' },
            include_unresolved: { type: 'boolean', description: 'Include unresolved scenarios (default true)' },
          },
        },
      },
      {
        name: 'update_location',
        description: 'Update the current narrative location description.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'New location description' },
          },
          required: ['location'],
        },
      },
      {
        name: 'record_achievement',
        description: 'Record a major achievement or failure for narrative tracking.',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['achievement', 'failure'] },
            description: { type: 'string', description: 'What was achieved or failed' },
          },
          required: ['type', 'description'],
        },
      },
      {
        name: 'get_current_scenario',
        description: 'Get the most recent unresolved scenario, if any.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'generate_scenario': {
      const context: GameContext = {
        hours_survived: (args as { hours_survived: number }).hours_survived || 0,
        vitals: {
          core_temperature_f: (args as { core_temperature_f?: number }).core_temperature_f || 98.6,
          hydration_level: (args as { hydration_level?: number }).hydration_level || 80,
          energy_level: (args as { energy_level?: number }).energy_level || 70,
          fatigue: (args as { fatigue?: number }).fatigue || 30,
          injuries: (args as { injuries?: string[] }).injuries || [],
        },
        has_shelter: (args as { has_shelter?: boolean }).has_shelter || false,
        has_fire: (args as { has_fire?: boolean }).has_fire || false,
        has_water: (args as { has_water?: boolean }).has_water || false,
        inventory_summary: (args as { inventory_summary?: string[] }).inventory_summary || [],
      };

      // Update narrative state
      narrativeState.time_of_day = getTimeOfDay(context.hours_survived);
      narrativeState.mood = getMood(context);
      narrativeState.story_arc = getStoryArc(
        context.hours_survived,
        narrativeState.major_achievements,
        narrativeState.major_failures
      );

      // Get recent scenario types to avoid repetition
      const recentTypes = scenarioHistory.slice(-3).map(s => s.type);

      // Generate scenario
      const scenario = selectScenario(context, narrativeState, recentTypes);

      if (!scenario) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'No suitable scenario available',
              narrative_state: narrativeState,
            }, null, 2),
          }],
        };
      }

      // Add to history
      scenarioHistory.push(scenario);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            scenario,
            narrative_context: {
              location: narrativeState.current_location,
              time_of_day: narrativeState.time_of_day,
              mood: narrativeState.mood,
              story_arc: narrativeState.story_arc,
            },
            prompt: `\n${scenario.title}\n\n${scenario.description}\n\nWhat do you do?`,
          }, null, 2),
        }],
      };
    }

    case 'resolve_scenario': {
      const { scenario_id, player_response, outcome, outcome_description } = args as {
        scenario_id: string;
        player_response?: string;
        outcome: 'success' | 'partial_success' | 'failure' | 'avoided';
        outcome_description?: string;
      };

      const scenario = scenarioHistory.find(s => s.id === scenario_id);
      if (!scenario) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Scenario not found', scenario_id }, null, 2),
          }],
        };
      }

      scenario.resolved = true;
      scenario.player_response = player_response;
      scenario.outcome = outcome_description || outcome;

      // Update achievements/failures
      if (outcome === 'success' && scenario.type === 'challenge') {
        narrativeState.major_achievements.push(`Overcame: ${scenario.title}`);
      } else if (outcome === 'failure' && (scenario.type === 'danger' || scenario.type === 'challenge')) {
        narrativeState.major_failures.push(`Failed: ${scenario.title}`);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Scenario resolved',
            scenario,
            updated_narrative: narrativeState,
          }, null, 2),
        }],
      };
    }

    case 'get_narrative_context': {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            narrative_state: narrativeState,
            recent_events: scenarioHistory.slice(-5).map(s => ({
              title: s.title,
              type: s.type,
              resolved: s.resolved,
              outcome: s.outcome,
            })),
            total_scenarios: scenarioHistory.length,
          }, null, 2),
        }],
      };
    }

    case 'get_scenario_history': {
      const limit = (args as { limit?: number }).limit || 5;
      const includeUnresolved = (args as { include_unresolved?: boolean }).include_unresolved !== false;

      let history = [...scenarioHistory];
      if (!includeUnresolved) {
        history = history.filter(s => s.resolved);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            scenarios: history.slice(-limit),
            total_count: scenarioHistory.length,
            unresolved_count: scenarioHistory.filter(s => !s.resolved).length,
          }, null, 2),
        }],
      };
    }

    case 'update_location': {
      const { location } = args as { location: string };
      narrativeState.current_location = location;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Location updated',
            current_location: location,
          }, null, 2),
        }],
      };
    }

    case 'record_achievement': {
      const { type, description } = args as { type: 'achievement' | 'failure'; description: string };

      if (type === 'achievement') {
        narrativeState.major_achievements.push(description);
      } else {
        narrativeState.major_failures.push(description);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: `${type} recorded`,
            achievements: narrativeState.major_achievements,
            failures: narrativeState.major_failures,
          }, null, 2),
        }],
      };
    }

    case 'get_current_scenario': {
      const unresolved = scenarioHistory.filter(s => !s.resolved);
      const current = unresolved.length > 0 ? unresolved[unresolved.length - 1] : null;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            has_active_scenario: current !== null,
            scenario: current,
            narrative_context: {
              location: narrativeState.current_location,
              time_of_day: narrativeState.time_of_day,
              mood: narrativeState.mood,
            },
          }, null, 2),
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Fatal server error: ${error}\n`);
  process.exit(1);
});
