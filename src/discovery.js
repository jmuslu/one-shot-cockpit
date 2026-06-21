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
    kind: 'music',
    title: 'Alan Walker - Faded',
    source: 'YouTube reference only',
    url: 'https://www.youtube.com/watch?v=60ItHLz5WEA',
    reason: 'Iconic vibe reference. Do not bundle or redistribute this audio; stream/embed only if YouTube allows it.'
  },
  {
    kind: 'music',
    title: 'Alan Walker - Fade / NCS-era reference',
    source: 'License needs verification',
    url: 'https://www.youtube.com/results?search_query=Alan+Walker+Fade+official',
    reason: 'Useful inspiration, but the old NCS availability changed, so treat as reference until licensing is confirmed.'
  },
  {
    kind: 'music',
    title: 'Provided meme-song reference video',
    source: 'User reference',
    url: 'https://www.youtube.com/watch?v=Ha3PktcY5yA&t=136s',
    reason: 'Use this as taste direction for the waiting-room music pack, not as a bundled audio source.'
  },
  {
    kind: 'music',
    title: 'Pixabay meme music search',
    source: 'Royalty-free discovery',
    url: 'https://pixabay.com/music/search/meme/',
    reason: 'Good place to source clean meme-ish tracks; check each asset license before committing files.'
  },
  {
    kind: 'music',
    title: 'Pixabay success and ding sounds',
    source: 'Royalty-free discovery',
    url: 'https://pixabay.com/sound-effects/search/success/',
    reason: 'Candidate source for addictive completion, unlock, and reward sounds.'
  },
  {
    kind: 'music',
    title: 'NoCopyrightSounds discovery',
    source: 'Creator-music discovery',
    url: 'https://www.youtube.com/@NoCopyrightSounds',
    reason: 'Useful music direction, but each track still needs current terms and attribution checked.'
  },
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
