// src/save-manager.ts

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SavedGameState {
  // Player info
  playerName: string;
  
  // Game state
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
  
  // Session history for AI context
  sessionSummary: string;
  recentActions: string[];
  importantEvents: string[];
  
  // Meta
  lastPlayed: string;
  totalSessions: number;
  createdAt: string;
}

const SAVE_DIR = path.join(os.homedir(), '.survival-game');
const SAVE_FILE = path.join(SAVE_DIR, 'savegame.json');

/**
 * Ensure save directory exists
 */
function ensureSaveDir(): void {
  if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
  }
}

/**
 * Check if a saved game exists
 */
export function hasSavedGame(): boolean {
  return fs.existsSync(SAVE_FILE);
}

/**
 * Load saved game state
 */
export function loadGame(): SavedGameState | null {
  try {
    if (!fs.existsSync(SAVE_FILE)) {
      return null;
    }
    const data = fs.readFileSync(SAVE_FILE, 'utf-8');
    return JSON.parse(data) as SavedGameState;
  } catch (error) {
    console.error('Failed to load save file:', error);
    return null;
  }
}

/**
 * Save game state
 */
export function saveGame(state: SavedGameState): boolean {
  try {
    ensureSaveDir();
    state.lastPlayed = new Date().toISOString();
    fs.writeFileSync(SAVE_FILE, JSON.stringify(state, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save game:', error);
    return false;
  }
}

/**
 * Delete saved game
 */
export function deleteSave(): boolean {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      fs.unlinkSync(SAVE_FILE);
    }
    return true;
  } catch (error) {
    console.error('Failed to delete save:', error);
    return false;
  }
}

/**
 * Create initial save state
 */
export function createInitialSave(playerName: string, location: { lat: number; lon: number; description: string }): SavedGameState {
  return {
    playerName,
    hours_survived: 0,
    player_vitals: {
      core_temperature_f: 97.5,
      hydration_level: 60,
      energy_level: 70,
      fatigue: 30,
      injuries: ['Minor ankle sprain'],
    },
    inventory: {
      clothing: ['hiking boots', 'jeans', 't-shirt', 'light jacket'],
      gear: ['backpack', 'water bottle (empty)', 'knife'],
      resources: [],
      food: [],
    },
    location,
    shelter_built: false,
    fire_active: false,
    sessionSummary: '',
    recentActions: [],
    importantEvents: ['Got lost in the wilderness', 'Sprained ankle while hiking'],
    lastPlayed: new Date().toISOString(),
    totalSessions: 1,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Update save with current game status
 */
export function updateSaveFromStatus(
  currentSave: SavedGameState,
  status: {
    hours_survived: number;
    vitals: SavedGameState['player_vitals'];
    inventory: SavedGameState['inventory'];
    shelter_built: boolean;
    fire_active: boolean;
  }
): SavedGameState {
  return {
    ...currentSave,
    hours_survived: status.hours_survived,
    player_vitals: status.vitals,
    inventory: status.inventory,
    shelter_built: status.shelter_built,
    fire_active: status.fire_active,
    lastPlayed: new Date().toISOString(),
  };
}

/**
 * Add an action to the recent actions list (keeps last 10)
 */
export function addRecentAction(save: SavedGameState, action: string): void {
  save.recentActions.push(action);
  if (save.recentActions.length > 10) {
    save.recentActions.shift();
  }
}

/**
 * Add an important event (keeps last 20)
 */
export function addImportantEvent(save: SavedGameState, event: string): void {
  save.importantEvents.push(event);
  if (save.importantEvents.length > 20) {
    save.importantEvents.shift();
  }
}

/**
 * Generate a context summary for the AI
 */
export function generateAIContext(save: SavedGameState): string {
  const timeSinceLastPlay = getTimeSinceLastPlay(save.lastPlayed);
  
  let context = `RETURNING PLAYER CONTEXT:\n`;
  context += `- Player name: ${save.playerName}\n`;
  context += `- Last played: ${timeSinceLastPlay}\n`;
  context += `- Total sessions: ${save.totalSessions}\n`;
  context += `- Hours survived: ${save.hours_survived}/72\n`;
  context += `- Current status: Temp ${save.player_vitals.core_temperature_f}°F, `;
  context += `Hydration ${save.player_vitals.hydration_level}%, `;
  context += `Energy ${save.player_vitals.energy_level}%\n`;
  
  if (save.shelter_built) {
    context += `- Has built a shelter\n`;
  }
  if (save.fire_active) {
    context += `- Has an active fire\n`;
  }
  
  if (save.player_vitals.injuries.length > 0) {
    context += `- Injuries: ${save.player_vitals.injuries.join(', ')}\n`;
  }
  
  if (save.importantEvents.length > 0) {
    context += `\nIMPORTANT EVENTS SO FAR:\n`;
    save.importantEvents.slice(-5).forEach(event => {
      context += `- ${event}\n`;
    });
  }
  
  if (save.recentActions.length > 0) {
    context += `\nLAST FEW ACTIONS:\n`;
    save.recentActions.slice(-5).forEach(action => {
      context += `- ${action}\n`;
    });
  }
  
  if (save.sessionSummary) {
    context += `\nPREVIOUS SESSION SUMMARY:\n${save.sessionSummary}\n`;
  }
  
  return context;
}

/**
 * Get human-readable time since last play
 */
function getTimeSinceLastPlay(lastPlayed: string): string {
  const last = new Date(lastPlayed);
  const now = new Date();
  const diffMs = now.getTime() - last.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMins < 5) return 'just now';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}