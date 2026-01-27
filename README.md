# 🏔️ 72-Hour Wilderness Survival Game

An AI-powered, text-based survival simulation where you must survive 72 hours in the Pacific Northwest wilderness. Built with TypeScript, LangChain, and Model Context Protocol (MCP) servers that provide real-time weather data, terrain information, wildlife encounters, and survival knowledge.

## 🎮 Game Overview

You've gotten lost while hiking in the wilderness. With only basic gear and a minor ankle sprain, you must survive for 72 hours until rescue arrives. Every decision matters—from building shelter and finding water to managing your core temperature and energy levels.

**Key Features:**
- 🌦️ **Real-time weather** from NOAA/NWS API
- 🌲 **Actual plant species** data from iNaturalist
- 🗺️ **Real terrain** elevation and geography
- 🤖 **AI wilderness expert** guide powered by Claude
- 💾 **Auto-save system** to continue your journey
- 📊 **Dynamic vitals tracking** (temperature, hydration, energy, fatigue)
- 🦌 **Wildlife encounters** based on season and location
- 🏕️ **Shelter building** and fire management

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js** v18 or higher ([Download here](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Anthropic API Key** ([Get one here](https://console.anthropic.com/))
- **Terminal/Command line** access
- Internet connection (for weather/terrain APIs)

## 🚀 Installation

### 1. Clone or Download the Repository

```bash
git clone <your-repo-url>
cd survival-game
```

### 2. Install Dependencies

```bash
npm install
```

This will install:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@anthropic-ai/sdk` - Anthropic's Claude API
- `langchain` - AI agent framework
- `axios` - HTTP client for API calls
- `dotenv` - Environment variable management
- TypeScript and related tooling

### 3. Set Up Environment Variables

Create a `.env` file in the project root:

```bash
touch .env
```

Add your Anthropic API key to `.env`:

```env
ANTHROPIC_API_KEY=your_api_key_here
```

**To get your API key:**
1. Visit [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Copy and paste it into your `.env` file

### 4. Build the Project

Compile TypeScript to JavaScript:

```bash
npm run build
```

This creates a `dist/` directory with compiled JavaScript files.

## 🎯 How to Play

### Starting the Game

```bash
npm start
```

### First-Time Setup

1. **Location Detection**: The game will detect your location via IP
   - Confirm or manually enter your location
   - Supports city names (e.g., "Seattle, WA") or coordinates (e.g., "47.6,-122.3")

2. **Character Creation**: Enter your player name

3. **Scenario Generation**: The AI creates your survival scenario based on:
   - Your actual location's terrain and weather
   - Current season
   - Realistic starting conditions

### Gameplay Loop

Each turn:

1. **Read the Situation**: The AI describes your current scenario
2. **Check Your Status**: See vitals, weather, inventory
3. **Take Action**: Type what you want to do
4. **See Results**: The AI processes your action and updates the game state
5. **Auto-save**: Progress is automatically saved

### Example Actions

**Survival Basics:**
- "Look around for a good shelter location"
- "Build a debris shelter under the cedar tree"
- "Search for a water source"
- "Collect dry tinder and kindling for a fire"
- "Start a fire using the bow drill method"

**Resource Management:**
- "Boil water from the stream"
- "Look for edible plants"
- "Check the salal berries for ripeness"
- "Collect firewood to last through the night"
- "Insulate my shelter with more debris"

**Health & Safety:**
- "Rest to recover energy"
- "Elevate my sprained ankle"
- "Move to higher ground to avoid the cold air drainage"
- "Check my core temperature"

**Exploration:**
- "Scout the area for better shelter materials"
- "Follow the stream downhill"
- "Look for signs of wildlife"
- "Try to get oriented using the sun"

### Special Commands

- `status` - View detailed stats (vitals, inventory, time survived)
- `save` - Manually save your game
- `quit` or `exit` or `q` - Save and exit the game

### Continuing a Saved Game

When you restart, you'll be prompted:
```
Found a saved game! Do you want to continue? (yes/no)
```

Choose `yes` to resume from where you left off. The AI will:
- Restore your game state
- Remind you where you left off
- Continue the narrative seamlessly

Choose `no` to start a new game (this deletes your previous save).

## 📊 Understanding Your Status

### Vitals

**Core Temperature (°F)**
- 98.6°F: Normal
- 95-97°F: Mild hypothermia (shivering, confusion)
- Below 95°F: Severe hypothermia (life-threatening)
- Above 99°F: Possible fever/infection

**Hydration Level (0-100%)**
- 80-100%: Well hydrated
- 50-80%: Mild dehydration
- Below 50%: Severe dehydration (impaired function)

**Energy Level (0-100%)**
- 70-100%: Good energy
- 40-70%: Fatigued
- Below 40%: Exhausted (reduced effectiveness)

**Fatigue (0-100)**
- 0-30: Well rested
- 30-60: Tired
- 60-100: Exhausted (need rest)

### Inventory Categories

- **Clothing**: Affects temperature retention
- **Gear**: Tools and equipment
- **Resources**: Materials collected (wood, tinder, etc.)
- **Food**: Consumable items

### Progress Tracking

- **Hours Survived**: 0-72 (goal: reach 72 hours)
- **Shelter Built**: Whether you have shelter
- **Fire Active**: Whether you have a fire going

## 🛠️ Technical Architecture

### MCP Servers

The game uses five specialized MCP servers that provide the AI with tools:

#### 1. **State Server** (`state-server.ts`)
Manages game state and player statistics.

**Tools:**
- `check_status` - Get current player status
- `initialize_game` - Start new game
- `restore_state` - Load saved game
- `advance_time` - Progress time
- `update_vitals` - Modify player health
- `manage_inventory` - Add/remove items
- `toggle_shelter` - Build/destroy shelter
- `toggle_fire` - Start/extinguish fire

#### 2. **Environment Server** (`environment-server.ts`)
Provides real environmental data.

**Tools:**
- `get_weather_conditions` - Current weather from NOAA
- `get_daylight_hours` - Sunrise/sunset times
- `check_terrain` - Elevation and vegetation
- `get_local_vegetation` - Plant species from iNaturalist
- `assess_hazards` - Environmental dangers

#### 3. **Knowledge Server** (`knowledge-server.ts`)
Survival knowledge database.

**Tools:**
- `evaluate_shelter_location` - Rate shelter sites
- `identify_water_source_safety` - Water treatment advice
- `check_plant_edibility` - Plant identification
- `assess_injury_treatment` - First aid guidance
- `get_shelter_building_guide` - Construction instructions

#### 4. **Wildlife Server** (`wildlife-server.ts`)
Manages animal encounters.

**Tools:**
- `check_wildlife_activity` - Current animal behavior
- `encounter_wildlife` - Generate encounters
- `track_animal` - Follow animal signs

#### 5. **Scenario Server** (`scenario-server.ts`)
Creates narrative events and challenges.

**Tools:**
- `generate_random_event` - Create complications
- `check_rescue_progress` - Time until rescue
- `get_scenario_advice` - Situation-specific tips

### Save System

Game state is automatically saved to:
```
~/.survival-game/savegame.json
```

**Save Data Includes:**
- Player vitals and inventory
- Location and progress
- Recent actions (last 10)
- Important events (last 20)
- Session summaries for AI context
- Metadata (creation time, total sessions)

## 🎓 Survival Tips

### Priority System (Rule of Threes)
1. **3 minutes** without air
2. **3 hours** without shelter (in harsh conditions)
3. **3 days** without water
4. **3 weeks** without food

### First Actions
1. **Don't Panic**: Assess your situation
2. **Find/Build Shelter**: Protection from elements
3. **Start a Fire**: Warmth, water purification, morale
4. **Secure Water**: Find and purify water source
5. **Signal**: Make yourself visible to rescuers

### Hypothermia Prevention
- Stay dry (wet = dangerous in cold)
- Insulate from ground
- Cover your head (40% heat loss)
- Keep moving (but don't sweat)
- Build fire and shelter ASAP

### Water Safety
- **Never drink untreated water** from streams/ponds
- Boiling (1+ min) is most reliable
- Filter before chemical treatment
- Rainwater is safer but still filter

### Edible Plants
- Only eat plants you're 100% certain about
- Test small amounts first
- Many edible plants have toxic lookalikes
- Common PNW edibles: salal berries, thimbleberries, salmonberries

## 🐛 Troubleshooting

### "ANTHROPIC_API_KEY not found"
- Ensure `.env` file exists in project root
- Check the API key is correctly formatted
- No quotes needed around the key value

### "Failed to connect to MCP server"
- Try rebuilding: `npm run build`
- Check Node.js version: `node --version` (need v18+)
- Restart the game

### "Weather API error" or "Cannot fetch terrain"
- Check internet connection
- Some APIs may be temporarily unavailable
- Game will use fallback data

### Game freezes during AI response
- This is normal for complex actions
- The spinning animation shows the AI is thinking
- May take 5-30 seconds for responses
- If frozen >1 minute, press Ctrl+C and restart

### Save file corruption
- If save fails to load, delete: `rm ~/.survival-game/savegame.json`
- Start fresh game

## 🔧 Development

### Project Structure

```
survival-game/
├── src/
│   ├── index.ts              # Main game loop
│   ├── game.ts               # Core game class
│   ├── save-manager.ts       # Save/load system
│   ├── types/
│   │   ├── game.ts           # Game type definitions
│   │   └── mcp.ts            # MCP type definitions
│   └── mcp-servers/
│       ├── state-server.ts       # Game state management
│       ├── environment-server.ts # Weather/terrain APIs
│       ├── knowledge-server.ts   # Survival knowledge
│       ├── wildlife-server.ts    # Animal encounters
│       └── scenario-server.ts    # Event generation
├── dist/                     # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── .env                      # Your API keys (not in git)
└── README.md
```

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run the game
npm start
```

### Modifying the Game

**Add new survival knowledge:**
Edit `src/mcp-servers/knowledge-server.ts` and add to the knowledge objects.

**Add new wildlife:**
Edit `src/mcp-servers/wildlife-server.ts` and expand the wildlife database.

**Change starting conditions:**
Modify the initial state in `src/mcp-servers/state-server.ts`.

**Adjust difficulty:**
Tweak vitals decay rates in the `advance_time` tool in `state-server.ts`.

## 🌟 Advanced Features

### Custom Locations

You can specify any location worldwide:
- Coordinates work globally
- Weather data available for US locations (via NOAA)
- Terrain/elevation works worldwide
- Plant data available where iNaturalist has coverage

### Session Summaries

The AI automatically generates summaries of your gameplay:
- Saved when you quit
- Used to maintain narrative continuity
- Helps AI remember key events across sessions

### Conversation History

Recent actions and AI responses are tracked:
- Maintains narrative flow
- Prevents AI from "forgetting" recent events
- Last 10 exchanges kept in memory

## 🤝 Contributing

This is a personal project but suggestions welcome! Areas for expansion:
- More plant/wildlife species
- Additional survival scenarios
- Multiplayer survival mode
- GUI interface
- Mobile app version

## 📝 License

This project is for educational and entertainment purposes. Real wilderness survival requires professional training. Never attempt survival situations without proper preparation and knowledge.

## ⚠️ Disclaimer

**This game is for entertainment only.** Real wilderness survival is extremely dangerous. The information provided should not be used as actual survival instruction. Always:
- Take proper wilderness courses
- Never hike alone
- Tell someone your plans
- Carry proper gear
- Know your limits

## 🙏 Credits

**APIs Used:**
- [Anthropic Claude](https://www.anthropic.com/) - AI reasoning and narrative
- [NOAA National Weather Service](https://www.weather.gov/) - Weather data
- [iNaturalist](https://www.inaturalist.org/) - Plant species data
- [Sunrise-Sunset.org](https://sunrise-sunset.org/) - Daylight calculations
- [Open-Elevation](https://open-elevation.com/) - Terrain elevation
- [ip-api.com](https://ip-api.com/) - Location detection

**Built with:**
- TypeScript
- LangChain
- Model Context Protocol (MCP)
- Node.js

---

**Developed by Duncan** - A software engineer and wilderness enthusiast from the Pacific Northwest

Survive. Adapt. Overcome. 🏔️🔥🏕️