import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createDashboardMcp } from '../src/integrations/mcp.ts';

try {
  const options = { url: process.env.DASHBOARD_URL ?? `http://127.0.0.1:${process.env.PORT ?? '4310'}`, token: process.env.DASHBOARD_PRODUCER_TOKEN ?? '' };
  // Validate configuration before accepting protocol messages. Stdout is protocol-only.
  createDashboardMcp(options);
  const handle = serveStdio(() => createDashboardMcp(options), { transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 131072 }) });
  const close = async () => { await handle.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} catch {
  console.error('Cannot start broadcast MCP. Set a reachable DASHBOARD_URL. Omit DASHBOARD_PRODUCER_TOKEN for public proposals, or supply a valid registered producer token.');
  process.exitCode = 1;
}
