// src/mcp-servers/wildlife-server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const server = new Server(
  {
    name: 'wildlife-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Cache for wildlife data
const wildlifeCache: Map<string, { data: DangerousAnimal[]; timestamp: number }> = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Track recent encounters to avoid repetition
let recentEncounters: string[] = [];
const MAX_RECENT_ENCOUNTERS = 5;

// Encounter cooldown (don't trigger too often)
let lastEncounterTime = 0;
const ENCOUNTER_COOLDOWN = 1000 * 60 * 2; // 2 minutes minimum between encounters

interface DangerousAnimal {
  name: string;
  scientificName: string;
  dangerLevel: 'low' | 'medium' | 'high' | 'extreme';
  encounterTypes: string[];
  injuries: string[];
  avoidanceTips: string[];
  observationCount: number;
}

interface WildlifeEncounter {
  triggered: boolean;
  animal: DangerousAnimal | null;
  encounterType: string;
  description: string;
  severity: 'minor' | 'moderate' | 'serious' | 'critical';
  injury: string | null;
  survivalTip: string;
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
}

// Dangerous animal categories to search for
const DANGEROUS_TAXA = [
  { name: 'bears', taxonId: 41638, dangerLevel: 'extreme' as const },
  { name: 'cougars', taxonId: 41958, dangerLevel: 'extreme' as const },
  { name: 'wolves', taxonId: 41652, dangerLevel: 'high' as const },
  { name: 'coyotes', taxonId: 41649, dangerLevel: 'medium' as const },
  { name: 'moose', taxonId: 41808, dangerLevel: 'high' as const },
  { name: 'elk', taxonId: 41849, dangerLevel: 'medium' as const },
  { name: 'wild boar', taxonId: 41515, dangerLevel: 'high' as const },
  { name: 'rattlesnakes', taxonId: 30745, dangerLevel: 'high' as const },
  { name: 'venomous snakes', taxonId: 30745, dangerLevel: 'high' as const },
  { name: 'scorpions', taxonId: 48654, dangerLevel: 'medium' as const },
  { name: 'black widow spiders', taxonId: 47113, dangerLevel: 'medium' as const },
  { name: 'wasps/hornets', taxonId: 52747, dangerLevel: 'low' as const },
];

// Encounter scenarios by animal type
const ENCOUNTER_SCENARIOS: Record<string, {
  encounters: Array<{
    type: string;
    description: string;
    severity: 'minor' | 'moderate' | 'serious' | 'critical';
    injury: string | null;
  }>;
  avoidanceTips: string[];
}> = {
  bears: {
    encounters: [
      { type: 'distant_sighting', description: 'You spot a bear about 200 yards away, foraging. It hasn\'t noticed you yet.', severity: 'minor', injury: null },
      { type: 'surprise_encounter', description: 'A bear emerges from the brush just 30 feet away! It stands on its hind legs, sniffing the air.', severity: 'moderate', injury: null },
      { type: 'food_attracted', description: 'A bear has been attracted to your camp by the smell of food. It\'s circling your position.', severity: 'serious', injury: null },
      { type: 'mother_with_cubs', description: 'You accidentally stumbled between a mother bear and her cubs. She\'s making warning sounds and showing teeth.', severity: 'critical', injury: null },
      { type: 'bluff_charge', description: 'The bear charges at you but stops 10 feet away - a bluff charge. Your heart is pounding.', severity: 'serious', injury: 'Elevated heart rate, adrenaline crash' },
      { type: 'defensive_swipe', description: 'The bear swipes at you defensively as you back away. Its claws graze your arm.', severity: 'critical', injury: 'Deep laceration on forearm' },
    ],
    avoidanceTips: ['Make noise while hiking', 'Store food in bear canisters', 'Never run from a bear', 'Carry bear spray'],
  },
  cougars: {
    encounters: [
      { type: 'stalked', description: 'You feel like you\'re being watched. Turning slowly, you spot a cougar crouched in the underbrush, eyes fixed on you.', severity: 'serious', injury: null },
      { type: 'tracks_found', description: 'Fresh cougar tracks cross your path - very fresh. The animal is nearby.', severity: 'minor', injury: null },
      { type: 'night_eyes', description: 'Your flashlight catches reflective eyes in the darkness. A cougar is watching from just 40 feet away.', severity: 'serious', injury: null },
      { type: 'territorial_warning', description: 'A cougar blocks your path, tail twitching. It\'s making direct eye contact - a territorial display.', severity: 'critical', injury: null },
      { type: 'ambush_attempt', description: 'A cougar lunges from a rock above! You manage to dodge but fall hard.', severity: 'critical', injury: 'Sprained wrist, bruised ribs' },
    ],
    avoidanceTips: ['Never crouch or bend over in cougar country', 'Make yourself look big', 'Maintain eye contact', 'Fight back if attacked'],
  },
  wolves: {
    encounters: [
      { type: 'howling_nearby', description: 'Wolf howls echo through the forest, answered by others. A pack is communicating nearby.', severity: 'minor', injury: null },
      { type: 'pack_sighting', description: 'A wolf pack is visible on a ridge, watching you. They\'re curious but keeping their distance.', severity: 'moderate', injury: null },
      { type: 'lone_wolf', description: 'A lone wolf approaches cautiously, possibly habituated to humans. It\'s not showing fear.', severity: 'moderate', injury: null },
      { type: 'surrounded', description: 'You realize wolves have spread out around you. They\'re testing you, looking for weakness.', severity: 'serious', injury: null },
    ],
    avoidanceTips: ['Travel in groups', 'Make noise', 'Never feed wolves', 'Stand your ground'],
  },
  moose: {
    encounters: [
      { type: 'path_blocked', description: 'A massive bull moose stands in your path, antlers gleaming. It snorts and stamps.', severity: 'moderate', injury: null },
      { type: 'cow_with_calf', description: 'A cow moose with a young calf spots you. She lowers her head and her ears go back - warning signs.', severity: 'serious', injury: null },
      { type: 'rutting_bull', description: 'A rutting bull moose has noticed you. It\'s acting erratically, thrashing bushes with its antlers.', severity: 'critical', injury: null },
      { type: 'charge', description: 'The moose charges! You barely dive behind a tree as it thunders past.', severity: 'critical', injury: 'Bruised shoulder from diving' },
    ],
    avoidanceTips: ['Give moose at least 50 feet', 'Get behind a tree if charged', 'Never get between cow and calf', 'Watch for laid-back ears'],
  },
  rattlesnakes: {
    encounters: [
      { type: 'warning_rattle', description: 'You freeze as a distinctive rattling sound comes from near your feet. A rattlesnake is coiled, ready to strike.', severity: 'serious', injury: null },
      { type: 'near_miss', description: 'A rattlesnake strikes at your boot but the fangs don\'t penetrate the leather. Too close.', severity: 'moderate', injury: null },
      { type: 'den_discovered', description: 'You\'ve stumbled near a snake den. Multiple rattlesnakes are visible, some rattling warnings.', severity: 'serious', injury: null },
      { type: 'bitten', description: 'Sharp pain in your calf - a rattlesnake got you before you saw it. You can see the puncture wounds.', severity: 'critical', injury: 'Venomous snakebite on lower leg' },
    ],
    avoidanceTips: ['Watch where you step', 'Don\'t put hands where you can\'t see', 'Wear boots', 'Give snakes space to retreat'],
  },
  coyotes: {
    encounters: [
      { type: 'pack_nearby', description: 'Coyote yips and howls surround your position as night falls. They sound close.', severity: 'minor', injury: null },
      { type: 'bold_approach', description: 'A coyote approaches to within 20 feet, not showing normal fear. It may be rabid or habituated.', severity: 'moderate', injury: null },
      { type: 'testing_pack', description: 'Several coyotes circle your camp, darting in and out. They\'re testing your defenses.', severity: 'moderate', injury: null },
    ],
    avoidanceTips: ['Make loud noises', 'Appear large and aggressive', 'Never turn your back', 'Protect pets and food'],
  },
  'wild boar': {
    encounters: [
      { type: 'rooting_nearby', description: 'Loud snorting and rooting sounds come from dense brush. Wild boar are feeding nearby.', severity: 'minor', injury: null },
      { type: 'surprised_sounder', description: 'You\'ve startled a group of wild boar! They scatter but one large male turns to face you.', severity: 'moderate', injury: null },
      { type: 'aggressive_boar', description: 'A large boar with prominent tusks lowers its head and charges!', severity: 'critical', injury: 'Tusk gash on thigh' },
    ],
    avoidanceTips: ['Make noise while walking', 'Climb a tree if charged', 'Avoid mothers with piglets', 'Never corner a boar'],
  },
  scorpions: {
    encounters: [
      { type: 'in_boot', description: 'You feel a sharp sting as you put on your boot - a scorpion was hiding inside!', severity: 'moderate', injury: 'Scorpion sting on foot' },
      { type: 'night_discovery', description: 'Using your light at night, you spot several scorpions near your sleeping area.', severity: 'minor', injury: null },
    ],
    avoidanceTips: ['Shake out boots and clothes', 'Check bedding before sleeping', 'Wear shoes at night', 'Use UV light to spot them'],
  },
  'black widow spiders': {
    encounters: [
      { type: 'web_contact', description: 'Reaching into a dark crevice for firewood, you feel a sharp bite. A black widow scurries away.', severity: 'serious', injury: 'Black widow bite on hand' },
      { type: 'nest_found', description: 'You notice distinctive black widow webs with egg sacs in the shelter material you\'ve gathered.', severity: 'minor', injury: null },
    ],
    avoidanceTips: ['Wear gloves when gathering wood', 'Check dark spaces before reaching', 'Shake out materials', 'Learn to identify their webs'],
  },
  'wasps/hornets': {
    encounters: [
      { type: 'nest_disturbed', description: 'Your movement disturbed a hidden wasp nest! Angry insects swarm out.', severity: 'moderate', injury: 'Multiple wasp stings' },
      { type: 'attracted_to_food', description: 'Wasps are aggressively hovering around you, attracted to food smells.', severity: 'minor', injury: null },
      { type: 'ground_nest', description: 'You stepped on a ground hornet nest! Dozens of hornets are attacking!', severity: 'serious', injury: 'Numerous hornet stings, possible allergic reaction' },
    ],
    avoidanceTips: ['Watch for nest activity', 'Don\'t swat at them', 'Move slowly away', 'Cover food and sweet drinks'],
  },
  elk: {
    encounters: [
      { type: 'rutting_bull', description: 'A bull elk bugles loudly - it\'s rutting season. He\'s eyeing you as competition.', severity: 'moderate', injury: null },
      { type: 'herd_crossing', description: 'An elk herd is crossing your path. Some cows are getting nervous at your presence.', severity: 'minor', injury: null },
      { type: 'charge', description: 'The bull elk charges! You scramble up a slope as antlers whistle past.', severity: 'serious', injury: 'Scrapes from scrambling' },
    ],
    avoidanceTips: ['Keep 50+ yards distance', 'Avoid during rut season', 'Never approach calves', 'Back away slowly'],
  },
};

/**
 * Fetch dangerous animals from iNaturalist for a location
 */
async function fetchDangerousWildlife(lat: number, lon: number): Promise<DangerousAnimal[]> {
  const cacheKey = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = wildlifeCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const dangerousAnimals: DangerousAnimal[] = [];

  // Query iNaturalist for each dangerous taxon
  for (const taxon of DANGEROUS_TAXA) {
    try {
      const url = `https://api.inaturalist.org/v1/observations/species_counts?` +
        `lat=${lat}&lng=${lon}&radius=50&taxon_id=${taxon.taxonId}&per_page=5&quality_grade=research`;
      
      const resp = await axios.get(url, { timeout: 10000 });
      
      for (const result of resp.data.results) {
        const name = result.taxon.preferred_common_name || result.taxon.name;
        const scientificName = result.taxon.name;
        
        // Get encounter scenarios for this type
        const scenarios = ENCOUNTER_SCENARIOS[taxon.name] || ENCOUNTER_SCENARIOS['coyotes']; // Default fallback
        
        dangerousAnimals.push({
          name,
          scientificName,
          dangerLevel: taxon.dangerLevel,
          encounterTypes: scenarios.encounters.map(e => e.type),
          injuries: scenarios.encounters.filter(e => e.injury).map(e => e.injury as string),
          avoidanceTips: scenarios.avoidanceTips,
          observationCount: result.count,
        });
      }
    } catch {
      // Continue with other taxa if one fails
    }
  }

  // Sort by danger level and observation count
  const dangerOrder = { extreme: 0, high: 1, medium: 2, low: 3 };
  dangerousAnimals.sort((a, b) => {
    const dangerDiff = dangerOrder[a.dangerLevel] - dangerOrder[b.dangerLevel];
    if (dangerDiff !== 0) return dangerDiff;
    return b.observationCount - a.observationCount;
  });

  wildlifeCache.set(cacheKey, { data: dangerousAnimals, timestamp: Date.now() });
  return dangerousAnimals;
}

/**
 * Determine time of day from hours survived (game starts at noon)
 */
function getTimeOfDay(hoursSurvived: number): 'dawn' | 'day' | 'dusk' | 'night' {
  const gameHour = (12 + hoursSurvived) % 24; // Game starts at noon
  if (gameHour >= 5 && gameHour < 7) return 'dawn';
  if (gameHour >= 7 && gameHour < 18) return 'day';
  if (gameHour >= 18 && gameHour < 20) return 'dusk';
  return 'night';
}

/**
 * Generate a random wildlife encounter
 */
function generateEncounter(
  animals: DangerousAnimal[],
  hoursSurvived: number,
  encounterChance: number = 0.3
): WildlifeEncounter {
  // Check cooldown
  if (Date.now() - lastEncounterTime < ENCOUNTER_COOLDOWN) {
    return {
      triggered: false,
      animal: null,
      encounterType: 'none',
      description: 'The wilderness is quiet for now.',
      severity: 'minor',
      injury: null,
      survivalTip: '',
      timeOfDay: getTimeOfDay(hoursSurvived),
    };
  }

  // Random chance to trigger
  if (Math.random() > encounterChance) {
    return {
      triggered: false,
      animal: null,
      encounterType: 'none',
      description: 'No wildlife encounters at this time.',
      severity: 'minor',
      injury: null,
      survivalTip: '',
      timeOfDay: getTimeOfDay(hoursSurvived),
    };
  }

  if (animals.length === 0) {
    return {
      triggered: false,
      animal: null,
      encounterType: 'none',
      description: 'No dangerous wildlife detected in this area.',
      severity: 'minor',
      injury: null,
      survivalTip: '',
      timeOfDay: getTimeOfDay(hoursSurvived),
    };
  }

  // Weight selection toward more dangerous animals but with randomness
  const weights = animals.map(a => {
    const dangerWeight = { extreme: 4, high: 3, medium: 2, low: 1 }[a.dangerLevel];
    // Avoid recently encountered animals
    const recentPenalty = recentEncounters.includes(a.name) ? 0.2 : 1;
    return dangerWeight * recentPenalty * (0.5 + Math.random());
  });
  
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  
  let selectedAnimal = animals[0];
  for (let i = 0; i < animals.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      selectedAnimal = animals[i];
      break;
    }
  }

  // Find matching scenario
  const animalType = Object.keys(ENCOUNTER_SCENARIOS).find(key => 
    selectedAnimal.name.toLowerCase().includes(key.replace('_', ' ')) ||
    key.includes(selectedAnimal.name.toLowerCase().split(' ')[0])
  ) || 'coyotes';
  
  const scenarios = ENCOUNTER_SCENARIOS[animalType];
  const timeOfDay = getTimeOfDay(hoursSurvived);
  
  // Weight encounters by severity (more minor, fewer critical)
  const severityWeights = { minor: 4, moderate: 3, serious: 2, critical: 1 };
  const encounterWeights = scenarios.encounters.map(e => severityWeights[e.severity]);
  const totalEncWeight = encounterWeights.reduce((a, b) => a + b, 0);
  
  let encRandom = Math.random() * totalEncWeight;
  let selectedEncounter = scenarios.encounters[0];
  for (let i = 0; i < scenarios.encounters.length; i++) {
    encRandom -= encounterWeights[i];
    if (encRandom <= 0) {
      selectedEncounter = scenarios.encounters[i];
      break;
    }
  }

  // Update tracking
  lastEncounterTime = Date.now();
  recentEncounters.push(selectedAnimal.name);
  if (recentEncounters.length > MAX_RECENT_ENCOUNTERS) {
    recentEncounters.shift();
  }

  // Enhance description with time of day
  let description = selectedEncounter.description;
  if (timeOfDay === 'night') {
    description = description.replace('You spot', 'In the darkness, you barely make out');
    description = description.replace('visible', 'barely visible in the moonlight');
  } else if (timeOfDay === 'dawn' || timeOfDay === 'dusk') {
    description = description.replace('You spot', 'In the dim light, you notice');
  }

  return {
    triggered: true,
    animal: selectedAnimal,
    encounterType: selectedEncounter.type,
    description: `⚠️ WILDLIFE ENCOUNTER: ${selectedAnimal.name.toUpperCase()}\n\n${description}`,
    severity: selectedEncounter.severity,
    injury: selectedEncounter.injury,
    survivalTip: scenarios.avoidanceTips[Math.floor(Math.random() * scenarios.avoidanceTips.length)],
    timeOfDay,
  };
}

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_local_wildlife_dangers',
        description: 'Get a list of dangerous wildlife species in the area based on real observation data',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lon: { type: 'number', description: 'Longitude' },
          },
          required: ['lat', 'lon'],
        },
      },
      {
        name: 'check_for_encounter',
        description: 'Check if a random wildlife encounter occurs. Call this periodically to add danger and unpredictability. Higher encounter_chance means more frequent encounters.',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lon: { type: 'number', description: 'Longitude' },
            hours_survived: { type: 'number', description: 'Hours the player has survived (affects time of day)' },
            encounter_chance: { type: 'number', description: 'Probability of encounter (0.0-1.0, default 0.3)' },
            activity: { type: 'string', description: 'What the player is doing (affects encounter type)' },
          },
          required: ['lat', 'lon', 'hours_survived'],
        },
      },
      {
        name: 'get_wildlife_avoidance_tips',
        description: 'Get survival tips for avoiding or handling a specific type of dangerous animal',
        inputSchema: {
          type: 'object',
          properties: {
            animal_type: { type: 'string', description: 'Type of animal (e.g., "bear", "cougar", "snake")' },
          },
          required: ['animal_type'],
        },
      },
      {
        name: 'force_encounter',
        description: 'Force a wildlife encounter to happen (for dramatic moments). Use sparingly!',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lon: { type: 'number', description: 'Longitude' },
            hours_survived: { type: 'number', description: 'Hours survived' },
            severity_min: { type: 'string', enum: ['minor', 'moderate', 'serious', 'critical'], description: 'Minimum severity' },
          },
          required: ['lat', 'lon', 'hours_survived'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_local_wildlife_dangers': {
        const { lat, lon } = args as { lat: number; lon: number };
        
        const wildlife = await fetchDangerousWildlife(lat, lon);
        
        const result = {
          location: { lat, lon },
          dangerous_species_count: wildlife.length,
          wildlife: wildlife.map(w => ({
            name: w.name,
            scientific_name: w.scientificName,
            danger_level: w.dangerLevel,
            local_observations: w.observationCount,
            avoidance_tips: w.avoidanceTips,
          })),
          data_source: 'iNaturalist research-grade observations',
          warning: 'Always be alert for wildlife. Make noise while traveling.',
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case 'check_for_encounter': {
        const { lat, lon, hours_survived, encounter_chance = 0.3 } = args as {
          lat: number;
          lon: number;
          hours_survived: number;
          encounter_chance?: number;
          activity?: string;
        };
        
        const wildlife = await fetchDangerousWildlife(lat, lon);
        const encounter = generateEncounter(wildlife, hours_survived, encounter_chance);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(encounter, null, 2),
          }],
        };
      }

      case 'get_wildlife_avoidance_tips': {
        const { animal_type } = args as { animal_type: string };
        const animalLower = animal_type.toLowerCase();
        
        // Find matching scenario
        const matchedType = Object.keys(ENCOUNTER_SCENARIOS).find(key =>
          animalLower.includes(key.replace('_', ' ')) ||
          key.includes(animalLower.split(' ')[0])
        );
        
        if (matchedType) {
          const scenarios = ENCOUNTER_SCENARIOS[matchedType];
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                animal_type: matchedType,
                avoidance_tips: scenarios.avoidanceTips,
                possible_encounters: scenarios.encounters.map(e => ({
                  type: e.type,
                  severity: e.severity,
                  can_cause_injury: !!e.injury,
                })),
              }, null, 2),
            }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              animal_type: animal_type,
              avoidance_tips: [
                'Keep a safe distance',
                'Make noise to avoid surprise encounters',
                'Never approach or feed wildlife',
                'Know the animal\'s behavior patterns',
              ],
              note: 'Specific tips not available for this animal type',
            }, null, 2),
          }],
        };
      }

      case 'force_encounter': {
        const { lat, lon, hours_survived, severity_min = 'minor' } = args as {
          lat: number;
          lon: number;
          hours_survived: number;
          severity_min?: 'minor' | 'moderate' | 'serious' | 'critical';
        };
        
        // Reset cooldown to force encounter
        lastEncounterTime = 0;
        
        const wildlife = await fetchDangerousWildlife(lat, lon);
        
        // Keep trying until we get an encounter at or above minimum severity
        const severityOrder = ['minor', 'moderate', 'serious', 'critical'];
        const minIndex = severityOrder.indexOf(severity_min);
        
        let encounter: WildlifeEncounter;
        let attempts = 0;
        
        do {
          lastEncounterTime = 0; // Reset each attempt
          encounter = generateEncounter(wildlife, hours_survived, 1.0); // 100% chance
          attempts++;
        } while (
          encounter.triggered &&
          severityOrder.indexOf(encounter.severity) < minIndex &&
          attempts < 10
        );
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(encounter, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: errorMessage }, null, 2),
      }],
    };
  }
});

// Start server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Fatal server error: ${error}\n`);
  process.exit(1);
});