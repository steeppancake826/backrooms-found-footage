import { world, system } from "@minecraft/server";

/**
 * BACKROOMS: FOUND FOOTAGE
 * Main entry point for the behavior pack scripting API.
 */

const BACKROOMS_TAG = "in_backrooms";

world.afterEvents.worldInitialize.subscribe(() => {
  world.sendMessage("§e[BACKROOMS] §fThe walls are watching...");
});
