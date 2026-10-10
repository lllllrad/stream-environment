import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('local Swagger supports explicit producer and controller authorization and real proposals without inherited cookies',async({page,request,context})=>{
  const adminToken='e2e-operator-credential-long-enough';
  const api=async(path:string,body?:object)=>{
    const response=await request.fetch(`/api/v1${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${adminToken}`},data:body});
    const data=await response.json();expect(response.ok(),JSON.stringify(data)).toBeTruthy();return data;
  };
  let control=await api('/admin/control');
  if(control.activeSessionId){const active=await api(`/sessions/${control.activeSessionId}/context`);if(active.status!=='ended')await api(`/admin/sessions/${active.id}/lifecycle`,{action:'end',expectedRevision:active.revision,expectedControlRevision:control.controlRevision});}
  control=await api('/admin/control');
  const session=await api('/admin/sessions',{title:'Swagger synthetic session',goal:'Verify API explorer',expectedControlRevision:control.controlRevision});
  await api(`/admin/sessions/${session.id}/lifecycle`,{action:'start',expectedRevision:session.revision,expectedControlRevision:control.controlRevision});
  control=await api('/admin/control');
  const producer=await api('/admin/producers',{name:'Swagger test producer',expectedControlRevision:control.controlRevision,canAutoPublish:false,allowedSessions:[session.id],allowedOperations:['set_now'],allowedPaths:['/now']});
  control=await api('/admin/control');
  const controller=await api('/admin/controllers',{name:'Swagger test controller',expectedControlRevision:control.controlRevision,allowedSceneIds:['break'],widgets:[]});
  // A valid operator cookie must not silently authorize Try it out.
  await request.post('/api/v1/admin/login',{data:{token:adminToken}});
  const cookies=await request.storageState();await context.addCookies(cookies.cookies);
  const externalRequests:string[]=[],errors:string[]=[];
  page.on('request',req=>{if(new URL(req.url()).origin!=='http://127.0.0.1:4311')externalRequests.push(req.url());});
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto('/swagger?url=https://untrusted.invalid/spec.json');
    await expect(page.getByRole('heading',{name:'FRAME API Explorer',exact:true})).toBeVisible();
    await expect(page.locator('#operations-Producer-getCapabilities')).toBeVisible();
    const capabilities=page.locator('#operations-Producer-getCapabilities');
    await capabilities.locator('.opblock-summary').click();await capabilities.getByRole('button',{name:'Try it out',exact:true}).click();
    let result=page.waitForResponse(r=>r.url().endsWith('/api/v1/capabilities'));
    await capabilities.getByRole('button',{name:'Execute',exact:true}).click();expect((await result).status()).toBe(401);
    const authorize=async(scheme:string,token:string)=>{
      await page.locator('.scheme-container').getByRole('button',{name:'Authorize',exact:true}).click();
      const modal=page.locator('.dialog-ux');const entry=modal.locator('.auth-container').filter({has:page.getByRole('heading',{name:new RegExp(`^${scheme} `)})});
      await entry.locator('input').fill(token);await entry.getByRole('button',{name:'Apply credentials',exact:true}).click();await entry.getByRole('button',{name:'Close',exact:true}).click();
    };
    await authorize('bearerAuth',producer.token);
    result=page.waitForResponse(r=>r.url().endsWith('/api/v1/capabilities'));await capabilities.getByRole('button',{name:'Execute',exact:true}).click();const cap=await result;expect(cap.status()).toBe(200);expect((await cap.json()).role).toBe('producer');
    const proposal=page.locator('#operations-Producer-submitChanges');await proposal.locator('.opblock-summary').click();await proposal.getByRole('button',{name:'Try it out',exact:true}).click();
    await proposal.locator('input[placeholder="id"]').fill(session.id);
    const current=await api(`/sessions/${session.id}/context`);
    await proposal.locator('textarea.body-param__text').fill(JSON.stringify({schemaVersion:'1.0',requestId:randomUUID(),sessionId:session.id,baseRevision:current.revision,intent:'propose',provenance:{disclosure:'public',observedAt:new Date().toISOString(),sourceRefs:[],reason:'Swagger synthetic proposal'},operations:[{op:'set_now',value:{title:'Swagger private suggestion',detail:'Awaiting operator review',status:'preparing',next:null}}]}));
    result=page.waitForResponse(r=>r.url().endsWith(`/sessions/${session.id}/changes`));await proposal.getByRole('button',{name:'Execute',exact:true}).click();const submitted=await result;expect(submitted.status()).toBe(200);expect((await submitted.json()).outcome).toBe('proposed');
    expect((await api(`/sessions/${session.id}/context`)).now).toBeNull();
    await authorize('controllerAuth',controller.token);
    const scoped=page.locator('[id$="-getControlContext"]');await scoped.locator('.opblock-summary').click();await scoped.getByRole('button',{name:'Try it out',exact:true}).click();
    result=page.waitForResponse(r=>r.url().endsWith('/control/context'));await scoped.getByRole('button',{name:'Execute',exact:true}).click();const granted=await result;expect(granted.status()).toBe(200);expect((await granted.json()).scenes.map((s:any)=>s.id)).toEqual(['break']);
    await page.reload();await expect(page.locator('#operations-Producer-getCapabilities')).toBeVisible();
    const refreshed=page.locator('#operations-Producer-getCapabilities');await refreshed.locator('.opblock-summary').click();await refreshed.getByRole('button',{name:'Try it out',exact:true}).click();
    result=page.waitForResponse(r=>r.url().endsWith('/api/v1/capabilities'));await refreshed.getByRole('button',{name:'Execute',exact:true}).click();expect((await result).status()).toBe(401);
    await page.goto('/docs');await expect(page.getByRole('heading',{name:'FRAME API Explorer',exact:true})).toBeVisible();await expect(page.locator('#operations-Producer-getSources')).toBeVisible();
    await page.screenshot({path:'artifacts/swagger-ui.png'});
    expect(externalRequests).toEqual([]);expect(errors).toEqual([]);
  }finally{
    control=await api('/admin/control');await api(`/admin/controllers/${controller.controller.id}/revoke`,{expectedControlRevision:control.controlRevision});
  }
});
