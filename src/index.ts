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

    // Initialize game
    console.log('Initializing your survival scenario...\n');
    const initResponse = await agent.invoke({
      input: 'Initialize the game and tell me my starting situation.',
    });
    console.log(`\n${initResponse.output}\n`);

    // Main game loop
    while (true) {
      const action = await ask('> ');

      if (['quit', 'exit', 'q'].includes(action.toLowerCase())) {
        console.log('\nGame ended. Stay safe out there.');
        break;
      }

      if (!action.trim()) continue;

      try {
        const response = await agent.invoke({ 
          input: action,
        });
        console.log(`\n${response.output}\n`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
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
