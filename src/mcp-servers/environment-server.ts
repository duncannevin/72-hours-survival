// src/mcp-servers/environment-server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import type { WeatherConditions, DaylightHours, TerrainInfo, Hazards, Season } from '../types/mcp.js';

const server = new Server(
  {
    name: 'environment-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Cache for vegetation data to avoid repeated API calls
const vegetationCache: Map<string, { data: string[]; timestamp: number }> = new Map();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

/**
 * Fetch local plants from iNaturalist API
 */
async function fetchLocalVegetation(lat: number, lon: number): Promise<string[]> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = vegetationCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `https://api.inaturalist.org/v1/observations/species_counts?` +
      `lat=${lat}&lng=${lon}&radius=20&iconic_taxa=Plantae&per_page=30&quality_grade=research`;
    
    const resp = await axios.get(url, { timeout: 15000 });
    
    const plants: string[] = resp.data.results
      .map((r: { taxon: { preferred_common_name?: string; name: string }; count: number }) => {
        const name = r.taxon.preferred_common_name || r.taxon.name;
        return name;
      })
      .filter((name: string) => name && name.length > 0)
      .slice(0, 15); // Limit to top 15 species

    vegetationCache.set(cacheKey, { data: plants, timestamp: Date.now() });
    return plants;
  } catch (error) {
    // Return empty array on error, will fall back to elevation-based zones
    return [];
  }
}

/**
 * Categorize plants into survival-relevant categories
 */
function categorizeVegetation(plants: string[]): {
  trees: string[];
  ediblePlants: string[];
  usefulPlants: string[];
  description: string;
} {
  const trees: string[] = [];
  const ediblePlants: string[] = [];
  const usefulPlants: string[] = [];

  // Keywords for categorization
  const treeKeywords = ['fir', 'pine', 'cedar', 'hemlock', 'spruce', 'oak', 'maple', 'alder', 'birch', 'willow', 'cottonwood', 'aspen', 'douglas'];
  const edibleKeywords = ['berry', 'berries', 'huckleberry', 'salal', 'thimbleberry', 'salmonberry', 'blackberry', 'elderberry', 'currant', 'gooseberry', 'strawberry', 'clover', 'sorrel', 'nettle', 'dandelion', 'cattail', 'camas'];
  const usefulKeywords = ['moss', 'fern', 'bracken', 'horsetail', 'willow', 'birch', 'cedar', 'cattail', 'reed', 'grass'];

  for (const plant of plants) {
    const lower = plant.toLowerCase();
    
    if (treeKeywords.some(kw => lower.includes(kw))) {
      trees.push(plant);
    }
    if (edibleKeywords.some(kw => lower.includes(kw))) {
      ediblePlants.push(plant);
    }
    if (usefulKeywords.some(kw => lower.includes(kw))) {
      usefulPlants.push(plant);
    }
  }

  // Build description
  let description = '';
  if (trees.length > 0) {
    description += `Forest type: ${trees.slice(0, 3).join(', ')}. `;
  }
  if (ediblePlants.length > 0) {
    description += `Potential forage: ${ediblePlants.slice(0, 3).join(', ')}. `;
  }
  if (usefulPlants.length > 0) {
    description += `Useful materials: ${usefulPlants.slice(0, 3).join(', ')}.`;
  }

  if (!description) {
    description = 'Mixed vegetation present.';
  }

  return { trees, ediblePlants, usefulPlants, description };
}

/**
 * Get vegetation zone based on elevation (fallback)
 */
function getVegetationZone(elevationM: number): string {
  const elevationFt = elevationM * 3.28084;
  if (elevationFt < 2000) return 'Western Hemlock - dense understory, wet';
  if (elevationFt < 4000) return 'Silver Fir - moderate understory, mossy';
  if (elevationFt < 5500) return 'Mountain Hemlock - subalpine, rocky';
  return 'Alpine - sparse vegetation, exposed';
}

function getWildlifeConcerns(season: Season): string {
  const concerns: Record<Season, string> = {
    spring: 'Bears emerging, aggressive if with cubs. Cougars active.',
    summer: 'Bears fattening up. Mosquitoes intense. Wasps/bees.',
    fall: 'Bears hyperphagia (very active/aggressive). Rutting elk/deer.',
    winter: 'Reduced wildlife activity. Cougar/coyote more desperate.'
  };
  return concerns[season] || concerns.fall;
}

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_weather_conditions',
        description: 'Get current weather for a specific location',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lon: { type: 'number', description: 'Longitude' }
          },
          required: ['lat', 'lon'],
        },
      },
      {
        name: 'get_daylight_hours',
        description: 'Calculate sunrise, sunset, and total daylight hours',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lon: { type: 'number' },
            date: { 
              type: 'string', 
              description: 'ISO date format (YYYY-MM-DD)' 
            }
          },
          required: ['lat', 'lon', 'date'],
        },
      },
      {
        name: 'check_terrain',
        description: 'Get terrain information: elevation, vegetation type, and local plant species',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number' },
            lon: { type: 'number' }
          },
          required: ['lat', 'lon'],
        },
      },
      {
        name: 'get_local_vegetation',
        description: 'Get detailed list of plant species observed near a location, categorized by survival usefulness',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lon: { type: 'number', description: 'Longitude' }
          },
          required: ['lat', 'lon'],
        },
      },
      {
        name: 'assess_hazards',
        description: 'Check environmental hazards for the season',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            season: { 
              type: 'string',
              enum: ['spring', 'summer', 'fall', 'winter']
            }
          },
          required: ['location', 'season'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_weather_conditions': {
        const { lat, lon } = args as { lat: number; lon: number };
        
        // Get grid point
        const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
        const pointsResp = await axios.get(pointsUrl, {
          headers: { 'User-Agent': 'SurvivalGame/1.0' },
          timeout: 10000
        });
        
        // Get forecast
        const forecastUrl = pointsResp.data.properties.forecast;
        const forecastResp = await axios.get(forecastUrl, {
          headers: { 'User-Agent': 'SurvivalGame/1.0' },
          timeout: 10000
        });
        
        const current = forecastResp.data.properties.periods[0];
        
        const weather: WeatherConditions = {
          temperature: current.temperature,
          temperature_unit: current.temperatureUnit,
          wind_speed: current.windSpeed,
          wind_direction: current.windDirection,
          short_forecast: current.shortForecast,
          detailed_forecast: current.detailedForecast,
          precipitation_probability: current.probabilityOfPrecipitation?.value || 0
        };
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(weather, null, 2),
            },
          ],
        };
      }

      case 'get_daylight_hours': {
        const { lat, lon, date } = args as { lat: number; lon: number; date: string };
        
        const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${date}&formatted=0`;
        const resp = await axios.get(url, { timeout: 10000 });
        const data = resp.data.results;
        
        const sunrise = new Date(data.sunrise);
        const sunset = new Date(data.sunset);
        const daylightHours = (sunset.getTime() - sunrise.getTime()) / (1000 * 60 * 60);
        
        const result: DaylightHours = {
          sunrise: data.sunrise,
          sunset: data.sunset,
          daylight_hours: daylightHours.toFixed(2),
          civil_twilight_begin: data.civil_twilight_begin,
          civil_twilight_end: data.civil_twilight_end
        };
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'check_terrain': {
        const { lat, lon } = args as { lat: number; lon: number };
        
        // Get elevation
        let elevation = 500; // Default fallback
        try {
          const elevUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
          const elevResp = await axios.get(elevUrl, { timeout: 10000 });
          elevation = elevResp.data.results[0].elevation;
        } catch {
          // Use default elevation
        }

        // Get real vegetation data from iNaturalist
        const localPlants = await fetchLocalVegetation(lat, lon);
        const categorized = categorizeVegetation(localPlants);
        
        // Build vegetation zone description
        let vegetationZone: string;
        if (localPlants.length > 0) {
          vegetationZone = categorized.description;
        } else {
          // Fall back to elevation-based zones
          vegetationZone = getVegetationZone(elevation);
        }
        
        const terrainInfo: TerrainInfo = {
          elevation_meters: elevation,
          elevation_feet: Math.round(elevation * 3.28084),
          vegetation_zone: vegetationZone,
          estimated_water_sources: 'Streams likely within 0.5-1 mile given elevation',
          terrain_difficulty: elevation < 1500 ? 'Moderate' : 'Challenging'
        };
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(terrainInfo, null, 2),
            },
          ],
        };
      }

      case 'get_local_vegetation': {
        const { lat, lon } = args as { lat: number; lon: number };
        
        const localPlants = await fetchLocalVegetation(lat, lon);
        const categorized = categorizeVegetation(localPlants);
        
        const result = {
          location: { lat, lon },
          total_species_found: localPlants.length,
          all_plants: localPlants,
          categorized: {
            trees: categorized.trees,
            potentially_edible: categorized.ediblePlants,
            useful_for_survival: categorized.usefulPlants,
          },
          summary: categorized.description,
          warning: 'ALWAYS verify plant identification before consuming. Many edible plants have toxic lookalikes.',
          data_source: 'iNaturalist research-grade observations'
        };
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'assess_hazards': {
        const { location, season } = args as { location: string; season: Season };
        
        const hazards: Hazards = {
          avalanche_risk: ['summer', 'fall'].includes(season) ? 'LOW' : 'MODERATE-HIGH',
          stream_crossing_danger: 'MODERATE - streams cold and fast year-round',
          wildlife_concerns: getWildlifeConcerns(season),
          hypothermia_risk: 'HIGH - weather is unpredictable, wet cold is dangerous',
          getting_lost_risk: 'HIGH - dense forest, poor visibility in trees'
        };
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(hazards, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
    };
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