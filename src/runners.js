import { randomUUID } from 'node:crypto';

// Runner-provider catalog (specs §2.1). Inclusion rule: a provider is listed
// ONLY if it supports OAuth sign-in. session-only / apiKey-only providers are
// intentionally excluded from the selectable options.
export const RUNNER_PROVIDERS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    authMode: 'oauth',
    tagline: 'Anthropic agent. Sign in with your Claude account.'
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    authMode: 'oauth',
    tagline: 'OpenAI agent. Sign in with ChatGPT.'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    authMode: 'oauth',
    tagline: 'GitHub agent. Authorize with your GitHub account.'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    authMode: 'oauth',
    tagline: 'Google agent. Sign in with Google.'
  }
];

export function findProvider(id) {
  return RUNNER_PROVIDERS.find((provider) => provider.id === id) || null;
}

// --- Adapter interface (specs §2.3) --------------------------------------
//   startSession(brief, workspace) -> { sessionId, questions[] }
//   answer(sessionId, answers)     -> void           // resumes the session
//   run(sessionId, context)        -> { summary, artifact }
//
// The simulated adapter lets the full one-shot lifecycle run end-to-end
// without a live OAuth agent. Real provider adapters (claude-code, codex, ...)
// slot in behind this same interface later.

function clarifyingQuestions(brief) {
  const text = String(brief || '');
  const questions = [];
  // Ask only high-leverage questions, and only when the brief omits them.
  if (!/\b(who|audience|users?|for\s+\w)/i.test(text)) {
    questions.push('Who is the primary audience or user?');
  }
  if (!/\b(done|success|must[- ]?have|criteria|acceptance)\b/i.test(text)) {
    questions.push('What does "done" look like — the one must-have outcome?');
  }
  return questions;
}

const simulatedAdapter = {
  id: 'simulated',
  startSession(brief) {
    return {
      sessionId: randomUUID(),
      questions: clarifyingQuestions(brief)
    };
  },
  answer() {
    // No-op. A real adapter resumes the provider session with the answers.
  },
  run(sessionId, context = {}) {
    const provider = context.providerName || 'the agent runner';
    const answered = (context.answers || []).filter((item) => String(item.answer || '').trim()).length;
    return {
      summary: `One-shot delivered by ${provider} (simulated runner). Session ${String(sessionId).slice(0, 8)} folded in ${answered} clarifying answer(s). A real adapter writes the artifact path, summary, tests, and handoff notes here.`,
      artifact: context.workspace || ''
    };
  }
};

// Every listed provider currently dispatches to the simulated adapter.
// Swap in provider-specific adapters keyed by id when they land.
export function getAdapter() {
  return simulatedAdapter;
}
