import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('startup defaults to all IPv4 interfaces and supports an explicit loopback override', async () => {
  for (const bindAddress of [undefined, '127.0.0.1']) {
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as {port:number}).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const dataDir = mkdtempSync(join(tmpdir(), 'dashboard-startup-'));
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_TOKEN: 'startup-test-operator-token-long-enough', ALLOWED_HOSTS: '' };
    delete env.BIND_ADDRESS;
    if (bindAddress) env.BIND_ADDRESS = bindAddress;
    const child = spawn(process.execPath, [resolve('src/server/main.ts')], { env, stdio: ['ignore','pipe','pipe'] });
    const exited = once(child, 'exit');
    try {
      const log = await new Promise<string>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Server did not become ready.')), 15000);
        child.stdout.on('data', chunk => { output += chunk; if (output.includes('Dashboard listening on ')) { clearTimeout(timer); resolve(output); } });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited before readiness: ${code}`)); });
      });
      assert.ok(log.includes(`Dashboard listening on ${bindAddress ?? '0.0.0.0'}:${port}`));
      const response = await fetch(`http://${bindAddress ?? '127.0.0.2'}:${port}/health/ready`, {signal:AbortSignal.timeout(5000)});
      assert.equal(response.status, 200);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});
