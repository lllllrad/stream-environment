import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/server/store.ts';
import { Engine } from '../src/domain/engine.ts';
import { createHttp } from '../src/server/http.ts';
import { DIMENSIONS } from '../src/contracts/display.ts';

const args = process.argv.slice(2), durationSeconds = Number(args[args.indexOf('--seconds') + 1] ?? 28800);
if (!Number.isFinite(durationSeconds) || durationSeconds < 2 || durationSeconds > 86400) throw new Error('--seconds must be between 2 and 86400.');
const dir = resolve(`.data/soak-${Date.now()}`); mkdirSync(dir,{recursive:true}); mkdirSync('artifacts',{recursive:true});
const store = new Store(resolve(dir,'dashboard.db')), engine = new Engine(store), token = randomUUID();
const app = createHttp(engine,{adminToken:token,webDir:resolve('dist'),heartbeatMs:5000});
await new Promise<void>(resolve => app.server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
const session = engine.createSession({title:'장시간 갱신 모의 실험',goal:'세 출력과 운영 화면의 안정성을 측정합니다.',expectedControlRevision:0});
engine.lifecycle(session.id,{action:'start',expectedRevision:0,expectedControlRevision:0});
// Explicit opt-in is confined to this synthetic server's separate database.
for (const sourceId of ['now','events']) engine.setSourcePolicy({sourceId,policy:'apply_allowed',expectedControlRevision:engine.control().controlRevision});
const producer = engine.producer({name:'Synthetic soak producer',canAutoPublish:true,allowedSessions:[session.id],allowedOperations:['set_now','upsert_event'],allowedPaths:['/now','/events/*'],expectedControlRevision:engine.control().controlRevision});
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const context = await browser.newContext({timezoneId:'Asia/Seoul'});
  const pages = [];
  for (const preset of ['full','side','lower'] as const) { const p = await context.newPage(); const [width,height] = DIMENSIONS[preset]; await p.setViewportSize({width,height}); await p.goto(`${base}/display/main-${preset}`); pages.push(p); }
  const admin = await context.newPage(); await admin.goto(`${base}/admin`); await admin.getByLabel('운영자 키').fill(token); await admin.getByRole('button',{name:'운영 화면 열기'}).click();
  await admin.getByRole('heading',{name:'오버레이 편집',exact:true}).waitFor();
  const metrics = await Promise.all([...pages,admin].map(async page => {const client=await context.newCDPSession(page);await client.send('Performance.enable');return client;}));
  const latencies: number[] = [], memory: {second:number;rss:number;heap:number;nodes:number[];browserJsHeap:number[]}[] = [];
  const start = performance.now(), cpuStart = process.cpuUsage(); let updates = 0;
  while (performance.now() - start < durationSeconds * 1000) {
    const begin = performance.now(), current = engine.session(session.id), title = `모의 갱신 ${updates}`;
    const response = await fetch(`${base}/api/v1/sessions/${session.id}/changes`,{method:'POST',headers:{Authorization:`Bearer ${producer.token}`,'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:'1.0',requestId:randomUUID(),sessionId:session.id,baseRevision:current.revision,intent:'apply',provenance:{disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:['soak:synthetic'],reason:'Synthetic sustained update'},operations:[{op:'set_now',value:{title,detail:'실제 AI 없이 송출의 안정성을 확인합니다.',status:'in_progress',next:null}},{op:'upsert_event',event:{id:'soak_event',kind:'progress',text:title,occurredAt:new Date().toISOString(),certainty:'confirmed'}}]})});
    if (!response.ok) throw new Error(`Soak command rejected: ${JSON.stringify(await response.json())}`);
    await Promise.all(pages.map(page => page.waitForFunction(expected => document.querySelector('.broadcast h2')?.textContent===expected,title,{timeout:2000})));
    latencies.push(performance.now()-begin); updates++;
    if (updates === 1 || updates % 20 === 0) { const usage=process.memoryUsage(); memory.push({second:(performance.now()-start)/1000,rss:usage.rss,heap:usage.heapUsed,nodes:await Promise.all([...pages,admin].map(p=>p.locator('*').count())),browserJsHeap:await Promise.all(metrics.map(async client => (await client.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')?.value ?? 0))}); }
    await delay(Math.max(0,500-(performance.now()-begin)));
  }
  const hideAt=performance.now(); engine.setControl({expectedControlRevision:engine.control().controlRevision,mode:'hidden'});
  await Promise.all(pages.map(p=>p.waitForFunction(()=>!document.querySelector('.broadcast'),undefined,{timeout:1000})));
  latencies.sort((a,b)=>a-b); const percentile=(q:number)=>latencies[Math.min(latencies.length-1,Math.floor(latencies.length*q))];
  const report={date:new Date().toISOString(),durationSeconds,updates,node:process.version,platform:process.platform,browser:await browser.version(),cpu:process.cpuUsage(cpuStart),publishP95Ms:percentile(.95),publishP99Ms:percentile(.99),hideMs:performance.now()-hideAt,memory,notes:'Synthetic local loopback, three output pages and one operator page. No OBS process. Memory samples are server RSS/heap, per-page browser JS heap and DOM counts, not complete browser process memory.'};
  writeFileSync('artifacts/soak-report.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
  if (report.publishP95Ms>1000 || report.publishP99Ms>2000 || report.hideMs>1000) throw new Error('Latency target exceeded; inspect artifacts/soak-report.json.');
} finally { await browser.close(); await app.close(); store.close(); }
