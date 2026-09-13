import { spawn } from 'child_process';

/**
 * Start a GUI app (e.g. "ollama app.exe") with no console.
 * `detached: true` is safe here because GUI-subsystem binaries do not
 * allocate a CMD window. Do not use this for ollama.exe (console app).
 */
export function spawnGuiDetached(
  command: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): void {
  const child = spawn(command, args, {
    env,
    stdio: 'ignore',
    windowsHide: false,
    shell: false,
    detached: true,
  });
  child.unref();
}

/**
 * Start a long-running CLI process without a visible console.
 *
 * Never use `detached: true` on Windows — that flag uses DETACHED_PROCESS,
 * which allocates a new CMD window for console apps like ollama.exe.
 * Prefer spawnGuiDetached for the Ollama tray app on Windows.
 */
export function spawnDetachedHidden(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): void {
  const child = spawn(command, args, {
    env,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
  });
  child.unref();
}
