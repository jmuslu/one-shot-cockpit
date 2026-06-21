import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { specPrompt } from './prepGraph.js';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

export const RUNNER_PROVIDERS = [
  {
    id: 'codex',
    name: 'OpenAI Codex',
    authMode: 'local-browser-auth',
    command: 'codex',
    tagline: 'Uses local Codex auth. Connect with codex login, then dispatch with codex exec.'
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    authMode: 'local-browser-auth',
    command: 'claude',
    tagline: 'Uses local Claude Code auth when the claude CLI is installed.'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    authMode: 'planned-oauth',
    command: '',
    tagline: 'Planned provider adapter. Kept visible as a future runner option.'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    authMode: 'planned-oauth',
    command: 'gemini',
    tagline: 'Planned provider adapter. Can use local Gemini CLI auth once wired.'
  }
];

export function findProvider(id) {
  return RUNNER_PROVIDERS.find((provider) => provider.id === id) || null;
}

function commandAvailable(command) {
  if (!command) {
    return false;
  }
  const check = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    encoding: 'utf8',
    shell: false
  });
  return check.status === 0;
}

export function providerRuntimeStatus(provider) {
  const available = commandAvailable(provider.command);
  return {
    commandAvailable: available,
    canExecute: available && process.env.ONESHOT_RUNNER_EXECUTE === 'true'
  };
}

function ensureWorkspace(workspace) {
  const absolute = join(rootDir, workspace || 'outputs/shot-unknown');
  mkdirSync(absolute, { recursive: true });
  return absolute;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// Async spawn helper. Resolves with { code, stdout, stderr, timedOut } and never
// rejects, so the run lifecycle can always finalize. Default 5-minute timeout.
function spawnAgent({ command, args, shell, cwd, input, timeoutMs = 1000 * 60 * 5 }) {
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

    let child;
    try {
      child = spawn(command, args || [], {
        cwd,
        env: process.env,
        shell: Boolean(shell),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({ code: null, stdout: '', stderr: `failed to start: ${error.message}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      finish({ code: null, stdout, stderr: `${stderr}\n[timed out after ${Math.round(timeoutMs / 1000)}s]`, timedOut: true });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => finish({ code: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));

    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function writeRunnerResult(resultPath, provider, sessionId, commandLabel, out) {
  writeFileSync(resultPath, [
    `# ${provider.name} dispatch`,
    '',
    `Session: ${sessionId}`,
    `Command: ${commandLabel}`,
    `Command exit: ${out.code ?? 'unknown'}${out.timedOut ? ' (timed out)' : ''}`,
    '',
    '## stdout',
    out.stdout || '',
    '## stderr',
    out.stderr || ''
  ].join('\n'));
}

// Dispatch the validated one-shot spec to the agent. Always writes the spec +
// prompt package into the workspace, then chooses how to run:
//   1) ONESHOT_AGENT_CMD set        -> provider-agnostic shell agent (async)
//   2) provider canExecute (codex)  -> codex exec (async)
//   3) otherwise                    -> export-only dispatch package
async function dispatchAndRun(provider, sessionId, context = {}) {
  const workspace = ensureWorkspace(context.workspace);
  const spec = context.spec || {};
  const prompt = specPrompt(spec);
  const specPath = join(workspace, 'one-shot-spec.json');
  const promptPath = join(workspace, 'runner-prompt.md');
  const resultPath = join(workspace, 'runner-result.md');
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(promptPath, prompt);

  const runtime = providerRuntimeStatus(provider);
  const agentCmd = String(process.env.ONESHOT_AGENT_CMD || '').trim();

  // 1) Provider-agnostic shell agent: the configured command is the agent. The
  // spec prompt is substituted for {prompt}, or piped to stdin otherwise.
  if (agentCmd) {
    const usesPlaceholder = agentCmd.includes('{prompt}');
    const finalCmd = usesPlaceholder ? agentCmd.replaceAll('{prompt}', shellQuote(prompt)) : agentCmd;
    const out = await spawnAgent({
      command: finalCmd,
      shell: true,
      cwd: workspace,
      input: usesPlaceholder ? undefined : prompt
    });
    writeRunnerResult(resultPath, provider, sessionId, `ONESHOT_AGENT_CMD: ${agentCmd}`, out);
    return {
      summary: out.code === 0
        ? `${provider.name} ran via ONESHOT_AGENT_CMD. See runner-result.md.`
        : `${provider.name} agent command exited ${out.code ?? 'with no code'}${out.timedOut ? ' (timed out)' : ''}. See runner-result.md.`,
      artifact: workspace
    };
  }

  // 2) Provider's own executor (codex exec, sandboxed to the workspace).
  if (runtime.canExecute && provider.id === 'codex') {
    const outputPath = join(workspace, 'codex-last-message.md');
    const out = await spawnAgent({
      command: 'codex',
      args: ['exec', '--cd', workspace, '--sandbox', 'workspace-write', '--ask-for-approval', 'never', '--output-last-message', outputPath, '-'],
      cwd: workspace,
      input: prompt,
      timeoutMs: 1000 * 60 * 20
    });
    writeRunnerResult(resultPath, provider, sessionId, 'codex exec', out);
    return {
      summary: out.code === 0
        ? `${provider.name} ran through local codex exec. See runner-result.md and codex-last-message.md.`
        : `${provider.name} command exited ${out.code ?? 'with no code'}${out.timedOut ? ' (timed out)' : ''}. See runner-result.md.`,
      artifact: workspace
    };
  }

  // 3) Export-only: write a dispatch package the user can run by hand.
  const mode = runtime.commandAvailable
    ? 'Command is installed, but neither ONESHOT_AGENT_CMD nor ONESHOT_RUNNER_EXECUTE=true is set, so this run exported a dispatch package.'
    : 'No runnable command configured here, so this run exported a dispatch package.';
  writeFileSync(resultPath, [
    `# ${provider.name} dispatch package`,
    '',
    mode,
    '',
    `Session: ${sessionId}`,
    `Spec: ${specPath}`,
    `Prompt: ${promptPath}`,
    '',
    'To run manually, feed runner-prompt.md to any agent, e.g.:',
    `  ${provider.command || '<your-agent-cli>'} < runner-prompt.md`,
    'or set ONESHOT_AGENT_CMD and re-run the shot.'
  ].join('\n'));

  return {
    summary: `${provider.name} prepared a validated one-shot dispatch package. ${mode}`,
    artifact: workspace
  };
}

const packageAdapter = {
  startSession() {
    return {
      sessionId: randomUUID(),
      questions: []
    };
  },
  answer() {
    // No-op. A resumable adapter would replay answers into the session here.
  },
  run(sessionId, context = {}) {
    const provider = findProvider(context.spec?.runnerProvider) || findProvider(context.providerId) || {
      id: 'simulated',
      name: context.providerName || 'Runner',
      command: ''
    };
    return dispatchAndRun(provider, sessionId, context);
  }
};

// The cockpit stays agnostic to the selected provider: a single adapter writes a
// validated spec and runs whatever command is configured (ONESHOT_AGENT_CMD, or a
// provider's own exec when enabled).
export function getAdapter() {
  return packageAdapter;
}
