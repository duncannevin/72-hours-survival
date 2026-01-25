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

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('72 HOURS: BACKCOUNTRY SURVIVAL SIMULATOR');
  console.log('='.repeat(60));
  console.log('\nInitializing game...\n');

  const game = new SurvivalGame();
  
  try {
    await game.initializeMCPServers();
    const agent = game.createAgent();

    console.log('='.repeat(60));
    console.log("You're lost in Washington's Cascade Mountains.");
    console.log('Survive 72 hours until rescue arrives.');
    console.log("Type 'quit' to exit");
    console.log('='.repeat(60));
    console.log();

    // Initialize game directly to save API calls
    console.log('Initializing your survival scenario...\n');
    try {
      const initMessage = await game.initializeGameDirectly();
      console.log(`\n${initMessage}\n`);
    } catch (error) {
      // Fallback to agent if direct initialization fails
      console.log('Using agent for initialization...\n');
      try {
        const initResponse = await game.invokeAgentWithRetry(agent, {
          input: 'Initialize the game and tell me my starting situation.',
        });
        console.log(`\n${initResponse.output}\n`);
      } catch (initError) {
        const errorMessage = initError instanceof Error ? initError.message : String(initError);
        console.error(`\nFailed to initialize game: ${errorMessage}\n`);
      }
    }

    // Main game loop
    while (true) {
      const action = await ask('> ');

      if (['quit', 'exit', 'q'].includes(action.toLowerCase())) {
        console.log('\nGame ended. Stay safe out there.');
        break;
      }

      if (!action.trim()) continue;

      try {
        const response = await game.invokeAgentWithRetry(agent, { 
          input: action,
        });
        console.log(`\n${response.output}\n`);
      } catch (error) {
        let errorMessage: string;
        
        // Handle overloaded errors with a user-friendly message
        if (typeof error === 'object' && error !== null) {
          const err = error as Record<string, unknown>;
          const errMsg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
          
          if (err.type === 'overloaded_error' || 
              errMsg.includes('overloaded') ||
              errMsg.includes('service is currently overloaded')) {
            errorMessage = 'The AI service is currently overloaded. All retry attempts failed. Please wait a few minutes and try again.';
          } else {
            errorMessage = error instanceof Error ? error.message : String(error);
          }
        } else {
          const errorStr = String(error).toLowerCase();
          if (errorStr.includes('overloaded')) {
            errorMessage = 'The AI service is currently overloaded. Please wait a few minutes and try again.';
          } else {
            errorMessage = String(error);
          }
        }
        
        console.error(`\nError: ${errorMessage}\n`);
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
