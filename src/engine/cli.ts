// CLI entrypoint for the wallpaper engine. It translates terminal commands into
// calls against the shared `engine` API and prints readable results.
import { engine } from "./index";
import { WALLPAPER_CATEGORIES, type Wallpaper } from "../types/wallpaper";

// Keep the file portable for environments where `process` may not be typed.
declare const process:
  | {
      argv?: string[];
      exit: (code?: number) => never;
    }
  | undefined;

// Supported commands for the wallpaper CLI.
type CommandName = "search" | "category" | "featured" | "trending" | "daily" | "categories" | "help";

// Returns only the arguments after the script name, so command parsing stays simple.
function getArgs(): string[] {
  return process?.argv?.slice(2) ?? [];
}

// Normalizes user input and falls back to `help` for unknown commands.
function getCommand(raw: string | undefined): CommandName { 
  const normalized = (raw ?? "help").toLowerCase();

  switch (normalized) {
    case "search":
    case "category":
    case "featured":
    case "trending":
    case "daily":
    case "categories":
      return normalized;
    default:
      return "help";
  }
}

// Prints an error and exits immediately so invalid CLI usage stops the script.
function fail(message: string): never {
  console.error(message);
  if (process) {
    process.exit(1);
  }

  throw new Error(message);
}

// Shows the available commands and a few common examples.
function printUsage(): void {
  console.log(`
Wallpaper Image CLI

Usage:
  npm run images -- categories
  npm run images -- search <query> [category] [page]
  npm run images -- category <category> [page]
  npm run images -- featured
  npm run images -- trending [page]
  npm run images -- daily

Examples:
  npm run images -- categories
  npm run images -- search mountains nature
  npm run images -- search "dark amoled" dark 1
  npm run images -- category abstract
  npm run images -- category space 2
  npm run images -- featured
  npm run images -- trending
  npm run images -- daily
`.trim());
}

// Converts the optional page argument into a safe positive integer.
function parsePage(raw: string | undefined, fallback = 1): number {
  if (!raw?.trim()) {
    return fallback;
  }

  const page = Number(raw);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : fallback;
} 

// Formats one wallpaper into a compact multi-line block for terminal output.
function summarizeWallpaper(item: Wallpaper, index: number): string {
  return [
    `${index + 1}. [${item.source}] ${item.metadata.description}`,
    `   category: ${item.category}`,
    `   photographer: ${item.photographer.name}`,
    `   preview: ${item.urls.preview}`,
    `   full: ${item.urls.full}`
  ].join("\n");
}

// Prints a heading and then renders every wallpaper using the shared formatter.
function printWallpapers(items: Wallpaper[], heading: string): void {
  console.log(`${heading}: ${items.length} result(s)\n`);

  if (items.length === 0) {
    console.log("No wallpapers found.");
    return;
  }

  console.log(items.map(summarizeWallpaper).join("\n\n"));
}
 
// Runs a free-text search, with optional category and page filtering.
async function handleSearch(query: string | undefined, category?: string, pageRaw?: string): Promise<void> {
  if (!query?.trim()) {
    fail('Missing query. Usage: npm run images -- search <query> [category] [page]');
  }

  const page = parsePage(pageRaw);
  const results = await engine.search(query, category, page);
  const label = category?.trim() ? `Search "${query}" in ${category}` : `Search "${query}"`;
  printWallpapers(results, label);
}

// Looks up wallpapers for one category, using a default query behind the scenes.
async function handleCategory(category: string | undefined, pageRaw?: string): Promise<void> {
  if (!category?.trim()) {
    fail('Missing category. Usage: npm run images -- category <category> [page]');
  }

  const page = parsePage(pageRaw);
  const results = await engine.getByCategory(category, page);
  printWallpapers(results, `Category "${category}" page ${page}`);
}

// Fetches the engine's current curated featured collection.
async function handleFeatured(): Promise<void> {
  const results = await engine.getFeatured();
  printWallpapers(results, "Featured");
}

// Fetches the current trending feed, optionally for a specific page.
async function handleTrending(pageRaw?: string): Promise<void> {
  const page = parsePage(pageRaw);
  const results = await engine.getTrending(page);
  printWallpapers(results, `Trending page ${page}`);
}

// Prints the single daily wallpaper with one extra original-size URL line.
async function handleDaily(): Promise<void> {
  const result = await engine.getDaily();
  console.log("Daily wallpaper:\n");
  console.log(summarizeWallpaper(result, 0));
  console.log(`   original: ${result.urls.original}`);
}

// Lists the engine's supported category vocabulary.
function handleCategories(): void {
  console.log("Supported categories:\n");
  console.log(WALLPAPER_CATEGORIES.join("\n"));
}

// Central dispatcher that maps parsed CLI input to the correct handler.
async function main(): Promise<void> {
  const [rawCommand, arg1, arg2, arg3] = getArgs();
  const command = getCommand(rawCommand);

  switch (command) {
    case "search":
      await handleSearch(arg1, arg2, arg3);
      return;
    case "category":
      await handleCategory(arg1, arg2);
      return;
    case "featured":
      await handleFeatured();
      return;
    case "trending":
      await handleTrending(arg1);
      return;
    case "daily":
      await handleDaily();
      return;
    case "categories":
      handleCategories();
      return;
    case "help":
    default:
      printUsage();
  }
}

// Final safety net so unexpected errors still surface as a clean CLI failure.
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Image CLI failed: ${message}`);
  if (process) {
    process.exit(1);
  }
});
