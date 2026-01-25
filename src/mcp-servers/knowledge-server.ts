// src/mcp-servers/knowledge-server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { WaterSourceType } from '../types/mcp.js';

// Knowledge base
interface ShelterInfo {
  construction_time: string;
  materials: string;
  insulation_value: string;
  best_for: string;
  technique: string;
}

interface WaterInfo {
  safety: string;
  treatment: string;
  collection: string;
  yield?: string;
}

interface PlantInfo {
  edible: boolean;
  description: string;
  nutrition?: string;
  season?: string;
  danger?: string;
  warning?: string;
}

interface FirstAidInfo {
  symptoms_mild?: string;
  symptoms_severe?: string;
  treatment: string;
  critical?: string;
  assessment?: string;
  improvise?: string;
  guidance?: string;
}

const SHELTERS: Record<string, ShelterInfo> = {
  debris_shelter: {
    construction_time: '2-4 hours',
    materials: 'Branches, leaves, bark, boughs',
    insulation_value: 'Can add 15-20°F effective warmth',
    best_for: 'Emergency overnight shelter in forest',
    technique: 'Build ridgepole, lean branches at 45°, pile debris 2-3 feet thick'
  },
  lean_to: {
    construction_time: '1-2 hours',
    materials: 'Tarp or branches',
    insulation_value: 'Minimal without reflector fire',
    best_for: 'Quick setup with fire',
    technique: 'Requires continuous fire maintenance'
  }
};

const WATER_KNOWLEDGE: Record<string, WaterInfo> = {
  stream_water: {
    safety: 'HIGH RISK - Giardia, Cryptosporidium common in PNW',
    treatment: 'Boil 1 min, or filter + chemical, or UV',
    collection: 'Collect from fast-moving, clear sections'
  },
  rainwater: {
    safety: 'SAFER - but still filter/treat',
    treatment: 'Filter recommended, minimal treatment needed',
    collection: 'Use tarp, poncho, or bark channels',
    yield: 'Can collect 0.5-1 gallon per hour in steady rain'
  }
};

const PLANTS: Record<string, PlantInfo> = {
  salal: {
    edible: true,
    description: 'Dark blue-black berries, leathery leaves',
    nutrition: 'Moderate calories, vitamin C',
    season: 'Late summer/fall'
  },
  thimbleberry: {
    edible: true,
    description: 'Red raspberry-like, large maple-shaped leaves',
    nutrition: 'Low calorie but safe',
    season: 'Summer'
  },
  false_hellebore: {
    edible: false,
    description: 'Large pleated leaves, corn-stalk appearance',
    danger: 'TOXIC - causes vomiting, cardiac issues, death',
    warning: 'Common in wet areas, often mistaken for edible plants'
  }
};

const FIRST_AID: Record<string, FirstAidInfo> = {
  hypothermia: {
    symptoms_mild: 'Shivering, confusion, fumbling hands, slurred speech',
    symptoms_severe: 'No shivering, unconsciousness, weak pulse',
    treatment: 'Remove wet clothes, insulate from ground, warm core (not extremities), warm sweet drinks if conscious',
    critical: 'Below 90°F core temp is life-threatening'
  },
  sprained_ankle: {
    assessment: "Can't bear weight, swelling, pain on movement",
    treatment: 'RICE - Rest, Ice (cold stream), Compress (bandage/clothing), Elevate',
    improvise: 'Use sticks and bandana/shirt for splint if needed'
  }
};

const server = new Server(
  {
    name: 'knowledge-server',
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
        name: 'evaluate_shelter_location',
        description: 'Rate a proposed shelter location based on survival criteria',
        inputSchema: {
          type: 'object',
          properties: {
            location_description: { type: 'string' },
            current_weather: { type: 'string' }
          },
          required: ['location_description'],
        },
      },
      {
        name: 'identify_water_source_safety',
        description: 'Assess water source safety and recommend treatment',
        inputSchema: {
          type: 'object',
          properties: {
            source_type: { 
              type: 'string', 
              enum: ['stream', 'rain', 'snow', 'pond'] 
            },
            description: { type: 'string' }
          },
          required: ['source_type'],
        },
      },
      {
        name: 'check_plant_edibility',
        description: 'Identify if a plant is safe to eat based on description',
        inputSchema: {
          type: 'object',
          properties: {
            plant_description: { type: 'string' }
          },
          required: ['plant_description'],
        },
      },
      {
        name: 'assess_injury_treatment',
        description: 'Provide first aid guidance for injuries/conditions',
        inputSchema: {
          type: 'object',
          properties: {
            injury_type: { type: 'string' },
            symptoms: { type: 'string' }
          },
          required: ['injury_type'],
        },
      },
      {
        name: 'get_shelter_building_guide',
        description: 'Get detailed instructions for building a specific shelter type',
        inputSchema: {
          type: 'object',
          properties: {
            shelter_type: { type: 'string' }
          },
          required: ['shelter_type'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'evaluate_shelter_location': {
      const { location_description } = args as { location_description: string };
      const location = location_description.toLowerCase();
      
      interface ShelterRating {
        wind_protection: number;
        drainage: number;
        materials_available: number;
        hazards: string[];
        overall_rating: string;
      }

      const rating: ShelterRating = {
        wind_protection: 0,
        drainage: 0,
        materials_available: 0,
        hazards: [],
        overall_rating: ''
      };
      
      if (location.includes('cedar') || location.includes('tree')) {
        rating.wind_protection = 8;
        rating.materials_available = 9;
      }
      
      if (location.includes('hill') || location.includes('slope')) {
        rating.drainage = 7;
      } else {
        rating.drainage = 4;
        rating.hazards.push('Possible water pooling');
      }
      
      if (location.includes('clearing')) {
        rating.wind_protection = 3;
        rating.hazards.push('Exposed to wind/rain');
      }
      
      if (location.includes('stream') || location.includes('river')) {
        rating.hazards.push('Flash flood risk, cold air drainage');
      }
      
      const avgScore = (rating.wind_protection + rating.drainage + rating.materials_available) / 3;
      rating.overall_rating = avgScore >= 7 ? 'EXCELLENT' : avgScore >= 5 ? 'GOOD' : 'POOR';
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(rating, null, 2),
          },
        ],
      };
    }

    case 'identify_water_source_safety': {
      const { source_type } = args as { source_type: WaterSourceType };
      const info: WaterInfo = WATER_KNOWLEDGE[`${source_type}_water`] || {
        safety: 'UNKNOWN',
        treatment: 'Boil or filter + treat to be safe',
        collection: 'Assess clarity and flow'
      };
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(info, null, 2),
          },
        ],
      };
    }

    case 'check_plant_edibility': {
      const { plant_description } = args as { plant_description: string };
      const description = plant_description.toLowerCase();
      
      interface PlantResult {
        identified: boolean;
        warning?: string;
        plant_name?: string;
        edible?: boolean;
        description?: string;
        nutrition?: string;
        season?: string;
        danger?: string;
      }

      let result: PlantResult = { 
        identified: false, 
        warning: 'Cannot identify - do NOT eat unknown plants' 
      };
      
      for (const [plantName, plantInfo] of Object.entries(PLANTS)) {
        if (description.includes(plantName.replace('_', ' '))) {
          result = {
            identified: true,
            plant_name: plantName,
            ...plantInfo
          };
          break;
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    case 'assess_injury_treatment': {
      const { injury_type } = args as { injury_type: string };
      const injuryType = injury_type.toLowerCase();
      const treatment = FIRST_AID[injuryType] || {
        guidance: 'Monitor condition. Keep warm and hydrated. Avoid aggravating injury.'
      };
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(treatment, null, 2),
          },
        ],
      };
    }

    case 'get_shelter_building_guide': {
      const { shelter_type } = args as { shelter_type: string };
      const shelterType = shelter_type.toLowerCase().replace(/\s+/g, '_');
      const guide = SHELTERS[shelterType] || {
        error: 'Shelter type not found. Try: debris_shelter, lean_to'
      };
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(guide, null, 2),
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
