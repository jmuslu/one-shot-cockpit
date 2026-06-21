import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(rootDir, '.env');

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    process.env[key] ||= rest.join('=').trim();
  }
}

const fallbackItems = [
  {
    kind: 'youtube',
    title: 'YouTube discovery queue',
    source: 'Bright Data MCP not configured',
    url: 'https://www.youtube.com/results?search_query=weird+web+games',
    reason: 'Fallback search until BRIGHT_DATA_API_TOKEN is configured.'
  },
  {
    kind: 'reddit',
    title: 'Reddit waiting-room search',
    source: 'Bright Data MCP not configured',
    url: 'https://www.reddit.com/search/?q=weird%20web%20games',
    reason: 'Fallback public search until Bright Data MCP can pull live results.'
  },
  {
    kind: 'game',
    title: 'Itch.io browser game discovery',
    source: 'Bright Data MCP not configured',
    url: 'https://itch.io/games/html5/tag-short',
    reason: 'A safer roulette source than random arbitrary embeds.'
  }
];

export function getDiscoveryStatus() {
  return {
    provider: 'Bright Data MCP',
    configured: Boolean(process.env.BRIGHT_DATA_API_TOKEN),
    mode: process.env.BRIGHT_DATA_API_TOKEN ? 'ready-to-wire' : 'fallback',
    setup: {
      hostedUrl: 'https://mcp.brightdata.com/mcp?token=YOUR_API_TOKEN',
      localCommand: 'npx @brightdata/mcp',
      env: 'API_TOKEN=YOUR_BRIGHT_DATA_API_TOKEN'
    }
  };
}

export async function discoverEntertainment() {
  if (!process.env.BRIGHT_DATA_API_TOKEN) {
    return {
      status: getDiscoveryStatus(),
      items: fallbackItems
    };
  }

  return {
    status: getDiscoveryStatus(),
    items: fallbackItems.map((item) => ({
      ...item,
      source: 'Bright Data MCP configured',
      reason: 'MCP adapter config is present; next step is binding search_engine/scrape_as_markdown into this route.'
    }))
  };
}
