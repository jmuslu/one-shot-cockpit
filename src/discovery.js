import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

function upsertEnv(values) {
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const seen = new Set();
  const lines = existing.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }
    const [key] = trimmed.split('=');
    if (!(key in values)) {
      return line;
    }
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
    process.env[key] = value;
  }

  writeFileSync(envPath, `${lines.join('\n').replace(/\n*$/, '')}\n`);
}

function removeEnv(keysToRemove) {
  const keys = new Set(keysToRemove);
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const lines = existing.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      return true;
    }
    const [key] = trimmed.split('=');
    return !keys.has(key);
  });

  for (const key of keys) {
    delete process.env[key];
  }

  writeFileSync(envPath, `${lines.join('\n').replace(/\n*$/, '')}\n`);
}

const fallbackItems = [
  {
    kind: 'youtube',
    title: 'Web games video fallback',
    source: 'Bright Data MCP not configured',
    url: 'https://www.youtube.com/watch?v=kHGgOVo_C4w',
    reason: 'Embeddable fallback video until BRIGHT_DATA_API_TOKEN is configured.'
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
  const configured = Boolean(process.env.BRIGHT_DATA_API_TOKEN);
  return {
    provider: 'Bright Data MCP',
    configured,
    mode: configured ? 'token saved locally' : 'fallback',
    setupKind: 'bring-your-own-token',
    setup: {
      hostedUrl: 'https://mcp.brightdata.com/mcp?token=YOUR_API_TOKEN',
      localCommand: 'npx @brightdata/mcp',
      env: 'BRIGHT_DATA_API_TOKEN=YOUR_BRIGHT_DATA_API_TOKEN'
    }
  };
}

export function configureBrightData({ token, mcpUrl }) {
  const cleanToken = String(token || '').trim();
  const cleanMcpUrl = String(mcpUrl || 'https://mcp.brightdata.com/mcp').trim();
  if (cleanToken.length < 12) {
    throw new Error('Paste a Bright Data API token before connecting.');
  }
  if (!cleanMcpUrl.startsWith('http://') && !cleanMcpUrl.startsWith('https://')) {
    throw new Error('Bright Data MCP URL must start with http:// or https://.');
  }
  upsertEnv({
    BRIGHT_DATA_API_TOKEN: cleanToken,
    BRIGHT_DATA_MCP_URL: cleanMcpUrl
  });
  return getDiscoveryStatus();
}

export function clearBrightDataConfig() {
  removeEnv(['BRIGHT_DATA_API_TOKEN', 'BRIGHT_DATA_MCP_URL']);
  return getDiscoveryStatus();
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
