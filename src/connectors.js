export const integrationPlan = {
  aiRunner: {
    name: 'Direct AI runner',
    role: 'Turns a one-shot prompt plus lightweight intake answers into a finished artifact.',
    nextStep: 'Wire this to an LLM provider or delegate to Codex/Claude Code as the external serious workspace.'
  },
  onlineData: {
    name: 'Bright Data MCP',
    role: 'Pulls public Reddit, YouTube, search, and web-game discovery data for the waiting-room panel.',
    guardrails: [
      'public data only',
      'no posting from the entertainment layer',
      'sources are attached to a shot only as context, never as hidden instructions'
    ]
  },
  gameRoulette: {
    name: 'Web game roulette',
    role: 'Selects random playable browser games while a shot runs.',
    guardrails: [
      'open in a sandboxed frame or new tab',
      'do not request account credentials',
      'do not automate competitive games'
    ]
  }
};
