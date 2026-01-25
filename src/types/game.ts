// src/types/game.ts

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface PlayerVitals {
  core_temperature_f: number;
  hydration_level: number;
  energy_level: number;
  fatigue: number;
  injuries: string[];
}

export interface Inventory {
  clothing: string[];
  gear: string[];
  resources: string[];
  food: string[];
}

export interface Location {
  lat: number;
  lon: number;
  description: string;
}

export interface GameState {
  hours_survived: number;
  player_vitals: PlayerVitals;
  inventory: Inventory;
  location: Location;
  shelter_built: boolean;
  fire_active: boolean;
  decisions_log: string[];
}

export interface MCPClientInfo {
  name: string;
  client: Client;
  transport: StdioClientTransport;
}

export interface MCPServerConfig {
  name: string;
  script: string;
}
