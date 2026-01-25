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
        description: 'Get terrain information: elevation, vegetation type',
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

// Helper functions
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
        
        const elevUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
        const elevResp = await axios.get(elevUrl, { timeout: 10000 });
        const elevation = elevResp.data.results[0].elevation;
        
        const terrainInfo: TerrainInfo = {
          elevation_meters: elevation,
          elevation_feet: Math.round(elevation * 3.28084),
          vegetation_zone: getVegetationZone(elevation),
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

      case 'assess_hazards': {
        const { location, season } = args as { location: string; season: Season };
        
        const hazards: Hazards = {
          avalanche_risk: ['summer', 'fall'].includes(season) ? 'LOW' : 'MODERATE-HIGH',
          stream_crossing_danger: 'MODERATE - streams cold and fast year-round',
          wildlife_concerns: getWildlifeConcerns(season),
          hypothermia_risk: 'HIGH - PNW weather is unpredictable, wet cold is dangerous',
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
  // Server is running silently on stdio
}

main().catch((error) => {
  // Only log fatal errors that prevent server startup
  process.stderr.write(`Fatal server error: ${error}\n`);
  process.exit(1);
});
