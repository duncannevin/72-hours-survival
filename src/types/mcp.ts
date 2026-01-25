// src/types/mcp.ts

export interface WeatherConditions {
  temperature: number;
  temperature_unit: string;
  wind_speed: string;
  wind_direction: string;
  short_forecast: string;
  detailed_forecast: string;
  precipitation_probability: number;
}

export interface DaylightHours {
  sunrise: string;
  sunset: string;
  daylight_hours: string;
  civil_twilight_begin: string;
  civil_twilight_end: string;
}

export interface TerrainInfo {
  elevation_meters: number;
  elevation_feet: number;
  vegetation_zone: string;
  estimated_water_sources: string;
  terrain_difficulty: string;
}

export interface Hazards {
  avalanche_risk: string;
  stream_crossing_danger: string;
  wildlife_concerns: string;
  hypothermia_risk: string;
  getting_lost_risk: string;
}

export type ActivityLevel = 'resting' | 'light' | 'moderate' | 'heavy';
export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export type InventoryAction = 'add' | 'remove' | 'use';
export type InventoryCategory = 'clothing' | 'gear' | 'resources' | 'food';
export type WaterSourceType = 'stream' | 'rain' | 'snow' | 'pond';
