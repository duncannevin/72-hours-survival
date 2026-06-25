// src/index.ts

import { SurvivalGame } from './game.js';
import * as readline from 'readline';
import dotenv from 'dotenv';
import {
  hasSavedGame,
  loadGame,
  saveGame,
  deleteSave,
  createInitialSave,
  updateSaveFromStatus,
  addRecentAction,
  addImportantEvent,
  generateAIContext,
  SavedGameState,
} from './save-manager.js';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// Emoji spinner animation
const SPINNER_FRAMES = [
  '🌲 🚶 🌲 🌲 🌲',
  '🌲 🌲 🚶 🌲 🌲',
  '🌲 🌲 🚶 🚶 🌲',
  '🌲 🌲 🚶 🌲 🚶',
  '🌲 🌲 🚶 🚶 🌲',
  '🌲 🌲 🚶 🌲 🌲',
];

const THINKING_MESSAGES = [
  'Assessing the situation',
  'Checking surroundings',
  'Thinking strategically',
  'Consulting survival knowledge',
  'Planning next move',
  'Evaluating risks',
];

let turnNumber = 0;
let currentSave: SavedGameState | null = null;

// Conversation history for narrative continuity
let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
const MAX_HISTORY_LENGTH = 10; // Keep last 10 exchanges

class LoadingSpinner {
  private frameIndex = 0;
  private messageIndex = 0;
  private dotCount = 0;
  private interval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.frameIndex = 0;
    this.messageIndex = Math.floor(Math.random() * THINKING_MESSAGES.length);
    this.dotCount = 0;
    
    this.render();
    
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.dotCount = (this.dotCount + 1) % 4;
      
      if (this.frameIndex === 0) {
        this.messageIndex = (this.messageIndex + 1) % THINKING_MESSAGES.length;
      }
      
      this.render();
    }, 200);
  }

  private render(): void {
    const dots = '.'.repeat(this.dotCount);
    const padding = ' '.repeat(3 - this.dotCount);
    const line = `${SPINNER_FRAMES[this.frameIndex]}  ${THINKING_MESSAGES[this.messageIndex]}${dots}${padding}`;
    process.stdout.write(`\r\x1B[2K${line}`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1B[2K');
  }
}

const spinner = new LoadingSpinner();

function drawBox(content: string, title?: string): string {
  const lines = content.split('\n');
  const maxWidth = Math.max(...lines.map(l => l.length), title ? title.length + 4 : 0, 60);
  
  const top = title 
    ? `╔${'═'.repeat(2)}[ ${title} ]${'═'.repeat(Math.max(0, maxWidth - title.length - 5))}╗`
    : `╔${'═'.repeat(maxWidth + 2)}╗`;
  const bottom = `╚${'═'.repeat(maxWidth + 2)}╝`;
  
  const paddedLines = lines.map(line => {
    const padding = maxWidth - line.length;
    return `║ ${line}${' '.repeat(Math.max(0, padding))} ║`;
  });
  
  return [top, ...paddedLines, bottom].join('\n');
}

function drawTurnHeader(turn: number, hoursSurvived: number): string {
  const hoursRemaining = 72 - hoursSurvived;
  return `
${'━'.repeat(60)}
  🌲🏔️  TURN ${turn}  |  ⏱️ ${hoursSurvived}h survived  |  ${hoursRemaining}h until rescue  🏔️🌲
${'━'.repeat(60)}`;
}

function drawSectionDivider(title: string): string {
  const padding = Math.floor((56 - title.length) / 2);
  return `\n┌${'─'.repeat(58)}┐\n│${' '.repeat(padding)}${title}${' '.repeat(58 - padding - title.length)}│\n└${'─'.repeat(58)}┘`;
}

/**
 * Build conversation context for the AI
 */
function buildConversationContext(): string {
  if (conversationHistory.length === 0) return '';
  
  let context = '\n\nRECENT CONVERSATION HISTORY (continue this narrative):\n';
  for (const entry of conversationHistory.slice(-6)) { // Last 6 exchanges
    if (entry.role === 'user') {
      context += `\nPLAYER ACTION: ${entry.content}\n`;
    } else {
      // Truncate long AI responses
      const truncated = entry.content.length > 300 
        ? entry.content.substring(0, 300) + '...' 
        : entry.content;
      context += `RESULT: ${truncated}\n`;
    }
  }
  context += '\nContinue the narrative from where we left off. Do NOT restart the scenario.\n';
  return context;
}

/**
 * Add to conversation history
 */
function addToHistory(role: 'user' | 'assistant', content: string): void {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY_LENGTH * 2) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH * 2);
  }
}

/**
 * Auto-save the game state
 */
async function autoSave(game: SurvivalGame): Promise<void> {
  if (!currentSave) return;
  
  try {
    const status = await game.getFullStatus();
    currentSave = updateSaveFromStatus(currentSave, {
      hours_survived: status.hours_survived,
      vitals: status.vitals,
      inventory: status.inventory,
      shelter_built: status.shelter_built,
      fire_active: status.fire_active,
    });
    saveGame(currentSave);
  } catch (error) {
    // Silent fail on auto-save
  }
}

/**
 * Get user's location - try IP first, then ask for manual input
 */
async function getUserLocation(game: SurvivalGame): Promise<{
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
  description: string;
}> {
  console.log('\n🌍 Detecting your location...');
  
  // Try IP-based detection first
  const ipLocation = await game.detectUserLocation();
  
  console.log(`\n📍 Detected location: ${ipLocation.city}, ${ipLocation.region}, ${ipLocation.country}`);
  console.log(`🧭 Coordinates: ${ipLocation.lat.toFixed(4)}°, ${ipLocation.lon.toFixed(4)}°`);
  
  const confirm = await ask('\nIs this correct? (yes/no): ');
  
  if (confirm.toLowerCase().startsWith('y')) {
    return ipLocation;
  }
  
  // Manual location entry
  console.log('\n📍 Enter your location manually:');
  console.log('   (You can enter a city name or coordinates)\n');
  
  const locationInput = await ask('Location (e.g., "Seattle, WA" or "47.6,-122.3"): ');
  
  // Check if it's coordinates
  const coordMatch = locationInput.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    const cityName = await ask('City/Region name (for display): ');
    
    return {
      lat,
      lon,
      city: cityName || 'Unknown',
      region: '',
      country: '',
      description: `Wilderness near ${cityName || 'coordinates ' + lat + ',' + lon}`,
    };
  }
  
  // Try to geocode the city name using a free API
  try {
    const { default: axios } = await import('axios');
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationInput)}&limit=1`;
    const resp = await axios.get(geoUrl, { 
      timeout: 10000,
      headers: { 'User-Agent': 'SurvivalGame/1.0' }
    });
    
    if (resp.data && resp.data.length > 0) {
      const result = resp.data[0];
      const lat = parseFloat(result.lat);
      const lon = parseFloat(result.lon);
      const displayName = result.display_name.split(',').slice(0, 2).join(',');
      
      console.log(`\n✓ Found: ${displayName}`);
      console.log(`  Coordinates: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`);
      
      return {
        lat,
        lon,
        city: displayName.split(',')[0].trim(),
        region: displayName.split(',')[1]?.trim() || '',
        country: '',
        description: `Wilderness near ${displayName}`,
      };
    }
  } catch (error) {
    console.warn('Could not geocode location, using default.');
  }
  
  // Fallback to default (your area - Washington)
  console.log('\n⚠️ Could not find location. Using default (Cascade Mountains, WA)');
  return {
    lat: 47.5,
    lon: -121.5,
    city: 'North Bend',
    region: 'Washington',
    country: 'United States',
    description: 'Cascade Mountains, Washington',
  };
}

async function main(): Promise<void> {
  // Title screen
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     🏔️  72 HOURS: BACKCOUNTRY SURVIVAL SIMULATOR  🏔️      ║
║                                                            ║
║              Can you survive the wilderness?               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

  console.log('Initializing game systems...\n');

  const game = new SurvivalGame();
  
  try {
    await game.initializeMCPServers();

    // Check for saved game
    let isReturningPlayer = false;
    let playerContext = '';
    let location: Awaited<ReturnType<typeof getUserLocation>>;
    
    if (hasSavedGame()) {
      const savedGame = loadGame();
      if (savedGame) {
        console.log(`\n🎮 Welcome back, ${savedGame.playerName}!`);
        console.log(`   Last played: ${new Date(savedGame.lastPlayed).toLocaleString()}`);
        console.log(`   Hours survived: ${savedGame.hours_survived}/72`);
        console.log(`   Location: ${savedGame.location.description}\n`);
        
        const choice = await ask('Continue saved game? (yes/no/delete): ');
        
        if (choice.toLowerCase().startsWith('y')) {
          isReturningPlayer = true;
          
          // Restore game state
          await game.restoreGameState(savedGame);
          savedGame.totalSessions += 1;
          currentSave = savedGame;
          saveGame(currentSave);
          
          // Restore conversation history from recent actions
          for (const action of savedGame.recentActions) {
            conversationHistory.push({ role: 'user', content: action });
          }
          
          playerContext = generateAIContext(savedGame);
          location = {
            lat: savedGame.location.lat,
            lon: savedGame.location.lon,
            city: savedGame.location.description.replace('Wilderness near ', '').split(',')[0],
            region: '',
            country: '',
            description: savedGame.location.description,
          };
          
          console.log('\n✓ Game loaded!\n');
        } else if (choice.toLowerCase() === 'delete') {
          deleteSave();
          console.log('\n✓ Save deleted. Starting fresh!\n');
        }
      }
    }

    // New game setup
    if (!isReturningPlayer) {
      // Get player name
      const playerName = (await ask('What is your name, survivor? ')).trim() || 'Survivor';
      
      // Get location with confirmation
      location = await getUserLocation(game);
      
      // Update game's internal location
      game.setLocation(location);
      
      // Create initial save
      currentSave = createInitialSave(playerName, {
        lat: location.lat,
        lon: location.lon,
        description: location.description,
      });
      saveGame(currentSave);
      
      playerContext = `Player name: ${playerName}\nLocation: ${location.description}`;
    }

    const playerName = currentSave?.playerName || 'Survivor';

    // Create agent with context (includes conversation history builder)
    const agent = game.createAgent(playerContext, buildConversationContext);

    console.log(drawSectionDivider('🌲 SCENARIO 🌲'));
    console.log(
      `${playerName}, you're lost in the wilderness near ${location!.city}${location!.region ? ', ' + location!.region : ''}.\n` +
      `Survive 72 hours until rescue arrives.\n\n` +
      `Commands:\n` +
      `  • Describe your actions naturally\n` +
      `  • Type 'status' to see your current state\n` +
      `  • Type 'save' to manually save\n` +
      `  • Type 'quit' to save and exit`,
    );
    console.log();

    // Initialize or resume game
    if (isReturningPlayer && currentSave) {
      // Show current status for returning player
      try {
        const status = await game.getCurrentStatus();
        const weather = await game.getCurrentWeather();
        
        console.log(drawSectionDivider('📊 YOUR CURRENT STATUS'));
        console.log('\n' + game.formatConditions(status.vitals, 'Current Conditions'));
        console.log(weather);
        console.log(game.formatInventory(status.inventory));
        console.log(`\n⏱️ Hours Survived: ${currentSave.hours_survived}/72\n`);
      } catch (error) {
        console.warn('Could not fetch status:', error);
      }
      
      // Get AI to summarize where we left off
      console.log('Recalling your situation...');
      spinner.start();
      try {
        const resumePrompt = `${playerName} is returning to continue their survival situation. ` +
          `They have survived ${currentSave.hours_survived} hours so far. ` +
          `Briefly remind them where they left off and what their immediate priorities should be. ` +
          `Do NOT restart the scenario - continue from where we were.`;
        
        const resumeResponse = await game.invokeAgentWithRetry(agent, { input: resumePrompt });
        spinner.stop();
        
        console.log(drawSectionDivider('📜 WHERE WE LEFT OFF'));
        console.log('\n' + resumeResponse.output + '\n');
        
        addToHistory('assistant', resumeResponse.output);
      } catch (error) {
        spinner.stop();
        console.log('\n💭 Ready to continue your survival journey.\n');
      }
    } else {
      // New game initialization
      console.log('Generating your survival scenario...\n');
      spinner.start();
      
      try {
        const initMessage = await game.initializeGameDirectly();
        spinner.stop();
        console.log(drawSectionDivider('📜 SITUATION'));
        console.log('\n' + initMessage + '\n');
        
        addToHistory('assistant', initMessage);
      } catch (error) {
        spinner.stop();
        try {
          const initResponse = await game.invokeAgentWithRetry(agent, {
            input: `Initialize the game for ${playerName}. They just got lost in the wilderness near ${location!.description}. ` +
              `Describe their starting situation vividly. What do they see, hear, and feel?`,
          });
          console.log(drawSectionDivider('📜 SITUATION'));
          console.log('\n' + initResponse.output + '\n');
          
          addToHistory('assistant', initResponse.output);
        } catch (initError) {
          console.error(`\n❌ Failed to initialize: ${initError}\n`);
        }
      }

      // Show starting conditions
      try {
        const startingStatus = await game.getCurrentStatus();
        const startingWeather = await game.getCurrentWeather();

        console.log(drawSectionDivider('📊 YOUR STATUS'));
        console.log('\n' + game.formatConditions(startingStatus.vitals, 'Starting Conditions'));
        console.log(startingWeather);
        console.log(game.formatInventory(startingStatus.inventory));
      } catch (error) {
        console.warn('Could not fetch starting status:', error);
      }
    }

    // Main game loop
    while (true) {
      const input = await ask(`\n🎯 ${playerName}, what do you do? `);
      const inputLower = input.toLowerCase().trim();

      // Handle special commands
      if (['quit', 'exit', 'q'].includes(inputLower)) {
        await autoSave(game);
        
        // Generate session summary
        if (currentSave && conversationHistory.length > 0) {
          spinner.start();
          try {
            const summaryResponse = await game.invokeAgentWithRetry(agent, {
              input: 'Generate a brief 2-3 sentence summary of what happened this session for future reference.',
            });
            spinner.stop();
            currentSave.sessionSummary = summaryResponse.output;
            saveGame(currentSave);
          } catch {
            spinner.stop();
          }
        }
        
        console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║                    🏕️  GAME SAVED  🏕️                      ║
║                                                            ║
║          Your progress has been saved. See you soon!       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
        break;
      }

      if (inputLower === 'save') {
        await autoSave(game);
        console.log('\n✓ Game saved!\n');
        continue;
      }

      if (inputLower === 'status') {
        try {
          const status = await game.getCurrentStatus();
          const weather = await game.getCurrentWeather();
          const fullStatus = await game.getFullStatus();
          
          console.log(drawSectionDivider('📊 CURRENT STATUS'));
          console.log('\n' + game.formatConditions(status.vitals, 'Current Conditions'));
          console.log(weather);
          console.log(game.formatInventory(status.inventory));
          console.log(`⏱️ Hours Survived: ${fullStatus.hours_survived}/72`);
          console.log(`🏕️ Shelter: ${fullStatus.shelter_built ? 'Built' : 'None'}`);
          console.log(`🔥 Fire: ${fullStatus.fire_active ? 'Active' : 'None'}\n`);
        } catch (error) {
          console.log('\n❌ Could not fetch status\n');
        }
        continue;
      }

      if (!input.trim()) continue;

      // Get current hours for display
      let hoursSurvived = currentSave?.hours_survived || 0;
      try {
        const status = await game.getFullStatus();
        hoursSurvived = status.hours_survived;
      } catch {}

      turnNumber++;
      console.log(drawTurnHeader(turnNumber, hoursSurvived));

      try {
        console.log(drawBox(input, '🎮 YOUR ACTION'));
        
        // Add to history BEFORE sending to AI
        addToHistory('user', input);
        
        // Record the action in save
        if (currentSave) {
          addRecentAction(currentSave, input);
        }
        
        spinner.start();
        
        // Build prompt with context to maintain narrative
        const actionPrompt = `${playerName} says: "${input}"

IMPORTANT: Continue the ongoing narrative. Do not restart or re-introduce the scenario. 
React to their action, describe what happens, update the game state appropriately, and present their next challenge or options.`;
        
        const response = await game.invokeAgentWithRetry(agent, { input: actionPrompt });
        
        spinner.stop();

        // Add response to history
        addToHistory('assistant', response.output);

        // Show current conditions FIRST
        try {
          const currentStatus = await game.getCurrentStatus();
          const currentWeather = await game.getCurrentWeather();
          const fullStatus = await game.getFullStatus();

          console.log(drawSectionDivider('📊 UPDATED STATUS'));
          console.log('\n' + game.formatConditions(currentStatus.vitals, 'Current Conditions'));
          console.log(currentWeather);
          console.log(game.formatInventory(currentStatus.inventory));
          console.log(`⏱️ Hours Survived: ${fullStatus.hours_survived}/72\n`);
          
          // Check for important events to record
          if (currentSave) {
            if (fullStatus.shelter_built && !currentSave.shelter_built) {
              addImportantEvent(currentSave, 'Built a shelter');
            }
            if (fullStatus.fire_active && !currentSave.fire_active) {
              addImportantEvent(currentSave, 'Started a fire');
            }
          }
        } catch (error) {
          console.warn('Could not fetch current status:', error);
        }

        // Show AI response
        console.log(drawSectionDivider('📖 WHAT HAPPENED'));
        console.log('\n' + response.output + '\n');

        // Auto-save after each turn
        await autoSave(game);

      } catch (error) {
        spinner.stop();
        
        let errorMessage: string;
        if (typeof error === 'object' && error !== null) {
          const err = error as Record<string, unknown>;
          const errMsg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
          
          if (err.type === 'overloaded_error' || errMsg.includes('overloaded')) {
            errorMessage = 'The AI service is currently overloaded. Please wait and try again.';
          } else {
            errorMessage = error instanceof Error ? error.message : String(error);
          }
        } else {
          errorMessage = String(error);
        }
        
        console.log(drawBox(`⚠️  ${errorMessage}`, '❌ ERROR'));
      }
    }
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await game.cleanup();
    rl.close();
    process.exit(0);
  }
}

main();
