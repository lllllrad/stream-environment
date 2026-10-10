import { useLayoutEffect, useRef } from 'react';
import { widgetZIndex, type OverlayFrame, type Rect, type VisibilityReport } from '../contracts/overlay.ts';
import './overlay.css';
import { widgetColorAlpha } from '../contracts/colors.ts';

const rect = (r: DOMRect, origin: DOMRect, scale: number): Rect => ({x:(r.x-origin.x)/scale,y:(r.y-origin.y)/scale,width:r.width/scale,height:r.height/scale});
const intersects = (a: Rect,b: Rect) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
export function fitOverlay(root: HTMLElement, frame: OverlayFrame) {
  for (const widget of frame.widgets) {
    const node = [...root.querySelectorAll<HTMLElement>('[data-widget]')].find(n=>n.dataset.widget===widget.id);
    if (!node) continue;
    const inner = node.querySelector<HTMLElement>('.overlay-inner')!, flow = inner.firstElementChild as HTMLElement;
    flow.style.fontSize = `${widget.settings.fontSize}px`;
    const fields = [...flow.querySelectorAll<HTMLElement>('[data-field]')];
    for (const field of fields) {field.textContent = field.dataset.text!;delete field.dataset.prefix;}
    if (widget.settings.overflow === 'shrink') {
      let size = widget.settings.fontSize;
      while (size > widget.settings.minFontSize && (flow.scrollHeight > inner.clientHeight || flow.scrollWidth > inner.clientWidth)) flow.style.fontSize = `${--size}px`;
    }
    if (widget.settings.overflow === 'ellipsis') for (const field of fields) {
      const text = [...field.dataset.text!], lineHeight = parseFloat(getComputedStyle(field).lineHeight);
      const budget = Math.max(0,Math.min(widget.settings.maxLines*lineHeight,inner.clientHeight-field.offsetTop));
      const fits = () => field.scrollHeight <= budget+.5 && field.scrollWidth <= inner.clientWidth;
      if (fits()) continue;
      let lo=0,hi=text.length;
      while(lo<hi){const mid=Math.ceil((lo+hi)/2);field.textContent=text.slice(0,mid).join('')+'…';if(fits())lo=mid;else hi=mid-1;}
      field.textContent = lo ? text.slice(0,lo).join('')+'…' : '';
      field.dataset.prefix = String(lo);
    }
    flow.style.setProperty('--travel',`${Math.max(0,flow.scrollHeight-inner.clientHeight)}px`);
    flow.classList.toggle('overlay-scroll',widget.settings.overflow==='scroll' && flow.scrollHeight>inner.clientHeight);
  }
}
export function measureOverlay(root: HTMLElement,frame: OverlayFrame):VisibilityReport {
  const origin=root.getBoundingClientRect(),scale=origin.width/frame.width,opaque=frame.widgets.map(w=>widgetColorAlpha(w.settings.background)===1);
  return {width:frame.width,height:frame.height,overlayId:frame.id,sceneId:frame.sceneId,configRevision:frame.configRevision,layoutRevision:frame.layoutRevision,widgets:frame.widgets.map((w,index)=>{
    const area={x:w.x,y:w.y,width:w.width,height:w.height}, overlapping=frame.widgets.filter((other,i)=>i!==index&&other.visible&&intersects(area,{x:other.x,y:other.y,width:other.width,height:other.height}));
    const node=[...root.querySelectorAll<HTMLElement>('[data-widget]')].find(n=>n.dataset.widget===w.id);
    return {id:w.id,type:w.type,rect:area,zIndex:widgetZIndex(w),visible:w.visible,overflow:w.settings.overflow,scrolling:!!node?.querySelector('.overlay-scroll'),overlaps:overlapping.map(o=>o.id),fields:node?[...node.querySelectorAll<HTMLElement>('[data-field]')].map(field=>{
      const full=[...field.dataset.text!],actual=[...(field.textContent??'')],textNode=field.firstChild,inner=node.querySelector('.overlay-inner')!.getBoundingClientRect(),ranges:{start:number;end:number}[]=[];
      const prefix=w.settings.overflow==='ellipsis'&&field.dataset.prefix!==undefined?Number(field.dataset.prefix):full.length;
      let offset=0,visibleText='';
      for(let i=0;i<Math.min(full.length,actual.length,prefix);i++){
        const length=actual[i].length,range=document.createRange();let visible=false;
        if(textNode){range.setStart(textNode,offset);range.setEnd(textNode,offset+length);const bounds=range.getBoundingClientRect(),r=rect(bounds,origin,scale);
          visible=widgetColorAlpha(w.settings.color)>0&&bounds.width>0&&bounds.left>=inner.left-.5&&bounds.right<=inner.right+.5&&bounds.top>=inner.top-.5&&bounds.bottom<=inner.bottom+.5&&r.x>=0&&r.y>=0&&r.x+r.width<=frame.width+.5&&r.y+r.height<=frame.height+.5&&!frame.widgets.some((o,j)=>(widgetZIndex(o)>widgetZIndex(w)||widgetZIndex(o)===widgetZIndex(w)&&j>index)&&o.visible&&o.blocks.length>0&&opaque[j]&&intersects(r,{x:o.x,y:o.y,width:o.width,height:o.height}));}
        if(visible){visibleText+=full[i];if(ranges.at(-1)?.end===i)ranges.at(-1)!.end++;else ranges.push({start:i,end:i+1});}offset+=length;
      }
      const count=[...visibleText].length;return {path:field.dataset.field!,text:full.join(''),visibleText,totalCodePoints:full.length,visibleCodePoints:count,visibleRanges:ranges,truncated:count<full.length,fontSize:parseFloat(getComputedStyle(field).fontSize),rect:rect(field.getBoundingClientRect(),origin,scale)};
    }):[]};
  })};
}
export function OverlayRenderer({frame,onMeasured}:{frame:OverlayFrame;onMeasured?:(report:VisibilityReport)=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    let cancelled=false; const render=()=>{if(cancelled||!ref.current)return;fitOverlay(ref.current,frame);onMeasured?.(measureOverlay(ref.current,frame));};
    render();void document.fonts.ready.then(()=>requestAnimationFrame(render));return()=>{cancelled=true;};
  },[frame,onMeasured]);
  return <div ref={ref} className="overlay-canvas" data-overlay={frame.id} style={{width:frame.width,height:frame.height}}>{frame.widgets.filter(w=>w.visible&&w.blocks.length).map(w=><section key={w.id} data-widget={w.id} className="overlay-widget" style={{left:w.x,top:w.y,width:w.width,height:w.height,zIndex:widgetZIndex(w),background:w.settings.background,color:w.settings.color,padding:w.settings.padding}}><div className="overlay-inner"><div className="overlay-flow" style={{fontSize:w.settings.fontSize}}>{w.blocks.map((b,i)=><div key={`${b.path}-${i}`} className={`overlay-field role-${b.role}`} data-field={b.path} data-text={b.text}>{b.text}</div>)}</div></div></section>)}</div>;
}
