import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { DomainError, ensure } from '../contracts/errors.ts';
import type { RenderPreview, VisibilityReport } from '../contracts/overlay.ts';
import { inspectionSource } from '../domain/inspection.ts';

export class RenderService {
  private browser?:Promise<Browser>; private active=0;
  private webDir:string;
  constructor(webDir=resolve('dist')){this.webDir=webDir;}
  async render(preview:RenderPreview,includeImage=false):Promise<RenderPreview>{
    ensure(this.active<2,'RENDER_BUSY','Two render inspections are already running. Retry shortly.',429);
    this.active++;let context;
    try {
      const frame=inspectionSource(preview);
      this.browser??=chromium.launch({headless:true,...(process.env.RENDER_BROWSER_EXECUTABLE?{executablePath:process.env.RENDER_BROWSER_EXECUTABLE}:{channel:process.env.RENDER_BROWSER_CHANNEL??(process.platform==='win32'?'msedge':'chrome')})}).catch(e=>{this.browser=undefined;throw e;});
      context=await (await this.browser).newContext({viewport:{width:frame.width,height:frame.height},deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul'});
      await context.route('**/*',route=>route.abort());const page=await context.newPage();page.setDefaultTimeout(10000);
      const css=readFileSync(resolve(this.webDir,'render-preview.css'),'utf8'),js=readFileSync(resolve(this.webDir,'render-preview.js'),'utf8');
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent"><div id="root"></div></body></html>');
      await page.addStyleTag({content:css+'\n.overlay-scroll{animation:none!important}'});
      await page.evaluate(f=>{window.__frame=f;},frame);await page.addScriptTag({content:js});
      await page.waitForFunction(()=>!!window.__report);await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const report=await page.evaluate(()=>window.__report!) as VisibilityReport;
      const allowed=preview.snapshot.overlay!.widgets.flatMap(w=>w.blocks.map(b=>`${w.id}:${b.path}`));
      for(const widget of report.widgets) widget.fields=widget.fields.filter(f=>allowed.includes(`${widget.id}:${f.path}`));
      if(includeImage) await page.evaluate(keys=>{for(const node of document.querySelectorAll<HTMLElement>('[data-field]'))if(!keys.includes(`${node.closest<HTMLElement>('[data-widget]')!.dataset.widget}:${node.dataset.field}`))node.style.visibility='hidden';},allowed);
      return {...preview,report,...(includeImage?{image:{mimeType:'image/png' as const,base64:(await page.screenshot({omitBackground:true})).toString('base64')}}:{})};
    } catch(error){if(error instanceof DomainError)throw error;throw new DomainError('RENDER_UNAVAILABLE','Browser inspection is unavailable. Build the app and configure an installed Chromium browser using RENDER_BROWSER_CHANNEL or RENDER_BROWSER_EXECUTABLE.',503);}
    finally{await context?.close();this.active--;}
  }
  async close(){await (await this.browser?.catch(()=>undefined))?.close();this.browser=undefined;}
}
