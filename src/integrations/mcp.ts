import { readFileSync } from 'node:fs';
import { McpServer, fromJsonSchema, type CallToolResult } from '@modelcontextprotocol/server';
import { DomainError, ensure } from '../contracts/errors.ts';
import type { ChangeSet } from '../contracts/types.ts';
import { LIMITS } from '../contracts/validation.ts';
import { layoutChangeSchema, type LayoutChange } from '../contracts/layout-proposals.ts';
import { widgetInstanceSchema, type WidgetInstance } from '../contracts/overlay.ts';

const changeSchema = JSON.parse(readFileSync(new URL('../../contracts/change-set.schema.json', import.meta.url), 'utf8'));
type JsonObject = Record<string, any>;
export type McpOptions = { url: string; token: string; timeoutMs?: number };
class DashboardFailure extends Error {
  body: JsonObject;
  constructor(body: JsonObject) { super(body.error?.message ?? 'Dashboard request failed.'); this.body = body; }
  toJSON(): JsonObject { return this.body; }
}
function transportFailure(submission: boolean): DomainError {
  return new DomainError(submission ? 'REQUEST_OUTCOME_UNKNOWN' : 'DASHBOARD_UNAVAILABLE', submission ? 'No valid response was received. A submission may have been saved; resend the exact command and requestId to recover its receipt.' : 'Dashboard is unavailable or returned an invalid response. Check the server, network connection and DASHBOARD_URL.', 503);
}

export function dashboardUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new DomainError('INVALID_CONFIGURATION', 'DASHBOARD_URL must be an HTTP or HTTPS origin.'); }
  ensure(['http:', 'https:'].includes(url.protocol) && !['0.0.0.0', '[::]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'INVALID_CONFIGURATION', 'DASHBOARD_URL must be a reachable HTTP or HTTPS origin without credentials, query or path.');
  return url.origin;
}

class DashboardClient {
  base: string; token: string; timeoutMs: number; verifiedProducer = false;
  constructor(options: McpOptions) {
    this.base = dashboardUrl(options.url); this.token = options.token; this.timeoutMs = options.timeoutMs ?? 30000;
    ensure(typeof this.token === 'string' && this.token.length >= 24 && !/\s/.test(this.token), 'INVALID_CONFIGURATION', 'Set DASHBOARD_PRODUCER_TOKEN to a registered producer token.');
  }
  async request(path: string, command?: JsonObject): Promise<JsonObject> {
    const body = command === undefined ? undefined : JSON.stringify(command);
    const submission = path.endsWith('/changes')||path==='/layout-proposals';
    ensure(body === undefined || Buffer.byteLength(body) <= LIMITS.maxBytes, 'BODY_TOO_LARGE', 'Request exceeds 64 KiB.');
    let response: Response;
    try {
      response = await fetch(`${this.base}/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body
      });
    } catch { throw transportFailure(submission); }
    let data: JsonObject;
    try { data = await response.json(); } catch { throw transportFailure(submission); }
    ensure(data && typeof data === 'object' && !Array.isArray(data), 'DASHBOARD_UNAVAILABLE', 'Dashboard returned an invalid response.', 503);
    if (!response.ok) {
      if (data.ok === false && typeof data.error?.code === 'string') throw new DashboardFailure(data);
      throw new DomainError('DASHBOARD_UNAVAILABLE', 'Dashboard request failed.', response.status);
    }
    return data;
  }
  async capabilities(): Promise<JsonObject> {
    const result = await this.request('/capabilities');
    ensure(result.role === 'producer', 'PRODUCER_TOKEN_REQUIRED', 'The MCP adapter requires a producer token, never an operator credential.', 403);
    this.verifiedProducer = true; return result;
  }
  async authorized(): Promise<void> { if (!this.verifiedProducer) await this.capabilities(); }
}

function result(data: JsonObject, isError = false): CallToolResult {
  const {image,...structured}=data,content:CallToolResult['content']=[{type:'text',text:JSON.stringify(structured)}];
  if(image?.mimeType==='image/png'&&typeof image.base64==='string')content.push({type:'image',mimeType:image.mimeType,data:image.base64});
  return { content, structuredContent: structured, ...(isError ? { isError: true } : {}) };
}
const contextSchema = { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', maxLength: 80, description: 'Omit to read the active session.' } } };
const emptySchema = { type: 'object', additionalProperties: false, properties: {} };

export function createDashboardMcp(options: McpOptions): McpServer {
  const client = new DashboardClient(options);
  const server = new McpServer({ name: 'broadcast-content', version: '1.2.0' }, {
    maxToolInputElements: 1024,
    instructions: 'Propose actual viewer-facing content: current activity, session title/goal/recap, timeline events, pinned notices and reported work. Read capabilities and context, use the shared ChangeSet contract, and preserve request IDs when recovering lost receipts. Content and layout proposals remain private until operator approval. Layout proposals require canProposeLayouts and the complete replacement widget array at the observed layout revision; use render_preview with widgets to inspect candidate geometry. Publishing requires apply_allowed policies for all affected sources, explicit producer grants and public provenance. All built-in sources default to proposal_only; read get_sources. Separate scene/widget control credentials use the HTTP Direct control API. Do not change baseRevision and blindly retry conflicts; do not claim work completion without evidence.'
  });
  const invoke = (fn: () => Promise<JsonObject>, verify = true) => async () => {
    try { if (verify) await client.authorized(); return result(await fn()); }
    catch (error) { return result(error instanceof DomainError || error instanceof DashboardFailure ? error.toJSON() : new DomainError('ADAPTER_ERROR', 'The adapter could not complete the request.', 503).toJSON(), true); }
  };
  server.registerTool('get_capabilities', { description: 'Read this producer’s allowed display-content fields, operations, publication grant and Unicode length limits.', inputSchema: fromJsonSchema(emptySchema), annotations: { readOnlyHint: true, openWorldHint: false } }, invoke(() => client.capabilities(), false));
  server.registerTool('get_layouts',{description:'Read fixed overlay resolutions, scenes, complete layouts and installed widget settings. These contain operator-authored layout settings, no session text.',inputSchema:fromJsonSchema(emptySchema),annotations:{readOnlyHint:true,openWorldHint:false}},invoke(()=>client.request('/overlays')));
  server.registerTool('get_sources',{description:'Discover installed content sources and effective publication policies. proposal_only sources reject producer apply even with automatic publication permission. Read before selecting an intent.',inputSchema:fromJsonSchema(emptySchema),annotations:{readOnlyHint:true,openWorldHint:false}},invoke(()=>client.request('/sources')));
  server.registerTool('render_preview',{description:'Inspect current or candidate content and optional candidate widgets in an exact-size overlay without saving. Candidate widgets require canProposeLayouts. Returns browser-measured visible text/code-point ranges, pixel rectangles, overlaps and truncation. Optional PNG. Scroll is measured at its first frame. Missing fields are not rendered in this layout or not granted to this producer. Read capabilities/context/layouts first.',inputSchema:fromJsonSchema<{sessionId?:string;overlayId:string;sceneId?:string;change?:ChangeSet;widgets?:WidgetInstance[];includeImage?:boolean}>({type:'object',additionalProperties:false,required:['overlayId'],$defs:changeSchema.$defs,properties:{sessionId:{type:'string',pattern:'^[A-Za-z0-9_-]+$'},overlayId:{type:'string',maxLength:80},sceneId:{type:'string',maxLength:80},change:changeSchema,widgets:{type:'array',maxItems:32,items:widgetInstanceSchema},includeImage:{type:'boolean'}}}),annotations:{readOnlyHint:true,openWorldHint:false}},async ({sessionId,...input})=>invoke(async()=>{
    const id=sessionId??(await client.request('/sessions/current')).session?.id;ensure(id,'NO_ACTIVE_SESSION','Choose a session ID or start a session.',404);return client.request(`/sessions/${encodeURIComponent(id)}/render-preview`,input);
  })());
  for(const name of ['validate_layout','propose_layout'] as const)server.registerTool(name,{description:name==='validate_layout'?'Validate a complete LayoutChange without saving. Requires canProposeLayouts. Read get_layouts and preserve the observed per-layout baseRevision.':'Propose a complete widget layout for one resolution/scene, including geometry, settings, visibility, order and addition/removal. Requires canProposeLayouts. Always intent:propose; never directly publishes. Include unchanged widgets to retain them and preserve requestId for exact retries.',inputSchema:fromJsonSchema<LayoutChange>(layoutChangeSchema),annotations:{readOnlyHint:name==='validate_layout',destructiveHint:false,idempotentHint:true,openWorldHint:false}},async command=>invoke(()=>client.request('/layout-proposals'+(name==='validate_layout'?'/validate':''),command))());
  server.registerTool('get_layout_proposal',{description:'Read status and stored configuration of your own layout proposal. Other producers cannot read it.',inputSchema:fromJsonSchema<{proposalId:string}>({type:'object',additionalProperties:false,required:['proposalId'],properties:{proposalId:{type:'string',pattern:'^[A-Za-z0-9_-]+$',maxLength:100}}}),annotations:{readOnlyHint:true,openWorldHint:false}},async({proposalId})=>invoke(()=>client.request('/layout-proposals/'+encodeURIComponent(proposalId)))());
  server.registerTool('get_context', { description: 'Read scope-filtered current display content, session ID/revision and protected paths. Returns session:null when no session is active. Never reads private proposals or audit data.', inputSchema: fromJsonSchema<{ sessionId?: string }>(contextSchema), annotations: { readOnlyHint: true, openWorldHint: false } }, async ({ sessionId }) => invoke(async () => {
    const id = sessionId ?? (await client.request('/sessions/current')).session?.id;
    return { session: id ? await client.request(`/sessions/${encodeURIComponent(id)}/context`) : null };
  })());
  for (const name of ['validate', 'apply', 'propose'] as const) {
    const schema = structuredClone(changeSchema);
    // Advertise the exact content contract, including distinct apply/propose intents.
    if (name !== 'validate') schema.properties.intent = { const: name };
    const descriptions = {
      validate: 'Validate a complete ChangeSet and compare before/after content without saving or publishing. Validation does not reserve the revision.',
      apply: 'Apply a public display-content ChangeSet only with apply_allowed policies for all affected sources, producer publishing permission, current revision and unlocked fields. Sources default to proposal_only; discover them with get_sources. Never falls back to a proposal. Identical request retries recover the original receipt.',
      propose: 'Submit a complete display-content ChangeSet for operator review: actual wording for now, recap, events, notices or session fields. Stores a private proposal; does not change the broadcast. Preserve intent:propose and the observed baseRevision.'
    };
    server.registerTool(name, {
      description: descriptions[name], inputSchema: fromJsonSchema<ChangeSet>(schema),
      annotations: { readOnlyHint: name === 'validate', destructiveHint: name === 'apply', idempotentHint: true, openWorldHint: false }
    }, async command => invoke(() => client.request(`/sessions/${encodeURIComponent(command.sessionId)}/changes${name === 'validate' ? '/validate' : ''}`, command))());
  }
  server.registerTool('heartbeat', { description: 'Report producer connectivity without changing broadcast content or revisions.', inputSchema: fromJsonSchema(emptySchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, invoke(() => client.request('/producers/heartbeat', {})));
  return server;
}
