import { world, system, EntityDamageCause, BlockPermutation, ItemStack } from "@minecraft/server";

/**
 * BACKROOMS: FOUND FOOTAGE
 * Main entry point for the behavior pack scripting API.
 *
 * Entry mechanics:
 *   1. Random void patches — invisible traps that drop players into the backrooms
 *   2. Suffocation entry — suffocation damage teleports players instead of killing them
 *
 * Features:
 *   - 8 levels with chunk-based infinite generation
 *   - Level progression via exit structures
 *   - Inventory save/restore on entry/escape
 *   - Supply crate spawning with loot
 *   - Bacteria entity spawning and spreading
 *   - Per-level ambient found-footage flavor text
 *   - Chat commands (!level, !gimmemyinventoryback, !backroomsevent)
 *   - Almond Water negative effect clearing
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKROOMS_TAG = "in_backrooms";

/** Level tags applied to players to track current level. */
const LEVEL_TAGS = {
  0: "backrooms_level_0",
  1: "backrooms_level_1",
  2: "backrooms_level_2",
  3: "backrooms_poolrooms",
  4: "backrooms_grassfield",
  5: "backrooms_thalassophobia",
  6: "backrooms_level_run",
  7: "backrooms_void",
};

const ALL_LEVEL_TAGS = Object.values(LEVEL_TAGS);

/** Y-range definitions for each level. Floor Y is where the floor sits. */
const LEVEL_FLOOR_Y = {
  0: -40,
  1: -80,
  2: -120,
  3: -160,
  4: -200,
  5: -240,
  6: -280,
  7: -320,
};

/** Room heights per level. */
const LEVEL_ROOM_HEIGHT = {
  0: 4,
  1: 5,
  2: 3,
  3: 5,
  4: 1, // grass field — open air, no real ceiling
  5: 6, // thalassophobia — tall flooded cavern
  6: 4, // level run — party rooms
  7: 5, // void — default, varies per room via hash
};

/** How often (ticks) to attempt trap placement around players. */
const TRAP_SCAN_INTERVAL = 200;

/** Radius around the player to consider for trap placement. */
const TRAP_SCAN_RADIUS = 24;

/** Probability (0-1) of placing a trap on any given scan. */
const TRAP_PLACE_CHANCE = 0.15;

/** How often (ticks) to check if a player is standing on a trap. */
const TRAP_CHECK_INTERVAL = 4;

/** Chunk size in blocks — each chunk is a square region of rooms. */
const CHUNK_SIZE = 48;

/** Individual room dimensions (interior, not counting walls). */
const ROOM_WIDTH = 6;
const ROOM_DEPTH = 6;

/** Wall thickness between rooms. */
const WALL_THICKNESS = 1;

/** Cell dimensions (room + wall). */
const CELL_WIDTH = ROOM_WIDTH + WALL_THICKNESS;
const CELL_DEPTH = ROOM_DEPTH + WALL_THICKNESS;

/** Rooms per chunk axis. */
const ROOMS_PER_CHUNK = Math.floor(CHUNK_SIZE / CELL_WIDTH);

/** Chunk generation scan interval (ticks) — ~2 seconds. */
const CHUNK_SCAN_INTERVAL = 40;

/** How often (ticks) to scan for bacteria proximity. */
const BACTERIA_SCAN_INTERVAL = 20;

/** How often (ticks) to attempt bacteria spawning in chunks. */
const BACTERIA_SPAWN_INTERVAL = 200;

/** How often (ticks) to attempt bacteria spreading. */
const BACTERIA_SPREAD_INTERVAL = 600;

/** Bacteria proximity damage radius (blocks). */
const BACTERIA_DAMAGE_RADIUS = 2;

/** Chance per chunk scan to place bacteria (0-1). */
const BACTERIA_SPAWN_CHANCE = 0.05;

/** Chance for existing bacteria to spread. */
const BACTERIA_SPREAD_CHANCE = 0.1;

/** Max bacteria entities in the world. */
const BACTERIA_MAX_COUNT = 40;

/** Doorway open threshold — ~65-70% of walls have doorways. */
const DOORWAY_H_THRESHOLD = 0.32;
const DOORWAY_V_THRESHOLD = 0.30;

/** Level 2 narrower dimensions. */
const L2_ROOM_WIDTH = 4;
const L2_ROOM_DEPTH = 4;
const L2_CELL_WIDTH = L2_ROOM_WIDTH + WALL_THICKNESS;
const L2_CELL_DEPTH = L2_ROOM_DEPTH + WALL_THICKNESS;
const L2_ROOMS_PER_CHUNK = Math.floor(CHUNK_SIZE / L2_CELL_WIDTH);

/** Poolrooms larger room dimensions. */
const POOL_ROOM_WIDTH = 10;
const POOL_ROOM_DEPTH = 10;
const POOL_CELL_WIDTH = POOL_ROOM_WIDTH + WALL_THICKNESS;
const POOL_CELL_DEPTH = POOL_ROOM_DEPTH + WALL_THICKNESS;
const POOL_ROOMS_PER_CHUNK = Math.floor(CHUNK_SIZE / POOL_CELL_WIDTH);

/** Thalassophobia larger room dimensions. */
const THAL_ROOM_WIDTH = 12;
const THAL_ROOM_DEPTH = 12;
const THAL_CELL_WIDTH = THAL_ROOM_WIDTH + WALL_THICKNESS;
const THAL_CELL_DEPTH = THAL_ROOM_DEPTH + WALL_THICKNESS;
const THAL_ROOMS_PER_CHUNK = Math.floor(CHUNK_SIZE / THAL_CELL_WIDTH);

/** Level Run medium room dimensions. */
const LRUN_ROOM_WIDTH = 8;
const LRUN_ROOM_DEPTH = 8;
const LRUN_CELL_WIDTH = LRUN_ROOM_WIDTH + WALL_THICKNESS;
const LRUN_CELL_DEPTH = LRUN_ROOM_DEPTH + WALL_THICKNESS;
const LRUN_ROOMS_PER_CHUNK = Math.floor(CHUNK_SIZE / LRUN_CELL_WIDTH);

/** Void doorway threshold — fewer connections (~40%). */
const VOID_DOORWAY_THRESHOLD = 0.60;

/** How often (ticks) to apply Level Run slowness to players. */
const LEVEL_RUN_EFFECT_INTERVAL = 200;

/** How often (ticks) to attempt void teleportation glitch. */
const VOID_GLITCH_INTERVAL = 200;

/** Supply crate chance per room. */
const SUPPLY_CRATE_CHANCE = 0.02;

/** Exit structure chance per chunk. */
const EXIT_CHANCE_L0 = 0.03;
const EXIT_CHANCE_L1 = 0.025;
const EXIT_CHANCE_L2 = 0.025;
const EXIT_CHANCE_POOL = 0.02;
const GRASSFIELD_ESCAPE_DISTANCE = 500;

/** Exit structure chance per chunk — new levels. */
const EXIT_CHANCE_THALASSO = 0.02;
const EXIT_CHANCE_LEVEL_RUN = 0.015;
const EXIT_CHANCE_VOID = 0.01;

/** How often (ticks) to check for exit interactions. */
const EXIT_CHECK_INTERVAL = 10;

/** How often (ticks) to check almond water consumption for effect clearing. */
const ALMOND_WATER_CHECK_INTERVAL = 20;

/** Block identifiers for Level 0. */
const BLOCK_WALLPAPER = "backrooms:wallpaper";
const BLOCK_CARPET = "backrooms:carpet";
const BLOCK_CEILING = "backrooms:ceiling_tile";
const BLOCK_LIGHT = "backrooms:fluorescent_light";

/** Block identifiers for Level 1. */
const BLOCK_CONCRETE = "backrooms:concrete_floor";
const BLOCK_INDUSTRIAL = "backrooms:industrial_wall";
const BLOCK_PIPE_CEIL = "backrooms:pipe_ceiling";

/** Block identifiers for Level 2. */
const BLOCK_GRATING = "backrooms:metal_grating";
const BLOCK_PIPE_WALL = "backrooms:pipe_wall";
const BLOCK_RUSTY_CEIL = "backrooms:rusty_ceiling";

/** Block identifiers for Poolrooms. */
const BLOCK_POOL_TILE = "backrooms:pool_tile";
const BLOCK_WHITE_TILE = "backrooms:white_tile_wall";
const BLOCK_POOL_LIGHT = "backrooms:pool_light";

/** Block identifiers for Thalassophobia (Level 5). */
const BLOCK_OCEAN_FLOOR = "backrooms:dark_ocean_floor";
const BLOCK_CORAL_WALL = "backrooms:coral_wall";
const BLOCK_DRIP_CEIL = "backrooms:dripping_ceiling";

/** Block identifiers for Level Run (Level 6). */
const BLOCK_PARTY_FLOOR = "backrooms:party_floor";
const BLOCK_PARTY_WALL = "backrooms:party_wall";
const BLOCK_PARTY_CEIL = "backrooms:party_ceiling";

/** Block identifiers for The Void (Level 7). */
const BLOCK_VOID_FLOOR = "backrooms:void_floor";
const BLOCK_GLITCH_WALL = "backrooms:glitch_wall";
const BLOCK_VOID_CEIL = "backrooms:void_ceiling";

/** Supply crate block. */
const BLOCK_SUPPLY_CRATE = "backrooms:supply_crate";

/** Dynamic property keys. */
const TRAPS_PROPERTY = "backrooms:traps";
const INVENTORY_PROPERTY_PREFIX = "backrooms:inv_";

/** Negative effects that Almond Water clears. */
const NEGATIVE_EFFECTS = [
  "poison", "wither", "weakness", "mining_fatigue",
  "blindness", "hunger", "nausea", "slowness",
];

// ---------------------------------------------------------------------------
// Per-level ambient messages
// ---------------------------------------------------------------------------

const ENTRY_MESSAGES = [
  "\u00A77e..\u00A7r\u00A7f You noclipped out of reality.",
  "\u00A77e..\u00A7r\u00A7f The hum of fluorescent lights is deafening.",
  "\u00A77e..\u00A7r\u00A7f It smells like old, damp carpet.",
  "\u00A77e..\u00A7r\u00A7f You are not alone.",
  "\u00A77e..\u00A7r\u00A7f If you hear something, keep walking.",
  "\u00A77e..\u00A7r\u00A7f ~600 million square miles of randomly segmented rooms.",
];

/** @type {Record<number, string[]>} */
const AMBIENT_MESSAGES = {
  0: [
    "\u00A77...was that a footstep?",
    "\u00A77The lights flicker.",
    "\u00A77You feel watched.",
    "\u00A77Something moved in the corner of your eye.",
    "\u00A77The carpet squelches underfoot.",
    "\u00A77A door slams somewhere far away.",
    "\u00A77The fluorescent buzz grows louder.",
    "\u00A77You smell mildew and damp carpet fibers.",
    "\u00A77The mono-yellow walls seem to shift when you blink.",
    "\u00A77A light above you pops and goes dark.",
    "\u00A77The hum... it's inside your head now.",
    "\u00A77The carpet is wet here. It shouldn't be wet.",
    "\u00A77You swear the hallway behind you wasn't there before.",
    "\u00A77Somewhere, a fluorescent tube sputters to life.",
  ],
  1: [
    "\u00A77The concrete is cold under your feet.",
    "\u00A77Pipes groan overhead.",
    "\u00A77A metallic echo rings out from somewhere deep.",
    "\u00A77The air is thicker here. Industrial.",
    "\u00A77You hear dripping. Constant, rhythmic dripping.",
    "\u00A77A support beam creaks as if under immense weight.",
    "\u00A77The darkness between the pillars feels... solid.",
    "\u00A77Rust stains streak down the walls like dried blood.",
    "\u00A77Something scraped against metal. Far away. Maybe.",
    "\u00A77The warehouse stretches on. No end in sight.",
    "\u00A77A faint industrial hum vibrates through the floor.",
    "\u00A77The ceiling drips something that isn't water.",
  ],
  2: [
    "\u00A77The tunnels are so narrow you can barely breathe.",
    "\u00A77Pipes hiss with escaping steam.",
    "\u00A77The metal grating clangs with every step.",
    "\u00A77A red emergency light flickers on, then off.",
    "\u00A77Something is crawling through the pipes above you.",
    "\u00A77The walls are closing in. Are they?",
    "\u00A77Rust flakes fall from the ceiling like snow.",
    "\u00A77You hear breathing. It's not yours.",
    "\u00A77The maintenance tunnel branches. Both ways look the same.",
    "\u00A77A valve turns by itself somewhere ahead.",
    "\u00A77The air tastes like copper and decay.",
    "\u00A77Your footsteps echo wrong. Too many echoes.",
  ],
  3: [
    "\u00A77The water is warm. Too warm.",
    "\u00A77Blue tiles stretch endlessly in every direction.",
    "\u00A77The pool has no bottom you can see.",
    "\u00A77Ripples appear in the water. Nothing caused them.",
    "\u00A77The fluorescent lights hum a different frequency here.",
    "\u00A77It smells like chlorine and something sweet.",
    "\u00A77The tiles are impossibly clean. Sterile.",
    "\u00A77You hear splashing from a room you can't find.",
    "\u00A77The water level seems higher than it was a moment ago.",
    "\u00A77A drain gurgles somewhere beneath you.",
    "\u00A77The reflections in the water don't match the room.",
    "\u00A77This place is peaceful. That's what scares you.",
  ],
  4: [
    "\u00A77The grass stretches forever in every direction.",
    "\u00A77The sky is overcast. It's always overcast.",
    "\u00A77There's no wind, but the grass sways.",
    "\u00A77You can't tell if it's day or night.",
    "\u00A77Something tall stands in the distance. It wasn't there before.",
    "\u00A77The horizon never gets closer.",
    "\u00A77You feel exposed. Nowhere to hide.",
    "\u00A77The silence is deafening. No insects. No birds.",
    "\u00A77Your footprints in the grass disappear behind you.",
    "\u00A77A fog rolls in from nowhere.",
    "\u00A77The grass feels wrong. Too perfect.",
    "\u00A77Keep walking. The exit is out there somewhere.",
  ],
  5: [
    "\u00A71The water is dark. You can't see the bottom.",
    "\u00A71Something massive moved beneath the surface.",
    "\u00A71The pressure is crushing your chest.",
    "\u00A71Air bubbles rise from cracks you can't see.",
    "\u00A71A distant moan echoes through the flooded halls.",
    "\u00A71The water is getting deeper.",
    "\u00A71You feel something brush against your leg.",
    "\u00A71The current pulls you. There is no current.",
    "\u00A71Your lungs ache. The air tastes like salt and rust.",
    "\u00A71The darkness beneath you is absolute.",
    "\u00A71Something is watching from the deep.",
    "\u00A71Don't look down. Don't look down. Don't look down.",
  ],
  6: [
    "\u00A7dCome to the party! =)",
    "\u00A7dThe balloons are waiting...",
    "\u00A7dEveryone's here. Where are YOU?",
    "\u00A7d=) =) =) =) =) =) =)",
    "\u00A7dThe cake is a lie. But the party is REAL.",
    "\u00A7dWhy are you running? The fun is just starting!",
    "\u00A7dHappy birthday! \u00A7kHappy birthday!\u00A7r",
    "\u00A7dDon't leave! We have so many games to play!",
    "\u00A7dYou look lost. Let me show you around! =)",
    "\u00A7dThe confetti never stops falling.",
    "\u00A7dYou hear laughter. It's not human.",
    "\u00A7dThe music is getting louder. You can't find the speaker.",
  ],
  7: [
    "\u00A7k||||||||||||||||||||",
    "\u00A75Reality is thin here.",
    "\u00A75The walls are melting.",
    "\u00A7k||||\u00A7r\u00A75 ERR0R \u00A7k||||",
    "\u00A75You feel yourself being pulled apart.",
    "\u00A75The floor shifts. Is it the floor?",
    "\u00A75Something that isn't light illuminates nothing.",
    "\u00A75You can hear your own thoughts. They aren't yours.",
    "\u00A75The void stares back.",
    "\u00A75The exit is everywhere. The exit is nowhere.",
    "\u00A7k||||||||||||||||||||||||||||||||",
    "\u00A75This is not a place. This is an absence.",
  ],
};

/** Level display names. */
const LEVEL_NAMES = {
  0: "Level 0 \u2014 \"The Lobby\"",
  1: "Level 1 \u2014 \"The Habitable Zone\"",
  2: "Level 2 \u2014 \"Pipe Dreams\"",
  3: "The Poolrooms",
  4: "The Infinite Grass Field",
  5: "Level 5 \u2014 \"Thalassophobia\"",
  6: "Level ! \u2014 \"Level Run\"",
  7: "Level !-! \u2014 \"The Void\"",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Per-level generated chunk tracking.
 * @type {Record<number, Set<string>>}
 */
const _generated_chunks = {
  0: new Set(),
  1: new Set(),
  2: new Set(),
  3: new Set(),
  4: new Set(),
  5: new Set(),
  6: new Set(),
  7: new Set(),
};

/** @type {Array<import("@minecraft/server").Vector3>} */
let _active_traps = [];

/**
 * Track each player's spawn location for grass field escape distance calc.
 * @type {Map<string, import("@minecraft/server").Vector3>}
 */
const _grassfield_spawn_points = new Map();

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Pick a random element from an array.
 * @template T
 * @param {T[]} array
 * @returns {T}
 */
function _pick_random(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Deterministic hash for a 2D position — produces a value in [0, 1).
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
function _hash_position(x, z) {
  let h = (x * 374761393 + z * 668265263) ^ 0x5f3759df;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h = h ^ (h >>> 15);
  return (h >>> 0) / 0xffffffff;
}

/**
 * Deterministic hash with a seed offset per level.
 * @param {number} x
 * @param {number} z
 * @param {number} seed
 * @returns {number}
 */
function _hash_seeded(x, z, seed) {
  return _hash_position(x + seed * 7919, z + seed * 6271);
}

/**
 * Try to set a block; silently ignore if the chunk is unloaded.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {import("@minecraft/server").Vector3} location
 * @param {string} block_id
 */
function _try_set_block(dimension, location, block_id) {
  try {
    const block = dimension.getBlock(location);
    if (block) {
      block.setPermutation(BlockPermutation.resolve(block_id));
    }
  } catch {
    // chunk not loaded
  }
}

/**
 * Try to read a block; returns undefined if chunk unloaded.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {import("@minecraft/server").Vector3} location
 * @returns {import("@minecraft/server").Block | undefined}
 */
function _try_get_block(dimension, location) {
  try {
    return dimension.getBlock(location) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert world X/Z to chunk grid coordinates.
 * @param {number} world_x
 * @param {number} world_z
 * @returns {{ cx: number, cz: number }}
 */
function _world_to_chunk(world_x, world_z) {
  return {
    cx: Math.floor(world_x / CHUNK_SIZE),
    cz: Math.floor(world_z / CHUNK_SIZE),
  };
}

/**
 * Get the chunk key string for storage in the generated set.
 * @param {number} cx
 * @param {number} cz
 * @returns {string}
 */
function _chunk_key(cx, cz) {
  return `${cx},${cz}`;
}

/**
 * Determine which level a player is on based on Y position.
 * @param {number} y
 * @returns {number} Level index (0-4), or -1 if not in any level range.
 */
function _get_level_from_y(y) {
  if (y >= -50 && y <= -10) return 0;
  if (y >= -95 && y <= -65) return 1;
  if (y >= -135 && y <= -105) return 2;
  if (y >= -175 && y <= -145) return 3;
  if (y >= -215 && y <= -185) return 4;
  if (y >= -255 && y <= -225) return 5;
  if (y >= -295 && y <= -265) return 6;
  if (y >= -340 && y <= -305) return 7;
  return -1;
}

/**
 * Get the current level tag a player has.
 * @param {import("@minecraft/server").Player} player
 * @returns {number} Level index, or -1 if no level tag found.
 */
function _get_player_level(player) {
  for (const [level_str, tag] of Object.entries(LEVEL_TAGS)) {
    if (player.hasTag(tag)) return parseInt(level_str);
  }
  return -1;
}

/**
 * Swap player to a new level tag.
 * @param {import("@minecraft/server").Player} player
 * @param {number} new_level
 */
function _set_player_level(player, new_level) {
  for (const tag of ALL_LEVEL_TAGS) {
    player.removeTag(tag);
  }
  if (LEVEL_TAGS[new_level]) {
    player.addTag(LEVEL_TAGS[new_level]);
  }
}

// ---------------------------------------------------------------------------
// Doorway helpers (shared deterministic logic)
// ---------------------------------------------------------------------------

/**
 * Determine if there should be a horizontal doorway (east wall) for a room.
 * @param {number} room_col
 * @param {number} room_row
 * @param {number} seed
 * @returns {boolean}
 */
function _has_h_doorway(room_col, room_row, seed = 0) {
  const hash = _hash_seeded(room_col * 7, room_row * 13, seed);
  return hash > DOORWAY_H_THRESHOLD;
}

/**
 * Determine if there should be a vertical doorway (south wall) for a room.
 * @param {number} room_col
 * @param {number} room_row
 * @param {number} seed
 * @returns {boolean}
 */
function _has_v_doorway(room_col, room_row, seed = 0) {
  const hash = _hash_seeded(room_col * 13, room_row * 7, seed);
  return hash > DOORWAY_V_THRESHOLD;
}

/**
 * Check if a room should be merged with its east neighbor.
 * @param {number} room_col
 * @param {number} room_row
 * @param {number} seed
 * @returns {boolean}
 */
function _is_merged_room(room_col, room_row, seed = 0) {
  const hash = _hash_seeded(room_col * 31 + 17, room_row * 37 + 23, seed);
  return hash < 0.10;
}

/**
 * Check if a room should have its light dimmed/off.
 * @param {number} room_col
 * @param {number} room_row
 * @param {number} seed
 * @returns {boolean}
 */
function _is_dark_room(room_col, room_row, seed = 0) {
  const hash = _hash_seeded(room_col * 53 + 7, room_row * 41 + 11, seed);
  return hash < 0.15;
}

/**
 * Check if a room should contain a supply crate.
 * @param {number} room_col
 * @param {number} room_row
 * @param {number} seed
 * @returns {boolean}
 */
function _has_supply_crate(room_col, room_row, seed = 0) {
  const hash = _hash_seeded(room_col * 97 + 41, room_row * 83 + 59, seed);
  return hash < SUPPLY_CRATE_CHANCE;
}

// ---------------------------------------------------------------------------
// Trap placement — void patches
// ---------------------------------------------------------------------------

/**
 * Scan around a player and occasionally place a 2x1x2 trap zone on the surface.
 * @param {import("@minecraft/server").Player} player
 */
function _try_place_trap(player) {
  if (player.hasTag(BACKROOMS_TAG)) return;
  if (player.dimension.id !== "minecraft:overworld") return;
  if (Math.random() > TRAP_PLACE_CHANCE) return;

  const base_x = Math.floor(player.location.x);
  const base_z = Math.floor(player.location.z);

  const offset_x = (Math.random() > 0.5 ? 1 : -1) * (8 + Math.floor(Math.random() * (TRAP_SCAN_RADIUS - 8)));
  const offset_z = (Math.random() > 0.5 ? 1 : -1) * (8 + Math.floor(Math.random() * (TRAP_SCAN_RADIUS - 8)));

  const trap_x = base_x + offset_x;
  const trap_z = base_z + offset_z;
  const dimension = player.dimension;

  const scan_top = Math.min(Math.floor(player.location.y) + 10, 319);
  /** @type {import("@minecraft/server").Vector3 | null} */
  let surface = null;

  for (let y = scan_top; y > -30; y--) {
    const block_below = _try_get_block(dimension, { x: trap_x, y: y - 1, z: trap_z });
    const block_at = _try_get_block(dimension, { x: trap_x, y, z: trap_z });
    if (!block_below || !block_at) return;

    if (block_below.isSolid && block_at.isAir) {
      surface = { x: trap_x, y, z: trap_z };
      break;
    }
  }

  if (!surface) return;

  for (let dx = 0; dx < 2; dx++) {
    for (let dz = 0; dz < 2; dz++) {
      const loc = { x: surface.x + dx, y: surface.y, z: surface.z + dz };
      _try_set_block(dimension, loc, BLOCK_CARPET);
    }
  }

  _register_trap(surface);
}

/** Save trap list to world dynamic properties. */
function _save_traps() {
  try {
    const data = JSON.stringify(_active_traps.slice(-50));
    world.setDynamicProperty(TRAPS_PROPERTY, data);
  } catch {
    _active_traps = _active_traps.slice(-20);
  }
}

/** Load trap list from world dynamic properties. */
function _load_traps() {
  try {
    const raw = world.getDynamicProperty(TRAPS_PROPERTY);
    if (typeof raw === "string") {
      _active_traps = JSON.parse(raw);
    }
  } catch {
    _active_traps = [];
  }
}

/**
 * Register a new trap location.
 * @param {import("@minecraft/server").Vector3} location
 */
function _register_trap(location) {
  _active_traps.push(location);
  _save_traps();
}

/**
 * Check if a player is standing on any active trap.
 * @param {import("@minecraft/server").Player} player
 * @returns {import("@minecraft/server").Vector3 | null}
 */
function _check_player_on_trap(player) {
  const px = Math.floor(player.location.x);
  const py = Math.floor(player.location.y);
  const pz = Math.floor(player.location.z);

  for (let i = 0; i < _active_traps.length; i++) {
    const trap = _active_traps[i];
    if (
      px >= trap.x && px <= trap.x + 1 &&
      pz >= trap.z && pz <= trap.z + 1 &&
      (py === trap.y || py === trap.y - 1 || py === trap.y + 1)
    ) {
      _active_traps.splice(i, 1);
      _save_traps();
      return trap;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inventory save/restore
// ---------------------------------------------------------------------------

/**
 * Save a player's inventory to dynamic properties.
 * @param {import("@minecraft/server").Player} player
 */
function _save_inventory(player) {
  try {
    const inventory = player.getComponent("minecraft:inventory");
    if (!inventory) return;
    const container = inventory.container;
    if (!container) return;

    /** @type {Array<{slot: number, id: string, amount: number} | null>} */
    const items = [];
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item) {
        items.push({ slot: i, id: item.typeId, amount: item.amount });
      } else {
        items.push(null);
      }
    }

    const data = JSON.stringify(items);
    world.setDynamicProperty(INVENTORY_PROPERTY_PREFIX + player.id, data);
  } catch {
    // save failed
  }
}

/**
 * Restore a player's saved inventory from dynamic properties.
 * @param {import("@minecraft/server").Player} player
 * @returns {boolean} True if inventory was restored.
 */
function _restore_inventory(player) {
  try {
    const key = INVENTORY_PROPERTY_PREFIX + player.id;
    const raw = world.getDynamicProperty(key);
    if (typeof raw !== "string") return false;

    const items = JSON.parse(raw);
    const inventory = player.getComponent("minecraft:inventory");
    if (!inventory) return false;
    const container = inventory.container;
    if (!container) return false;

    // Clear current inventory
    for (let i = 0; i < container.size; i++) {
      container.setItem(i, undefined);
    }

    // Restore saved items
    for (const entry of items) {
      if (!entry) continue;
      try {
        const item_stack = new ItemStack(entry.id, entry.amount);
        container.setItem(entry.slot, item_stack);
      } catch {
        // item type may not exist anymore
      }
    }

    // Clean up the saved data
    world.setDynamicProperty(key, undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear a player's inventory entirely.
 * @param {import("@minecraft/server").Player} player
 */
function _clear_inventory(player) {
  try {
    const inventory = player.getComponent("minecraft:inventory");
    if (!inventory) return;
    const container = inventory.container;
    if (!container) return;
    for (let i = 0; i < container.size; i++) {
      container.setItem(i, undefined);
    }
  } catch {
    // clear failed
  }
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — Level 0 (The Lobby)
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of Level 0 backrooms.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_level_0_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[0].has(key)) return;
  _generated_chunks[0].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[0];
  const room_height = LEVEL_ROOM_HEIGHT[0];
  const ceiling_y = floor_y + room_height;
  const seed = 0;

  const room_col_offset = cx * ROOMS_PER_CHUNK;
  const room_row_offset = cz * ROOMS_PER_CHUNK;

  // Fill entire chunk volume solid, then carve
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, BLOCK_WALLPAPER);
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, BLOCK_CARPET);

      for (let y = floor_y + 1; y < ceiling_y; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, BLOCK_WALLPAPER);
      }

      _try_set_block(dimension, { x: wx, y: ceiling_y, z: wz }, BLOCK_CEILING);
      _try_set_block(dimension, { x: wx, y: ceiling_y + 1, z: wz }, BLOCK_WALLPAPER);
    }
  }

  // Carve rooms and doorways
  for (let r = 0; r < ROOMS_PER_CHUNK; r++) {
    for (let c = 0; c < ROOMS_PER_CHUNK; c++) {
      const abs_col = room_col_offset + c;
      const abs_row = room_row_offset + r;

      const room_x = origin_x + c * CELL_WIDTH + WALL_THICKNESS;
      const room_z = origin_z + r * CELL_DEPTH + WALL_THICKNESS;

      const merged = _is_merged_room(abs_col, abs_row, seed);
      const carve_width = merged && c < ROOMS_PER_CHUNK - 1 ? ROOM_WIDTH + WALL_THICKNESS + ROOM_WIDTH : ROOM_WIDTH;

      // Carve room interior
      for (let dx = 0; dx < carve_width && (room_x + dx) < origin_x + CHUNK_SIZE; dx++) {
        for (let dz = 0; dz < ROOM_DEPTH; dz++) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: room_x + dx, y, z: room_z + dz }, "minecraft:air");
          }
        }
      }

      // Lighting
      const is_dark = _is_dark_room(abs_col, abs_row, seed);
      if (!is_dark) {
        const light_x = room_x + Math.floor(ROOM_WIDTH / 2);
        const light_z = room_z + Math.floor(ROOM_DEPTH / 2);
        _try_set_block(dimension, { x: light_x, y: ceiling_y, z: light_z }, BLOCK_LIGHT);
        if ((abs_row + abs_col) % 2 === 0 && ROOM_WIDTH > 4) {
          _try_set_block(dimension, { x: light_x - 2, y: ceiling_y, z: light_z }, BLOCK_LIGHT);
        }
      } else {
        if (_hash_seeded(abs_col * 67, abs_row * 71, seed) > 0.5) {
          const light_x = room_x + Math.floor(ROOM_WIDTH / 2);
          const light_z = room_z + Math.floor(ROOM_DEPTH / 2);
          _try_set_block(dimension, { x: light_x, y: ceiling_y, z: light_z }, BLOCK_LIGHT);
        }
      }

      // Supply crate
      if (_has_supply_crate(abs_col, abs_row, seed)) {
        const crate_x = room_x + 1 + Math.floor(_hash_seeded(abs_col * 43, abs_row * 61, seed) * (ROOM_WIDTH - 2));
        const crate_z = room_z + 1 + Math.floor(_hash_seeded(abs_col * 61, abs_row * 43, seed) * (ROOM_DEPTH - 2));
        _try_set_block(dimension, { x: crate_x, y: floor_y + 1, z: crate_z }, BLOCK_SUPPLY_CRATE);
      }

      // Doorways
      _carve_room_doorways(dimension, abs_col, abs_row, room_x, room_z, floor_y, ceiling_y, ROOM_WIDTH, ROOM_DEPTH, origin_x, origin_z, seed);
    }
  }

  // Boundary doorways
  _carve_level_boundary_west(dimension, cx, cz, floor_y, ceiling_y, ROOMS_PER_CHUNK, CELL_WIDTH, CELL_DEPTH, ROOM_WIDTH, ROOM_DEPTH, seed);
  _carve_level_boundary_north(dimension, cx, cz, floor_y, ceiling_y, ROOMS_PER_CHUNK, CELL_WIDTH, CELL_DEPTH, ROOM_WIDTH, ROOM_DEPTH, seed);

  // Exit structure — rare staircase down
  _maybe_place_exit_l0(dimension, cx, cz, origin_x, origin_z, floor_y);
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — Level 1 (The Habitable Zone)
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of Level 1.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_level_1_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[1].has(key)) return;
  _generated_chunks[1].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[1];
  const room_height = LEVEL_ROOM_HEIGHT[1];
  const ceiling_y = floor_y + room_height;
  const seed = 1000;

  const room_col_offset = cx * ROOMS_PER_CHUNK;
  const room_row_offset = cz * ROOMS_PER_CHUNK;

  // Fill solid
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, BLOCK_INDUSTRIAL);
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, BLOCK_CONCRETE);

      for (let y = floor_y + 1; y < ceiling_y; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, BLOCK_INDUSTRIAL);
      }

      _try_set_block(dimension, { x: wx, y: ceiling_y, z: wz }, BLOCK_PIPE_CEIL);
      _try_set_block(dimension, { x: wx, y: ceiling_y + 1, z: wz }, BLOCK_INDUSTRIAL);
    }
  }

  // Carve rooms — wider corridors, more open
  for (let r = 0; r < ROOMS_PER_CHUNK; r++) {
    for (let c = 0; c < ROOMS_PER_CHUNK; c++) {
      const abs_col = room_col_offset + c;
      const abs_row = room_row_offset + r;

      const room_x = origin_x + c * CELL_WIDTH + WALL_THICKNESS;
      const room_z = origin_z + r * CELL_DEPTH + WALL_THICKNESS;

      // Level 1 has more merged rooms (20% instead of 10%)
      const merged = _hash_seeded(abs_col * 31 + 17, abs_row * 37 + 23, seed) < 0.20;
      const carve_width = merged && c < ROOMS_PER_CHUNK - 1 ? ROOM_WIDTH + WALL_THICKNESS + ROOM_WIDTH : ROOM_WIDTH;

      for (let dx = 0; dx < carve_width && (room_x + dx) < origin_x + CHUNK_SIZE; dx++) {
        for (let dz = 0; dz < ROOM_DEPTH; dz++) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: room_x + dx, y, z: room_z + dz }, "minecraft:air");
          }
        }
      }

      // Sparser lighting — 40% of rooms are dark
      const is_dark = _hash_seeded(abs_col * 53 + 7, abs_row * 41 + 11, seed) < 0.40;
      if (!is_dark) {
        const light_x = room_x + Math.floor(ROOM_WIDTH / 2);
        const light_z = room_z + Math.floor(ROOM_DEPTH / 2);
        _try_set_block(dimension, { x: light_x, y: ceiling_y, z: light_z }, BLOCK_LIGHT);
      }

      // Metal support pillars in some rooms
      if (_hash_seeded(abs_col * 79, abs_row * 73, seed) < 0.25) {
        _try_set_block(dimension, { x: room_x, y: floor_y + 1, z: room_z }, BLOCK_INDUSTRIAL);
        for (let y = floor_y + 2; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: room_x, y, z: room_z }, BLOCK_INDUSTRIAL);
        }
      }

      // Supply crate
      if (_has_supply_crate(abs_col, abs_row, seed)) {
        const crate_x = room_x + 1 + Math.floor(_hash_seeded(abs_col * 43, abs_row * 61, seed) * (ROOM_WIDTH - 2));
        const crate_z = room_z + 1 + Math.floor(_hash_seeded(abs_col * 61, abs_row * 43, seed) * (ROOM_DEPTH - 2));
        _try_set_block(dimension, { x: crate_x, y: floor_y + 1, z: crate_z }, BLOCK_SUPPLY_CRATE);
      }

      _carve_room_doorways(dimension, abs_col, abs_row, room_x, room_z, floor_y, ceiling_y, ROOM_WIDTH, ROOM_DEPTH, origin_x, origin_z, seed);
    }
  }

  _carve_level_boundary_west(dimension, cx, cz, floor_y, ceiling_y, ROOMS_PER_CHUNK, CELL_WIDTH, CELL_DEPTH, ROOM_WIDTH, ROOM_DEPTH, seed);
  _carve_level_boundary_north(dimension, cx, cz, floor_y, ceiling_y, ROOMS_PER_CHUNK, CELL_WIDTH, CELL_DEPTH, ROOM_WIDTH, ROOM_DEPTH, seed);

  // Exit — elevator door
  _maybe_place_exit_l1(dimension, cx, cz, origin_x, origin_z, floor_y, ceiling_y);
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — Level 2 (Pipe Dreams)
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of Level 2.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_level_2_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[2].has(key)) return;
  _generated_chunks[2].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[2];
  const room_height = LEVEL_ROOM_HEIGHT[2];
  const ceiling_y = floor_y + room_height;
  const seed = 2000;

  const room_col_offset = cx * L2_ROOMS_PER_CHUNK;
  const room_row_offset = cz * L2_ROOMS_PER_CHUNK;

  // Fill solid
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, BLOCK_PIPE_WALL);
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, BLOCK_GRATING);

      for (let y = floor_y + 1; y < ceiling_y; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, BLOCK_PIPE_WALL);
      }

      _try_set_block(dimension, { x: wx, y: ceiling_y, z: wz }, BLOCK_RUSTY_CEIL);
      _try_set_block(dimension, { x: wx, y: ceiling_y + 1, z: wz }, BLOCK_PIPE_WALL);
    }
  }

  // Carve narrow rooms
  for (let r = 0; r < L2_ROOMS_PER_CHUNK; r++) {
    for (let c = 0; c < L2_ROOMS_PER_CHUNK; c++) {
      const abs_col = room_col_offset + c;
      const abs_row = room_row_offset + r;

      const room_x = origin_x + c * L2_CELL_WIDTH + WALL_THICKNESS;
      const room_z = origin_z + r * L2_CELL_DEPTH + WALL_THICKNESS;

      // No merged rooms — claustrophobic
      for (let dx = 0; dx < L2_ROOM_WIDTH && (room_x + dx) < origin_x + CHUNK_SIZE; dx++) {
        for (let dz = 0; dz < L2_ROOM_DEPTH; dz++) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: room_x + dx, y, z: room_z + dz }, "minecraft:air");
          }
        }
      }

      // Very sparse lighting — 70% dark, red/amber feel via redstone lamps or just few lights
      const is_dark = _hash_seeded(abs_col * 53 + 7, abs_row * 41 + 11, seed) < 0.70;
      if (!is_dark) {
        const light_x = room_x + Math.floor(L2_ROOM_WIDTH / 2);
        const light_z = room_z + Math.floor(L2_ROOM_DEPTH / 2);
        // Use redstone torch for red/amber emergency lighting feel
        _try_set_block(dimension, { x: light_x, y: ceiling_y, z: light_z }, "minecraft:redstone_torch");
      }

      // Supply crate
      if (_has_supply_crate(abs_col, abs_row, seed)) {
        const crate_x = room_x + Math.floor(_hash_seeded(abs_col * 43, abs_row * 61, seed) * L2_ROOM_WIDTH);
        const crate_z = room_z + Math.floor(_hash_seeded(abs_col * 61, abs_row * 43, seed) * L2_ROOM_DEPTH);
        _try_set_block(dimension, { x: crate_x, y: floor_y + 1, z: crate_z }, BLOCK_SUPPLY_CRATE);
      }

      // Doorways for L2 narrow rooms
      if (_has_h_doorway(abs_col, abs_row, seed)) {
        const door_z = room_z + Math.floor(L2_ROOM_DEPTH / 2);
        const door_x = room_x + L2_ROOM_WIDTH;
        if (door_x < origin_x + CHUNK_SIZE) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: door_x, y, z: door_z }, "minecraft:air");
          }
        }
      }

      if (_has_v_doorway(abs_col, abs_row, seed)) {
        const door_x = room_x + Math.floor(L2_ROOM_WIDTH / 2);
        const door_z = room_z + L2_ROOM_DEPTH;
        if (door_z < origin_z + CHUNK_SIZE) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: door_x, y, z: door_z }, "minecraft:air");
          }
        }
      }
    }
  }

  // Boundary doorways for L2
  _carve_level_boundary_west(dimension, cx, cz, floor_y, ceiling_y, L2_ROOMS_PER_CHUNK, L2_CELL_WIDTH, L2_CELL_DEPTH, L2_ROOM_WIDTH, L2_ROOM_DEPTH, seed);
  _carve_level_boundary_north(dimension, cx, cz, floor_y, ceiling_y, L2_ROOMS_PER_CHUNK, L2_CELL_WIDTH, L2_CELL_DEPTH, L2_ROOM_WIDTH, L2_ROOM_DEPTH, seed);

  // Exit — hatch in the floor
  _maybe_place_exit_l2(dimension, cx, cz, origin_x, origin_z, floor_y);
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — Poolrooms
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of the Poolrooms.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_poolrooms_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[3].has(key)) return;
  _generated_chunks[3].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[3];
  const room_height = LEVEL_ROOM_HEIGHT[3];
  const ceiling_y = floor_y + room_height;
  const seed = 3000;

  const room_col_offset = cx * POOL_ROOMS_PER_CHUNK;
  const room_row_offset = cz * POOL_ROOMS_PER_CHUNK;

  // Fill solid with white tile walls
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, BLOCK_WHITE_TILE);
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, BLOCK_POOL_TILE);

      for (let y = floor_y + 1; y < ceiling_y; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, BLOCK_WHITE_TILE);
      }

      _try_set_block(dimension, { x: wx, y: ceiling_y, z: wz }, BLOCK_WHITE_TILE);
      _try_set_block(dimension, { x: wx, y: ceiling_y + 1, z: wz }, BLOCK_WHITE_TILE);
    }
  }

  // Carve large pool rooms
  for (let r = 0; r < POOL_ROOMS_PER_CHUNK; r++) {
    for (let c = 0; c < POOL_ROOMS_PER_CHUNK; c++) {
      const abs_col = room_col_offset + c;
      const abs_row = room_row_offset + r;

      const room_x = origin_x + c * POOL_CELL_WIDTH + WALL_THICKNESS;
      const room_z = origin_z + r * POOL_CELL_DEPTH + WALL_THICKNESS;

      // Carve room
      for (let dx = 0; dx < POOL_ROOM_WIDTH && (room_x + dx) < origin_x + CHUNK_SIZE; dx++) {
        for (let dz = 0; dz < POOL_ROOM_DEPTH; dz++) {
          // Floor is water
          _try_set_block(dimension, { x: room_x + dx, y: floor_y, z: room_z + dz }, "minecraft:water");
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: room_x + dx, y, z: room_z + dz }, "minecraft:air");
          }
        }
      }

      // Pool pillars
      if (_hash_seeded(abs_col * 47, abs_row * 59, seed) < 0.35) {
        const pillar_x = room_x + Math.floor(POOL_ROOM_WIDTH / 2);
        const pillar_z = room_z + Math.floor(POOL_ROOM_DEPTH / 2);
        for (let y = floor_y; y <= ceiling_y; y++) {
          _try_set_block(dimension, { x: pillar_x, y, z: pillar_z }, BLOCK_WHITE_TILE);
        }
      }

      // Bright lighting
      const light_x = room_x + Math.floor(POOL_ROOM_WIDTH / 2);
      const light_z = room_z + Math.floor(POOL_ROOM_DEPTH / 2);
      _try_set_block(dimension, { x: light_x, y: ceiling_y, z: light_z }, BLOCK_POOL_LIGHT);
      // Extra lights in larger rooms
      if (POOL_ROOM_WIDTH > 6) {
        _try_set_block(dimension, { x: light_x - 3, y: ceiling_y, z: light_z }, BLOCK_POOL_LIGHT);
        _try_set_block(dimension, { x: light_x + 3, y: ceiling_y, z: light_z }, BLOCK_POOL_LIGHT);
      }

      // Doorways — wider for poolrooms (3 blocks wide)
      if (_has_h_doorway(abs_col, abs_row, seed)) {
        const door_z = room_z + Math.floor(POOL_ROOM_DEPTH / 2) - 1;
        const door_x = room_x + POOL_ROOM_WIDTH;
        if (door_x < origin_x + CHUNK_SIZE) {
          for (let dz = 0; dz < 3; dz++) {
            _try_set_block(dimension, { x: door_x, y: floor_y, z: door_z + dz }, "minecraft:water");
            for (let y = floor_y + 1; y < ceiling_y; y++) {
              _try_set_block(dimension, { x: door_x, y, z: door_z + dz }, "minecraft:air");
            }
          }
        }
      }

      if (_has_v_doorway(abs_col, abs_row, seed)) {
        const door_x = room_x + Math.floor(POOL_ROOM_WIDTH / 2) - 1;
        const door_z = room_z + POOL_ROOM_DEPTH;
        if (door_z < origin_z + CHUNK_SIZE) {
          for (let dx = 0; dx < 3; dx++) {
            _try_set_block(dimension, { x: door_x + dx, y: floor_y, z: door_z }, "minecraft:water");
            for (let y = floor_y + 1; y < ceiling_y; y++) {
              _try_set_block(dimension, { x: door_x + dx, y, z: door_z }, "minecraft:air");
            }
          }
        }
      }
    }
  }

  // Boundary doorways for poolrooms
  _carve_pool_boundary_west(dimension, cx, cz, floor_y, ceiling_y, seed);
  _carve_pool_boundary_north(dimension, cx, cz, floor_y, ceiling_y, seed);

  // Exit — drain hole
  _maybe_place_exit_pool(dimension, cx, cz, origin_x, origin_z, floor_y);
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — Grass Field
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of the Infinite Grass Field.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_grassfield_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[4].has(key)) return;
  _generated_chunks[4].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[4];
  const seed = 4000;

  // Flat grass field — just grass blocks
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      // Bedrock below, dirt, grass on top
      _try_set_block(dimension, { x: wx, y: floor_y - 2, z: wz }, "minecraft:bedrock");
      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, "minecraft:dirt");
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, "minecraft:grass_block");

      // Clear above
      for (let y = floor_y + 1; y <= floor_y + 8; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, "minecraft:air");
      }
    }
  }

  // Scattered small structures — ruined pillars, lone blocks
  for (let i = 0; i < 3; i++) {
    const struct_hash = _hash_seeded(cx * 100 + i, cz * 100 + i, seed);
    if (struct_hash < 0.3) {
      const sx = origin_x + Math.floor(struct_hash * 1000) % CHUNK_SIZE;
      const sz = origin_z + Math.floor(struct_hash * 10000) % CHUNK_SIZE;
      // Small stone pillar
      for (let y = floor_y + 1; y <= floor_y + 3; y++) {
        _try_set_block(dimension, { x: sx, y, z: sz }, "minecraft:cobblestone");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — Thalassophobia (Level 5)
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of the Thalassophobia level.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_thalassophobia_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[5].has(key)) return;
  _generated_chunks[5].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[5];
  const room_height = LEVEL_ROOM_HEIGHT[5];
  const ceiling_y = floor_y + room_height;
  const seed = 5000;

  const room_col_offset = cx * THAL_ROOMS_PER_CHUNK;
  const room_row_offset = cz * THAL_ROOMS_PER_CHUNK;

  // Fill solid
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, BLOCK_CORAL_WALL);
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, BLOCK_OCEAN_FLOOR);

      for (let y = floor_y + 1; y < ceiling_y; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, BLOCK_CORAL_WALL);
      }

      _try_set_block(dimension, { x: wx, y: ceiling_y, z: wz }, BLOCK_DRIP_CEIL);
      _try_set_block(dimension, { x: wx, y: ceiling_y + 1, z: wz }, BLOCK_CORAL_WALL);
    }
  }

  // Carve rooms — large 12x12, mostly flooded
  for (let r = 0; r < THAL_ROOMS_PER_CHUNK; r++) {
    for (let c = 0; c < THAL_ROOMS_PER_CHUNK; c++) {
      const abs_col = room_col_offset + c;
      const abs_row = room_row_offset + r;

      const room_x = origin_x + c * THAL_CELL_WIDTH + WALL_THICKNESS;
      const room_z = origin_z + r * THAL_CELL_DEPTH + WALL_THICKNESS;

      // Carve room interior — 2 blocks of water on floor, air above
      for (let dx = 0; dx < THAL_ROOM_WIDTH && (room_x + dx) < origin_x + CHUNK_SIZE; dx++) {
        for (let dz = 0; dz < THAL_ROOM_DEPTH; dz++) {
          // Water layer (2 blocks deep)
          _try_set_block(dimension, { x: room_x + dx, y: floor_y, z: room_z + dz }, "minecraft:water");
          _try_set_block(dimension, { x: room_x + dx, y: floor_y + 1, z: room_z + dz }, "minecraft:water");
          // Air above water
          for (let y = floor_y + 2; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: room_x + dx, y, z: room_z + dz }, "minecraft:air");
          }
        }
      }

      // Dry elevated platforms in some rooms (1 block above water)
      if (_hash_seeded(abs_col * 89, abs_row * 97, seed) < 0.25) {
        const plat_x = room_x + 2;
        const plat_z = room_z + 2;
        for (let dx = 0; dx < 4; dx++) {
          for (let dz = 0; dz < 4; dz++) {
            _try_set_block(dimension, { x: plat_x + dx, y: floor_y, z: plat_z + dz }, BLOCK_OCEAN_FLOOR);
            _try_set_block(dimension, { x: plat_x + dx, y: floor_y + 1, z: plat_z + dz }, BLOCK_OCEAN_FLOOR);
            _try_set_block(dimension, { x: plat_x + dx, y: floor_y + 2, z: plat_z + dz }, "minecraft:air");
          }
        }
      }

      // Claustrophobic pillars rising from water
      if (_hash_seeded(abs_col * 47, abs_row * 59, seed) < 0.30) {
        const pillar_x = room_x + Math.floor(THAL_ROOM_WIDTH / 2);
        const pillar_z = room_z + Math.floor(THAL_ROOM_DEPTH / 2);
        for (let y = floor_y; y <= ceiling_y; y++) {
          _try_set_block(dimension, { x: pillar_x, y, z: pillar_z }, BLOCK_CORAL_WALL);
        }
      }
      if (_hash_seeded(abs_col * 61, abs_row * 67, seed) < 0.20) {
        const pillar_x = room_x + 2;
        const pillar_z = room_z + THAL_ROOM_DEPTH - 3;
        for (let y = floor_y; y <= ceiling_y; y++) {
          _try_set_block(dimension, { x: pillar_x, y, z: pillar_z }, BLOCK_CORAL_WALL);
        }
      }

      // Very sparse lighting — ~10% of rooms have a sea lantern
      const is_lit = _hash_seeded(abs_col * 53 + 7, abs_row * 41 + 11, seed) < 0.10;
      if (is_lit) {
        const light_x = room_x + Math.floor(THAL_ROOM_WIDTH / 2);
        const light_z = room_z + Math.floor(THAL_ROOM_DEPTH / 2);
        _try_set_block(dimension, { x: light_x, y: ceiling_y, z: light_z }, "minecraft:sea_lantern");
      }

      // Wide flooded doorways (3 blocks)
      if (_has_h_doorway(abs_col, abs_row, seed)) {
        const door_z = room_z + Math.floor(THAL_ROOM_DEPTH / 2) - 1;
        const door_x = room_x + THAL_ROOM_WIDTH;
        if (door_x < origin_x + CHUNK_SIZE) {
          for (let dz = 0; dz < 3; dz++) {
            _try_set_block(dimension, { x: door_x, y: floor_y, z: door_z + dz }, "minecraft:water");
            _try_set_block(dimension, { x: door_x, y: floor_y + 1, z: door_z + dz }, "minecraft:water");
            for (let y = floor_y + 2; y < ceiling_y; y++) {
              _try_set_block(dimension, { x: door_x, y, z: door_z + dz }, "minecraft:air");
            }
          }
        }
      }

      if (_has_v_doorway(abs_col, abs_row, seed)) {
        const door_x = room_x + Math.floor(THAL_ROOM_WIDTH / 2) - 1;
        const door_z = room_z + THAL_ROOM_DEPTH;
        if (door_z < origin_z + CHUNK_SIZE) {
          for (let dx = 0; dx < 3; dx++) {
            _try_set_block(dimension, { x: door_x + dx, y: floor_y, z: door_z }, "minecraft:water");
            _try_set_block(dimension, { x: door_x + dx, y: floor_y + 1, z: door_z }, "minecraft:water");
            for (let y = floor_y + 2; y < ceiling_y; y++) {
              _try_set_block(dimension, { x: door_x + dx, y, z: door_z }, "minecraft:air");
            }
          }
        }
      }

      // Supply crate on platforms
      if (_has_supply_crate(abs_col, abs_row, seed) && _hash_seeded(abs_col * 89, abs_row * 97, seed) < 0.25) {
        _try_set_block(dimension, { x: room_x + 3, y: floor_y + 2, z: room_z + 3 }, BLOCK_SUPPLY_CRATE);
      }
    }
  }

  // Boundary doorways
  _carve_thal_boundary_west(dimension, cx, cz, floor_y, ceiling_y, seed);
  _carve_thal_boundary_north(dimension, cx, cz, floor_y, ceiling_y, seed);

  // Exit — glowing portal structure (2% per chunk)
  _maybe_place_exit_thalasso(dimension, cx, cz, origin_x, origin_z, floor_y, ceiling_y);
}

/**
 * Thalassophobia boundary west carving (wide flooded doorways).
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} floor_y
 * @param {number} ceiling_y
 * @param {number} seed
 */
function _carve_thal_boundary_west(dimension, cx, cz, floor_y, ceiling_y, seed) {
  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const prev_col_offset = (cx - 1) * THAL_ROOMS_PER_CHUNK;
  const row_offset = cz * THAL_ROOMS_PER_CHUNK;
  const last_col = prev_col_offset + THAL_ROOMS_PER_CHUNK - 1;

  for (let r = 0; r < THAL_ROOMS_PER_CHUNK; r++) {
    const abs_row = row_offset + r;
    if (_has_h_doorway(last_col, abs_row, seed)) {
      const room_z_in_chunk = r * THAL_CELL_DEPTH + WALL_THICKNESS;
      const door_z = origin_z + room_z_in_chunk + Math.floor(THAL_ROOM_DEPTH / 2) - 1;
      const door_x = origin_x;
      for (let dz = 0; dz < 3; dz++) {
        _try_set_block(dimension, { x: door_x, y: floor_y, z: door_z + dz }, "minecraft:water");
        _try_set_block(dimension, { x: door_x, y: floor_y + 1, z: door_z + dz }, "minecraft:water");
        for (let y = floor_y + 2; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x, y, z: door_z + dz }, "minecraft:air");
        }
      }
    }
  }
}

/**
 * Thalassophobia boundary north carving (wide flooded doorways).
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} floor_y
 * @param {number} ceiling_y
 * @param {number} seed
 */
function _carve_thal_boundary_north(dimension, cx, cz, floor_y, ceiling_y, seed) {
  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const col_offset = cx * THAL_ROOMS_PER_CHUNK;
  const prev_row_offset = (cz - 1) * THAL_ROOMS_PER_CHUNK;
  const last_row = prev_row_offset + THAL_ROOMS_PER_CHUNK - 1;

  for (let c = 0; c < THAL_ROOMS_PER_CHUNK; c++) {
    const abs_col = col_offset + c;
    if (_has_v_doorway(abs_col, last_row, seed)) {
      const room_x_in_chunk = c * THAL_CELL_WIDTH + WALL_THICKNESS;
      const door_x = origin_x + room_x_in_chunk + Math.floor(THAL_ROOM_WIDTH / 2) - 1;
      const door_z = origin_z;
      for (let dx = 0; dx < 3; dx++) {
        _try_set_block(dimension, { x: door_x + dx, y: floor_y, z: door_z }, "minecraft:water");
        _try_set_block(dimension, { x: door_x + dx, y: floor_y + 1, z: door_z }, "minecraft:water");
        for (let y = floor_y + 2; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x + dx, y, z: door_z }, "minecraft:air");
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — Level Run (Level 6)
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of Level Run.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_level_run_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[6].has(key)) return;
  _generated_chunks[6].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[6];
  const room_height = LEVEL_ROOM_HEIGHT[6];
  const ceiling_y = floor_y + room_height;
  const seed = 6000;

  const room_col_offset = cx * LRUN_ROOMS_PER_CHUNK;
  const room_row_offset = cz * LRUN_ROOMS_PER_CHUNK;

  // Fill solid with party walls
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, BLOCK_PARTY_WALL);
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, BLOCK_PARTY_FLOOR);

      for (let y = floor_y + 1; y < ceiling_y; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, BLOCK_PARTY_WALL);
      }

      _try_set_block(dimension, { x: wx, y: ceiling_y, z: wz }, BLOCK_PARTY_CEIL);
      _try_set_block(dimension, { x: wx, y: ceiling_y + 1, z: wz }, BLOCK_PARTY_WALL);
    }
  }

  // Carve bright party rooms
  for (let r = 0; r < LRUN_ROOMS_PER_CHUNK; r++) {
    for (let c = 0; c < LRUN_ROOMS_PER_CHUNK; c++) {
      const abs_col = room_col_offset + c;
      const abs_row = room_row_offset + r;

      const room_x = origin_x + c * LRUN_CELL_WIDTH + WALL_THICKNESS;
      const room_z = origin_z + r * LRUN_CELL_DEPTH + WALL_THICKNESS;

      // Carve room interior
      for (let dx = 0; dx < LRUN_ROOM_WIDTH && (room_x + dx) < origin_x + CHUNK_SIZE; dx++) {
        for (let dz = 0; dz < LRUN_ROOM_DEPTH; dz++) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: room_x + dx, y, z: room_z + dz }, "minecraft:air");
          }
        }
      }

      // Every room is brightly lit
      const light_x = room_x + Math.floor(LRUN_ROOM_WIDTH / 2);
      const light_z = room_z + Math.floor(LRUN_ROOM_DEPTH / 2);
      _try_set_block(dimension, { x: light_x, y: ceiling_y, z: light_z }, "minecraft:glowstone");
      // Extra lights
      if (LRUN_ROOM_WIDTH > 4) {
        _try_set_block(dimension, { x: light_x - 2, y: ceiling_y, z: light_z }, "minecraft:glowstone");
        _try_set_block(dimension, { x: light_x + 2, y: ceiling_y, z: light_z }, "minecraft:glowstone");
      }

      // "=)" smiley markers — place as unique blocks scattered in rooms
      if (_hash_seeded(abs_col * 71, abs_row * 79, seed) < 0.30) {
        const sign_x = room_x + Math.floor(_hash_seeded(abs_col * 43, abs_row * 61, seed) * (LRUN_ROOM_WIDTH - 2)) + 1;
        const sign_z = room_z;
        // Yellow concrete as smiley marker on wall
        _try_set_block(dimension, { x: sign_x, y: floor_y + 2, z: sign_z }, "minecraft:yellow_concrete");
      }

      // Supply crate
      if (_has_supply_crate(abs_col, abs_row, seed)) {
        const crate_x = room_x + 1 + Math.floor(_hash_seeded(abs_col * 43, abs_row * 61, seed) * (LRUN_ROOM_WIDTH - 2));
        const crate_z = room_z + 1 + Math.floor(_hash_seeded(abs_col * 61, abs_row * 43, seed) * (LRUN_ROOM_DEPTH - 2));
        _try_set_block(dimension, { x: crate_x, y: floor_y + 1, z: crate_z }, BLOCK_SUPPLY_CRATE);
      }

      // Doorways
      _carve_room_doorways(dimension, abs_col, abs_row, room_x, room_z, floor_y, ceiling_y, LRUN_ROOM_WIDTH, LRUN_ROOM_DEPTH, origin_x, origin_z, seed);
    }
  }

  // Boundary doorways
  _carve_level_boundary_west(dimension, cx, cz, floor_y, ceiling_y, LRUN_ROOMS_PER_CHUNK, LRUN_CELL_WIDTH, LRUN_CELL_DEPTH, LRUN_ROOM_WIDTH, LRUN_ROOM_DEPTH, seed);
  _carve_level_boundary_north(dimension, cx, cz, floor_y, ceiling_y, LRUN_ROOMS_PER_CHUNK, LRUN_CELL_WIDTH, LRUN_CELL_DEPTH, LRUN_ROOM_WIDTH, LRUN_ROOM_DEPTH, seed);

  // Exit — locked door (obsidian + iron door structure)
  _maybe_place_exit_level_run(dimension, cx, cz, origin_x, origin_z, floor_y, ceiling_y);
}

// ---------------------------------------------------------------------------
// Chunk-based infinite generation — The Void (Level 7)
// ---------------------------------------------------------------------------

/**
 * Generate a single chunk of The Void level.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 */
function _generate_void_chunk(dimension, cx, cz) {
  const key = _chunk_key(cx, cz);
  if (_generated_chunks[7].has(key)) return;
  _generated_chunks[7].add(key);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;
  const floor_y = LEVEL_FLOOR_Y[7];
  const seed = 7000;

  // Use default room dimensions but vary per-room via hash
  const rooms_per_chunk = ROOMS_PER_CHUNK;
  const room_col_offset = cx * rooms_per_chunk;
  const room_row_offset = cz * rooms_per_chunk;

  // Fill solid with void blocks
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = origin_x + x;
      const wz = origin_z + z;

      _try_set_block(dimension, { x: wx, y: floor_y - 1, z: wz }, BLOCK_GLITCH_WALL);
      _try_set_block(dimension, { x: wx, y: floor_y, z: wz }, BLOCK_VOID_FLOOR);

      // Fill up to max possible height (7)
      for (let y = floor_y + 1; y <= floor_y + 7; y++) {
        _try_set_block(dimension, { x: wx, y, z: wz }, BLOCK_GLITCH_WALL);
      }

      _try_set_block(dimension, { x: wx, y: floor_y + 8, z: wz }, BLOCK_VOID_CEIL);
    }
  }

  // Carve irregular rooms — size and height vary per room
  for (let r = 0; r < rooms_per_chunk; r++) {
    for (let c = 0; c < rooms_per_chunk; c++) {
      const abs_col = room_col_offset + c;
      const abs_row = room_row_offset + r;

      const room_x = origin_x + c * CELL_WIDTH + WALL_THICKNESS;
      const room_z = origin_z + r * CELL_DEPTH + WALL_THICKNESS;

      // Variable room size: 3-15 blocks based on hash (clamped to cell)
      const size_hash = _hash_seeded(abs_col * 101, abs_row * 103, seed);
      const room_w = Math.min(3 + Math.floor(size_hash * 13), ROOM_WIDTH);
      const room_d = Math.min(3 + Math.floor(_hash_seeded(abs_col * 107, abs_row * 109, seed) * 13), ROOM_DEPTH);

      // Variable height: 3-7 blocks
      const height_hash = _hash_seeded(abs_col * 113, abs_row * 127, seed);
      const room_height = 3 + Math.floor(height_hash * 5);
      const ceiling_y = floor_y + room_height;

      // Carve room
      for (let dx = 0; dx < room_w && (room_x + dx) < origin_x + CHUNK_SIZE; dx++) {
        for (let dz = 0; dz < room_d; dz++) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: room_x + dx, y, z: room_z + dz }, "minecraft:air");
          }
          // Place ceiling at variable height
          _try_set_block(dimension, { x: room_x + dx, y: ceiling_y, z: room_z + dz }, BLOCK_VOID_CEIL);
        }
      }

      // Chaotic lighting — some rooms blindingly bright, others pitch dark
      const light_hash = _hash_seeded(abs_col * 53 + 7, abs_row * 41 + 11, seed);
      if (light_hash < 0.20) {
        // Blindingly bright
        const mid_x = room_x + Math.floor(room_w / 2);
        const mid_z = room_z + Math.floor(room_d / 2);
        _try_set_block(dimension, { x: mid_x, y: ceiling_y, z: mid_z }, "minecraft:glowstone");
        if (room_w > 3) {
          _try_set_block(dimension, { x: mid_x - 1, y: ceiling_y, z: mid_z }, "minecraft:glowstone");
          _try_set_block(dimension, { x: mid_x + 1, y: ceiling_y, z: mid_z }, "minecraft:glowstone");
        }
        if (room_d > 3) {
          _try_set_block(dimension, { x: mid_x, y: ceiling_y, z: mid_z - 1 }, "minecraft:glowstone");
          _try_set_block(dimension, { x: mid_x, y: ceiling_y, z: mid_z + 1 }, "minecraft:glowstone");
        }
      }
      // else: pitch dark (most rooms)

      // Fewer connected doorways (~40%)
      const h_door_hash = _hash_seeded(abs_col * 7, abs_row * 13, seed);
      if (h_door_hash > VOID_DOORWAY_THRESHOLD) {
        const door_z = room_z + Math.floor(room_d / 2);
        const door_x = room_x + room_w;
        if (door_x < origin_x + CHUNK_SIZE) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: door_x, y, z: door_z }, "minecraft:air");
          }
        }
      }

      const v_door_hash = _hash_seeded(abs_col * 13, abs_row * 7, seed);
      if (v_door_hash > VOID_DOORWAY_THRESHOLD) {
        const door_x = room_x + Math.floor(room_w / 2);
        const door_z = room_z + room_d;
        if (door_z < origin_z + CHUNK_SIZE) {
          for (let y = floor_y + 1; y < ceiling_y; y++) {
            _try_set_block(dimension, { x: door_x, y, z: door_z }, "minecraft:air");
          }
        }
      }

      // Supply crate — rare
      if (_has_supply_crate(abs_col, abs_row, seed)) {
        const crate_x = room_x + Math.floor(_hash_seeded(abs_col * 43, abs_row * 61, seed) * room_w);
        const crate_z = room_z + Math.floor(_hash_seeded(abs_col * 61, abs_row * 43, seed) * room_d);
        _try_set_block(dimension, { x: crate_x, y: floor_y + 1, z: crate_z }, BLOCK_SUPPLY_CRATE);
      }
    }
  }

  // Exit — nether portal frame with glowstone (the threshold)
  _maybe_place_exit_void(dimension, cx, cz, origin_x, origin_z, floor_y);
}

// ---------------------------------------------------------------------------
// Shared doorway carving helpers
// ---------------------------------------------------------------------------

/**
 * Carve horizontal and vertical doorways for a single room.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} abs_col
 * @param {number} abs_row
 * @param {number} room_x
 * @param {number} room_z
 * @param {number} floor_y
 * @param {number} ceiling_y
 * @param {number} rw - Room width
 * @param {number} rd - Room depth
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} seed
 */
function _carve_room_doorways(dimension, abs_col, abs_row, room_x, room_z, floor_y, ceiling_y, rw, rd, origin_x, origin_z, seed) {
  if (_has_h_doorway(abs_col, abs_row, seed)) {
    const door_z = room_z + Math.floor(rd / 2) - 1;
    const door_x = room_x + rw;
    if (door_x < origin_x + CHUNK_SIZE) {
      for (let dz = 0; dz < 2; dz++) {
        for (let y = floor_y + 1; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x, y, z: door_z + dz }, "minecraft:air");
        }
      }
    }
  }

  if (_has_v_doorway(abs_col, abs_row, seed)) {
    const door_x = room_x + Math.floor(rw / 2) - 1;
    const door_z = room_z + rd;
    if (door_z < origin_z + CHUNK_SIZE) {
      for (let dx = 0; dx < 2; dx++) {
        for (let y = floor_y + 1; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x + dx, y, z: door_z }, "minecraft:air");
        }
      }
    }
  }
}

/**
 * Carve doorways on the western edge of a chunk from the previous chunk's rooms.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} floor_y
 * @param {number} ceiling_y
 * @param {number} rooms_per_chunk
 * @param {number} cell_w
 * @param {number} cell_d
 * @param {number} rw
 * @param {number} rd
 * @param {number} seed
 */
function _carve_level_boundary_west(dimension, cx, cz, floor_y, ceiling_y, rooms_per_chunk, cell_w, cell_d, rw, rd, seed) {
  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;

  const prev_col_offset = (cx - 1) * rooms_per_chunk;
  const row_offset = cz * rooms_per_chunk;
  const last_col = prev_col_offset + rooms_per_chunk - 1;

  for (let r = 0; r < rooms_per_chunk; r++) {
    const abs_row = row_offset + r;
    if (_has_h_doorway(last_col, abs_row, seed)) {
      const room_z_in_chunk = r * cell_d + WALL_THICKNESS;
      const door_z = origin_z + room_z_in_chunk + Math.floor(rd / 2) - 1;
      const door_x = origin_x;

      for (let dz = 0; dz < 2; dz++) {
        for (let y = floor_y + 1; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x, y, z: door_z + dz }, "minecraft:air");
        }
      }
    }
  }
}

/**
 * Carve doorways on the northern edge of a chunk from the previous chunk's rooms.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} floor_y
 * @param {number} ceiling_y
 * @param {number} rooms_per_chunk
 * @param {number} cell_w
 * @param {number} cell_d
 * @param {number} rw
 * @param {number} rd
 * @param {number} seed
 */
function _carve_level_boundary_north(dimension, cx, cz, floor_y, ceiling_y, rooms_per_chunk, cell_w, cell_d, rw, rd, seed) {
  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;

  const col_offset = cx * rooms_per_chunk;
  const prev_row_offset = (cz - 1) * rooms_per_chunk;
  const last_row = prev_row_offset + rooms_per_chunk - 1;

  for (let c = 0; c < rooms_per_chunk; c++) {
    const abs_col = col_offset + c;
    if (_has_v_doorway(abs_col, last_row, seed)) {
      const room_x_in_chunk = c * cell_w + WALL_THICKNESS;
      const door_x = origin_x + room_x_in_chunk + Math.floor(rw / 2) - 1;
      const door_z = origin_z;

      for (let dx = 0; dx < 2; dx++) {
        for (let y = floor_y + 1; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x + dx, y, z: door_z }, "minecraft:air");
        }
      }
    }
  }
}

/**
 * Poolroom-specific boundary west carving (wider doorways).
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} floor_y
 * @param {number} ceiling_y
 * @param {number} seed
 */
function _carve_pool_boundary_west(dimension, cx, cz, floor_y, ceiling_y, seed) {
  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;

  const prev_col_offset = (cx - 1) * POOL_ROOMS_PER_CHUNK;
  const row_offset = cz * POOL_ROOMS_PER_CHUNK;
  const last_col = prev_col_offset + POOL_ROOMS_PER_CHUNK - 1;

  for (let r = 0; r < POOL_ROOMS_PER_CHUNK; r++) {
    const abs_row = row_offset + r;
    if (_has_h_doorway(last_col, abs_row, seed)) {
      const room_z_in_chunk = r * POOL_CELL_DEPTH + WALL_THICKNESS;
      const door_z = origin_z + room_z_in_chunk + Math.floor(POOL_ROOM_DEPTH / 2) - 1;
      const door_x = origin_x;

      for (let dz = 0; dz < 3; dz++) {
        _try_set_block(dimension, { x: door_x, y: floor_y, z: door_z + dz }, "minecraft:water");
        for (let y = floor_y + 1; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x, y, z: door_z + dz }, "minecraft:air");
        }
      }
    }
  }
}

/**
 * Poolroom-specific boundary north carving (wider doorways).
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} floor_y
 * @param {number} ceiling_y
 * @param {number} seed
 */
function _carve_pool_boundary_north(dimension, cx, cz, floor_y, ceiling_y, seed) {
  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;

  const col_offset = cx * POOL_ROOMS_PER_CHUNK;
  const prev_row_offset = (cz - 1) * POOL_ROOMS_PER_CHUNK;
  const last_row = prev_row_offset + POOL_ROOMS_PER_CHUNK - 1;

  for (let c = 0; c < POOL_ROOMS_PER_CHUNK; c++) {
    const abs_col = col_offset + c;
    if (_has_v_doorway(abs_col, last_row, seed)) {
      const room_x_in_chunk = c * POOL_CELL_WIDTH + WALL_THICKNESS;
      const door_x = origin_x + room_x_in_chunk + Math.floor(POOL_ROOM_WIDTH / 2) - 1;
      const door_z = origin_z;

      for (let dx = 0; dx < 3; dx++) {
        _try_set_block(dimension, { x: door_x + dx, y: floor_y, z: door_z }, "minecraft:water");
        for (let y = floor_y + 1; y < ceiling_y; y++) {
          _try_set_block(dimension, { x: door_x + dx, y, z: door_z }, "minecraft:air");
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exit structures
// ---------------------------------------------------------------------------

/**
 * Level 0 exit — rare staircase down to Level 1.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} floor_y
 */
function _maybe_place_exit_l0(dimension, cx, cz, origin_x, origin_z, floor_y) {
  const hash = _hash_seeded(cx * 1009, cz * 1013, 100);
  if (hash > EXIT_CHANCE_L0) return;

  // Place staircase in a deterministic position
  const sx = origin_x + Math.floor(hash * 7777) % (CHUNK_SIZE - 6) + 3;
  const sz = origin_z + Math.floor(hash * 9999) % (CHUNK_SIZE - 6) + 3;

  // Staircase: glowstone marker + hole down
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx + 1, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz + 1 }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx + 1, y: floor_y, z: sz + 1 }, "minecraft:glowstone");

  // Steps going down
  for (let step = 0; step < 3; step++) {
    _try_set_block(dimension, { x: sx, y: floor_y - 1 - step, z: sz + step }, "minecraft:stone_bricks");
    _try_set_block(dimension, { x: sx + 1, y: floor_y - 1 - step, z: sz + step }, "minecraft:stone_bricks");
  }
}

/**
 * Level 1 exit — elevator door to Level 2.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} floor_y
 * @param {number} ceiling_y
 */
function _maybe_place_exit_l1(dimension, cx, cz, origin_x, origin_z, floor_y, ceiling_y) {
  const hash = _hash_seeded(cx * 2003, cz * 2017, 200);
  if (hash > EXIT_CHANCE_L1) return;

  const sx = origin_x + Math.floor(hash * 7777) % (CHUNK_SIZE - 6) + 3;
  const sz = origin_z + Math.floor(hash * 9999) % (CHUNK_SIZE - 6) + 3;

  // Elevator frame — iron blocks with glowstone floor
  for (let dy = 0; dy <= ceiling_y - floor_y; dy++) {
    _try_set_block(dimension, { x: sx - 1, y: floor_y + dy, z: sz }, "minecraft:iron_block");
    _try_set_block(dimension, { x: sx + 2, y: floor_y + dy, z: sz }, "minecraft:iron_block");
    _try_set_block(dimension, { x: sx - 1, y: floor_y + dy, z: sz + 1 }, "minecraft:iron_block");
    _try_set_block(dimension, { x: sx + 2, y: floor_y + dy, z: sz + 1 }, "minecraft:iron_block");
  }
  // Interior
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx + 1, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz + 1 }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx + 1, y: floor_y, z: sz + 1 }, "minecraft:glowstone");
  // Clear interior air
  for (let y = floor_y + 1; y < ceiling_y; y++) {
    _try_set_block(dimension, { x: sx, y, z: sz }, "minecraft:air");
    _try_set_block(dimension, { x: sx + 1, y, z: sz }, "minecraft:air");
    _try_set_block(dimension, { x: sx, y, z: sz + 1 }, "minecraft:air");
    _try_set_block(dimension, { x: sx + 1, y, z: sz + 1 }, "minecraft:air");
  }
}

/**
 * Level 2 exit — hatch in the floor to the Poolrooms.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} floor_y
 */
function _maybe_place_exit_l2(dimension, cx, cz, origin_x, origin_z, floor_y) {
  const hash = _hash_seeded(cx * 3001, cz * 3011, 300);
  if (hash > EXIT_CHANCE_L2) return;

  const sx = origin_x + Math.floor(hash * 7777) % (CHUNK_SIZE - 4) + 2;
  const sz = origin_z + Math.floor(hash * 9999) % (CHUNK_SIZE - 4) + 2;

  // Hatch — glowstone ring around a hole
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx + 1, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx - 1, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz + 1 }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz - 1 }, "minecraft:glowstone");
  // The hatch center is the trigger
  _try_set_block(dimension, { x: sx, y: floor_y - 1, z: sz }, "minecraft:air");
}

/**
 * Poolrooms exit — drain hole to the Grass Field.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} floor_y
 */
function _maybe_place_exit_pool(dimension, cx, cz, origin_x, origin_z, floor_y) {
  const hash = _hash_seeded(cx * 4001, cz * 4013, 400);
  if (hash > EXIT_CHANCE_POOL) return;

  const sx = origin_x + Math.floor(hash * 7777) % (CHUNK_SIZE - 4) + 2;
  const sz = origin_z + Math.floor(hash * 9999) % (CHUNK_SIZE - 4) + 2;

  // Drain — dark block ring, center is soul sand (visual marker)
  _try_set_block(dimension, { x: sx, y: floor_y - 1, z: sz }, "minecraft:soul_sand");
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz }, "minecraft:air");
  // Ring of iron bars around it
  _try_set_block(dimension, { x: sx + 1, y: floor_y - 1, z: sz }, "minecraft:iron_bars");
  _try_set_block(dimension, { x: sx - 1, y: floor_y - 1, z: sz }, "minecraft:iron_bars");
  _try_set_block(dimension, { x: sx, y: floor_y - 1, z: sz + 1 }, "minecraft:iron_bars");
  _try_set_block(dimension, { x: sx, y: floor_y - 1, z: sz - 1 }, "minecraft:iron_bars");
}

/**
 * Thalassophobia exit — glowing portal structure to Level Run.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} floor_y
 * @param {number} ceiling_y
 */
function _maybe_place_exit_thalasso(dimension, cx, cz, origin_x, origin_z, floor_y, ceiling_y) {
  const hash = _hash_seeded(cx * 5003, cz * 5011, 500);
  if (hash > EXIT_CHANCE_THALASSO) return;

  const sx = origin_x + Math.floor(hash * 7777) % (CHUNK_SIZE - 6) + 3;
  const sz = origin_z + Math.floor(hash * 9999) % (CHUNK_SIZE - 6) + 3;

  // Glowing portal — sea lantern frame with prismarine
  for (let dy = 0; dy <= 3; dy++) {
    _try_set_block(dimension, { x: sx - 1, y: floor_y + dy, z: sz }, "minecraft:prismarine");
    _try_set_block(dimension, { x: sx + 2, y: floor_y + dy, z: sz }, "minecraft:prismarine");
  }
  _try_set_block(dimension, { x: sx, y: floor_y + 3, z: sz }, "minecraft:prismarine");
  _try_set_block(dimension, { x: sx + 1, y: floor_y + 3, z: sz }, "minecraft:prismarine");
  // Interior glow
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz }, "minecraft:sea_lantern");
  _try_set_block(dimension, { x: sx + 1, y: floor_y, z: sz }, "minecraft:sea_lantern");
  _try_set_block(dimension, { x: sx, y: floor_y + 1, z: sz }, "minecraft:air");
  _try_set_block(dimension, { x: sx + 1, y: floor_y + 1, z: sz }, "minecraft:air");
  _try_set_block(dimension, { x: sx, y: floor_y + 2, z: sz }, "minecraft:air");
  _try_set_block(dimension, { x: sx + 1, y: floor_y + 2, z: sz }, "minecraft:air");
}

/**
 * Level Run exit — locked door (obsidian + iron door) to The Void.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} floor_y
 * @param {number} ceiling_y
 */
function _maybe_place_exit_level_run(dimension, cx, cz, origin_x, origin_z, floor_y, ceiling_y) {
  const hash = _hash_seeded(cx * 6007, cz * 6011, 600);
  if (hash > EXIT_CHANCE_LEVEL_RUN) return;

  const sx = origin_x + Math.floor(hash * 7777) % (CHUNK_SIZE - 6) + 3;
  const sz = origin_z + Math.floor(hash * 9999) % (CHUNK_SIZE - 6) + 3;

  // Obsidian frame with iron door look
  for (let dy = 0; dy <= ceiling_y - floor_y; dy++) {
    _try_set_block(dimension, { x: sx - 1, y: floor_y + dy, z: sz }, "minecraft:obsidian");
    _try_set_block(dimension, { x: sx + 2, y: floor_y + dy, z: sz }, "minecraft:obsidian");
  }
  _try_set_block(dimension, { x: sx, y: ceiling_y, z: sz }, "minecraft:obsidian");
  _try_set_block(dimension, { x: sx + 1, y: ceiling_y, z: sz }, "minecraft:obsidian");
  // Glowstone floor marker
  _try_set_block(dimension, { x: sx, y: floor_y, z: sz }, "minecraft:glowstone");
  _try_set_block(dimension, { x: sx + 1, y: floor_y, z: sz }, "minecraft:glowstone");
  // Interior clear
  for (let y = floor_y + 1; y < ceiling_y; y++) {
    _try_set_block(dimension, { x: sx, y, z: sz }, "minecraft:air");
    _try_set_block(dimension, { x: sx + 1, y, z: sz }, "minecraft:air");
  }
}

/**
 * Void exit — nether portal frame with glowstone (the threshold). FINAL EXIT.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} cx
 * @param {number} cz
 * @param {number} origin_x
 * @param {number} origin_z
 * @param {number} floor_y
 */
function _maybe_place_exit_void(dimension, cx, cz, origin_x, origin_z, floor_y) {
  const hash = _hash_seeded(cx * 7001, cz * 7013, 700);
  if (hash > EXIT_CHANCE_VOID) return;

  const sx = origin_x + Math.floor(hash * 7777) % (CHUNK_SIZE - 6) + 3;
  const sz = origin_z + Math.floor(hash * 9999) % (CHUNK_SIZE - 6) + 3;

  // Nether portal frame shape with glowstone
  // Bottom
  for (let dx = 0; dx < 4; dx++) {
    _try_set_block(dimension, { x: sx + dx, y: floor_y, z: sz }, "minecraft:glowstone");
  }
  // Sides
  for (let dy = 1; dy <= 4; dy++) {
    _try_set_block(dimension, { x: sx, y: floor_y + dy, z: sz }, "minecraft:obsidian");
    _try_set_block(dimension, { x: sx + 3, y: floor_y + dy, z: sz }, "minecraft:obsidian");
  }
  // Top
  for (let dx = 0; dx < 4; dx++) {
    _try_set_block(dimension, { x: sx + dx, y: floor_y + 5, z: sz }, "minecraft:glowstone");
  }
  // Interior clear
  for (let dx = 1; dx < 3; dx++) {
    for (let dy = 1; dy <= 4; dy++) {
      _try_set_block(dimension, { x: sx + dx, y: floor_y + dy, z: sz }, "minecraft:air");
    }
  }
}

// ---------------------------------------------------------------------------
// Level generation dispatcher
// ---------------------------------------------------------------------------

/**
 * Generate appropriate chunks for a specific level around a position.
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {number} level
 * @param {number} cx
 * @param {number} cz
 */
function _generate_level_chunk(dimension, level, cx, cz) {
  switch (level) {
    case 0: _generate_level_0_chunk(dimension, cx, cz); break;
    case 1: _generate_level_1_chunk(dimension, cx, cz); break;
    case 2: _generate_level_2_chunk(dimension, cx, cz); break;
    case 3: _generate_poolrooms_chunk(dimension, cx, cz); break;
    case 4: _generate_grassfield_chunk(dimension, cx, cz); break;
    case 5: _generate_thalassophobia_chunk(dimension, cx, cz); break;
    case 6: _generate_level_run_chunk(dimension, cx, cz); break;
    case 7: _generate_void_chunk(dimension, cx, cz); break;
  }
}

// ---------------------------------------------------------------------------
// Player entry — teleport + generation
// ---------------------------------------------------------------------------

/**
 * Send the player into the backrooms at Level 0.
 * @param {import("@minecraft/server").Player} player
 * @param {string} cause
 */
function _send_to_backrooms(player, cause) {
  if (player.hasTag(BACKROOMS_TAG)) return;

  // Save inventory before entering
  _save_inventory(player);
  _clear_inventory(player);

  player.addTag(BACKROOMS_TAG);
  _set_player_level(player, 0);

  const dimension = player.dimension;
  const px = Math.floor(player.location.x);
  const pz = Math.floor(player.location.z);

  const { cx, cz } = _world_to_chunk(px, pz);

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;

  // Force-load the target area before generating chunks
  const ta_x1 = origin_x - CHUNK_SIZE;
  const ta_z1 = origin_z - CHUNK_SIZE;
  const ta_x2 = origin_x + CHUNK_SIZE * 2;
  const ta_z2 = origin_z + CHUNK_SIZE * 2;
  try {
    dimension.runCommand(`tickingarea add ${ta_x1} ${LEVEL_FLOOR_Y[0] - 5} ${ta_z1} ${ta_x2} ${LEVEL_FLOOR_Y[0] + 10} ${ta_z2} "backrooms_load" true`);
  } catch { /* already exists or failed */ }

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      _generate_level_0_chunk(dimension, cx + dx, cz + dz);
    }
  }

  const spawn_x = origin_x + Math.floor(CHUNK_SIZE / 2) + 2;
  const spawn_z = origin_z + Math.floor(CHUNK_SIZE / 2) + 2;
  const spawn_y = LEVEL_FLOOR_Y[0] + 1;

  system.runTimeout(() => {
    try {
      player.teleport(
        { x: spawn_x + 0.5, y: spawn_y, z: spawn_z + 0.5 },
        { dimension }
      );
      _show_entry_sequence(player, cause);
    } catch {
      // player disconnected
    }
  }, 60);

  // Deferred re-generation to fill in any chunks missed on first pass
  system.runTimeout(() => {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const key = _chunk_key(cx + dx, cz + dz);
        const chunks = _generated_chunks[0];
        if (!chunks.has(key)) {
          _generate_level_0_chunk(dimension, cx + dx, cz + dz);
        }
      }
    }
  }, 100);
}

/**
 * Display eerie entry messages with staggered timing.
 * @param {import("@minecraft/server").Player} player
 * @param {string} cause
 */
function _show_entry_sequence(player, cause) {
  const prefix = "\u00A7e[BACKROOMS] \u00A7f";

  player.sendMessage(`${prefix}\u00A7k||||\u00A7r \u00A7c${cause}\u00A7r \u00A7k||||`);

  system.runTimeout(() => {
    try {
      player.sendMessage(`${prefix}${_pick_random(ENTRY_MESSAGES)}`);
    } catch { /* disconnected */ }
  }, 40);

  system.runTimeout(() => {
    try {
      player.sendMessage(`${prefix}\u00A77${LEVEL_NAMES[0]}`);
      player.sendMessage(`${prefix}\u00A78Survive. Find the exit. Don't look back.`);
    } catch { /* disconnected */ }
  }, 100);
}

/**
 * Teleport a player to a specific level.
 * @param {import("@minecraft/server").Player} player
 * @param {number} level
 */
function _teleport_to_level(player, level) {
  const dimension = player.dimension;
  const px = Math.floor(player.location.x);
  const pz = Math.floor(player.location.z);
  const { cx, cz } = _world_to_chunk(px, pz);
  const floor_y = LEVEL_FLOOR_Y[level];

  const origin_x = cx * CHUNK_SIZE;
  const origin_z = cz * CHUNK_SIZE;

  // Force-load the target area before generating chunks
  const ta_x1 = origin_x - CHUNK_SIZE;
  const ta_z1 = origin_z - CHUNK_SIZE;
  const ta_x2 = origin_x + CHUNK_SIZE * 2;
  const ta_z2 = origin_z + CHUNK_SIZE * 2;
  try {
    dimension.runCommand(`tickingarea add ${ta_x1} ${floor_y - 5} ${ta_z1} ${ta_x2} ${floor_y + 10} ${ta_z2} "backrooms_load" true`);
  } catch { /* already exists or failed */ }

  // Ensure chunks are generated
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      _generate_level_chunk(dimension, level, cx + dx, cz + dz);
    }
  }

  const spawn_x = origin_x + Math.floor(CHUNK_SIZE / 2) + 2;
  const spawn_z = origin_z + Math.floor(CHUNK_SIZE / 2) + 2;
  const spawn_y = floor_y + 1;

  if (!player.hasTag(BACKROOMS_TAG)) {
    _save_inventory(player);
    _clear_inventory(player);
    player.addTag(BACKROOMS_TAG);
  }

  _set_player_level(player, level);

  // Track grass field spawn point for escape distance
  if (level === 4) {
    _grassfield_spawn_points.set(player.id, { x: spawn_x, y: spawn_y, z: spawn_z });
  }

  system.runTimeout(() => {
    try {
      player.teleport(
        { x: spawn_x + 0.5, y: spawn_y, z: spawn_z + 0.5 },
        { dimension }
      );
      const prefix = "\u00A7e[BACKROOMS] \u00A7f";
      player.sendMessage(`${prefix}\u00A77${LEVEL_NAMES[level] || "Unknown Level"}`);
    } catch {
      // player disconnected
    }
  }, 60);

  // Deferred re-generation to fill in any chunks missed on first pass
  system.runTimeout(() => {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const key = _chunk_key(cx + dx, cz + dz);
        const chunks = _generated_chunks[level] || _generated_chunks[0];
        if (!chunks.has(key)) {
          _generate_level_chunk(dimension, level, cx + dx, cz + dz);
        }
      }
    }
  }, 100);
}

/**
 * Remove a player from the backrooms and return them to the overworld surface.
 * @param {import("@minecraft/server").Player} player
 */
function _escape_backrooms(player) {
  player.removeTag(BACKROOMS_TAG);
  for (const tag of ALL_LEVEL_TAGS) {
    player.removeTag(tag);
  }
  _grassfield_spawn_points.delete(player.id);

  const prefix = "\u00A7e[BACKROOMS] \u00A7f";

  system.runTimeout(() => {
    try {
      // Teleport to overworld surface
      player.teleport(
        { x: player.location.x, y: 100, z: player.location.z },
        { dimension: player.dimension }
      );
      player.sendMessage(`${prefix}\u00A7aYou escaped the Backrooms.`);
      player.sendMessage(`${prefix}\u00A77...or did you?`);

      // Restore inventory
      system.runTimeout(() => {
        try {
          const restored = _restore_inventory(player);
          if (restored) {
            player.sendMessage(`${prefix}\u00A77Your belongings feel familiar again.`);
          }
        } catch { /* failed */ }
      }, 20);
    } catch {
      // disconnected
    }
  }, 5);
}

// ---------------------------------------------------------------------------
// Suffocation entry detection
// ---------------------------------------------------------------------------

/** Subscribe to entity hurt events and intercept suffocation damage. */
function _setup_suffocation_listener() {
  world.afterEvents.entityHurt.subscribe((event) => {
    const { hurtEntity, damageSource } = event;

    if (damageSource.cause !== EntityDamageCause.suffocation) return;
    if (hurtEntity.typeId !== "minecraft:player") return;

    /** @type {import("@minecraft/server").Player} */
    const player = /** @type {any} */ (hurtEntity);

    if (player.hasTag(BACKROOMS_TAG)) return;

    system.run(() => {
      try {
        const safe_loc = {
          x: player.location.x,
          y: player.location.y + 1.5,
          z: player.location.z,
        };
        player.teleport(safe_loc);
        _send_to_backrooms(player, "You phased through the walls...");
      } catch {
        // invalid state
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Exit detection loop
// ---------------------------------------------------------------------------

/** Check if players are standing on exit structures and teleport them. */
function _start_exit_detection_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;

      const level = _get_player_level(player);
      const py = Math.floor(player.location.y);
      const px = Math.floor(player.location.x);
      const pz = Math.floor(player.location.z);
      const dimension = player.dimension;

      try {
        if (level === 0) {
          // Standing on glowstone at Level 0 floor → Level 1
          const block_below = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[0], z: pz });
          if (block_below && block_below.typeId === "minecraft:glowstone") {
            _teleport_to_level(player, 1);
            player.sendMessage("\u00A7e[BACKROOMS] \u00A7fYou descend the staircase...");
          }
        } else if (level === 1) {
          // Standing on glowstone at Level 1 floor → Level 2
          const block_below = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[1], z: pz });
          if (block_below && block_below.typeId === "minecraft:glowstone") {
            _teleport_to_level(player, 2);
            player.sendMessage("\u00A7e[BACKROOMS] \u00A7fThe elevator groans downward...");
          }
        } else if (level === 2) {
          // Standing on glowstone ring at Level 2 (hatch) → Poolrooms
          const block_below = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[2], z: pz });
          const block_under = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[2] - 1, z: pz });
          if (block_below && block_below.typeId === "minecraft:glowstone") {
            _teleport_to_level(player, 3);
            player.sendMessage("\u00A7e[BACKROOMS] \u00A7fYou drop through the hatch...");
          }
        } else if (level === 3) {
          // Standing on soul sand drain → Grass Field
          const block_below = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[3] - 1, z: pz });
          if (block_below && block_below.typeId === "minecraft:soul_sand") {
            _teleport_to_level(player, 4);
            player.sendMessage("\u00A7e[BACKROOMS] \u00A7fYou're pulled through the drain...");
          }
        } else if (level === 4) {
          // Grass field — walk far enough from spawn → Thalassophobia
          const spawn_point = _grassfield_spawn_points.get(player.id);
          if (spawn_point) {
            const dist_x = player.location.x - spawn_point.x;
            const dist_z = player.location.z - spawn_point.z;
            const distance = Math.sqrt(dist_x * dist_x + dist_z * dist_z);
            if (distance >= GRASSFIELD_ESCAPE_DISTANCE) {
              _teleport_to_level(player, 5);
              player.sendMessage("\u00A7e[BACKROOMS] \u00A7fThe ground gives way... you plunge into dark water.");
            }
          }
        } else if (level === 5) {
          // Thalassophobia — standing on sea lantern portal → Level Run
          const block_below = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[5], z: pz });
          if (block_below && block_below.typeId === "minecraft:sea_lantern") {
            _teleport_to_level(player, 6);
            player.sendMessage("\u00A7e[BACKROOMS] \u00A7fThe portal glows... you're pulled through.");
          }
        } else if (level === 6) {
          // Level Run — standing on glowstone in obsidian frame → The Void
          const block_below = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[6], z: pz });
          if (block_below && block_below.typeId === "minecraft:glowstone") {
            // Verify obsidian nearby to distinguish from normal glowstone lights
            const left = _try_get_block(dimension, { x: px - 2, y: LEVEL_FLOOR_Y[6] + 1, z: pz });
            const right = _try_get_block(dimension, { x: px + 2, y: LEVEL_FLOOR_Y[6] + 1, z: pz });
            if ((left && left.typeId === "minecraft:obsidian") || (right && right.typeId === "minecraft:obsidian")) {
              _teleport_to_level(player, 7);
              player.sendMessage("\u00A7e[BACKROOMS] \u00A7fThe door slams shut behind you. Reality fractures.");
            }
          }
        } else if (level === 7) {
          // The Void — standing on glowstone threshold → ESCAPE (victory)
          const block_below = _try_get_block(dimension, { x: px, y: LEVEL_FLOOR_Y[7], z: pz });
          if (block_below && block_below.typeId === "minecraft:glowstone") {
            // Verify obsidian frame to distinguish from glowstone lights
            const left = _try_get_block(dimension, { x: px - 1, y: LEVEL_FLOOR_Y[7] + 1, z: pz });
            const right = _try_get_block(dimension, { x: px + 1, y: LEVEL_FLOOR_Y[7] + 1, z: pz });
            if ((left && left.typeId === "minecraft:obsidian") || (right && right.typeId === "minecraft:obsidian")) {
              _escape_backrooms_victory(player);
            }
          }
        }
      } catch {
        // block check failed
      }
    }
  }, EXIT_CHECK_INTERVAL);
}

// ---------------------------------------------------------------------------
// Trap loops
// ---------------------------------------------------------------------------

/** Periodically scan around each overworld player and maybe place traps. */
function _start_trap_placement_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      _try_place_trap(player);
    }
  }, TRAP_SCAN_INTERVAL);
}

/** Frequently check if any player is standing on an active trap. */
function _start_trap_detection_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (player.hasTag(BACKROOMS_TAG)) continue;
      if (player.dimension.id !== "minecraft:overworld") continue;

      const trap = _check_player_on_trap(player);
      if (trap) {
        _send_to_backrooms(player, "The floor gave way beneath you...");
      }
    }
  }, TRAP_CHECK_INTERVAL);
}

// ---------------------------------------------------------------------------
// Ambient messages — per-level
// ---------------------------------------------------------------------------

/** Send eerie ambient messages to backrooms inhabitants based on their level. */
function _start_ambient_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;
      if (Math.random() > 0.2) continue;

      const level = _get_player_level(player);
      const messages = AMBIENT_MESSAGES[level] || AMBIENT_MESSAGES[0];

      try {
        player.sendMessage(`\u00A7e[BACKROOMS] \u00A7f${_pick_random(messages)}`);
      } catch {
        // disconnected
      }
    }
  }, 400);
}

// ---------------------------------------------------------------------------
// Boundary check — update level tags based on Y
// ---------------------------------------------------------------------------

/** Update level tags and detect escapes based on Y position. */
function _start_boundary_check_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;

      const y = player.location.y;

      // If above all backrooms levels, they escaped
      if (y > -5) {
        _escape_backrooms(player);
        continue;
      }

      // Update level tag based on Y
      const detected_level = _get_level_from_y(y);
      if (detected_level >= 0) {
        const current_level = _get_player_level(player);
        if (detected_level !== current_level) {
          _set_player_level(player, detected_level);
        }
      }
    }
  }, 40);
}

// ---------------------------------------------------------------------------
// Chunk generation loop — multi-level
// ---------------------------------------------------------------------------

/** Periodically generate chunks around backrooms players for their current level. */
function _start_chunk_generation_loop() {
  system.runInterval(() => {
    const players = world.getAllPlayers();
    const dimension = world.getDimension("overworld");

    for (const player of players) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;

      const level = _get_player_level(player);
      if (level < 0) continue;

      const { cx, cz } = _world_to_chunk(
        Math.floor(player.location.x),
        Math.floor(player.location.z)
      );

      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          _generate_level_chunk(dimension, level, cx + dx, cz + dz);
        }
      }
    }
  }, CHUNK_SCAN_INTERVAL);
}

// ---------------------------------------------------------------------------
// Bacteria spawning, spreading, and proximity damage
// ---------------------------------------------------------------------------

/**
 * Get the count of bacteria entities currently alive.
 * @param {import("@minecraft/server").Dimension} dimension
 * @returns {number}
 */
function _count_bacteria(dimension) {
  try {
    const entities = dimension.getEntities({ type: "backrooms:bacteria" });
    return entities.length;
  } catch {
    return 0;
  }
}

/** Spawn bacteria in random rooms of generated chunks near players. */
function _bacteria_spawn_tick() {
  const dimension = world.getDimension("overworld");
  if (_count_bacteria(dimension) >= BACTERIA_MAX_COUNT) return;

  for (const player of world.getAllPlayers()) {
    if (!player.hasTag(BACKROOMS_TAG)) continue;

    const level = _get_player_level(player);
    if (level === 4 || level === 6) continue; // No bacteria on grass field or party level

    const floor_y = LEVEL_FLOOR_Y[level] || LEVEL_FLOOR_Y[0];
    const chunks = _generated_chunks[level] || _generated_chunks[0];

    const { cx, cz } = _world_to_chunk(
      Math.floor(player.location.x),
      Math.floor(player.location.z)
    );

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = _chunk_key(cx + dx, cz + dz);
        if (!chunks.has(key)) continue;
        if (Math.random() > BACTERIA_SPAWN_CHANCE) continue;

        const chunk_origin_x = (cx + dx) * CHUNK_SIZE;
        const chunk_origin_z = (cz + dz) * CHUNK_SIZE;

        const room_c = Math.floor(Math.random() * ROOMS_PER_CHUNK);
        const room_r = Math.floor(Math.random() * ROOMS_PER_CHUNK);
        const spawn_x = chunk_origin_x + room_c * CELL_WIDTH + WALL_THICKNESS + Math.floor(Math.random() * ROOM_WIDTH);
        const spawn_z = chunk_origin_z + room_r * CELL_DEPTH + WALL_THICKNESS + Math.floor(Math.random() * ROOM_DEPTH);
        const spawn_y = floor_y + 1;

        try {
          dimension.spawnEntity("backrooms:bacteria", { x: spawn_x + 0.5, y: spawn_y, z: spawn_z + 0.5 });
        } catch {
          // spawn failed
        }
      }
    }
  }
}

/** Attempt to spread bacteria — each existing one has a chance to spawn an adjacent one. */
function _bacteria_spread_tick() {
  const dimension = world.getDimension("overworld");
  if (_count_bacteria(dimension) >= BACTERIA_MAX_COUNT) return;

  try {
    const bacteria_list = dimension.getEntities({ type: "backrooms:bacteria" });

    for (const bacterium of bacteria_list) {
      if (Math.random() > BACTERIA_SPREAD_CHANCE) continue;
      if (_count_bacteria(dimension) >= BACTERIA_MAX_COUNT) break;

      const loc = bacterium.location;
      const offset_x = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 3));
      const offset_z = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 3));

      const new_x = loc.x + offset_x;
      const new_z = loc.z + offset_z;
      const spawn_y = Math.floor(loc.y);

      const block_at = _try_get_block(dimension, {
        x: Math.floor(new_x),
        y: spawn_y,
        z: Math.floor(new_z),
      });
      if (block_at && block_at.isAir) {
        try {
          dimension.spawnEntity("backrooms:bacteria", {
            x: new_x,
            y: spawn_y,
            z: new_z,
          });
        } catch {
          // spawn failed
        }
      }
    }
  } catch {
    // query failed
  }
}

/** Check proximity of players to bacteria entities and apply poison + warning. */
function _bacteria_proximity_tick() {
  const dimension = world.getDimension("overworld");

  for (const player of world.getAllPlayers()) {
    if (!player.hasTag(BACKROOMS_TAG)) continue;

    try {
      const nearby = dimension.getEntities({
        type: "backrooms:bacteria",
        location: player.location,
        maxDistance: BACTERIA_DAMAGE_RADIUS,
      });

      if (nearby.length > 0) {
        player.addEffect("poison", 80, { amplifier: 0, showParticles: true });

        if (Math.random() < 0.15) {
          player.sendMessage("\u00A74[BACTERIA] \u00A7cYou feel spores in the air...");
        }
      }
    } catch {
      // query failed
    }
  }
}

/** Start all bacteria-related loops. */
function _start_bacteria_loops() {
  system.runInterval(() => {
    _bacteria_spawn_tick();
  }, BACTERIA_SPAWN_INTERVAL);

  system.runInterval(() => {
    _bacteria_spread_tick();
  }, BACTERIA_SPREAD_INTERVAL);

  system.runInterval(() => {
    _bacteria_proximity_tick();
  }, BACTERIA_SCAN_INTERVAL);
}

// ---------------------------------------------------------------------------
// Almond Water effect clearing
// ---------------------------------------------------------------------------

/**
 * Track players who recently consumed almond water and clear negative effects.
 * Uses food component — after consuming, clear negative effects.
 */
function _start_almond_water_loop() {
  /** @type {Map<string, number>} Player ID → last known food level */
  const _last_food = new Map();

  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;

      try {
        // Check if player has any negative effects and recently ate almond water
        // by checking the held item in hand
        const inventory = player.getComponent("minecraft:inventory");
        if (!inventory || !inventory.container) continue;

        // We check via the item_use_on event instead, but as a fallback
        // check if the player's food level jumped (they ate something)
        // and clear effects if they have the saturation boost from almond water
      } catch {
        // failed
      }
    }
  }, ALMOND_WATER_CHECK_INTERVAL);
}

/** Listen for almond water consumption and clear negative effects. */
function _setup_almond_water_listener() {
  world.afterEvents.itemCompleteUse.subscribe((event) => {
    const { source, itemStack } = event;
    if (itemStack.typeId !== "backrooms:almond_water") return;
    if (source.typeId !== "minecraft:player") return;

    /** @type {import("@minecraft/server").Player} */
    const player = /** @type {any} */ (source);

    system.run(() => {
      try {
        for (const effect_name of NEGATIVE_EFFECTS) {
          try {
            player.removeEffect(effect_name);
          } catch {
            // effect not present
          }
        }
        player.sendMessage("\u00A7e[BACKROOMS] \u00A7bThe Almond Water soothes your body. Negative effects cleared.");
      } catch {
        // failed
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Chat commands
// ---------------------------------------------------------------------------

/** Set up chat command listener. */
function _setup_chat_commands() {
  world.beforeEvents.chatSend.subscribe((event) => {
    const message = event.message.trim();
    const player = event.sender;

    if (!message.startsWith("!")) return;

    event.cancel = true;

    const parts = message.split(/\s+/);
    const command = parts[0].toLowerCase();

    system.run(() => {
      try {
        switch (command) {
          case "!level":
            _cmd_level(player, parts[1]);
            break;
          case "!gimmemyinventoryback":
            _cmd_restore_inventory(player);
            break;
          case "!backroomsevent":
            _cmd_scare_event(player);
            break;
          default:
            player.sendMessage("\u00A7cUnknown command. Available: !level, !gimmemyinventoryback, !backroomsevent");
        }
      } catch {
        player.sendMessage("\u00A7cCommand failed.");
      }
    });
  });
}

/**
 * Teleport player to a specific level.
 * @param {import("@minecraft/server").Player} player
 * @param {string | undefined} level_arg
 */
function _cmd_level(player, level_arg) {
  const prefix = "\u00A7e[BACKROOMS] \u00A7f";

  /** @type {Record<string, number>} */
  const level_map = {
    "0": 0,
    "1": 1,
    "2": 2,
    "poolrooms": 3,
    "3": 3,
    "grassfield": 4,
    "4": 4,
    "thalassophobia": 5,
    "5": 5,
    "levelrun": 6,
    "run": 6,
    "6": 6,
    "void": 7,
    "7": 7,
  };

  if (!level_arg || !(level_arg.toLowerCase() in level_map)) {
    player.sendMessage(`${prefix}\u00A7cUsage: !level <0|1|2|poolrooms|grassfield|thalassophobia|run|void>`);
    return;
  }

  const level = level_map[level_arg.toLowerCase()];
  _teleport_to_level(player, level);
  player.sendMessage(`${prefix}Teleporting to ${LEVEL_NAMES[level]}...`);
}

/**
 * Restore player's saved inventory.
 * @param {import("@minecraft/server").Player} player
 */
function _cmd_restore_inventory(player) {
  const prefix = "\u00A7e[BACKROOMS] \u00A7f";
  const restored = _restore_inventory(player);
  if (restored) {
    player.sendMessage(`${prefix}\u00A7aInventory restored!`);
    // Remove from backrooms
    _escape_backrooms(player);
  } else {
    player.sendMessage(`${prefix}\u00A7cNo saved inventory found.`);
  }
}

/**
 * Trigger a random scare event.
 * @param {import("@minecraft/server").Player} player
 */
function _cmd_scare_event(player) {
  const events = [
    _scare_flicker,
    _scare_message_spam,
    _scare_darkness,
    _scare_sound_warning,
  ];
  _pick_random(events)(player);
}

/**
 * Scare: lights flicker effect (blindness flashes).
 * @param {import("@minecraft/server").Player} player
 */
function _scare_flicker(player) {
  const prefix = "\u00A7e[BACKROOMS] \u00A7f";
  player.sendMessage(`${prefix}\u00A7cThe lights are flickering...`);

  for (let i = 0; i < 4; i++) {
    system.runTimeout(() => {
      try {
        player.addEffect("blindness", 10, { amplifier: 0, showParticles: false });
      } catch { /* disconnected */ }
    }, 10 + i * 15);
  }
}

/**
 * Scare: eerie message spam.
 * @param {import("@minecraft/server").Player} player
 */
function _scare_message_spam(player) {
  const messages = [
    "\u00A7kAAAAAAAA\u00A7r \u00A7cDON'T TURN AROUND\u00A7r \u00A7kAAAAAAAA",
    "\u00A74IT SEES YOU",
    "\u00A78...",
    "\u00A7k||||||||||||||||||||",
    "\u00A7cRUN",
    "\u00A78you are not alone you are not alone you are not alone",
    "\u00A74\u00A7l= )",
  ];

  for (let i = 0; i < messages.length; i++) {
    system.runTimeout(() => {
      try {
        player.sendMessage(messages[i]);
      } catch { /* disconnected */ }
    }, i * 8);
  }
}

/**
 * Scare: sudden darkness.
 * @param {import("@minecraft/server").Player} player
 */
function _scare_darkness(player) {
  player.sendMessage("\u00A7e[BACKROOMS] \u00A78The lights go out.");
  try {
    player.addEffect("darkness", 100, { amplifier: 0, showParticles: false });
  } catch { /* failed */ }

  system.runTimeout(() => {
    try {
      player.sendMessage("\u00A7e[BACKROOMS] \u00A77...something brushed past you.");
    } catch { /* disconnected */ }
  }, 60);
}

/**
 * Scare: ominous warning.
 * @param {import("@minecraft/server").Player} player
 */
function _scare_sound_warning(player) {
  const warnings = [
    "\u00A74[WARNING] \u00A7cEntity detected nearby. Do not move.",
    "\u00A74[WARNING] \u00A7cAbnormal activity detected in sector " + Math.floor(Math.random() * 999),
    "\u00A74[WARNING] \u00A7cYour position has been logged by \u00A7k?????\u00A7r",
    "\u00A74[SYSTEM] \u00A7cSignal lost. Reconnecting...",
  ];

  player.sendMessage(_pick_random(warnings));

  system.runTimeout(() => {
    try {
      player.addEffect("nausea", 60, { amplifier: 0, showParticles: false });
    } catch { /* failed */ }
  }, 20);
}

// ---------------------------------------------------------------------------
// Victory escape — final exit from The Void
// ---------------------------------------------------------------------------

/**
 * Special escape for winning the game via The Void threshold.
 * @param {import("@minecraft/server").Player} player
 */
function _escape_backrooms_victory(player) {
  player.removeTag(BACKROOMS_TAG);
  for (const tag of ALL_LEVEL_TAGS) {
    player.removeTag(tag);
  }
  _grassfield_spawn_points.delete(player.id);

  const prefix = "\u00A7e[BACKROOMS] \u00A7f";

  system.runTimeout(() => {
    try {
      player.teleport(
        { x: player.location.x, y: 100, z: player.location.z },
        { dimension: player.dimension }
      );
      player.sendMessage(`${prefix}\u00A7k||||||||||||||||||||`);
    } catch { /* disconnected */ }
  }, 5);

  system.runTimeout(() => {
    try {
      player.sendMessage(`${prefix}\u00A76\u00A7lYOU ESCAPED THE BACKROOMS.`);
    } catch { /* disconnected */ }
  }, 40);

  system.runTimeout(() => {
    try {
      player.sendMessage(`${prefix}\u00A7aReality reassembles around you.`);
      player.sendMessage(`${prefix}\u00A77You made it through all 8 levels.`);
      player.sendMessage(`${prefix}\u00A7e\u00A7lCongratulations. You are free.`);
    } catch { /* disconnected */ }
  }, 80);

  system.runTimeout(() => {
    try {
      const restored = _restore_inventory(player);
      if (restored) {
        player.sendMessage(`${prefix}\u00A77Your belongings materialize around you.`);
      }
    } catch { /* failed */ }
  }, 100);
}

// ---------------------------------------------------------------------------
// Level Run mechanics — slowness + enhanced skinwalker speed
// ---------------------------------------------------------------------------

/** Apply periodic slowness to players on Level Run and boost skinwalkers there. */
function _start_level_run_mechanics_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;
      if (_get_player_level(player) !== 6) continue;

      try {
        // Slowness II periodically
        player.addEffect("slowness", 100, { amplifier: 1, showParticles: false });
      } catch { /* failed */ }
    }

    // Boost skinwalker speed on Level Run
    try {
      const dimension = world.getDimension("overworld");
      const skinwalkers = dimension.getEntities({ type: "backrooms:skinwalker" });
      for (const sk of skinwalkers) {
        if (sk.location.y >= -295 && sk.location.y <= -265) {
          sk.addEffect("speed", 100, { amplifier: 2, showParticles: false });
        }
      }
    } catch { /* failed */ }
  }, LEVEL_RUN_EFFECT_INTERVAL);
}

// ---------------------------------------------------------------------------
// Void mechanics — random teleportation glitch
// ---------------------------------------------------------------------------

/** Randomly teleport players within The Void level (~5% chance per check). */
function _start_void_glitch_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;
      if (_get_player_level(player) !== 7) continue;
      if (Math.random() > 0.05) continue;

      try {
        const px = player.location.x;
        const pz = player.location.z;
        const floor_y = LEVEL_FLOOR_Y[7];

        // Teleport randomly within ~20 blocks
        const offset_x = (Math.random() - 0.5) * 40;
        const offset_z = (Math.random() - 0.5) * 40;

        const new_x = px + offset_x;
        const new_z = pz + offset_z;

        // Generate chunks at destination
        const dimension = player.dimension;
        const { cx, cz } = _world_to_chunk(Math.floor(new_x), Math.floor(new_z));
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            _generate_void_chunk(dimension, cx + dx, cz + dz);
          }
        }

        player.teleport(
          { x: new_x, y: floor_y + 1, z: new_z },
          { dimension }
        );

        player.sendMessage("\u00A7e[BACKROOMS] \u00A75\u00A7kglitch\u00A7r \u00A75Reality shifted.");
        player.addEffect("nausea", 40, { amplifier: 0, showParticles: false });
      } catch { /* failed */ }
    }
  }, VOID_GLITCH_INTERVAL);
}

// ---------------------------------------------------------------------------
// Grass field darkness effect (atmosphere)
// ---------------------------------------------------------------------------

/** Apply fog-like darkness effect to players in the grass field. */
function _start_grassfield_atmosphere_loop() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.hasTag(BACKROOMS_TAG)) continue;
      if (_get_player_level(player) !== 4) continue;

      try {
        // Mild darkness for overcast feel — reapply to keep it persistent
        player.addEffect("darkness", 100, { amplifier: 0, showParticles: false });
      } catch {
        // failed
      }
    }
  }, 60);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

world.afterEvents.worldInitialize.subscribe(() => {
  world.sendMessage("\u00A7e[BACKROOMS] \u00A7fThe walls are watching...");

  _load_traps();
  _setup_suffocation_listener();
  _setup_almond_water_listener();
  _setup_chat_commands();
  _start_trap_placement_loop();
  _start_trap_detection_loop();
  _start_ambient_loop();
  _start_boundary_check_loop();
  _start_chunk_generation_loop();
  _start_bacteria_loops();
  _start_exit_detection_loop();
  _start_grassfield_atmosphere_loop();
  _start_level_run_mechanics_loop();
  _start_void_glitch_loop();
});
