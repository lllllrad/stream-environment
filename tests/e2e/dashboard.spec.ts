import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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
async function login(page: Page) { await page.goto('/admin'); await page.getByLabel('운영자 키').fill(token); await page.getByRole('button', {name:'컨트롤 룸 열기'}).click(); await expect(page.getByRole('heading',{name:'컨트롤 룸',exact:true})).toBeVisible(); }

test('operator can create a session, edit and lock, compare hold preview, hide and restore', async ({ page, request }) => {
  const fixture = await seed(request, 'minimal'); await login(page);
  await page.getByRole('button', {name:'현재 활동 수정',exact:true}).click();
  await page.getByLabel('현재 활동 제목').fill('사람이 정정한 활동'); await page.getByRole('button',{name:'저장하고 잠금'}).click();
  await expect(page.locator('.now-editor-content h3')).toHaveText('사람이 정정한 활동');
  const state = await api(request, `/sessions/${fixture.session.id}/context`); expect(state.locks.some((l:any) => l.path === '/now')).toBeTruthy();
  await page.getByRole('button',{name:'게시 보류',exact:true}).click(); await expect(page.getByText('게시 보류 중',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'현재 활동 수정',exact:true}).click(); await page.getByLabel('현재 활동 제목').fill('다음 반영본의 활동'); await page.getByRole('button',{name:'저장하고 잠금'}).click();
  await expect(page.locator('.preview-stage h2')).toHaveText('사람이 정정한 활동');
  await page.getByRole('button',{name:'다음 반영본',exact:true}).click(); await expect(page.locator('.preview-stage h2')).toHaveText('다음 반영본의 활동');
  await page.getByRole('button',{name:'긴급 숨김',exact:true}).click(); await page.getByRole('button',{name:'실제 송출본',exact:true}).click(); await expect(page.locator('.preview-stage .broadcast')).toHaveCount(0);
  await page.getByRole('button',{name:'게시 재개',exact:true}).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button',{name:'이 내용을 공개하고 재개'}).click(); await expect(page.locator('.preview-stage h2')).toHaveText('다음 반영본의 활동');
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

test('proposal review shows current and proposed values, requires explicit disclosure approval, and locks the result', async ({page,request}) => {
  const fixture = await seed(request,'minimal'); await fixture.change([{op:'set_now',value:{title:'検討後の公開活動',detail:'運営者が内容を確認しました。',status:'in_progress',next:null}}],'propose');
  await login(page); await page.getByRole('button',{name:/変更提案|변경 제안/}).click(); await expect(page.getByText('제안 내용',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'승인하고 잠금'})).toBeDisabled(); await page.getByLabel('이 내용이 공개 가능한지 검토하고 명시적으로 허용합니다.').check(); await page.getByRole('button',{name:'승인하고 잠금'}).click(); await expect(page.getByText('검토할 제안이 없습니다',{exact:true})).toBeVisible();
  const current = await api(request,`/sessions/${fixture.session.id}/context`); expect(current.now.title).toBe('検討後の公開活動'); expect(current.locks.some((l:any)=>l.path==='/now')).toBeTruthy();
});
test('keyboard navigation, dialog Escape, reduced motion, and broadcast text contrast',async ({page,request})=>{
  await seed(request,'normal');await login(page);await page.emulateMedia({reducedMotion:'reduce'});
  const create=page.getByRole('button',{name:'새 세션',exact:true});await create.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(create).toBeFocused();
  const contrast=await page.locator('.preview-stage .broadcast').evaluate(el=>{
    const root=getComputedStyle(el);const hex=(v:string)=>v.match(/[0-9a-f]{2}/gi)!.map(n=>parseInt(n,16)/255);const luminance=(rgb:number[])=>rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const bg=luminance(hex(root.getPropertyValue('--broadcast-bg').trim()));return ['--broadcast-ink','--broadcast-muted','--broadcast-accent'].map(name=>{const fg=luminance(hex(root.getPropertyValue(name).trim()));return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});
  });expect(contrast.every(ratio=>ratio>=4.5)).toBeTruthy();
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
