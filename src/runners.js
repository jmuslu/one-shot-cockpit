import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

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

// Build the single instruction prompt handed to the agent. Brief + answers.
function buildAgentPrompt(context) {
  const answered = (context.answers || []).filter((item) => String(item.answer || '').trim());
  const answersBlock = answered.length
    ? `\n\n# Clarifying answers\n${answered.map((item) => `- ${item.question} ${item.answer}`).join('\n')}`
    : '';
  return [
    'You are an autonomous one-shot build agent.',
    'Build the project described below as real, runnable files in the current working directory.',
    'Make reasonable decisions instead of asking questions. Do not wait for input.',
    '',
    '# Brief',
    context.brief || '',
    answersBlock,
    '',
    'Deliver the files now in this directory.'
  ].join('\n');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// Provider-agnostic agent loop: a shell command (ONESHOT_AGENT_CMD) is the
// agent. The built prompt goes to the command — substituted for {prompt} if the
// template contains it, otherwise piped to stdin — and the command runs in the
// shot's workspace so the agent writes real files there. Works with any CLI
// agent (claude, codex, gemini, ...); the cockpit stays agnostic.
function runShellAgent(prompt, context) {
  const cmd = String(process.env.ONESHOT_AGENT_CMD || '').trim();
  if (!cmd) {
    return Promise.resolve({
      summary: `No agent command configured. Brief and answers were written to ${context.workspace}. `
        + 'Set ONESHOT_AGENT_CMD (e.g. "claude -p --permission-mode bypassPermissions" or "codex exec {prompt}") to run a real build.',
      artifact: context.workspace || ''
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const usesPlaceholder = cmd.includes('{prompt}');
    const finalCmd = usesPlaceholder ? cmd.replaceAll('{prompt}', shellQuote(prompt)) : cmd;
    const child = spawn(finalCmd, {
      cwd: context.absWorkspace,
      env: process.env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      finish({
        summary: `Agent timed out after 5 min. Partial output:\n${stdout.trim().slice(0, 400)}`,
        artifact: context.workspace || ''
      });
    }, 300000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      finish({ summary: `Agent command failed to start: ${error.message}`, artifact: context.workspace || '' });
    });
    child.on('close', (code) => {
      const body = stdout.trim() || stderr.trim();
      finish({
        summary: code === 0
          ? (body.slice(0, 800) || `Build completed by ${context.providerName || 'the agent'}.`)
          : `Agent exited with code ${code}. ${stderr.trim().slice(0, 400)}`,
        artifact: context.workspace || ''
      });
    });

    if (!usesPlaceholder) {
      child.stdin.write(prompt);
    }
    child.stdin.end();
  });
}

const shellAdapter = {
  id: 'shell',
  startSession(brief) {
    return {
      sessionId: randomUUID(),
      questions: clarifyingQuestions(brief)
    };
  },
  answer() {
    // No-op. A resumable adapter would replay answers into the session here.
  },
  run(sessionId, context = {}) {
    return runShellAgent(buildAgentPrompt(context), context);
  }
};

// Agnostic to the selected provider: the configured shell command is the agent.
export function getAdapter() {
  return shellAdapter;
}
