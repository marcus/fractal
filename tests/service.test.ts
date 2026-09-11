import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LABEL,
  bootstrapWithRetry,
  foregroundServeOwners,
  parseLsofOwners,
  parseTailscaleServe,
  parseLaunchctlPrint,
  parseServiceArgs,
  plistDocument,
  runtimeMatches,
  resolveCatalogPath,
  serviceHealth,
  xmlEscape
} from '../scripts/service.mjs';

test('bootstrap retries an unloaded launchd race and retains command diagnostics', async () => {
  let attempts = 0;
  const delays: number[] = [];
  await bootstrapWithRetry({
    runtimeDir: '/runtime',
    bootstrap: async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = Object.assign(new Error('bootstrap failed'), {
          details: { stderr: `failure ${attempts}`, stdout: 'launchctl output' }
        });
        throw error;
      }
    },
    readState: async () => ({ loaded: false, state: 'unloaded', pid: null, program: null }),
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    delays: [10, 20]
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test('bootstrap retry refuses a loaded singleton from another runtime', async () => {
  await assert.rejects(
    bootstrapWithRetry({
      runtimeDir: '/requested',
      bootstrap: async () => {
        throw Object.assign(new Error('bootstrap failed'), {
          details: { stderr: 'already loaded' }
        });
      },
      readState: async () => ({
        loaded: true,
        state: 'running',
        pid: 42,
        program: '/node',
        entrypoint: '/other/current/build/index.js'
      }),
      sleep: async () => {},
      delays: []
    }),
    (error: any) =>
      error.code === 'runtime_mismatch' &&
      error.details.failures[0].details.stderr === 'already loaded'
  );
});

test('bootstrap retry accepts an already loaded job owned by the requested runtime', async () => {
  await bootstrapWithRetry({
    runtimeDir: '/requested',
    bootstrap: async () => {
      throw new Error('bootstrap raced with launchd');
    },
    readState: async () => ({
      loaded: true,
      state: 'running',
      pid: 42,
      program: '/node',
      entrypoint: '/requested/current/build/index.js'
    }),
    sleep: async () => {},
    delays: []
  });
});

test('reload mode waits past a retiring owned job before bootstrap succeeds', async () => {
  let attempts = 0;
  await bootstrapWithRetry({
    runtimeDir: '/requested',
    acceptOwnedLoaded: false,
    bootstrap: async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('still retiring');
    },
    readState: async () => ({
      loaded: true,
      state: 'running',
      pid: 42,
      program: '/node',
      entrypoint: '/requested/current/build/index.js'
    }),
    sleep: async () => {},
    delays: [1]
  });
  assert.equal(attempts, 2);
});

test('bootstrap retry exhausts its bound with all diagnostics intact', async () => {
  let attempts = 0;
  await assert.rejects(
    bootstrapWithRetry({
      runtimeDir: '/requested',
      bootstrap: async () => {
        attempts += 1;
        throw Object.assign(new Error(`failure ${attempts}`), {
          details: { stdout: `out ${attempts}`, stderr: `err ${attempts}` }
        });
      },
      readState: async () => ({ loaded: false, state: 'unloaded', pid: null, program: null }),
      sleep: async () => {},
      delays: [1, 2]
    }),
    (error: any) =>
      error.code === 'launchd_bootstrap_failed' &&
      error.details.attempts === 3 &&
      error.details.failures[2].details.stderr === 'err 3'
  );
  assert.equal(attempts, 3);
});

test('service arguments parse install options and reject unsafe ports', () => {
  assert.deepEqual(
    parseServiceArgs([
      'install',
      '--port',
      '5201',
      '--catalog',
      '~/catalog.json',
      '--runtime-dir',
      '/tmp/fractal runtime',
      '--json'
    ]),
    {
      command: 'install',
      options: {
        json: true,
        skipBuild: false,
        port: 5201,
        catalog: '~/catalog.json',
        runtimeDir: '/tmp/fractal runtime'
      }
    }
  );
  assert.throws(() => parseServiceArgs(['install', '--port', '0']), /Port must be an integer/);
  assert.throws(() => parseServiceArgs(['status', '--wat']), /Unknown option/);
  assert.equal(parseServiceArgs(['--json', 'status']).command, 'status');
  assert.deepEqual(parseServiceArgs(['expose', '--https-port', '443']), {
    command: 'expose',
    options: { json: false, skipBuild: false, httpsPort: 443 }
  });
  assert.throws(() => parseServiceArgs(['expose', '--https-port', '70000']), /Port must be/);
});

test('tailnet exposures report only listeners that proxy to the service port', () => {
  const serveStatus = JSON.stringify({
    TCP: { '443': { HTTPS: true }, '5199': { HTTPS: true }, '7447': { HTTPS: true } },
    Web: {
      'studio.example.ts.net:5199': { Handlers: { '/': { Proxy: 'http://127.0.0.1:5199' } } },
      'studio.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:5199' } } },
      'studio.example.ts.net:7447': { Handlers: { '/': { Proxy: 'http://127.0.0.1:7447' } } },
      'studio.example.ts.net:8080': { Handlers: { '/': { Path: '/srv' } } }
    }
  });
  assert.deepEqual(parseTailscaleServe(serveStatus, 5199), [
    { httpsPort: 443, url: 'https://studio.example.ts.net/', proxy: 'http://127.0.0.1:5199' },
    {
      httpsPort: 5199,
      url: 'https://studio.example.ts.net:5199/',
      proxy: 'http://127.0.0.1:5199'
    }
  ]);
  assert.deepEqual(parseTailscaleServe(serveStatus, 5200), []);
  assert.deepEqual(parseTailscaleServe('{}', 5199), []);
  assert.deepEqual(parseTailscaleServe('not json', 5199), []);
});

test('foreground serve detection names the tailscale process, not shells or --bg runs', () => {
  const ps = [
    '  100 /bin/sh /usr/local/bin/tailscale serve --yes --bg=false 51500',
    '  101 /Applications/Tailscale.app/Contents/MacOS/tailscale serve --yes --bg=false 51500',
    '  102 tailscale serve --https=8443 http://127.0.0.1:5199',
    '  103 tailscale serve --bg --https=8443 http://127.0.0.1:5199',
    "  104 /bin/zsh -c 'tailscale serve --https=8443 3000'",
    '  105 node scripts/service.mjs expose'
  ].join('\n');
  assert.deepEqual(foregroundServeOwners(ps, 443), [
    {
      pid: 101,
      command: '/Applications/Tailscale.app/Contents/MacOS/tailscale serve --yes --bg=false 51500'
    }
  ]);
  assert.deepEqual(foregroundServeOwners(ps, 8443), [
    { pid: 102, command: 'tailscale serve --https=8443 http://127.0.0.1:5199' }
  ]);
  assert.deepEqual(foregroundServeOwners(ps, 9999), []);
});

test('catalog resolution follows explicit, environment, XDG, and empty-value precedence', () => {
  const home = '/Users/tester';
  assert.equal(
    resolveCatalogPath('~/chosen.json', { FRACTAL_CATALOG: '/ignored.json' }, home),
    '/Users/tester/chosen.json'
  );
  assert.equal(
    resolveCatalogPath(undefined, { FRACTAL_CATALOG: '', XDG_CONFIG_HOME: '~/xdg' }, home),
    '/Users/tester/xdg/fractal/catalog.json'
  );
  assert.equal(
    resolveCatalogPath(undefined, { FRACTAL_CATALOG: '', XDG_CONFIG_HOME: '' }, home),
    '/Users/tester/.config/fractal/catalog.json'
  );
});

test('launchd entrypoint pins the singleton label to one runtime root', () => {
  const launchd = parseLaunchctlPrint(`${LABEL} = {
  state = running
  arguments = {
    /opt/node/bin/node
    /Users/me/Library/Application Support/Fractal/current/build/index.js
  }
  pid = 44
}`);
  assert.equal(
    runtimeMatches(launchd.entrypoint, '/Users/me/Library/Application Support/Fractal'),
    true
  );
  assert.equal(runtimeMatches(launchd.entrypoint, '/tmp/another-fractal'), false);
});

test('port ownership ignores IPv6-only listeners but includes loopback and wildcard IPv4', () => {
  const owners = parseLsofOwners(
    `p10\ncnode\nn[::1]:5199\np20\ncstudio\nn127.0.0.1:5199\np30\ncwild\nn*:5199\n`,
    5199
  );
  assert.deepEqual(
    owners.map(({ pid, address }) => ({ pid, address })),
    [
      { pid: 20, address: '127.0.0.1:5199' },
      { pid: 30, address: '*:5199' }
    ]
  );
});

test('plist uses explicit stable launch settings and XML escaping', () => {
  const plist = plistDocument({
    node: '/node & stable/bin/node',
    entrypoint: '/runtime/current/build/index.js',
    workingDirectory: '/runtime/current',
    catalog: `/Users/me/catalog's <models>.json`,
    port: 5199,
    stdout: '/runtime/logs/stdout.log',
    stderr: '/runtime/logs/stderr.log'
  });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /\/node &amp; stable\/bin\/node/);
  assert.match(plist, /catalog&apos;s &lt;models&gt;\.json/);
  assert.equal(xmlEscape('"<&'), '&quot;&lt;&amp;');
});

test('launchctl parsing and health require one matching process', () => {
  const launchd = parseLaunchctlPrint(
    `${LABEL} = {\n  state = running\n  program = /node\n  pid = 481\n}`
  );
  assert.deepEqual(launchd, {
    loaded: true,
    state: 'running',
    pid: 481,
    program: '/node',
    entrypoint: null
  });
  assert.deepEqual(
    serviceHealth({
      launchd,
      http: { ok: true },
      portOwner: { pid: 481, command: '/node /runtime/current/build/index.js' },
      expectedEntrypoint: '/runtime/current/build/index.js'
    }),
    { status: 'running', healthy: true, processMatches: true }
  );
  assert.equal(
    serviceHealth({
      launchd,
      http: { ok: true },
      portOwner: { pid: 999, command: '/other' },
      expectedEntrypoint: '/runtime/current/build/index.js'
    }).status,
    'degraded'
  );
});
