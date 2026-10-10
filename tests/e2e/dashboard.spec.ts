import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { scenarios } from '../../fixtures/scenarios.ts';
import { DIMENSIONS } from '../../src/contracts/display.ts';
import type { ChangeSet, Control, Operation, Session } from '../../src/contracts/types.ts';
const token = 'e2e-operator-credential-long-enough';
async function api(request: APIRequestContext, path: string, data?: unknown, bearer = token) {
  const r = await request.fetch(`/api/v1${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${bearer}` }, data });
  const result = await r.json(); expect(r.ok(), JSON.stringify(result)).toBeTruthy(); return result;
}
async function seed(request: APIRequestContext, name = 'normal') {
  let control: Control = await api(request, '/admin/control');
  if (control.activeSessionId) {
    const active: Session = await api(request, `/sessions/${control.activeSessionId}/context`);
    if (active.status !== 'ended') await api(request, `/admin/sessions/${active.id}/lifecycle`, { action: 'end', expectedRevision: active.revision, expectedControlRevision: control.controlRevision });
    const ended = await api(request, `/sessions/${active.id}/context`);
    control = await api(request, '/admin/control');
    await api(request, `/admin/sessions/${active.id}/purge`, { expectedRevision: ended.revision, expectedControlRevision: control.controlRevision, confirm: true });
  }
  control = await api(request, '/admin/control');
  await api(request, '/admin/control', { mode: 'auto', confirmRestore: true, expectedControlRevision: control.controlRevision, aiWritesEnabled: true });
  control = await api(request, '/admin/control'); const fixture = scenarios[name];
  const s: Session = await api(request, '/admin/sessions', { title: fixture.title, goal: fixture.goal, expectedControlRevision: control.controlRevision });
  await api(request, `/admin/sessions/${s.id}/lifecycle`, { action: 'start', expectedRevision: s.revision, expectedControlRevision: control.controlRevision });
  control = await api(request, '/admin/control');
  const producer = await api(request, '/admin/producers', { name: 'Browser fixture producer', canAutoPublish: true, allowedSessions: [s.id], allowedOperations: ['update_session','set_now','set_pin','upsert_event','retract_event','upsert_work_item','retract_work_item'], allowedPaths: ['*'], expectedControlRevision: control.controlRevision });
  const change = async (ops: Operation[], intent: 'apply'|'propose' = 'apply') => {
    const current: Session = await api(request, `/sessions/${s.id}/context`);
    return api(request, `/sessions/${s.id}/changes`, { schemaVersion: '1.0', requestId: randomUUID(), sessionId: s.id, baseRevision: current.revision, intent, provenance: { disclosure: intent === 'propose' ? 'restricted' : 'public', observedAt: new Date().toISOString(), sourceRefs: ['fixture:public'], reason: intent === 'propose' ? 'PRIVATE_PROPOSAL_MARKER' : 'Fixture update' }, operations: ops }, producer.token);
  };
  if (fixture.operations.length) await change(fixture.operations);
  if (fixture.hidden) { control = await api(request, '/admin/control'); await api(request, '/admin/control', { mode: 'hidden', expectedControlRevision: control.controlRevision }); }
  const outputUrl = async (preset = 'side') => `/display/main-${preset}`;
  return { session: s, producer, change, outputUrl };
}
async function login(page: Page, content = true) { await page.goto('/admin'); await page.getByLabel('운영자 키').fill(token); await page.getByRole('button', {name:'운영 화면 열기'}).click(); await expect(page.getByRole('heading',{name:'오버레이 편집',exact:true})).toBeVisible(); if(content) { await page.getByRole('button',{name:'내용 관리',exact:true}).click(); await expect(page.getByRole('heading',{name:'내용 관리',exact:true})).toBeVisible(); } }

test('source policy UI blocks producer apply and separate scoped token controls a scene and status widget without review',async({page,request,context})=>{
  const fixture=await seed(request,'normal'),original=(await api(request,'/admin/overlays')).config,layout=original.layouts.find((l:any)=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='break'),source=(await api(request,'/sources')).sources.find((s:any)=>s.id==='now');let controllerId='';const display=await context.newPage();
  try{
    await login(page,false);await page.getByRole('button',{name:'생산자',exact:true}).click();const policy=page.getByLabel('현재 활동 게시 정책');await expect(policy).toHaveValue(source.policy);await policy.selectOption('proposal_only');await expect(page.getByRole('status')).toContainText('소스 게시 정책을 변경했습니다');
    const session=await api(request,`/sessions/${fixture.session.id}/context`),command={schemaVersion:'1.0',requestId:randomUUID(),sessionId:session.id,baseRevision:session.revision,intent:'apply',provenance:{disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:[],reason:'Synthetic policy check'},operations:[{op:'set_now',value:{title:'Reviewed source proposal',detail:'Synthetic content',status:'preparing',next:null}}]};
    const blocked=await request.post(`/api/v1/sessions/${session.id}/changes`,{headers:{Authorization:`Bearer ${fixture.producer.token}`},data:command});expect(blocked.status()).toBe(403);expect((await blocked.json()).error.code).toBe('SOURCE_REVIEW_REQUIRED');
    const proposal=await api(request,`/sessions/${session.id}/changes`,{...command,requestId:randomUUID(),intent:'propose'},fixture.producer.token);expect(proposal.outcome).toBe('proposed');
    await page.getByLabel('제어 토큰 이름').fill('Browser scene control');await page.getByLabel('씬 제어 자리 비움',{exact:true}).check();await page.getByLabel('위젯 제어 1080p / 자리 비움 / away',{exact:true}).check();await page.getByRole('button',{name:'제어 토큰 발급',exact:true}).click();
    const secret=page.getByLabel('발급된 자격 증명');await expect(secret).toBeVisible();const token=await secret.inputValue();await page.keyboard.press('Escape');
    controllerId=(await api(request,'/admin/controllers')).items.find((c:any)=>c.name==='Browser scene control').id;
    let control=await api(request,'/control/context',undefined,token);expect(control.widgets).toHaveLength(1);expect(control.scenes.map((s:any)=>s.id)).toEqual(['break']);
    await api(request,'/control/widgets',{requestId:randomUUID(),expectedConfigRevision:control.configRevision,overlayId:layout.overlayId,sceneId:layout.sceneId,widgetId:'away',visible:true,settings:{message:'Direct status from another system',detail:'No proposal review needed'}},token);
    control=await api(request,'/control/context',undefined,token);await api(request,'/control/scene',{requestId:randomUUID(),expectedConfigRevision:control.configRevision,sceneId:'break'},token);
    await display.goto(`/display/${layout.overlayId}`);await expect(display.locator('[data-widget="away"]')).toContainText('Direct status from another system');
    expect((await api(request,'/admin/state')).proposals.map((p:any)=>p.id)).toContain(proposal.proposalId);
    const card=page.getByRole('article',{name:'제어 토큰 Browser scene control',exact:true});await expect(card).toBeVisible();await page.locator('.access-settings').first().screenshot({path:'artifacts/source-publication-policies.png'});await page.locator('.access-settings').nth(1).screenshot({path:'artifacts/direct-control-token.png'});
    await card.getByRole('button',{name:'제어 토큰 폐기',exact:true}).click();await expect(card).toContainText('폐기됨');const revoked=await request.get('/api/v1/control/context',{headers:{Authorization:`Bearer ${token}`}});expect(revoked.status()).toBe(401);
  }finally{
    await display.close();let c=await api(request,'/admin/control');await api(request,'/admin/source-policies',{expectedControlRevision:c.controlRevision,sourceId:'now',policy:source.policy});
    let config=(await api(request,'/admin/overlays')).config;await api(request,'/admin/layouts',{expectedRevision:config.revision,overlayId:layout.overlayId,sceneId:layout.sceneId,widgets:layout.widgets});config=(await api(request,'/admin/overlays')).config;await api(request,'/admin/scene',{expectedRevision:config.revision,sceneId:original.activeSceneId});
    if(controllerId&&(await api(request,'/admin/controllers')).items.some((item:any)=>item.id===controllerId&&!item.revoked)){c=await api(request,'/admin/control');await api(request,`/admin/controllers/${controllerId}/revoke`,{expectedControlRevision:c.controlRevision});}
  }
});

test('operator starts in the overlay editor and compact navigation retains an accessible icon',async({page,request})=>{
  await seed(request,'normal'); await login(page,false);
  await expect(page.getByLabel('오버레이',{exact:true})).toBeVisible();
  await expect(page.getByLabel('편집 씬')).toBeVisible();
  await expect(page.getByText('OUTPUT PREVIEW',{exact:true})).toHaveCount(0);
  await expect(page.getByText('시청자가 보는 화면',{exact:true})).toHaveCount(0);
  await expect(page.locator('.overlay-editor-stage [data-field="/now/title"]')).toBeVisible();
  await expect(page.locator('.overlay-editor-stage .visibility-details')).toBeVisible();
  await page.screenshot({path:'artifacts/operator-overlay-home.png',fullPage:true});
  await page.getByRole('button',{name:'내용 관리',exact:true}).click();
  await expect(page.locator('.content-grid')).toBeVisible();
  await expect(page.getByRole('button',{name:'레이아웃 편집',exact:true})).toBeVisible();
  await expect(page.locator('.preview-panel')).toHaveCount(0);
  await page.screenshot({path:'artifacts/operator-content.png',fullPage:true});
  await page.getByRole('button',{name:'운영 설정',exact:true}).click();
  await expect(page.getByRole('heading',{name:'연결 진단',exact:true})).toBeVisible();
  await expect(page.locator('.output-card')).toHaveCount(0);
  await page.setViewportSize({width:720,height:1000});
  const editor = page.getByRole('button',{name:'오버레이 편집',exact:true});
  await expect(editor.locator('svg rect').first()).toBeVisible();
  await editor.click(); await expect(page.getByLabel('편집 씬')).toBeVisible();
});

test('widget colors accept RGB/RGBA, preserve alpha in pickers, persist and support opacity controls',async({page,request})=>{
  await seed(request,'normal'); const {config}=await api(request,'/admin/overlays');
  const original=config.layouts.find((layout:any)=>layout.overlayId==='overlay-1920x1080'&&layout.sceneId==='live').widgets;
  await login(page,false); const widget=page.locator('.overlay-editor-stage [data-widget="now"]');
  await expect(widget).toBeVisible();
  const rejected:number[]=[],invalidRequests:unknown[]=[];
  page.on('response',response=>{if(response.url().endsWith('/admin/layouts/preview')&&!response.ok())rejected.push(response.status());});
  page.on('request',request=>{if(request.url().endsWith('/admin/layouts/preview')){const input=request.postDataJSON();if(input.widgets?.some((widget:any)=>widget.settings.background==='#bf'))invalidRequests.push(input);}});
  const display=await page.context().newPage(); await display.goto('/display/overlay-1920x1080');
  try {
    const background=page.getByLabel('배경색',{exact:true});
    await background.fill('#bf'); await expect(background).toHaveAttribute('aria-invalid','true');
    await expect(page.getByRole('button',{name:'저장 전 검토',exact:true})).toBeDisabled();
    // Cover both the debounce and periodic refresh while an entry is incomplete.
    await page.waitForTimeout(2300); expect(rejected).toEqual([]); expect(invalidRequests).toEqual([]);
    await background.pressSequentially('8'); await expect(widget).toHaveCSS('background-color','rgb(187, 255, 136)');
    await page.getByLabel('글자색',{exact:true}).fill('#AbC'); await expect(background).toHaveValue('#bf8');
    await expect(widget).toHaveCSS('color','rgb(170, 187, 204)');
    await page.getByLabel('글자색 선택',{exact:true}).fill('#204060'); await expect(widget).toHaveCSS('color','rgb(32, 64, 96)');
    const save=async()=>{await expect(page.getByRole('button',{name:'저장 전 검토',exact:true})).toBeEnabled();await page.getByRole('button',{name:'저장 전 검토',exact:true}).click();await page.getByRole('button',{name:'검토한 레이아웃 저장',exact:true}).click();await expect(page.getByText('레이아웃을 저장했습니다.',{exact:true})).toBeVisible();};
    await background.focus(); await save(); await expect(display.locator('[data-widget="now"]')).toHaveCSS('background-color','rgb(187, 255, 136)');
    let {config:saved}=await api(request,'/admin/overlays'); let settings=saved.layouts.find((layout:any)=>layout.overlayId==='overlay-1920x1080'&&layout.sceneId==='live').widgets.find((widget:any)=>widget.id==='now').settings;
    expect(settings.background).toBe('#bbff88'); expect(settings.color).toBe('#204060');
    await page.reload(); await expect(background).toHaveValue('#bbff88');
    await expect(widget).toHaveCSS('background-color','rgb(187, 255, 136)');
    await expect(widget).toHaveCSS('color','rgb(32, 64, 96)');
    await background.fill('#8BF8'); await expect(widget).toHaveCSS('background-color',/^rgba\(136, 187, 255, 0\.533\d*\)$/);
    await page.getByLabel('글자색',{exact:true}).fill('#ABC8'); await expect(widget).toHaveCSS('color',/^rgba\(170, 187, 204, 0\.533\d*\)$/);
    await page.getByLabel('배경색 선택',{exact:true}).fill('#102030'); await expect(background).toHaveValue('#10203088');
    await expect(widget).toHaveCSS('background-color',/^rgba\(16, 32, 48, 0\.533\d*\)$/);
    await page.getByLabel('배경색 선택',{exact:true}).fill('#88bbff');
    await page.getByLabel('글자색 선택',{exact:true}).fill('#204060'); await expect(page.getByLabel('글자색',{exact:true})).toHaveValue('#20406088');
    await save(); await expect(display.locator('[data-widget="now"]')).toHaveCSS('background-color',/^rgba\(136, 187, 255, 0\.533\d*\)$/);
    await expect(display.locator('[data-widget="now"]')).toHaveCSS('color',/^rgba\(32, 64, 96, 0\.533\d*\)$/);
    ({config:saved}=await api(request,'/admin/overlays'));settings=saved.layouts.find((layout:any)=>layout.overlayId==='overlay-1920x1080'&&layout.sceneId==='live').widgets.find((widget:any)=>widget.id==='now').settings;
    expect(settings.background).toBe('#88bbff88'); expect(settings.color).toBe('#20406088');
    await page.reload(); await expect(background).toHaveValue('#88bbff88'); await expect(page.getByLabel('배경색 선택',{exact:true})).toHaveValue('#88bbff');
    await expect(page.getByLabel('배경색 불투명도',{exact:true})).toHaveValue('53');
    await expect(widget).toHaveCSS('background-color',/^rgba\(136, 187, 255, 0\.533\d*\)$/);
    await page.screenshot({path:'artifacts/widget-alpha-colors.png',fullPage:true});
    await page.getByLabel('배경색 불투명도',{exact:true}).press('Home'); await expect(background).toHaveValue('#88bbff00');
    await expect(widget).toHaveCSS('background-color','rgba(136, 187, 255, 0)');
    await page.getByLabel('배경색 불투명도',{exact:true}).press('End'); await expect(background).toHaveValue('#88bbff');
    await expect(widget).toHaveCSS('background-color','rgb(136, 187, 255)');
    await page.getByRole('button',{name:'배경 투명하게',exact:true}).click(); await expect(widget).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await save(); await expect(display.locator('[data-widget="now"]')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    expect(rejected).toEqual([]); expect(invalidRequests).toEqual([]);
  } finally {
    await display.close(); const {config:latest}=await api(request,'/admin/overlays');
    await api(request,'/admin/layouts',{overlayId:'overlay-1920x1080',sceneId:'live',widgets:original,expectedRevision:latest.revision});
  }
});

test('operator grants layout proposals and reviews measured widget geometry before approving private AI suggestions',async({page,request})=>{
  const fixture=await seed(request,'normal'),{config}=await api(request,'/admin/overlays'),layout=config.layouts.find((l:any)=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='live'),original=layout.widgets;
  await login(page,false);await page.getByRole('button',{name:'생산자',exact:true}).click();
  const producer=page.getByRole('article',{name:`생산자 Browser fixture producer ${fixture.producer.producer.id}`,exact:true});await producer.getByRole('button',{name:'레이아웃 제안 권한 허용',exact:true}).click();await expect(producer.getByRole('button',{name:'레이아웃 제안 권한 해제',exact:true})).toBeVisible();
  const widgets=structuredClone(original).filter((w:any)=>w.id!=='events'),now=widgets.find((w:any)=>w.id==='now');Object.assign(now,{x:40,y:200,width:540,height:240});now.settings.background='#8BF8';widgets.push({...structuredClone(now),id:'agent_banner',type:'away',x:40,y:480,height:140,settings:{...now.settings,message:'검토 후 공개할 위젯 문구',detail:'AI 레이아웃 제안'}});
  const command={schemaVersion:'1.0',requestId:randomUUID(),intent:'propose',overlayId:layout.overlayId,sceneId:layout.sceneId,baseRevision:layout.revision,provenance:{disclosure:'restricted',observedAt:new Date().toISOString(),sourceRefs:['fixture:layout'],reason:'활동 영역을 왼쪽으로 배치'},widgets};
  const display=await page.context().newPage();await display.goto(`/display/${layout.overlayId}`);
  try{
    const inspection=await api(request,`/sessions/${fixture.session.id}/render-preview`,{overlayId:layout.overlayId,sceneId:'live',widgets},fixture.producer.token);expect(inspection.report.width).toBe(1920);expect(inspection.report.widgets.find((w:any)=>w.id==='now').rect.x).toBe(40);
    await api(request,'/layout-proposals/validate',command,fixture.producer.token);const receipt=await api(request,'/layout-proposals',command,fixture.producer.token);
    await expect(display.locator('[data-widget="now"]')).toHaveCSS('left',`${original.find((w:any)=>w.id==='now').x}px`);await expect(display.getByText('검토 후 공개할 위젯 문구',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'변경 제안',exact:true}).click();const card=page.getByRole('article',{name:'레이아웃 제안 활동 영역을 왼쪽으로 배치',exact:true});await expect(card).toBeVisible();await expect(card.getByRole('button',{name:'레이아웃 승인',exact:true})).toBeDisabled();
    await expect(card.getByRole('region',{name:'레이아웃 제안 비교',exact:true})).toBeVisible();await expect(card.locator('[data-widget="agent_banner"]')).toBeVisible();await expect(card.locator('.visibility-details').first()).toBeVisible();
    await card.getByLabel('배치·크기·표시 내용과 잘림·겹침을 검토했습니다.').check();await expect(card.getByRole('button',{name:'레이아웃 승인',exact:true})).toBeDisabled();await card.getByLabel('위젯 문구와 설정이 공개 가능한지 검토하고 허용합니다.').check();
    await page.screenshot({path:'artifacts/layout-proposal-review.png',fullPage:true});await card.getByRole('button',{name:'레이아웃 승인',exact:true}).click();await expect(card).toHaveCount(0);await expect(display.locator('[data-widget="now"]')).toHaveCSS('left','40px');await expect(display.getByText('검토 후 공개할 위젯 문구',{exact:true})).toBeVisible();await expect(display.locator('[data-widget="events"]')).toHaveCount(0);
    expect((await api(request,`/layout-proposals/${receipt.proposalId}`,undefined,fixture.producer.token)).status).toBe('approved');await page.reload();await expect(page.getByLabel('위젯 x',{exact:true})).toHaveValue('40');
  }finally{await display.close();const {config:latest}=await api(request,'/admin/overlays');await api(request,'/admin/layouts',{overlayId:layout.overlayId,sceneId:'live',widgets:original,expectedRevision:latest.revision});}
});

test('layout proposal review invalidates on edits, requires stale replacement acknowledgment and can reject without publishing',async({page,request})=>{
  const fixture=await seed(request,'normal'),{config}=await api(request,'/admin/overlays'),layout=config.layouts.find((l:any)=>l.overlayId==='overlay-1280x720'&&l.sceneId==='break'),original=layout.widgets;
  await api(request,`/admin/producers/${fixture.producer.producer.id}/layout-grant`,{expectedControlRevision:(await api(request,'/admin/control')).controlRevision,canProposeLayouts:true});
  const widgets=structuredClone(original);widgets.find((w:any)=>w.id==='away').x=100;
  const command={schemaVersion:'1.0',requestId:randomUUID(),intent:'propose',overlayId:layout.overlayId,sceneId:layout.sceneId,baseRevision:layout.revision,provenance:{disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:[],reason:'720p 자리비움 배치 조정'},widgets};const receipt=await api(request,'/layout-proposals',command,fixture.producer.token);
  await login(page,false);await page.getByRole('button',{name:'변경 제안',exact:true}).click();const card=page.getByRole('article',{name:'레이아웃 제안 720p 자리비움 배치 조정',exact:true});
  try{
    const reviewed=card.getByLabel('배치·크기·표시 내용과 잘림·겹침을 검토했습니다.');await reviewed.check();await expect(card.getByRole('button',{name:'레이아웃 승인',exact:true})).toBeEnabled();await expect(card.getByText('현재 송출 선택 씬이 아닙니다. 이 씬을 송출 선택할 때 반영됩니다.',{exact:true})).toBeVisible();
    const newer=structuredClone(original);newer.find((w:any)=>w.id==='away').y=50;await api(request,'/admin/layouts',{overlayId:layout.overlayId,sceneId:layout.sceneId,widgets:newer,expectedRevision:config.revision});
    const stale=card.getByLabel('최신 레이아웃을 제안 구성으로 대체하는 것을 확인했습니다.');await expect(stale).toBeVisible();await expect(reviewed).not.toBeChecked();await reviewed.check();await expect(card.getByRole('button',{name:'레이아웃 승인',exact:true})).toBeDisabled();await stale.check();await card.getByRole('button',{name:'레이아웃 승인',exact:true}).click();await expect(card).toHaveCount(0);
    let {config:current}=await api(request,'/admin/overlays');expect(current.activeSceneId).toBe('live');const saved=current.layouts.find((l:any)=>l.overlayId===layout.overlayId&&l.sceneId===layout.sceneId);expect(saved.widgets.find((w:any)=>w.id==='away').x).toBe(100);expect(saved.widgets.find((w:any)=>w.id==='away').y).toBe(original.find((w:any)=>w.id==='away').y);
    const reject=await api(request,'/layout-proposals',{...command,requestId:randomUUID(),baseRevision:saved.revision,widgets:original,provenance:{...command.provenance,reason:'거절할 레이아웃 제안'}},fixture.producer.token);const rejectedCard=page.getByRole('article',{name:'레이아웃 제안 거절할 레이아웃 제안',exact:true});await rejectedCard.getByRole('button',{name:'레이아웃 제안 거절',exact:true}).click();await expect(rejectedCard).toHaveCount(0);expect((await api(request,`/layout-proposals/${reject.proposalId}`,undefined,fixture.producer.token)).status).toBe('rejected');expect((await api(request,`/layout-proposals/${receipt.proposalId}`,undefined,fixture.producer.token)).status).toBe('approved');
  }finally{const {config:latest}=await api(request,'/admin/overlays');await api(request,'/admin/layouts',{overlayId:layout.overlayId,sceneId:layout.sceneId,widgets:original,expectedRevision:latest.revision});}
});

test('layout undo groups drag and resize gestures, restores saved drafts and resets across layouts',async({page,request})=>{
  const fixture=await seed(request,'normal'),{config}=await api(request,'/admin/overlays');
  const original=config.layouts.find((layout:any)=>layout.overlayId==='overlay-1920x1080'&&layout.sceneId==='live').widgets;
  await login(page,false);
  const handle=page.getByRole('button',{name:'위젯 now',exact:true}),undo=page.getByRole('button',{name:'실행 취소',exact:true}),redo=page.getByRole('button',{name:'다시 실행',exact:true});
  const field=(key:string)=>page.getByLabel(`위젯 ${key}`,{exact:true});
  await expect(handle).toBeVisible();const initial=Object.fromEntries(await Promise.all(['x','y','width','height'].map(async key=>[key,await field(key).inputValue()])));
  const drag=async(target:typeof handle,dx:number,dy:number)=>{const box=(await target.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:6});await page.mouse.up();};
  try {
    await expect(undo).toBeDisabled();await drag(handle,-30,12);
    const movedX=await field('x').inputValue(),movedY=await field('y').inputValue();expect(movedX).not.toBe(initial.x);expect(movedY).not.toBe(initial.y);
    await page.keyboard.press('Control+z');await expect(field('x')).toHaveValue(initial.x);await expect(field('y')).toHaveValue(initial.y);
    await expect(undo).toBeDisabled();await expect(redo).toBeEnabled();await expect(page.getByLabel('오버레이',{exact:true})).toBeEnabled();
    await handle.click();await expect(redo).toBeEnabled();await page.keyboard.press('Control+Shift+z');await expect(field('x')).toHaveValue(movedX);await expect(field('y')).toHaveValue(movedY);
    await page.keyboard.press('Control+z');await page.keyboard.press('Control+y');await expect(field('x')).toHaveValue(movedX);await undo.click();
    await drag(page.getByRole('button',{name:'now 크기 조절',exact:true}),-18,10);expect(await field('width').inputValue()).not.toBe(initial.width);expect(await field('height').inputValue()).not.toBe(initial.height);
    await page.keyboard.press('Control+z');await expect(field('width')).toHaveValue(initial.width);await expect(field('height')).toHaveValue(initial.height);await expect(undo).toBeDisabled();
    await handle.focus();await page.keyboard.press('Shift+ArrowLeft');await expect(field('x')).toHaveValue(String(Number(initial.x)-10));await page.keyboard.press('Control+z');await expect(field('x')).toHaveValue(initial.x);
    await field('x').fill('321');await page.getByRole('button',{name:'저장 전 검토',exact:true}).click();await page.getByRole('button',{name:'검토한 레이아웃 저장',exact:true}).click();await expect(page.getByText('레이아웃을 저장했습니다.',{exact:true})).toBeVisible();
    await expect(undo).toBeEnabled();await page.keyboard.press('Control+z');await expect(field('x')).toHaveValue(initial.x);
    await expect(page.getByRole('region',{name:'레이아웃 저장 검토'})).toHaveCount(0);await expect(page.getByRole('button',{name:'검토한 레이아웃 저장',exact:true})).toBeDisabled();
    const {config:saved}=await api(request,'/admin/overlays');expect(saved.layouts.find((layout:any)=>layout.overlayId==='overlay-1920x1080'&&layout.sceneId==='live').widgets.find((widget:any)=>widget.id==='now').x).toBe(321);
    await fixture.change([{op:'set_now',value:{title:'활동 갱신 후에도 실행 취소 유지',detail:'실시간 내용 업데이트',status:'in_progress',next:null}}]);
    await expect(page.locator('.overlay-editor-stage [data-field="/now/title"]')).toHaveText('활동 갱신 후에도 실행 취소 유지');await expect(redo).toBeEnabled();await redo.click();await expect(field('x')).toHaveValue('321');
    await expect(page.getByLabel('오버레이',{exact:true})).toBeEnabled();await expect(page.locator('.overlay-editor-stage [data-widget="now"]')).toHaveCSS('left','321px');await page.screenshot({path:'artifacts/overlay-history.png',fullPage:true});
    await page.getByLabel('오버레이',{exact:true}).selectOption('overlay-1280x720');await expect(undo).toBeDisabled();await expect(redo).toBeDisabled();
  } finally {
    const {config:latest}=await api(request,'/admin/overlays');await api(request,'/admin/layouts',{overlayId:'overlay-1920x1080',sceneId:'live',widgets:original,expectedRevision:latest.revision});
  }
});

test('layout undo restores widget settings, visibility, order and removed or added widgets, preserving native text undo',async({page,request})=>{
  await seed(request,'normal');await login(page,false);
  const undo=page.getByRole('button',{name:'실행 취소',exact:true}),redo=page.getByRole('button',{name:'다시 실행',exact:true}),selected=page.getByLabel('위젯 선택',{exact:true});
  const background=page.getByLabel('배경색',{exact:true});await expect(background).toBeVisible();const initial=await background.inputValue();
  await background.fill('#');await background.pressSequentially('8BF8');await undo.click();await expect(background).toHaveValue(initial);await expect(undo).toBeDisabled();await redo.click();await expect(background).toHaveValue('#8BF8');await undo.click();
  const visible=page.getByLabel('위젯 표시',{exact:true});await visible.uncheck();await undo.click();await expect(visible).toBeChecked();
  const order=()=>page.locator('.widget-handle').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label'))),original=await order();await page.getByRole('button',{name:'앞으로',exact:true}).click();expect(await order()).not.toEqual(original);await undo.click();expect(await order()).toEqual(original);
  await page.getByRole('button',{name:'위젯 제거',exact:true}).click();await expect(page.getByRole('button',{name:'위젯 now',exact:true})).toHaveCount(0);await undo.click();await expect(selected).toHaveValue('now');await expect(background).toHaveValue(initial);await expect(page.getByRole('button',{name:'위젯 now',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'위젯 추가',exact:true}).click();const added=await selected.inputValue(),message=page.getByLabel('상태 문구',{exact:true}),defaultMessage=await message.inputValue();
  await message.fill('새');await message.pressSequentially(' 상태 문구');await undo.click();await expect(message).toHaveValue(defaultMessage);await undo.click();await expect(page.getByRole('button',{name:`위젯 ${added}`,exact:true})).toHaveCount(0);
  await redo.click();await expect(selected).toHaveValue(added);await expect(message).toHaveValue(defaultMessage);await redo.click();await expect(message).toHaveValue('새 상태 문구');
  // A focused text field must keep browser text undo instead of the layout shortcut.
  await message.focus();await page.evaluate(()=>{const listener=(event:KeyboardEvent)=>{if(event.ctrlKey&&event.key==='z'){document.body.dataset.undoPrevented=String(event.defaultPrevented);window.removeEventListener('keydown',listener);}};window.addEventListener('keydown',listener);});
  await message.press('Control+z');await expect(page.locator('body')).toHaveAttribute('data-undo-prevented','false');await expect(selected).toHaveValue(added);
  await page.getByRole('button',{name:'수정 취소 / 다시 읽기',exact:true}).click();await expect(undo).toBeDisabled();await expect(redo).toBeDisabled();await expect(selected).not.toHaveValue(added);await expect(page.getByRole('button',{name:`위젯 ${added}`,exact:true})).toHaveCount(0);
});

test('z-index controls broadcast stacking, measured occlusion, editor handles and undo/save',async({page,request,context})=>{
  await seed(request,'normal');const original=await api(request,'/admin/overlays'),layout=original.config.layouts.find((l:any)=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='live'),widgets=structuredClone(layout.widgets);
  for(const w of widgets){w.visible=['now','away'].includes(w.type);w.zIndex=w.type==='now'?200:w.type==='away'?10:0;if(w.visible)Object.assign(w,{x:24,y:24,width:500,height:240});}
  await api(request,'/admin/layouts',{expectedRevision:original.config.revision,overlayId:layout.overlayId,sceneId:layout.sceneId,widgets});
  const display=await context.newPage();
  try{
    await login(page,false);const z=page.getByLabel('위젯 z-index'),undo=page.getByRole('button',{name:'실행 취소',exact:true}),redo=page.getByRole('button',{name:'다시 실행',exact:true});
    await expect(z).toHaveValue('200');await z.fill('10000');await undo.click();await expect(z).toHaveValue('200');await redo.click();await expect(z).toHaveValue('10000');
    await expect(page.locator('.overlay-editor-stage [data-widget="now"]')).toHaveCSS('z-index','10000');
    const handle=page.getByRole('button',{name:'위젯 now',exact:true});await expect(handle).toHaveCSS('z-index','10001');
    const box=(await handle.boundingBox())!;expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.widget-handle')?.getAttribute('aria-label'),{x:box.x+box.width/2,y:box.y+box.height/2})).toBe('위젯 now');
    await page.getByRole('button',{name:'뒤로',exact:true}).click();await expect(z).toHaveValue('10');await undo.click();await expect(z).toHaveValue('10000');
    const review=page.getByRole('button',{name:'저장 전 검토',exact:true});await expect(review).toBeEnabled();await review.click();await page.getByRole('button',{name:'검토한 레이아웃 저장',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('레이아웃을 저장했습니다');await display.goto(`/display/${layout.overlayId}`);
    await expect(display.locator('[data-widget="now"]')).toHaveCSS('z-index','10000');
    const top=()=>display.evaluate(()=>document.elementFromPoint(60,60)?.closest('[data-widget]')?.getAttribute('data-widget'));expect(await top()).toBe('now');
    const visible=await api(request,`/sessions/${(await api(request,'/sessions/current')).session.id}/render-preview`,{overlayId:layout.overlayId});expect(visible.report.widgets.find((w:any)=>w.id==='now').fields[0].visibleCodePoints).toBeGreaterThan(0);
    await z.fill('0');await expect(review).toBeEnabled();await review.click();await page.getByRole('button',{name:'검토한 레이아웃 저장',exact:true}).click();await expect(display.locator('[data-widget="now"]')).toHaveCSS('z-index','0');expect(await top()).toBe('away');
    const hidden=await api(request,`/sessions/${(await api(request,'/sessions/current')).session.id}/render-preview`,{overlayId:layout.overlayId});expect(hidden.report.widgets.find((w:any)=>w.id==='now').fields[0].visibleCodePoints).toBe(0);
    await page.locator('.widget-inspector').evaluate(el=>el.scrollTo({top:0}));await page.screenshot({path:'artifacts/widget-z-index.png',fullPage:true});
  }finally{await display.close();const latest=await api(request,'/admin/overlays');await api(request,'/admin/layouts',{expectedRevision:latest.config.revision,overlayId:layout.overlayId,sceneId:layout.sceneId,widgets:layout.widgets});}
});

test('overlay editor drags, resizes, reviews and persists widget geometry and adds complete scene layouts',async({page,request})=>{
  const fixture=await seed(request,'normal');await login(page);await page.getByRole('button',{name:'오버레이 편집',exact:true}).click();
  const handle=page.getByRole('button',{name:'위젯 now',exact:true});await expect(handle).toBeVisible();const box=(await handle.boundingBox())!,initialX=Number(await page.getByLabel('위젯 x',{exact:true}).inputValue());
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-35,box.y+box.height/2+15,{steps:5});await page.mouse.up();expect(Number(await page.getByLabel('위젯 x',{exact:true}).inputValue())).toBeLessThan(initialX);
  const initialWidth=Number(await page.getByLabel('위젯 width').inputValue()),resize=(await page.getByRole('button',{name:'now 크기 조절',exact:true}).boundingBox())!;
  await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await page.mouse.down();await page.mouse.move(resize.x+resize.width/2-15,resize.y+resize.height/2+10,{steps:4});await page.mouse.up();expect(Number(await page.getByLabel('위젯 width').inputValue())).toBeLessThan(initialWidth);
  await page.getByLabel('위젯 x',{exact:true}).fill('55');await page.getByLabel('넘침 동작').selectOption('shrink');await expect(page.getByRole('button',{name:'저장 전 검토',exact:true})).toBeEnabled();await page.getByRole('button',{name:'저장 전 검토',exact:true}).click();await expect(page.getByRole('region',{name:'레이아웃 저장 검토'})).toBeVisible();await page.getByRole('button',{name:'검토한 레이아웃 저장'}).click();await expect(page.getByText('레이아웃을 저장했습니다.',{exact:true})).toBeVisible();
  let catalog=await api(request,'/admin/overlays');let w=catalog.config.layouts.find((l:any)=>l.overlayId==='overlay-1920x1080'&&l.sceneId==='live').widgets.find((w:any)=>w.id==='now');expect(w.x).toBe(55);expect(w.settings.overflow).toBe('shrink');
  await page.reload();await page.getByRole('button',{name:'오버레이 편집',exact:true}).click();await expect(page.getByLabel('위젯 x',{exact:true})).toHaveValue('55');
  await page.getByLabel('추가할 위젯').selectOption('away');await page.getByRole('button',{name:'위젯 추가',exact:true}).click();await page.getByLabel('상태 문구',{exact:true}).fill('새 상태 플러그인');await expect(page.getByRole('button',{name:'저장 전 검토',exact:true})).toBeEnabled();await page.getByRole('button',{name:'저장 전 검토',exact:true}).click();await page.getByRole('button',{name:'검토한 레이아웃 저장'}).click();await expect(page.getByText('레이아웃을 저장했습니다.',{exact:true})).toBeVisible();
  await page.getByLabel('새 씬 이름').fill('검토 씬');await page.getByRole('button',{name:'씬 추가',exact:true}).click();await expect(page.getByText('씬과 모든 해상도의 레이아웃을 만들었습니다.',{exact:true})).toBeVisible();catalog=await api(request,'/admin/overlays');expect(catalog.config.layouts.length).toBe(catalog.config.scenes.length*catalog.config.overlays.length);
  await fixture.change([{op:'set_now',value:{title:'새로 수신된 활동',detail:'편집 중에도 미리보기를 갱신합니다.',status:'in_progress',next:null}}]);await expect(page.locator('.overlay-editor-stage [data-field="/now/title"]')).toHaveText('새로 수신된 활동');await expect(page.locator('.overlay-editor-stage .visibility-details')).toBeVisible();await page.locator('.widget-inspector').evaluate(el=>el.scrollTop=0);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/overlay-editor.png',fullPage:true});
});

test('whole-canvas overlays use exact dimensions, preserve transparency, switch scenes and honor emergency hide',async({page,request})=>{
  await seed(request,'normal');let {config}=await api(request,'/admin/overlays');await api(request,'/admin/scene',{sceneId:'break',expectedRevision:config.revision});
  for(const o of config.overlays){await page.setViewportSize({width:o.width,height:o.height});await page.goto(`/display/${o.id}`);await expect(page.locator('.overlay-canvas')).toBeVisible();await expect(page.locator('[data-field="/widget/away/message"]')).toHaveText('잠시 자리 비움');const canvas=await page.locator('.overlay-canvas').boundingBox();expect(canvas!.width).toBe(o.width);expect(canvas!.height).toBe(o.height);expect(await page.locator('.overlay-canvas').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');await expect(page).toHaveScreenshot(`${o.id}-break.png`,{omitBackground:true});}
  ({config}=await api(request,'/admin/overlays'));await api(request,'/admin/scene',{sceneId:'live',expectedRevision:config.revision});await expect(page.locator('[data-field="/now/title"]')).toBeVisible();let c=await api(request,'/admin/control');await api(request,'/admin/control',{mode:'hidden',expectedControlRevision:c.controlRevision});await expect(page.locator('.overlay-canvas')).toHaveCount(0);
});

test('review compares candidate content inside a selected full-canvas overlay without publishing it',async({page,request})=>{
  const fixture=await seed(request,'normal');const {config}=await api(request,'/admin/overlays');if(config.activeSceneId!=='live')await api(request,'/admin/scene',{sceneId:'live',expectedRevision:config.revision});await fixture.change([{op:'set_now',value:{title:'비공개 오버레이 검토 문구',detail:'검토용 내용입니다.',status:'in_progress',next:null}}],'propose');await login(page);await page.getByRole('button',{name:/^변경 제안/}).click();const card=page.locator('.proposal-card').last();await card.getByLabel('제안 오버레이').selectOption('overlay-1920x1080');await expect(card.locator('.proposal-screen-viewport').locator('[data-field="/now/title"]')).toHaveText('비공개 오버레이 검토 문구');expect(JSON.stringify(await (await request.get('/api/v1/display/overlay-1920x1080/snapshot')).json())).not.toContain('비공개 오버레이 검토 문구');await expect(card.getByText(/잘린 필드/).first()).toBeVisible();
});

test('operator edits stored content, holds actual output and reviews every overlay before restoring', async ({ page, request }) => {
  const fixture = await seed(request, 'minimal'); await login(page);
  const display = await page.context().newPage(); await display.goto('/display/overlay-1920x1080'); await expect(display.locator('[data-field="/now/title"]')).toBeVisible();
  await page.getByRole('button', {name:'현재 활동 수정',exact:true}).click();
  await page.getByLabel('현재 활동 제목').fill('사람이 정정한 활동'); await page.getByRole('button',{name:'저장하고 잠금'}).click();
  await expect(page.locator('.now-editor-content h3')).toHaveText('사람이 정정한 활동');
  const state = await api(request, `/sessions/${fixture.session.id}/context`); expect(state.locks.some((l:any) => l.path === '/now')).toBeTruthy();
  await page.getByRole('button',{name:'게시 보류',exact:true}).click(); await expect(page.getByText('게시 보류 중',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'현재 활동 수정',exact:true}).click(); await page.getByLabel('현재 활동 제목').fill('다음 반영본의 활동'); await page.getByRole('button',{name:'저장하고 잠금'}).click();
  await expect(display.locator('[data-field="/now/title"]')).toHaveText('사람이 정정한 활동');
  await expect(page.locator('.now-editor-content h3')).toHaveText('다음 반영본의 활동');
  await page.getByRole('button',{name:'긴급 숨김',exact:true}).click(); await expect(display.locator('.overlay-canvas')).toHaveCount(0);
  await page.getByRole('button',{name:'게시 재개',exact:true}).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.restore-preview .overlay-canvas')).toHaveCount(2);
  await expect(page.locator('.restore-preview [data-field="/now/title"]')).toHaveText(['다음 반영본의 활동','다음 반영본의 활동']);
  await page.getByRole('button',{name:'이 내용을 공개하고 재개'}).click(); await expect(display.locator('[data-field="/now/title"]')).toHaveText('다음 반영본의 활동'); await display.close();
  await page.screenshot({ path: 'artifacts/admin-control-room.png', fullPage: true });
});
test('operator can create and end sessions without any AI account', async ({page, request}) => {
  const fixture = await seed(request, 'empty'); const current = await api(request, `/sessions/${fixture.session.id}/context`), c = await api(request, '/admin/control');
  await api(request, `/admin/sessions/${current.id}/lifecycle`, {action:'end',expectedRevision:current.revision,expectedControlRevision:c.controlRevision});
  await login(page); await page.getByRole('button',{name:'새 세션',exact:true}).click(); await page.getByLabel('오늘 무엇을 하나요?').fill('사람만으로 시작한 활동'); await page.getByLabel('활동 목적',{exact:true}).fill('외부 AI 없이 수동으로 관리합니다'); await page.getByRole('button',{name:'세션 만들기',exact:true}).click();
  await expect(page.locator('.session-strip h2')).toContainText('사람만으로 시작한 활동');
  await page.getByRole('button',{name:'종료',exact:true}).click(); await page.getByRole('button',{name:'세션 종료',exact:true}).click(); await expect(page.locator('.session-strip .badge')).toHaveText('종료');
});
test('public display renders text safely, receives SSE, reconnects and expires after disconnect', async ({ page, request, context }) => {
  const fixture = await seed(request, 'minimal'); await page.setViewportSize({width:480,height:1080}); await page.goto(await fixture.outputUrl());
  await expect(page.locator('.broadcast h2')).toBeVisible(); expect(page.url()).not.toContain('#');
  await fixture.change([{ op:'set_now', value:{title:'<script>window.bad=1</script>',detail:'코드처럼 보이지만 일반 텍스트입니다.',status:'in_progress',next:null} }]);
  await expect(page.locator('.broadcast h2')).toHaveText('<script>window.bad=1</script>'); expect(await page.evaluate(() => (window as any).bad)).toBeUndefined();
  await fixture.change([{op:'set_now',value:{title:'PRIVATE_PROPOSAL_MARKER',detail:'검토 전에 공개하지 않습니다.',status:'in_progress',next:null}}],'propose');
  expect(await page.content()).not.toContain('PRIVATE_PROPOSAL_MARKER');
  await context.setOffline(true); await expect(page.locator('.broadcast')).toHaveCount(0, {timeout:5000});
  await context.setOffline(false); await expect(page.locator('.broadcast h2')).toHaveText('<script>window.bad=1</script>', {timeout:10000});
  await page.reload(); await expect(page.locator('.broadcast h2')).toBeVisible();
});
test('outputs open without credentials, accept legacy URLs and remain hidden after reload', async ({page, request, context}) => {
  const fixture = await seed(request,'normal');
  await context.clearCookies(); await page.goto(await fixture.outputUrl()); await expect(page.locator('.broadcast')).toBeVisible();
  expect((await context.cookies()).some(c => c.name === 'display_session')).toBeFalsy();
  await page.goto('/display/main-side#key=obsolete'); await expect(page.locator('.broadcast')).toBeVisible(); expect(page.url()).not.toContain('#');
  const c = await api(request,'/admin/control'); await api(request,'/admin/control',{mode:'hidden',expectedControlRevision:c.controlRevision}); await expect(page.locator('.broadcast')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.broadcast')).toHaveCount(0); expect(await page.locator('#root').textContent()).toBe('');
  const privateRead = await page.request.get('/api/v1/admin/state'); expect(privateRead.status()).toBe(401);
});

test('external MCP content proposals stay private until UI approval and then render on OBS outputs', async ({page,request,context}) => {
  const fixture = await seed(request,'minimal');
  const client = new Client({name:'browser-content-test',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:[resolve('scripts/mcp.ts')],env:{...getDefaultEnvironment(),DASHBOARD_URL:'http://127.0.0.1:4311',DASHBOARD_PRODUCER_TOKEN:fixture.producer.token},stderr:'pipe'});
  await client.connect(transport);
  const display = await context.newPage();
  try {
    await display.setViewportSize({width:1920,height:1080}); await display.goto(await fixture.outputUrl('full')); await expect(display.locator('.broadcast')).toBeVisible();
    const state = await client.callTool({name:'get_context',arguments:{}});
    const current = (state.structuredContent as any).session;
    const catalog=await client.callTool({name:'get_layouts',arguments:{}});expect((catalog.structuredContent as any).config.overlays.length).toBe(2);
    const inspected=await client.callTool({name:'render_preview',arguments:{overlayId:'overlay-1920x1080',sceneId:'live',includeImage:true,change:{schemaVersion:'1.0',requestId:randomUUID(),sessionId:current.id,baseRevision:current.revision,intent:'propose',provenance:{disclosure:'restricted',observedAt:new Date().toISOString(),sourceRefs:['fixture:private'],reason:'Inspect actual pixel visibility'},operations:[{op:'set_now',value:{title:'픽셀 범위를 검사할 제안',detail:'브라우저 측정 후 검토합니다.',status:'in_progress',next:null}}]}}});
    expect(inspected.isError,JSON.stringify(inspected.structuredContent)).not.toBeTruthy();expect((inspected.structuredContent as any).report.width).toBe(1920);expect(inspected.content.some(block=>block.type==='image'&&block.mimeType==='image/png')).toBeTruthy();expect(await display.content()).not.toContain('픽셀 범위를 검사할 제안');
    const result = await client.callTool({name:'propose',arguments:{schemaVersion:'1.0',requestId:randomUUID(),sessionId:current.id,baseRevision:current.revision,intent:'propose',provenance:{disclosure:'restricted',observedAt:new Date().toISOString(),sourceRefs:['fixture:private'],reason:'External viewer-facing wording'},operations:[{op:'set_now',value:{title:'외부 시스템이 제안한 활동',detail:'운영자가 내용 확인 후 공개합니다.',status:'in_progress',next:null}},{op:'update_session',fields:{recap:['외부 시스템이 방송 맥락을 제안했습니다.']}},{op:'set_pin',value:{text:'제안한 안내 문구도 표시할 수 있습니다.',expiresAt:null}}]}});
    expect(result.isError).not.toBeTruthy(); expect((result.structuredContent as any).outcome).toBe('proposed');
    expect(await display.content()).not.toContain('외부 시스템이 제안한 활동');
    await login(page); await page.getByRole('button',{name:/^변경 제안/}).click(); await expect(page.getByText('제안 내용',{exact:true})).toHaveCount(3);

    const visual = page.getByRole('region',{name:'제안 송출 미리보기'});
    await expect(visual.locator('.proposal-screen-viewport').locator('[data-field="/now/title"]')).toHaveText('외부 시스템이 제안한 활동');
    expect(await display.content()).not.toContain('외부 시스템이 제안한 활동');
    await visual.getByLabel('제안 오버레이').selectOption('overlay-1280x720'); await expect(visual.locator('.overlay-canvas').first()).toHaveCSS('width','1280px');
    await visual.getByLabel('제안 씬').selectOption('break'); await expect(visual.locator('[data-field="/now/title"]')).toHaveCount(0); await expect(visual.locator('[data-field="/widget/away/message"]')).toHaveCount(1);
    await visual.getByLabel('제안 씬').selectOption('live'); await visual.getByLabel('제안 오버레이').selectOption('overlay-1920x1080'); await expect(visual.locator('[data-field="/now/title"]').last()).toHaveText('외부 시스템이 제안한 활동');
    await page.screenshot({path:'artifacts/proposal-rendered-review.png',fullPage:true});
    await expect(page.getByRole('button',{name:'승인하고 잠금'})).toBeDisabled(); await page.getByLabel('이 내용이 공개 가능한지 검토하고 명시적으로 허용합니다.').check(); await page.getByRole('button',{name:'승인하고 잠금'}).click(); await expect(page.getByText('검토할 제안이 없습니다',{exact:true})).toBeVisible();
    await expect(display.locator('.broadcast h2')).toHaveText('외부 시스템이 제안한 활동');
    await expect(display.locator('.broadcast-recap')).toContainText('외부 시스템이 방송 맥락을 제안했습니다.');
    await expect(display.locator('.broadcast-pin')).toContainText('제안한 안내 문구도 표시할 수 있습니다.');
    const approved = await api(request,`/sessions/${fixture.session.id}/context`); expect(approved.locks.some((l:any)=>l.path==='/now')).toBeTruthy();
  } finally { await client.close(); await display.close(); }
});

test('operator downloads filtered session records as JSON and literal Markdown, including held editorial content', async ({page,request}) => {
  const fixture = await seed(request,'normal');
  await fixture.change([{op:'upsert_event',event:{id:'withdraw_for_export',kind:'progress',text:'WITHDRAWN_EVENT',occurredAt:new Date().toISOString(),certainty:'confirmed'}},{op:'upsert_work_item',workItem:{id:'withdraw_work_export',title:'WITHDRAWN_WORK',status:'failed',publicResult:'WITHDRAWN_RESULT'}}]);
  await fixture.change([{op:'retract_event',id:'withdraw_for_export'},{op:'retract_work_item',id:'withdraw_work_export'}]);
  await fixture.change([{op:'set_now',value:{title:'PRIVATE_PROPOSAL_MARKER',detail:'Never in export',status:'in_progress',next:null}}],'propose');
  let control = await api(request,'/admin/control'); await api(request,'/admin/control',{mode:'hold',expectedControlRevision:control.controlRevision});
  await fixture.change([{op:'set_now',value:{title:'보류 중 기록된 마지막 활동',detail:'저장된 내용의 기록을 내보냅니다.',status:'in_progress',next:null}}]);
  const current = await api(request,`/sessions/${fixture.session.id}/context`); control = await api(request,'/admin/control');
  await api(request,`/admin/sessions/${current.id}/lifecycle`,{action:'end',expectedRevision:current.revision,expectedControlRevision:control.controlRevision});
  await login(page); await page.getByRole('button',{name:'세션 기록',exact:true}).click();
  const record = page.locator('.session-record').filter({hasText:fixture.session.id}); await expect(record).toHaveCount(1);
  const read = async (download: import('@playwright/test').Download) => { const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8'); };
  const [jsonDownload] = await Promise.all([page.waitForEvent('download'),record.getByRole('button',{name:/JSON 다운로드$/}).click()]);
  expect(jsonDownload.suggestedFilename()).toMatch(/session_[A-Za-z0-9_-]+-r\d+\.json$/);
  const json = await read(jsonDownload), data = JSON.parse(json);
  expect(data.session.status).toBe('ended'); expect(data.publication).toBe('held'); expect(data.session.lastActivity.title).toBe('보류 중 기록된 마지막 활동');
  for (const forbidden of ['PRIVATE_PROPOSAL_MARKER','WITHDRAWN_','sourceRefs','actorId','locks','tokenHash']) expect(json).not.toContain(forbidden);
  const [markdownDownload] = await Promise.all([page.waitForEvent('download'),record.getByRole('button',{name:/Markdown 다운로드$/}).click()]);
  expect(markdownDownload.suggestedFilename()).toMatch(/\.md$/); const markdown = await read(markdownDownload); expect(markdown).toContain('# Session content export'); expect(markdown).toContain('not a live activity'); expect(markdown).toContain('보류 중 기록된 마지막 활동');
  await page.getByLabel('세션 상태',{exact:true}).selectOption('prepared'); await expect(record).toHaveCount(0);
  await page.getByLabel('세션 상태',{exact:true}).selectOption('ended'); await expect(record).toHaveCount(1);
  await page.screenshot({path:'artifacts/session-archive.png',fullPage:true});
});

test('keyboard navigation, dialog Escape, reduced motion, and broadcast text contrast',async ({page,request})=>{
  const fixture=await seed(request,'normal');await login(page);await page.emulateMedia({reducedMotion:'reduce'});
  const create=page.getByRole('button',{name:'새 세션',exact:true});await create.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(create).toBeFocused();
  const display=await page.context().newPage();await display.goto(await fixture.outputUrl('full'));await expect(display.locator('.broadcast')).toBeVisible();
  const contrast=await display.locator('.broadcast').evaluate(el=>{
    const root=getComputedStyle(el);const hex=(v:string)=>v.match(/[0-9a-f]{2}/gi)!.map(n=>parseInt(n,16)/255);const luminance=(rgb:number[])=>rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const bg=luminance(hex(root.getPropertyValue('--broadcast-bg').trim()));return ['--broadcast-ink','--broadcast-muted','--broadcast-accent'].map(name=>{const fg=luminance(hex(root.getPropertyValue(name).trim()));return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});
  });expect(contrast.every(ratio=>ratio>=4.5)).toBeTruthy();await display.close();
});
for(const preset of ['full','side','lower'] as const){
  test(`720p scaled composition: ${preset}`,async({page,request})=>{
    const fixture=await seed(request,'normal');await page.setViewportSize({width:1280,height:720});await page.goto(await fixture.outputUrl(preset));await expect(page.locator('.broadcast')).toBeVisible();
    await page.addStyleTag({content:`#root{transform:scale(0.6666666667);transform-origin:top left;width:${DIMENSIONS[preset][0]}px;height:${DIMENSIONS[preset][1]}px;}${preset==='lower'?'#root{position:absolute;top:573.333333px;}':''}`});
    await expect(page).toHaveScreenshot(`${preset}-720p.png`,{omitBackground:true});
  });
}
for (const name of ['empty','minimal','normal','maximum','maximum_work','crowded','optional_none','tentative','failed','hidden']) {
  for (const preset of ['full','side','lower'] as const) {
    test(`visual ${preset}: ${name}`, async ({page,request}) => {
      const fixture = await seed(request,name); const [width,height] = DIMENSIONS[preset]; await page.setViewportSize({width,height}); await page.goto(await fixture.outputUrl(preset));
      if (name !== 'hidden') {
        await expect(page.locator('.broadcast')).toBeVisible();
        const bounds = await page.locator('.broadcast').evaluate(el => {
          const parent = el.getBoundingClientRect();
          return Array.from(el.querySelectorAll('h1,h2,h3,.now-detail,.next-activity,.section-label,li,.broadcast-pin,.broadcast-work,.broadcast-footer')).map(node => {const r=node.getBoundingClientRect();return {tag:node.className||node.tagName, top:r.top,bottom:r.bottom,right:r.right,left:r.left,limit:parent.bottom,width:parent.right};});
        });
        expect(bounds.filter(b=>b.bottom>height+1||b.top<0||b.right>width+1||b.left<0), JSON.stringify(bounds)).toEqual([]);
      } else await expect(page.locator('.broadcast')).toHaveCount(0);
      await expect(page).toHaveScreenshot(`${preset}-${name}.png`, { omitBackground: true });
    });
  }
}
