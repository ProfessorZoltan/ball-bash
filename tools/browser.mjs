// What the browser tools share: Playwright, and the game served locally.
//
// Playwright is not a dependency of the game. It is found in the repo's
// node_modules (npm install --no-save playwright) or, failing that, in the
// global install (Claude Code on the web ships one, with Chromium).
//
// serve() uses the game at DEFLECTOR_URL if that is set, or one already
// running on the port, and otherwise starts server.js for as long as the tool
// runs. The same server is the LAN relay, so ?relay=local multiplayer works.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const global = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const at = createRequire(path.join(global, 'noop.js')).resolve('playwright');
    return import(pathToFileURL(at).href);
  }
}

// Playwright is CommonJS: its exports arrive as the module's default.
const pw = await loadPlaywright();
export const chromium = pw.chromium || pw.default.chromium;

const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

/** The game's address, and a stop() for the server if this call started one. */
export async function serve(port = 8099) {
  if (process.env.DEFLECTOR_URL) return { url: process.env.DEFLECTOR_URL.replace(/\/?$/, '/'), stop() {} };
  const url = `http://localhost:${port}/`;
  if (await up(url)) return { url, stop() {} };
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(port)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up(url)); i++) await new Promise((ok) => setTimeout(ok, 100));
  if (!(await up(url))) {
    child.kill();
    throw new Error(`server.js did not come up on ${port}`);
  }
  return { url, stop: () => child.kill() };
}

/**
 * A page's errors, collected: call it on each page, print errs at the end.
 * A request the network refused (net::ERR_…, the online relay from a sandbox)
 * is left out; a file the server lacks (a 404) is not.
 */
export function watchErrors(page, errs, who = '') {
  page.on('pageerror', (e) => errs.push(`${who}PAGEERROR ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errs.push(`${who}CONSOLE ${m.text()}`);
  });
}
