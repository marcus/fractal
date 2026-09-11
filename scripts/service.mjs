#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const DEFAULT_LABEL = 'local.fractal.studio';
// The per-user LaunchAgent label. Override it to manage a service installed under another name.
export const LABEL = process.env.FRACTAL_SERVICE_LABEL || DEFAULT_LABEL;
export const DEFAULT_PORT = 5199;
export const DEFAULT_RUNTIME_DIR = join(homedir(), 'Library', 'Application Support', 'Fractal');
export const DEFAULT_CATALOG = resolveCatalogPath();

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const checkoutRoot = resolve(scriptDir, '..');

/**
 * @typedef {{json: boolean, skipBuild: boolean, help?: boolean, port?: number,
 * catalog?: string, runtimeDir?: string, lines?: number, httpsPort?: number}} ServiceOptions
 * @typedef {{httpsPort: number, url: string, proxy: string}} Exposure
 * @typedef {{loaded: boolean, state: string, pid: number | null, program: string | null,
 * entrypoint?: string | null, detail?: string}} LaunchdState
 * @typedef {{pid: number, command: string | null} | null} PortOwner
 * @typedef {{ok: boolean, statusCode?: number | null, url?: string, error?: string}} HttpState
 */

export class ServiceError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** @param {unknown} value */
export function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** @param {string} value @param {string} [home] */
export function expandHome(value, home = homedir()) {
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));
  return resolve(value);
}

/**
 * @param {string | undefined} [explicit] @param {NodeJS.ProcessEnv} [environment]
 * @param {string} [home]
 */
export function resolveCatalogPath(explicit, environment = process.env, home = homedir()) {
  const configured = explicit || environment.FRACTAL_CATALOG;
  if (configured) return expandHome(configured, home);
  const configRoot = expandHome(environment.XDG_CONFIG_HOME || join(home, '.config'), home);
  return join(configRoot, 'fractal', 'catalog.json');
}

/** @param {string[]} argv */
export function parseServiceArgs(argv) {
  let command = 'help';
  /** @type {ServiceOptions} */
  const options = { json: false, skipBuild: false };
  /** @type {Map<string, 'port' | 'catalog' | 'runtimeDir' | 'lines' | 'httpsPort'>} */
  const valueOptions = new Map([
    ['--port', 'port'],
    ['--catalog', 'catalog'],
    ['--runtime-dir', 'runtimeDir'],
    ['--lines', 'lines'],
    ['--https-port', 'httpsPort']
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (valueOptions.has(arg)) {
      const value = argv[++index];
      if (value === undefined)
        throw new ServiceError('invalid_arguments', `${arg} requires a value`);
      const key = valueOptions.get(arg);
      if (key === 'port') options.port = Number(value);
      else if (key === 'httpsPort') options.httpsPort = Number(value);
      else if (key === 'lines') options.lines = Number(value);
      else if (key === 'catalog') options.catalog = value;
      else if (key === 'runtimeDir') options.runtimeDir = value;
    } else if (!arg.startsWith('-') && command === 'help') command = arg;
    else if (!arg.startsWith('-'))
      throw new ServiceError('invalid_arguments', `Unexpected argument: ${arg}`);
    else throw new ServiceError('invalid_arguments', `Unknown option: ${arg}`);
  }
  for (const key of /** @type {const} */ (['port', 'httpsPort'])) {
    const port = options[key];
    if (port === undefined) continue;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new ServiceError('invalid_port', `Port must be an integer from 1 to 65535: ${port}`);
  }
  if (options.lines !== undefined) {
    const lines = options.lines;
    if (!Number.isInteger(lines) || lines < 1 || lines > 10_000)
      throw new ServiceError('invalid_lines', '--lines must be an integer from 1 to 10000');
    options.lines = lines;
  }
  return { command, options };
}

/**
 * @param {{node: string, entrypoint: string, workingDirectory: string, catalog: string,
 * port: number, stdout: string, stderr: string}} values
 */
export function plistDocument({
  node,
  entrypoint,
  workingDirectory,
  catalog,
  port,
  stdout,
  stderr
}) {
  /** @param {string[]} items */
  const strings = (items) =>
    items.map((item) => `      <string>${xmlEscape(item)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings([node, entrypoint])}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key><string>127.0.0.1</string>
    <key>PORT</key><string>${port}</string>
    <key>FRACTAL_CATALOG</key><string>${xmlEscape(catalog)}</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(stderr)}</string>
</dict>
</plist>
`;
}

/** @param {string} text @returns {LaunchdState} */
export function parseLaunchctlPrint(text) {
  const pid = text.match(/^\s*pid\s*=\s*(\d+)/m)?.[1];
  const state = text.match(/^\s*state\s*=\s*([^\n]+)/m)?.[1]?.trim();
  const program = text.match(/^\s*program\s*=\s*([^\n]+)/m)?.[1]?.trim();
  const entrypoint = text
    .match(/^\s*(?:\d+\s*=\s*)?(\/[^\n]*\/current\/build\/index\.js)\s*$/m)?.[1]
    ?.trim();
  return {
    loaded: true,
    state: state ?? 'unknown',
    pid: pid ? Number(pid) : null,
    program: program ?? null,
    entrypoint: entrypoint ?? null
  };
}

/**
 * @param {{launchd: LaunchdState, http: HttpState, portOwner: PortOwner,
 * expectedEntrypoint: string}} values
 */
export function serviceHealth({ launchd, http, portOwner, expectedEntrypoint }) {
  const processMatches = Boolean(
    launchd.loaded &&
    launchd.pid &&
    portOwner?.pid === launchd.pid &&
    portOwner.command?.includes(expectedEntrypoint)
  );
  const healthy = processMatches && http.ok;
  return {
    status: healthy ? 'running' : launchd.loaded ? 'degraded' : 'stopped',
    healthy,
    processMatches
  };
}

/** @param {string} text @param {number} port */
export function parseLsofOwners(text, port) {
  /** @type {{pid: number, command: string | null, address: string | null}[]} */
  const records = [];
  /** @type {{pid: number, command: string | null, address: string | null} | null} */
  let record = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) {
      if (record) records.push(record);
      record = { pid: Number(line.slice(1)), command: null, address: null };
    } else if (record && line.startsWith('c')) record.command = line.slice(1);
    else if (record && line.startsWith('n')) record.address = line.slice(1);
  }
  if (record) records.push(record);
  return records.filter(
    (item) =>
      item.address === `127.0.0.1:${port}` ||
      item.address === `*:${port}` ||
      item.address === `0.0.0.0:${port}`
  );
}

/**
 * Exposures of Fractal's loopback port in `tailscale serve status --json` output. Entries that
 * proxy to other backends belong to other applications and are never reported or touched.
 * @param {string} text @param {number} port @returns {Exposure[]}
 */
export function parseTailscaleServe(text, port) {
  /** @type {Exposure[]} */
  const exposures = [];
  const proxy = `http://127.0.0.1:${port}`;
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return exposures;
  }
  for (const [hostPort, site] of Object.entries(config?.Web ?? {})) {
    const handler = site?.Handlers?.['/'];
    if (handler?.Proxy !== proxy) continue;
    const separator = hostPort.lastIndexOf(':');
    const host = hostPort.slice(0, separator);
    const httpsPort = Number(hostPort.slice(separator + 1));
    if (!Number.isInteger(httpsPort)) continue;
    const url = httpsPort === 443 ? `https://${host}/` : `https://${host}:${httpsPort}/`;
    exposures.push({ httpsPort, url, proxy });
  }
  return exposures.sort((left, right) => left.httpsPort - right.httpsPort);
}

/** @param {string | null | undefined} installedEntrypoint @param {string} runtimeDir */
export function runtimeMatches(installedEntrypoint, runtimeDir) {
  return installedEntrypoint === join(runtimeDir, 'current', 'build', 'index.js');
}

function helpText() {
  return `Fractal local service

Usage: bin/fractal service <command> [options]

Commands:
  install      Build and install a production release, then load it
  status       Verify launchd, process/port identity, and HTTP response
  restart      Restart the installed LaunchAgent
  logs         Show recent service logs (--lines N, default 100)
  expose       Publish the studio to this tailnet over HTTPS via tailscale serve
  unexpose     Remove the tailnet HTTPS listener that points at the studio
  uninstall    Unload the LaunchAgent and remove its installed runtime

Options:
  --json                Emit structured JSON
  --port PORT           Loopback port for install (default 5199)
  --https-port PORT     Tailnet HTTPS port for expose/unexpose (default: the service port)
  --catalog PATH        Catalog path for install (default ~/.config/fractal/catalog.json)
  --runtime-dir PATH    Installed runtime root
  --skip-build          Install the existing build (coordination/testing only)
  --lines N             Lines per log file (default 100)
  -h, --help            Show this help

Environment:
  FRACTAL_SERVICE_LABEL LaunchAgent label (default local.fractal.studio)
  FRACTAL_CATALOG       Default catalog path when --catalog is not given`;
}

/** @param {string} file @param {string[]} args @param {import('node:child_process').ExecFileOptions} [options] */
async function run(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      ...options
    });
  } catch (error) {
    const cause = /** @type {any} */ (error);
    throw new ServiceError('command_failed', `${basename(file)} ${args[0] ?? ''} failed`, {
      command: [file, ...args],
      exitCode: cause.code,
      stdout: cause.stdout?.trim() || undefined,
      stderr: cause.stderr?.trim() || undefined
    });
  }
}

/**
 * Bootstrap a singleton job after bootout has returned while launchd may still be
 * retiring its previous instance. A loaded job is accepted only when it still
 * belongs to the requested runtime.
 * @param {{bootstrap: () => Promise<void>, readState: () => Promise<LaunchdState>,
 * runtimeDir: string, sleep?: (milliseconds: number) => Promise<void>,
 * delays?: number[], acceptOwnedLoaded?: boolean}} operations
 */
export async function bootstrapWithRetry({
  bootstrap,
  readState,
  runtimeDir,
  sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  delays = [100, 250, 500, 1000, 1500],
  acceptOwnedLoaded = true
}) {
  /** @type {{message: string, details?: Record<string, unknown>}[]} */
  const failures = [];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await bootstrap();
      return;
    } catch (error) {
      const cause = /** @type {any} */ (error);
      failures.push({
        message: cause.message,
        ...(cause.details ? { details: cause.details } : {})
      });
      const state = await readState();
      if (state.loaded) {
        if (!runtimeMatches(state.entrypoint, runtimeDir))
          throw new ServiceError(
            'runtime_mismatch',
            'The loaded Fractal service belongs to another runtime directory',
            { requestedRuntimeDir: runtimeDir, runningEntrypoint: state.entrypoint, failures }
          );
        if (acceptOwnedLoaded) return;
      }
      if (attempt === delays.length)
        throw new ServiceError('launchd_bootstrap_failed', 'Could not load the Fractal service', {
          attempts: failures.length,
          failures
        });
      await sleep(delays[attempt]);
    }
  }
}

/** @param {string} path */
async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} runtimeDir */
async function currentRelease(runtimeDir) {
  const current = join(runtimeDir, 'current');
  try {
    return resolve(runtimeDir, await readlink(current));
  } catch {
    return null;
  }
}

/** @param {string} runtimeDir */
async function readSettings(runtimeDir) {
  try {
    return JSON.parse(await readFile(join(runtimeDir, 'service.json'), 'utf8'));
  } catch {
    return { port: DEFAULT_PORT, catalog: DEFAULT_CATALOG, node: process.execPath };
  }
}

/** @param {string} runtimeDir */
async function assertRuntimeOwnership(runtimeDir) {
  if (!(await exists(runtimeDir))) return;
  const entries = await readdir(runtimeDir);
  if (entries.length === 0) return;
  try {
    const settings = JSON.parse(await readFile(join(runtimeDir, 'service.json'), 'utf8'));
    if (settings.label === LABEL && settings.version === 1) return;
  } catch {}
  throw new ServiceError(
    'runtime_not_owned',
    `Refusing to use a non-empty directory that is not owned by Fractal: ${runtimeDir}`,
    { runtimeDir }
  );
}

/** @param {string} plistPath @param {string} runtimeDir */
async function assertPlistOwnership(plistPath, runtimeDir) {
  if (!(await exists(plistPath))) return;
  const contents = await readFile(plistPath, 'utf8');
  const expected = xmlEscape(join(runtimeDir, 'current', 'build', 'index.js'));
  if (!contents.includes(`<string>${expected}</string>`))
    throw new ServiceError(
      'runtime_mismatch',
      `The singleton Fractal LaunchAgent belongs to another runtime directory`,
      { requestedRuntimeDir: runtimeDir, plistPath }
    );
}

async function verifyCheckoutDependencies() {
  const lock = JSON.parse(await readFile(join(checkoutRoot, 'package-lock.json'), 'utf8'));
  /** @type {string[]} */
  const problems = [];
  for (const [relative, metadata] of Object.entries(lock.packages ?? {})) {
    if (!relative || metadata.link) continue;
    const packageFile = join(checkoutRoot, relative, 'package.json');
    try {
      const installed = JSON.parse(await readFile(packageFile, 'utf8'));
      if (metadata.version && installed.version !== metadata.version)
        problems.push(`${relative}: installed ${installed.version}, locked ${metadata.version}`);
    } catch (error) {
      if (!metadata.optional) problems.push(`${relative}: missing`);
    }
  }
  if (problems.length)
    throw new ServiceError(
      'dependency_tree_mismatch',
      'Checkout dependencies do not match package-lock.json; run npm ci before install',
      { problems: problems.slice(0, 20), total: problems.length }
    );
}

function launchDomain() {
  if (!process.getuid)
    throw new ServiceError('unsupported_platform', 'Per-user service management requires macOS');
  return `gui/${process.getuid()}`;
}

/** @returns {Promise<LaunchdState>} */
async function launchdState() {
  try {
    const { stdout } = await execFileAsync(
      '/bin/launchctl',
      ['print', `${launchDomain()}/${LABEL}`],
      {
        encoding: 'utf8'
      }
    );
    return parseLaunchctlPrint(stdout);
  } catch (error) {
    const cause = /** @type {any} */ (error);
    return {
      loaded: false,
      state: 'unloaded',
      pid: null,
      program: null,
      detail: cause.stderr?.trim()
    };
  }
}

/** @param {number} port @returns {Promise<PortOwner>} */
async function portOwner(port) {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-Fpcn'
    ]);
    const [owner] = parseLsofOwners(stdout, port);
    if (!owner) return null;
    try {
      const result = await execFileAsync('/bin/ps', ['-p', String(owner.pid), '-o', 'command='], {
        encoding: 'utf8'
      });
      owner.command = result.stdout.trim() || owner.command;
    } catch {}
    return owner;
  } catch {
    return null;
  }
}

/** @param {number} port @returns {Promise<HttpState>} */
async function httpState(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/models`, {
      signal: controller.signal
    });
    return { ok: response.ok, statusCode: response.status, url: `http://127.0.0.1:${port}` };
  } catch (error) {
    const cause = /** @type {Error} */ (error);
    return { ok: false, statusCode: null, url: `http://127.0.0.1:${port}`, error: cause.message };
  } finally {
    clearTimeout(timer);
  }
}

const TAILSCALE_CANDIDATES = [
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale'
];

/** @returns {Promise<string | null>} the first tailscale CLI that answers */
async function tailscaleBinary() {
  for (const candidate of TAILSCALE_CANDIDATES) {
    try {
      await execFileAsync(candidate, ['version'], { encoding: 'utf8' });
      return candidate;
    } catch {}
  }
  return null;
}

/**
 * Tailnet exposures of the service port, or `available: false` when tailscale is missing or
 * not running. Status never fails because of tailscale.
 * @param {number} port
 */
async function tailscaleState(port) {
  const binary = await tailscaleBinary();
  if (!binary) return { available: false, exposures: [] };
  try {
    const { stdout } = await execFileAsync(binary, ['serve', 'status', '--json'], {
      encoding: 'utf8'
    });
    return { available: true, exposures: parseTailscaleServe(stdout, port) };
  } catch (error) {
    const cause = /** @type {any} */ (error);
    return { available: false, exposures: [], error: cause.stderr?.trim() || cause.message };
  }
}

async function requireTailscale() {
  const binary = await tailscaleBinary();
  if (!binary)
    throw new ServiceError('tailscale_unavailable', 'The tailscale CLI is not installed');
  return binary;
}

/**
 * Processes whose executable is tailscale running `serve` without --bg. Such a listener holds
 * its port only while the process lives and blocks background configuration of the same port.
 * Report them; never kill them.
 * @param {string} psOutput @param {number} httpsPort
 * @returns {{pid: number, command: string}[]}
 */
export function foregroundServeOwners(psOutput, httpsPort) {
  /** @type {{pid: number, command: string}[]} */
  const owners = [];
  for (const line of psOutput.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+((?:\S*\/)?tailscale\s+serve\b.*)$/);
    if (!match) continue;
    const command = match[2].trim();
    if (/(?:^|\s)--bg(?:=true)?(?:\s|$)/.test(command)) continue;
    const explicit = command.match(/--https[= ](\d+)/)?.[1];
    if ((explicit ? Number(explicit) : 443) === httpsPort)
      owners.push({ pid: Number(match[1]), command });
  }
  return owners;
}

/** @param {number} httpsPort */
async function findForegroundServeOwners(httpsPort) {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8'
    });
    return foregroundServeOwners(stdout, httpsPort);
  } catch {
    return [];
  }
}

/** @param {string} url */
async function httpsState(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(new URL('/api/models', url), { signal: controller.signal });
    return { ok: response.ok, statusCode: response.status, url };
  } catch (error) {
    const cause = /** @type {Error} */ (error);
    return { ok: false, statusCode: null, url, error: cause.message };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} runtimeDir @param {number | undefined} requestedHttpsPort */
async function expose(runtimeDir, requestedHttpsPort) {
  const settings = await readSettings(runtimeDir);
  if (!(await currentRelease(runtimeDir)))
    throw new ServiceError('not_installed', 'Fractal service is not installed');
  const httpsPort = requestedHttpsPort ?? settings.port;
  const binary = await requireTailscale();
  const proxy = `http://127.0.0.1:${settings.port}`;
  const before = await tailscaleState(settings.port);
  try {
    await run(binary, ['serve', '--bg', `--https=${httpsPort}`, proxy]);
  } catch (error) {
    const cause = /** @type {ServiceError} */ (error);
    const stderr = String(cause.details?.stderr ?? '');
    if (/foreground listener already exists/i.test(stderr)) {
      const owners = await findForegroundServeOwners(httpsPort);
      throw new ServiceError(
        'serve_port_occupied',
        `Tailnet port ${httpsPort} is held by a foreground tailscale serve process; stop it and retry`,
        { httpsPort, owners }
      );
    }
    throw error;
  }
  const after = await tailscaleState(settings.port);
  const exposure = after.exposures.find((item) => item.httpsPort === httpsPort);
  if (!exposure)
    throw new ServiceError('expose_failed', 'tailscale accepted the config but did not report it', {
      httpsPort,
      exposures: after.exposures
    });
  const https = await httpsState(exposure.url);
  return {
    command: 'expose',
    label: LABEL,
    port: settings.port,
    httpsPort,
    url: exposure.url,
    changed: !before.exposures.some((item) => item.httpsPort === httpsPort),
    https,
    exposures: after.exposures
  };
}

/** @param {string} runtimeDir @param {number | undefined} requestedHttpsPort */
async function unexpose(runtimeDir, requestedHttpsPort) {
  const settings = await readSettings(runtimeDir);
  const httpsPort = requestedHttpsPort ?? settings.port;
  const binary = await requireTailscale();
  const before = await tailscaleState(settings.port);
  const exposure = before.exposures.find((item) => item.httpsPort === httpsPort);
  if (!exposure) {
    const { stdout } = await execFileAsync(binary, ['serve', 'status', '--json'], {
      encoding: 'utf8'
    });
    const other = Object.keys(JSON.parse(stdout)?.Web ?? {}).find((hostPort) =>
      hostPort.endsWith(`:${httpsPort}`)
    );
    if (other)
      throw new ServiceError(
        'serve_port_not_owned',
        `Tailnet port ${httpsPort} proxies to another application; leaving it alone`,
        { httpsPort, site: other }
      );
    return { command: 'unexpose', label: LABEL, port: settings.port, httpsPort, changed: false };
  }
  await run(binary, ['serve', `--https=${httpsPort}`, 'off']);
  const after = await tailscaleState(settings.port);
  return {
    command: 'unexpose',
    label: LABEL,
    port: settings.port,
    httpsPort,
    url: exposure.url,
    changed: true,
    exposures: after.exposures
  };
}

/** @param {string} runtimeDir @param {number} [attempts] */
async function waitForHealthy(runtimeDir, attempts = 75) {
  let result = await status(runtimeDir);
  for (let attempt = 1; !result.healthy && attempt < attempts; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    result = await status(runtimeDir);
  }
  return result;
}

/** @param {string} runtimeDir */
async function status(runtimeDir) {
  const settings = await readSettings(runtimeDir);
  const release = await currentRelease(runtimeDir);
  const [launchd, owner, http, tailscale] = await Promise.all([
    launchdState(),
    portOwner(settings.port),
    httpState(settings.port),
    tailscaleState(settings.port)
  ]);
  const expectedEntrypoint = join(runtimeDir, 'current', 'build', 'index.js');
  return {
    command: 'status',
    label: LABEL,
    ...serviceHealth({ launchd, http, portOwner: owner, expectedEntrypoint }),
    url: http.url,
    port: settings.port,
    catalog: settings.catalog,
    runtimeDir,
    release,
    launchd,
    http,
    portOwner: owner,
    expectedEntrypoint,
    tailscale
  };
}

/**
 * @param {string} file @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options] @param {boolean} [quiet]
 */
async function spawnChecked(file, args, options = {}, quiet = false) {
  /** @type {Promise<void>} */
  const completion = new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      stdio: quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit',
      shell: false,
      ...options
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new ServiceError('command_failed', `${basename(file)} failed`, {
            exitCode: code,
            signal,
            ...(stderr.trim() ? { stderr: stderr.trim() } : {})
          })
        );
    });
  });
  await completion;
}

/** @param {string} stage */
async function validateRelease(stage) {
  const entrypoint = join(stage, 'build', 'index.js');
  await access(entrypoint, constants.R_OK);
  await access(join(stage, 'examples'), constants.R_OK);
  await access(join(stage, 'node_modules', '@playwright', 'test'), constants.R_OK);
  await run(process.execPath, ['--check', entrypoint]);
}

async function availableLoopbackPort() {
  /** @type {Promise<number>} */
  const result = new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePromise(port)));
    });
  });
  return await result;
}

/** @param {string} stage @param {string} catalog */
async function smokeRelease(stage, catalog) {
  const port = await availableLoopbackPort();
  const child = spawn(process.execPath, [join(stage, 'build', 'index.js')], {
    cwd: stage,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), FRACTAL_CATALOG: catalog },
    stdio: ['ignore', 'ignore', 'pipe'],
    shell: false
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  try {
    let response = await httpState(port);
    for (let attempt = 1; !response.ok && attempt < 25; attempt += 1) {
      if (child.exitCode !== null)
        throw new ServiceError('release_smoke_failed', 'Candidate exited during smoke test', {
          exitCode: child.exitCode,
          stderr: stderr.trim() || undefined
        });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      response = await httpState(port);
    }
    if (!response.ok)
      throw new ServiceError('release_smoke_failed', 'Candidate failed its HTTP smoke test', {
        response,
        stderr: stderr.trim() || undefined
      });
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolvePromise) => child.once('exit', resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2000))
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

/** @param {string} runtimeDir @param {boolean} skipBuild @param {boolean} quiet @param {string} catalog */
async function createRelease(runtimeDir, skipBuild, quiet, catalog) {
  if (!skipBuild) {
    await verifyCheckoutDependencies();
    await spawnChecked('npm', ['run', 'build'], { cwd: checkoutRoot }, quiet);
  }
  if (!(await exists(join(checkoutRoot, 'build', 'index.js'))))
    throw new ServiceError(
      'missing_build',
      'Production build is missing; run install without --skip-build'
    );

  const stagingRoot = await mkdtemp(join(tmpdir(), 'fractal-release-'));
  const stage = join(stagingRoot, 'release');
  await mkdir(stage);
  try {
    await Promise.all([
      cp(join(checkoutRoot, 'build'), join(stage, 'build'), { recursive: true }),
      cp(join(checkoutRoot, 'examples'), join(stage, 'examples'), { recursive: true }),
      cp(join(checkoutRoot, 'package-lock.json'), join(stage, 'package-lock.json')),
      ...['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'].map((name) =>
        cp(join(checkoutRoot, name), join(stage, name))
      )
    ]);
    const sourcePackage = JSON.parse(await readFile(join(checkoutRoot, 'package.json'), 'utf8'));
    const runtimePackage = {
      ...sourcePackage,
      name: 'fractal-installed-runtime',
      private: true,
      type: 'module',
      dependencies: {
        ...sourcePackage.dependencies,
        '@playwright/test': sourcePackage.devDependencies?.['@playwright/test']
      },
      devDependencies: {}
    };
    await writeFile(join(stage, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');
    await spawnChecked(
      'npm',
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--offline',
        '--no-audit',
        '--no-fund'
      ],
      { cwd: stage },
      quiet
    );
    await spawnChecked(
      'npm',
      ['ci', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'],
      { cwd: stage },
      quiet
    );
    await validateRelease(stage);
    await smokeRelease(stage, catalog);
    await mkdir(join(runtimeDir, 'releases'), { recursive: true });
    const releaseName = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`;
    const release = join(runtimeDir, 'releases', releaseName);
    await rename(stage, release);
    return release;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

/** @param {string} runtimeDir @param {any} settings */
async function writePlist(runtimeDir, settings) {
  const logs = join(runtimeDir, 'logs');
  await mkdir(logs, { recursive: true });
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  await mkdir(dirname(plistPath), { recursive: true });
  const entrypoint = join(runtimeDir, 'current', 'build', 'index.js');
  const contents = plistDocument({
    node: settings.node,
    entrypoint,
    workingDirectory: join(runtimeDir, 'current'),
    catalog: settings.catalog,
    port: settings.port,
    stdout: join(logs, 'stdout.log'),
    stderr: join(logs, 'stderr.log')
  });
  const temporary = `${plistPath}.tmp-${process.pid}`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, plistPath);
  return plistPath;
}

/** @param {string} runtimeDir @param {string} release */
async function switchCurrent(runtimeDir, release) {
  const next = join(runtimeDir, `.current-${process.pid}`);
  await symlink(join('releases', basename(release)), next);
  await rename(next, join(runtimeDir, 'current'));
}

/** @param {string} plistPath @param {string} runtimeDir */
async function reload(plistPath, runtimeDir) {
  const domain = launchDomain();
  const prior = await launchdState();
  if (prior.loaded) {
    try {
      await execFileAsync('/bin/launchctl', ['bootout', `${domain}/${LABEL}`], {
        encoding: 'utf8'
      });
    } catch (error) {
      const cause = /** @type {any} */ (error);
      throw new ServiceError(
        'launchd_unload_failed',
        'Could not unload the existing Fractal service',
        {
          stderr: cause.stderr?.trim()
        }
      );
    }
  }
  await bootstrapWithRetry({
    bootstrap: async () => {
      await run('/bin/launchctl', ['bootstrap', domain, plistPath]);
    },
    readState: launchdState,
    runtimeDir,
    acceptOwnedLoaded: false
  });
}

/** @param {ServiceOptions} options */
async function install(options) {
  if (process.platform !== 'darwin')
    throw new ServiceError('unsupported_platform', 'Fractal service management requires macOS');
  const runtimeDir = expandHome(options.runtimeDir ?? DEFAULT_RUNTIME_DIR);
  const catalog = resolveCatalogPath(options.catalog);
  const port = options.port ?? DEFAULT_PORT;
  const runtimeWasPresent = await exists(runtimeDir);
  const existing = await status(runtimeDir);
  const owner = await portOwner(port);
  if (owner && owner.pid !== existing.launchd.pid)
    throw new ServiceError('port_occupied', `Port ${port} is already owned by another process`, {
      port,
      owner
    });

  await assertRuntimeOwnership(runtimeDir);

  const previousRelease = await currentRelease(runtimeDir);
  const previousSettings = await readSettings(runtimeDir);
  const settings = { version: 1, label: LABEL, port, catalog, node: process.execPath };
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (existing.launchd.loaded) {
    const expected = join(runtimeDir, 'current', 'build', 'index.js');
    if (!runtimeMatches(existing.launchd.entrypoint, runtimeDir))
      throw new ServiceError(
        'runtime_mismatch',
        'The running Fractal service belongs to another runtime directory',
        {
          requestedRuntimeDir: runtimeDir,
          runningEntrypoint: existing.launchd.entrypoint
        }
      );
  }
  await assertPlistOwnership(plistPath, runtimeDir);
  /** @type {string | null} */
  let release = null;
  let activationStarted = false;
  let result;
  try {
    release = await createRelease(runtimeDir, options.skipBuild, options.json, catalog);
    const ownerAfterBuild = await portOwner(port);
    if (ownerAfterBuild && ownerAfterBuild.pid !== existing.launchd.pid)
      throw new ServiceError('port_occupied', `Port ${port} became occupied during install`, {
        port,
        owner: ownerAfterBuild
      });
    activationStarted = true;
    await writePlist(runtimeDir, settings);
    await switchCurrent(runtimeDir, release);
    await writeFile(join(runtimeDir, 'service.json'), JSON.stringify(settings, null, 2) + '\n');
    await reload(plistPath, runtimeDir);
    result = await waitForHealthy(runtimeDir);
    if (!result.healthy)
      throw new ServiceError('service_unhealthy', 'Installed service did not become healthy', {
        status: result
      });
  } catch (error) {
    if (!activationStarted) {
      if (release) await rm(release, { recursive: true, force: true });
      if (!runtimeWasPresent) await rm(runtimeDir, { recursive: true, force: true });
      else if (!previousRelease)
        await rm(join(runtimeDir, 'releases'), { recursive: true, force: true });
      throw error;
    }
    /** @type {unknown} */
    let rollbackError;
    if (previousRelease) {
      try {
        await switchCurrent(runtimeDir, previousRelease);
        await writeFile(
          join(runtimeDir, 'service.json'),
          JSON.stringify(previousSettings, null, 2) + '\n'
        );
        await writePlist(runtimeDir, previousSettings);
        await reload(plistPath, runtimeDir);
        const restored = await waitForHealthy(runtimeDir);
        if (!restored.healthy)
          throw new ServiceError('rollback_unhealthy', 'Previous service did not recover', {
            status: restored
          });
      } catch (cause) {
        rollbackError = cause;
      }
    } else {
      try {
        const state = await launchdState();
        if (state.loaded)
          await execFileAsync('/bin/launchctl', ['bootout', `${launchDomain()}/${LABEL}`]);
      } catch (cause) {
        rollbackError = cause;
      }
      await Promise.all([
        rm(join(runtimeDir, 'current'), { force: true }),
        rm(join(runtimeDir, 'service.json'), { force: true }),
        rm(plistPath, { force: true })
      ]);
      if (runtimeWasPresent) {
        await Promise.all([
          rm(join(runtimeDir, 'releases'), { recursive: true, force: true }),
          rm(join(runtimeDir, 'logs'), { recursive: true, force: true })
        ]);
      } else await rm(runtimeDir, { recursive: true, force: true });
    }
    if (release && release !== previousRelease)
      await rm(release, { recursive: true, force: true }).catch(() => {});
    if (rollbackError) {
      const original = /** @type {any} */ (error);
      const rollback = /** @type {Error} */ (rollbackError);
      throw new ServiceError('install_rollback_failed', original.message, {
        originalCode: original.code,
        rollbackError: rollback.message,
        postStatus: await status(runtimeDir)
      });
    }
    throw error;
  }
  return { ...result, command: 'install', installed: true };
}

/** @param {string} runtimeDir */
async function restart(runtimeDir) {
  const release = await currentRelease(runtimeDir);
  if (!release) throw new ServiceError('not_installed', 'Fractal service is not installed');
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  await assertPlistOwnership(plistPath, runtimeDir);
  if (!(await exists(plistPath)))
    throw new ServiceError('missing_plist', `LaunchAgent is missing: ${plistPath}`);
  const state = await launchdState();
  if (state.loaded && !runtimeMatches(state.entrypoint, runtimeDir))
    throw new ServiceError(
      'runtime_mismatch',
      'The running Fractal service belongs to another runtime directory',
      { requestedRuntimeDir: runtimeDir, runningEntrypoint: state.entrypoint }
    );
  if (state.loaded) await run('/bin/launchctl', ['kickstart', '-k', `${launchDomain()}/${LABEL}`]);
  else
    await bootstrapWithRetry({
      bootstrap: async () => {
        await run('/bin/launchctl', ['bootstrap', launchDomain(), plistPath]);
      },
      readState: launchdState,
      runtimeDir
    });
  const result = await waitForHealthy(runtimeDir);
  if (!result.healthy)
    throw new ServiceError('service_unhealthy', 'Restarted service did not become healthy', {
      status: result
    });
  return { ...result, command: 'restart', restarted: true };
}

/** @param {string} runtimeDir @param {number} [lines] */
async function logs(runtimeDir, lines = 100) {
  const logDir = join(runtimeDir, 'logs');
  /** @param {string} name */
  const readTail = async (name) => {
    const path = join(logDir, name);
    try {
      const content = await readFile(path, 'utf8');
      return { path, lines: content.split('\n').slice(-lines).filter(Boolean) };
    } catch (error) {
      const cause = /** @type {NodeJS.ErrnoException} */ (error);
      if (cause.code === 'ENOENT') return { path, lines: [] };
      throw error;
    }
  };
  const [stdout, stderr] = await Promise.all([readTail('stdout.log'), readTail('stderr.log')]);
  return { command: 'logs', runtimeDir, stdout, stderr };
}

/** @param {string} runtimeDir */
async function uninstall(runtimeDir) {
  const runtimeExists = await exists(runtimeDir);
  if (runtimeExists) await assertRuntimeOwnership(runtimeDir);
  const domain = launchDomain();
  const state = await launchdState();
  const expectedEntrypoint = join(runtimeDir, 'current', 'build', 'index.js');
  if (state.loaded && !runtimeMatches(state.entrypoint, runtimeDir))
    throw new ServiceError(
      'runtime_mismatch',
      'The running Fractal service belongs to another runtime directory',
      {
        requestedRuntimeDir: runtimeDir,
        runningEntrypoint: state.entrypoint
      }
    );
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  await assertPlistOwnership(plistPath, runtimeDir);
  if (state.loaded) await run('/bin/launchctl', ['bootout', `${domain}/${LABEL}`]);
  const plistExisted = await exists(plistPath);
  await rm(plistPath, { force: true });
  if (runtimeExists) {
    await rm(runtimeDir, { recursive: true, force: true });
  }
  return {
    command: 'uninstall',
    label: LABEL,
    uninstalled: state.loaded || plistExisted || runtimeExists,
    runtimeDir,
    plistPath
  };
}

/** @param {any} result @param {boolean} json */
function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  if (result.command === 'logs') {
    for (const stream of ['stdout', 'stderr']) {
      console.log(`${stream} (${result[stream].path})`);
      console.log(result[stream].lines.join('\n') || '(empty)');
    }
    return;
  }
  if (result.command === 'uninstall')
    console.log(`Fractal service uninstalled from ${result.runtimeDir}`);
  else if (result.command === 'expose')
    console.log(
      `Fractal exposed to the tailnet at ${result.url} (${result.https.ok ? 'responding' : `not responding: ${result.https.error ?? result.https.statusCode}`})`
    );
  else if (result.command === 'unexpose')
    console.log(
      result.changed
        ? `Removed tailnet listener ${result.url}`
        : `No tailnet listener on port ${result.httpsPort} points at Fractal`
    );
  else {
    const tailnet = result.tailscale?.exposures?.length
      ? result.tailscale.exposures.map((/** @type {Exposure} */ item) => item.url).join(', ')
      : result.tailscale?.available
        ? 'not exposed'
        : 'tailscale unavailable';
    console.log(
      `Fractal service: ${result.status} (${result.url})\nLaunchAgent: ${result.launchd.state}\nRuntime: ${result.release ?? 'not installed'}\nTailnet: ${tailnet}`
    );
  }
}

async function main() {
  const { command, options } = parseServiceArgs(process.argv.slice(2));
  if (options.help || command === 'help') {
    console.log(helpText());
    return;
  }
  if (
    !['install', 'status', 'restart', 'logs', 'expose', 'unexpose', 'uninstall'].includes(command)
  )
    throw new ServiceError('unknown_command', `Unknown service command: ${command}`);
  if (
    command !== 'install' &&
    (options.port !== undefined || options.catalog !== undefined || options.skipBuild)
  )
    throw new ServiceError(
      'invalid_arguments',
      '--port, --catalog, and --skip-build apply only to install'
    );
  if (command !== 'logs' && options.lines !== undefined)
    throw new ServiceError('invalid_arguments', '--lines applies only to logs');
  if (!['expose', 'unexpose'].includes(command) && options.httpsPort !== undefined)
    throw new ServiceError('invalid_arguments', '--https-port applies only to expose and unexpose');
  const runtimeDir = expandHome(options.runtimeDir ?? DEFAULT_RUNTIME_DIR);
  let result;
  if (command === 'install') result = await install(options);
  else if (command === 'status') result = await status(runtimeDir);
  else if (command === 'restart') result = await restart(runtimeDir);
  else if (command === 'logs') result = await logs(runtimeDir, options.lines ?? 100);
  else if (command === 'expose') result = await expose(runtimeDir, options.httpsPort);
  else if (command === 'unexpose') result = await unexpose(runtimeDir, options.httpsPort);
  else result = await uninstall(runtimeDir);
  printResult(result, options.json);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const result = {
      ok: false,
      error: {
        code: error.code ?? 'service_error',
        message: error.message,
        ...(error.details && Object.keys(error.details).length ? { details: error.details } : {})
      }
    };
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  });
}
