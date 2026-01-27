// src/mcp-servers/state-server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { GameState } from '../types/game.js';
import type { ActivityLevel, InventoryAction, InventoryCategory } from '../types/mcp.js';

// Game state storage
let gameState: GameState = {
  hours_survived: 0,
  player_vitals: {
    core_temperature_f: 98.6,
    hydration_level: 80,
    energy_level: 70,
    fatigue: 30,
    injuries: []
  },
  inventory: {
    clothing: ['hiking boots', 'jeans', 't-shirt', 'light jacket'],
    gear: ['backpack', 'water bottle (empty)', 'knife'],
    resources: [],
    food: []
  },
  location: {
    lat: 47.5,
    lon: -121.0,
    description: 'Dense forest, moderate elevation'
  },
  shelter_built: false,
  fire_active: false,
  decisions_log: []
};

// Create server instance
const server = new Server(
  {
    name: 'state-server',
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
        name: 'check_status',
        description: 'Get complete player status: vitals, inventory, time survived',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'initialize_game',
        description: 'Start a new game with initial conditions. Optionally provide location coordinates.',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude of the survival location' },
            lon: { type: 'number', description: 'Longitude of the survival location' },
            location_description: { type: 'string', description: 'Description of the location (e.g., "Rocky Mountains, Colorado")' },
          },
          required: [],
        },
      },
      {
        name: 'get_location',
        description: 'Get the current game location coordinates',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'set_location',
        description: 'Update the game location coordinates',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lon: { type: 'number', description: 'Longitude' },
            description: { type: 'string', description: 'Location description' },
          },
          required: ['lat', 'lon'],
        },
      },
      {
        name: 'update_vitals',
        description: 'Update player vitals based on an action or event',
        inputSchema: {
          type: 'object',
          properties: {
            temperature_change: { type: 'number' },
            hydration_change: { type: 'number' },
            energy_change: { type: 'number' },
            fatigue_change: { type: 'number' },
            add_injury: { type: 'string' }
          },
        },
      },
      {
        name: 'manage_inventory',
        description: 'Add or remove items from inventory',
        inputSchema: {
          type: 'object',
          properties: {
            action: { 
              type: 'string', 
              enum: ['add', 'remove', 'use'] 
            },
            category: { 
              type: 'string', 
              enum: ['clothing', 'gear', 'resources', 'food'] 
            },
            item: { type: 'string' }
          },
          required: ['action', 'category', 'item'],
        },
      },
      {
        name: 'advance_time',
        description: 'Move game time forward and apply passive effects',
        inputSchema: {
          type: 'object',
          properties: {
            hours: { type: 'number' },
            activity_level: { 
              type: 'string', 
              enum: ['resting', 'light', 'moderate', 'heavy'] 
            },
            sheltered: { type: 'boolean' },
            near_fire: { type: 'boolean' }
          },
          required: ['hours', 'activity_level'],
        },
      },
      {
        name: 'calculate_survival_score',
        description: 'Calculate current survival score and win/lose conditions',
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
    case 'initialize_game': {
      const initArgs = args as {
        lat?: number;
        lon?: number;
        location_description?: string;
      };

      gameState.hours_survived = 0;
      gameState.player_vitals.core_temperature_f = 97.5; // Slightly cold
      gameState.player_vitals.hydration_level = 60; // Thirsty
      gameState.player_vitals.injuries = ['Minor ankle sprain'];
      
      // Update location if provided
      if (initArgs.lat !== undefined && initArgs.lon !== undefined) {
        gameState.location.lat = initArgs.lat;
        gameState.location.lon = initArgs.lon;
      }
      if (initArgs.location_description) {
        gameState.location.description = initArgs.location_description;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Game initialized. You\'ve been lost for 2 hours already.',
              starting_conditions: gameState.player_vitals,
              inventory: gameState.inventory,
              location: gameState.location
            }, null, 2),
          },
        ],
      };
    }

    case 'get_location': {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(gameState.location, null, 2),
          },
        ],
      };
    }

    case 'set_location': {
      const locArgs = args as {
        lat: number;
        lon: number;
        description?: string;
      };

      gameState.location.lat = locArgs.lat;
      gameState.location.lon = locArgs.lon;
      if (locArgs.description) {
        gameState.location.description = locArgs.description;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Location updated',
              location: gameState.location
            }, null, 2),
          },
        ],
      };
    }

    case 'check_status': {
      const status = {
        hours_survived: gameState.hours_survived,
        hours_remaining: 72 - gameState.hours_survived,
        vitals: gameState.player_vitals,
        inventory: gameState.inventory,
        location: gameState.location,
        shelter_built: gameState.shelter_built,
        fire_active: gameState.fire_active
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }

    case 'update_vitals': {
      const vitals = gameState.player_vitals;
      const updateArgs = args as {
        temperature_change?: number;
        hydration_change?: number;
        energy_change?: number;
        fatigue_change?: number;
        add_injury?: string;
      };

      if (updateArgs.temperature_change !== undefined) {
        vitals.core_temperature_f += updateArgs.temperature_change;
      }
      if (updateArgs.hydration_change !== undefined) {
        vitals.hydration_level = Math.max(0, Math.min(100, 
          vitals.hydration_level + updateArgs.hydration_change));
      }
      if (updateArgs.energy_change !== undefined) {
        vitals.energy_level = Math.max(0, Math.min(100, 
          vitals.energy_level + updateArgs.energy_change));
      }
      if (updateArgs.fatigue_change !== undefined) {
        vitals.fatigue = Math.max(0, Math.min(100, 
          vitals.fatigue + updateArgs.fatigue_change));
      }
      if (updateArgs.add_injury) {
        vitals.injuries.push(updateArgs.add_injury);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Vitals updated',
              new_vitals: vitals
            }, null, 2),
          },
        ],
      };
    }

    case 'manage_inventory': {
      const { action, category, item } = args as {
        action: InventoryAction;
        category: InventoryCategory;
        item: string;
      };
      let result: string;

      if (action === 'add') {
        gameState.inventory[category].push(item);
        result = `Added ${item} to ${category}`;
      } else if (action === 'remove') {
        const index = gameState.inventory[category].indexOf(item);
        if (index > -1) {
          gameState.inventory[category].splice(index, 1);
          result = `Removed ${item} from ${category}`;
        } else {
          result = `${item} not found in ${category}`;
        }
      } else if (action === 'use') {
        result = `Used ${item}`;
      } else {
        result = 'Unknown action';
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              result,
              current_inventory: gameState.inventory
            }, null, 2),
          },
        ],
      };
    }

    case 'advance_time': {
      const { hours, activity_level, sheltered = false, near_fire = false } = args as {
        hours: number;
        activity_level: ActivityLevel;
        sheltered?: boolean;
        near_fire?: boolean;
      };
      
      gameState.hours_survived += hours;
      
      const vitals = gameState.player_vitals;
      
      // Temperature effects
      let tempChange = 0;
      if (!sheltered) tempChange -= 0.3 * hours;
      if (near_fire) tempChange += 0.5 * hours;
      vitals.core_temperature_f += tempChange;
      
      // Hydration loss
      const hydrationLoss: Record<ActivityLevel, number> = {
        resting: 1,
        light: 2,
        moderate: 3,
        heavy: 5
      };
      vitals.hydration_level -= hydrationLoss[activity_level] * hours;
      
      // Energy/fatigue
      const energyLoss: Record<ActivityLevel, number> = {
        resting: 0.5,
        light: 1,
        moderate: 2,
        heavy: 4
      };
      vitals.energy_level -= energyLoss[activity_level] * hours;
      
      if (activity_level === 'resting') {
        vitals.fatigue -= 5 * hours;
      } else {
        vitals.fatigue += 2 * hours;
      }
      
      // Clamp values
      vitals.hydration_level = Math.max(0, Math.min(100, vitals.hydration_level));
      vitals.energy_level = Math.max(0, Math.min(100, vitals.energy_level));
      vitals.fatigue = Math.max(0, Math.min(100, vitals.fatigue));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: `Time advanced ${hours} hours`,
              hours_survived: gameState.hours_survived,
              new_vitals: vitals,
              effects: {
                temperature_change: tempChange.toFixed(2),
                activity_level
              }
            }, null, 2),
          },
        ],
      };
    }

    case 'calculate_survival_score': {
      const vitals = gameState.player_vitals;
      const hours = gameState.hours_survived;
      
      let status = 'SURVIVING';
      
      if (vitals.core_temperature_f < 90) {
        status = 'CRITICAL - Severe hypothermia';
      } else if (vitals.hydration_level < 10) {
        status = 'CRITICAL - Severe dehydration';
      } else if (vitals.core_temperature_f < 95) {
        status = 'WARNING - Mild hypothermia';
      } else if (vitals.hydration_level < 30) {
        status = 'WARNING - Dehydrated';
      }
      
      if (hours >= 72) {
        if (vitals.core_temperature_f >= 95 && vitals.hydration_level >= 30) {
          status = 'VICTORY - Survived 72 hours!';
        }
      }
      
      const score = {
        hours_survived: hours,
        hours_remaining: 72 - hours,
        status,
        vitals_summary: {
          temperature: `${vitals.core_temperature_f}°F`,
          hydration: `${vitals.hydration_level}%`,
          energy: `${vitals.energy_level}%`,
          fatigue: `${vitals.fatigue}%`
        },
        survival_points: Math.floor(
          hours * 10 + 
          vitals.hydration_level + 
          (vitals.core_temperature_f - 95) * 10
        )
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(score, null, 2),
          },
        ],
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
  // Server is running silently on stdio
}

main().catch((error) => {
  // Only log fatal errors that prevent server startup
  process.stderr.write(`Fatal server error: ${error}\n`);
  process.exit(1);
});
