// src/index.ts

import { SurvivalGame } from './game.js';
import * as readline from 'readline';
import dotenv from 'dotenv';

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
  '🌲 🌲 🌲 🚶 🌲',
  '🌲 🌲 🌲 🌲 🚶',
  '🌲 🌲 🌲 🚶 🌲',
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
      
      // Change message every 6 frames
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
    
    // Clear line and write new content
    process.stdout.write(`\r\x1B[2K${line}`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Clear the spinner line
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
    return `║ ${line}${' '.repeat(padding)} ║`;
  });
  
  return [top, ...paddedLines, bottom].join('\n');
}

function drawTurnHeader(turn: number): string {
  const wilderness = `
  🌲🏔️  TURN ${turn}  🏔️🌲
  `;
  return `
${'━'.repeat(60)}
${wilderness}
${'━'.repeat(60)}`;
}

function drawSectionDivider(title: string): string {
  const padding = Math.floor((56 - title.length) / 2);
  return `\n┌${'─'.repeat(58)}┐\n│${' '.repeat(padding)}${title}${' '.repeat(58 - padding - title.length)}│\n└${'─'.repeat(58)}┘`;
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

    // Detect user's location
    console.log('🌍 Detecting your location...');
    const location = await game.detectUserLocation();
    console.log(`📍 Location: ${location.city}, ${location.region}, ${location.country}`);
    console.log(`🧭 Coordinates: ${location.lat.toFixed(4)}°N, ${Math.abs(location.lon).toFixed(4)}°W\n`);

    const agent = game.createAgent();

    console.log(drawSectionDivider('🌲 SCENARIO 🌲'));
    console.log(
      `You're lost in the wilderness near ${location.city}, ${location.region}.\n` +
      `Survive 72 hours until rescue arrives.\n\n` +
      `Commands:\n` +
      `  • Describe your actions naturally\n` +
      `  • Type 'quit' to exit`,
    );
    console.log();

    // Initialize game
    console.log('Generating your survival scenario...\n');
    
    // Show loading animation during initialization
    spinner.start();
    
    let initMessage = '';
    try {
      initMessage = await game.initializeGameDirectly();
      spinner.stop();
      console.log(drawSectionDivider('📜 SITUATION'));
      console.log('\n' + initMessage + '\n');
    } catch (error) {
      spinner.stop();
      console.log('Using agent for initialization...\n');
      try {
        const initResponse = await game.invokeAgentWithRetry(agent, {
          input: 'Initialize the game and tell me my starting situation.',
        });
        console.log(drawBox(initResponse.output, '📜 SITUATION'));
      } catch (initError) {
        const errorMessage = initError instanceof Error ? initError.message : String(initError);
        console.error(`\n❌ Failed to initialize game: ${errorMessage}\n`);
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

    // Store the last AI response to parse options from
    let lastResponse = '';
    let availableOptions: Array<{ id: number; text: string }> = [];

    // Get initial situation from AI
    console.log('\nAssessing your situation...');
    spinner.start();
    try {
      const initialResponse = await game.invokeAgentWithRetry(agent, {
        input: 'I just realized I am lost in the wilderness. Assess my situation and tell me what I should do.',
      });
      spinner.stop();
      lastResponse = initialResponse.output;
      availableOptions = game.parseOptionsFromResponse(lastResponse);
      
      console.log(drawSectionDivider('🎯 YOUR SITUATION'));
      console.log('\n' + lastResponse + '\n');
    } catch (error) {
      spinner.stop();
      console.log('\n💭 You find yourself lost in the wilderness. What do you do?\n');
    }

    // Main game loop
    while (true) {
      // Show prompt with available options
      const promptText = availableOptions.length > 0 
        ? `Enter choice (1-${availableOptions.length}) or describe your action: `
        : '🎯 What do you do? ';
      
      const input = await ask(promptText);

      if (['quit', 'exit', 'q'].includes(input.toLowerCase())) {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║                    🏕️  GAME ENDED  🏕️                      ║
║                                                            ║
║                  Stay safe out there!                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
        break;
      }

      if (!input.trim()) continue;

      // Determine the action from input
      let selectedAction = input;
      const choiceNum = parseInt(input, 10);
      
      if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= availableOptions.length) {
        const option = availableOptions.find(o => o.id === choiceNum);
        if (option) {
          selectedAction = option.text;
          console.log(`\n✓ Selected: ${option.text}\n`);
        }
      }

      turnNumber++;
      console.log(drawTurnHeader(turnNumber));

      try {
        // Show player's action
        console.log(drawBox(selectedAction, '🎮 YOUR ACTION'));
        console.log();
        
        // Show loading animation while processing
        spinner.start();
        
        const response = await game.invokeAgentWithRetry(agent, { 
          input: `I choose to: ${selectedAction}`,
        });
        
        spinner.stop();

        // Store response and parse new options
        lastResponse = response.output;
        availableOptions = game.parseOptionsFromResponse(lastResponse);

        // Show current conditions FIRST
        try {
          const currentStatus = await game.getCurrentStatus();
          const currentWeather = await game.getCurrentWeather();

          console.log(drawSectionDivider('📊 UPDATED STATUS'));
          console.log('\n' + game.formatConditions(currentStatus.vitals, 'Current Conditions'));
          console.log(currentWeather);
          console.log(game.formatInventory(currentStatus.inventory));
        } catch (error) {
          console.warn('Could not fetch current status:', error);
        }

        // Then show AI response (includes the situation and new options)
        console.log(drawSectionDivider('📖 WHAT HAPPENED'));
        console.log('\n' + response.output + '\n');

      } catch (error) {
        spinner.stop();
        
        let errorMessage: string;
        
        if (typeof error === 'object' && error !== null) {
          const err = error as Record<string, unknown>;
          const errMsg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
          
          if (err.type === 'overloaded_error' || 
              errMsg.includes('overloaded') ||
              errMsg.includes('service is currently overloaded')) {
            errorMessage = 'The AI service is currently overloaded. Please wait and try again.';
          } else {
            errorMessage = error instanceof Error ? error.message : String(error);
          }
        } else {
          const errorStr = String(error).toLowerCase();
          if (errorStr.includes('overloaded')) {
            errorMessage = 'The AI service is currently overloaded. Please wait and try again.';
          } else {
            errorMessage = String(error);
          }
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
