import { Ajv } from 'ajv';
import { ensure } from '../contracts/errors.ts';
import { DEFAULT_SETTINGS, widgetInstanceSchema, widgetZIndex, type OverlayConfig, type Overlay, type Scene, type Layout, type WidgetInstance, type OverlayFrame } from '../contracts/overlay.ts';
import type { Actor, PublicContent, Session } from '../contracts/types.ts';
import { pathAllowed, text } from '../contracts/validation.ts';
import { widgetPlugin } from '../widgets/registry.ts';
import { normalizeWidgetColor } from '../contracts/colors.ts';

const validateWidget = new Ajv({strict:true,allErrors:true}).compile<WidgetInstance>(widgetInstanceSchema);
export function defaultLayout(overlay:Overlay,scene:Scene):Layout {
  const ratio=overlay.width/1920, ry=overlay.height/1080;
  const positions:[string,number,number,number,number][]=[['session',1464,24,424,140],['now',1464,180,424,244],['recap',1464,440,424,180],['events',1464,636,424,160],['work',1464,812,424,244],['pin',32,920,1384,128],['away',320,340,1280,400]];
  return {overlayId:overlay.id,sceneId:scene.id,revision:0,widgets:positions.map(([type,x,y,w,h])=>({id:type,type,zIndex:0,x:Math.round(x*ratio),y:Math.round(y*ry),width:Math.max(48,Math.round(w*ratio)),height:Math.max(32,Math.round(h*ry)),visible:scene.id==='break'?type==='away':type!=='away',settings:{...DEFAULT_SETTINGS,...widgetPlugin(type)?.defaults,fontSize:Math.max(12,Math.round((widgetPlugin(type)?.defaults?.fontSize??26)*Math.min(ratio,ry))),minFontSize:12,padding:Math.round((widgetPlugin(type)?.defaults?.padding??20)*Math.min(ratio,ry))}}))};
}
export function defaultOverlayConfig():OverlayConfig {
  const overlays:Overlay[]=[{id:'overlay-1920x1080',name:'1080p',width:1920,height:1080},{id:'overlay-1280x720',name:'720p',width:1280,height:720}],scenes:Scene[]=[{id:'live',name:'진행 중'},{id:'break',name:'자리 비움'}];
  return {revision:0,activeSceneId:'live',overlays,scenes,layouts:overlays.flatMap(o=>scenes.map(s=>defaultLayout(o,s)))};
}
export function overlayPair(config:OverlayConfig,overlayId:string,sceneId=config.activeSceneId){
  const overlay=config.overlays.find(o=>o.id===overlayId),scene=config.scenes.find(s=>s.id===sceneId),layout=config.layouts.find(l=>l.overlayId===overlayId&&l.sceneId===sceneId);
  ensure(overlay&&scene&&layout,'NOT_FOUND','Overlay, scene or layout not found.',404);return {overlay,scene,layout};
}
export function validatedWidgets(overlay:Overlay,raw:unknown):WidgetInstance[]{
  ensure(Array.isArray(raw)&&raw.length<=32,'INVALID_LAYOUT','A layout supports at most 32 widgets.');
  const ids=new Set<string>();
  for(const widget of raw){
    ensure(validateWidget(widget),'INVALID_LAYOUT','Widget geometry or settings are invalid.');
    ensure(widgetPlugin(widget.type),'UNKNOWN_WIDGET','Widget plugin is not installed.');
    ensure(!ids.has(widget.id),'INVALID_LAYOUT','Widget IDs must be unique within a layout.');ids.add(widget.id);
    ensure(widget.x+widget.width<=overlay.width&&widget.y+widget.height<=overlay.height,'INVALID_LAYOUT','Widgets must remain inside the overlay canvas.');
    ensure(widget.settings.minFontSize<=widget.settings.fontSize,'INVALID_LAYOUT','Minimum font size must not exceed the requested font size.');
    for(const field of ['message','detail'] as const) if(widget.settings[field]) text(widget.settings[field],field==='message'?160:300);
  }
  return structuredClone(raw).map(widget=>({...widget,zIndex:widgetZIndex(widget),settings:{...widget.settings,background:normalizeWidgetColor(widget.settings.background,true)!,color:normalizeWidgetColor(widget.settings.color)!}}));
}
function publicContent(s:Session|undefined,now:string):PublicContent|null{
  if(!s)return null;
  const work=s.selectedWorkId?s.workItems.find(w=>w.id===s.selectedWorkId&&!w.retractedAt):s.workItems.filter(w=>!w.retractedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  return {title:s.title,status:s.status,goal:s.goal,now:s.status==='ended'?null:s.now,recap:s.recap,events:s.events.filter(e=>!e.retractedAt).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.receivedAt.localeCompare(a.receivedAt)).slice(0,10).map(({id,kind,text,occurredAt,certainty})=>({id,kind,text,occurredAt,certainty})),pin:s.pin&&(!s.pin.expiresAt||s.pin.expiresAt>now)?s.pin:null,workItem:work?{id:work.id,title:work.title,status:work.status,publicResult:work.publicResult}:null};
}
function permitted(actor:Actor|undefined,path:string):boolean{
  if(!actor||actor.role==='operator'||path.startsWith('/widget/'))return true;
  const root=path.startsWith('/now/')?'/now':path.startsWith('/pin/')?'/pin':path.startsWith('/session/recap/')?'/session/recap':path.startsWith('/events/')?path.split('/').slice(0,3).join('/'):path.startsWith('/workItems/')?path.split('/').slice(0,3).join('/'):path;
  return pathAllowed(root,actor.allowedPaths);
}
export function projectOverlay(config:OverlayConfig,overlayId:string,s:Session|undefined,now:string,sceneId=config.activeSceneId,actor?:Actor):OverlayFrame {
  const {overlay,scene,layout}=overlayPair(config,overlayId,sceneId),content=publicContent(s,now);
  return {...overlay,sceneId:scene.id,sceneName:scene.name,configRevision:config.revision,layoutRevision:layout.revision,widgets:layout.widgets.map(w=>({...w,zIndex:widgetZIndex(w),settings:{...w.settings,message:'',detail:''},blocks:w.visible?(widgetPlugin(w.type)?.project({content,scene},w.settings)??[]).filter(b=>permitted(actor,b.path)).map(b=>({...b,path:b.path.startsWith('/widget/')?b.path.replace('/widget/',`/widget/${w.id}/`):b.path})):[]}))};
}
