# 🏔️ 72 Hours: Backcountry Survival Simulator

An AI-powered text-based survival game where you must survive 72 hours in the wilderness until rescue arrives. The game uses Claude AI with the ReAct framework and Model Context Protocol (MCP) servers to create a dynamic, realistic survival experience based on your actual location.

## 🎮 Gameplay

You find yourself lost in the wilderness. Your goal is to survive for 72 hours until search and rescue finds you. Every decision matters:

- **Shelter** - Hypothermia can kill in 3 hours
- **Water** - Dehydration is deadly within 3 days
- **Fire** - Essential for warmth, water purification, and signaling
- **Food** - Lowest priority but important for energy

The AI simulates realistic outcomes based on survival principles, weather conditions, and your physical state. Your choices have consequences - actions take time, drain energy, and affect your core temperature and hydration.

### Features

- 🌍 **Real Location** - Uses your actual geographic location for realistic weather data
- 🌤️ **Live Weather** - Fetches real weather conditions from the National Weather Service API
- 📊 **Dynamic Vitals** - Tracks core temperature, hydration, energy, fatigue, and injuries
- 🎒 **Inventory System** - Manage clothing, gear, resources, and food
- 🎯 **Selectable Options** - AI presents contextual choices, or type your own actions
- ⏱️ **Time Progression** - Every action advances game time with realistic effects

## 📋 Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** or **yarn**
- **Anthropic API Key** - Get one at [console.anthropic.com](https://console.anthropic.com)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/72-hours-survival.git
cd 72-hours-survival
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env` file in the project root:

```bash
# Required: Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# Optional: Set to 'development' for verbose agent logging
NODE_ENV=production
```

### 4. Run the Game

```bash
npm start
```

## 🎯 How to Play

1. **Game Initialization**
   - The game detects your location and fetches current weather
   - You receive your starting conditions and initial situation

2. **Making Choices**
   - The AI presents numbered options (e.g., `1`, `2`, `3`)
   - Type the number to select an option
   - Or type a custom action to do something else

3. **Understanding Your Status**
   - **Core Temp**: Below 95°F = hypothermia danger
   - **Hydration**: Below 30% = severe dehydration
   - **Energy**: Depletes with activity, rest to recover
   - **Fatigue**: Increases with exertion, decreases with rest

4. **Commands**
   - Type `quit`, `exit`, or `q` to end the game

## 🏗️ Architecture

The game uses a modular MCP (Model Context Protocol) server architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                      Game Client                            │
│                     (src/index.ts)                          │
│  • CLI interface with game loop                             │
│  • Loading animations & status display                      │
│  • Option parsing from AI responses                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    SurvivalGame                             │
│                    (src/game.ts)                            │
│  • LangChain ReAct Agent                                    │
│  • Claude AI (claude-sonnet-4-5-20250929)                   │
│  • MCP Client connections (stdio transport)                 │
│  • IP geolocation for real-world location                   │
│  • Retry with exponential backoff                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┬─────────────────┐
        │                 │                 │                 │
        ▼                 ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ State Server  │ │ Environment   │ │ Knowledge     │ │ Scenario      │
│   (8 tools)   │ │ Server        │ │ Server        │ │ Server        │
│               │ │   (4 tools)   │ │   (5 tools)   │ │   (7 tools)   │
├───────────────┤ ├───────────────┤ ├───────────────┤ ├───────────────┤
│ • Game state  │ │ • Weather API │ │ • Shelter     │ │ • Dynamic     │
│ • Vitals      │ │ • Daylight    │ │   evaluation  │ │   scenarios   │
│ • Inventory   │ │ • Terrain     │ │ • Water safety│ │ • Narrative   │
│ • Time        │ │ • Hazards     │ │ • Plant ID    │ │   tracking    │
│ • Location    │ │               │ │ • First aid   │ │ • Story arc   │
└───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
```

### MCP Servers

| Server | File | Tools | Purpose |
|--------|------|-------|---------|
| **State** | `state-server.ts` | 8 | Manages game state, player vitals, inventory, location, and time progression |
| **Environment** | `environment-server.ts` | 4 | Fetches real weather, terrain info, daylight hours, and environmental hazards |
| **Knowledge** | `knowledge-server.ts` | 5 | Provides survival expertise for shelter, water, plants, and first aid |
| **Scenario** | `scenario-server.ts` | 7 | Generates dynamic scenarios, tracks narrative state, and manages story progression |

### Available Tools (24 total)

The AI agent has access to these tools via MCP:

**State Tools (8):**
- `state_initialize_game` - Start a new game with location coordinates
- `state_check_status` - Get current vitals, inventory, and game progress
- `state_get_location` - Get current coordinates
- `state_set_location` - Update game location
- `state_update_vitals` - Modify player conditions (temp, hydration, energy, fatigue, injuries)
- `state_manage_inventory` - Add/remove/use items from inventory
- `state_advance_time` - Progress game time with activity-based effects
- `state_calculate_survival_score` - Calculate win/lose conditions

**Environment Tools (4):**
- `environment_get_weather_conditions` - Real weather data from NWS API
- `environment_get_daylight_hours` - Sunrise/sunset times from location
- `environment_check_terrain` - Elevation and vegetation zone info
- `environment_assess_hazards` - Wildlife and seasonal danger assessment

**Knowledge Tools (5):**
- `knowledge_evaluate_shelter_location` - Rate shelter site quality
- `knowledge_identify_water_source_safety` - Assess water source safety
- `knowledge_check_plant_edibility` - Identify if plants are safe to eat
- `knowledge_assess_injury_treatment` - First aid guidance for injuries
- `knowledge_get_shelter_building_guide` - Detailed shelter construction instructions

**Scenario Tools (7):**
- `scenario_generate_scenario` - Create context-aware challenges/opportunities
- `scenario_resolve_scenario` - Record player responses and outcomes
- `scenario_get_narrative_context` - Get current story state and mood
- `scenario_get_scenario_history` - Review past events for continuity
- `scenario_update_location` - Update narrative location description
- `scenario_record_achievement` - Track major successes/failures
- `scenario_get_current_scenario` - Get active unresolved scenario

## 📁 Project Structure

```
72-hours-survival/
├── src/
│   ├── index.ts              # Main entry point, game loop, CLI
│   ├── game.ts               # SurvivalGame class, AI agent setup
│   ├── mcp-servers/
│   │   ├── state-server.ts   # Game state management
│   │   ├── environment-server.ts  # Weather & terrain APIs
│   │   ├── knowledge-server.ts    # Survival knowledge base
│   │   └── scenario-server.ts     # Scenario generation
│   └── types/
│       ├── game.ts           # Game-related types
│       └── mcp.ts            # MCP-related types
├── package.json
├── tsconfig.json
├── .env                      # Your API key (create this)
└── README.md
```

## 🛠️ Development

### Run in Development Mode

```bash
npm run dev
```

This uses `nodemon` for auto-restart on file changes.

### Build TypeScript

```bash
npm run build
```

### Enable Verbose Logging

Set `NODE_ENV=development` in your `.env` file to see detailed agent reasoning and tool calls.

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `NODE_ENV` | No | Set to `development` for verbose logging |

### Game Constants (in `src/game.ts`)

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_ITERATIONS` | 10 | Maximum agent reasoning steps per turn |
| `MAX_RETRIES` | 5 | API retry attempts on failure |
| `INITIAL_RETRY_DELAY` | 2000ms | Initial backoff delay |
| `MAX_RETRY_DELAY` | 30000ms | Maximum backoff delay |

## 🌐 External APIs

The game uses these free APIs:

- **National Weather Service** (`api.weather.gov`) - Real US weather data
- **Sunrise-Sunset API** (`api.sunrise-sunset.org`) - Daylight calculations
- **Open-Elevation API** (`api.open-elevation.com`) - Terrain elevation
- **IP-API** (`ip-api.com`) - Geolocation from IP address

## 📝 Example Session

```
╔════════════════════════════════════════════════════════════╗
║     🏔️  72 HOURS: BACKCOUNTRY SURVIVAL SIMULATOR  🏔️      ║
╚════════════════════════════════════════════════════════════╝

🌍 Detecting your location...
📍 Location: Seattle, Washington, United States
🧭 Coordinates: 47.6062°N, 122.3321°W

┌──────────────────────────────────────────────────────────┐
│                      📊 YOUR STATUS                       │
└──────────────────────────────────────────────────────────┘

🏁 Starting Conditions:
  • Core Temp: 97.5°F
  • Hydration: 60%
  • Energy: 70%
  • Fatigue: 30%
  • Injuries: Minor ankle sprain

🌤️ Weather:
  • Temperature: 42°F
  • Conditions: Partly Cloudy
  • Wind: 8 mph SW
  • Precipitation: 20%

🎒 Inventory:
  • Clothing: hiking boots, jeans, t-shirt, light jacket
  • Gear: backpack, water bottle (empty), knife
  • Resources: None
  • Food: None

The sun is getting low. You have about 2 hours of daylight left.

Your options:
1. **Find shelter immediately** - Look for natural protection from the elements
2. **Search for water** - Your bottle is empty and you're getting thirsty
3. **Gather firewood** - Collect dry materials while you can still see

Enter choice (1-3) or describe your action: 1
```

## 🐛 Troubleshooting

### "API overloaded" Error
The AI service is busy. The game will automatically retry with exponential backoff. Wait a moment and try again.

### Weather Data Unavailable
The National Weather Service API only covers US locations. For non-US locations, weather will show as unavailable but the game will still work.

### "Could not detect location"
IP geolocation failed. The game falls back to default coordinates (Cascade Mountains, WA).

### Agent Parsing Errors
If the AI produces malformed responses, the game will prompt it to retry with proper formatting.

## 📄 License

MIT License - See LICENSE file for details.

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com) - Claude AI
- [LangChain](https://langchain.com) - AI agent framework
- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
- National Weather Service - Weather data API
