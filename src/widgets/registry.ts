import type { WidgetPlugin } from './types.ts';
import { awayWidget } from './away.ts';
import type { WidgetBlock, WidgetContext, WidgetSettings } from '../contracts/overlay.ts';

const status: Record<string,string> = {prepared:'준비',active:'진행 중',paused:'일시정지',ended:'종료',preparing:'준비 중',in_progress:'진행 중',blocked:'확인 필요',complete:'완료',queued:'대기',running:'작업 중',succeeded:'완료 보고',failed:'실패 보고',cancelled:'취소'};
const block=(path:string,text:string|undefined|null,role:WidgetBlock['role']='body'):WidgetBlock[]=>text?[{path,text,role}]:[];
const define=(type:string,label:string,description:string,sourcePaths:string[],settingsKeys:WidgetPlugin['settingsKeys'],project:WidgetPlugin['project']):WidgetPlugin=>({type,label,description,sourcePaths,settingsKeys,version:1,project});
// Register new trusted modules here; the core editor/projection need no per-plugin branches.
export const WIDGET_PLUGINS: WidgetPlugin[] = [
  define('session','세션 정보','Session title and optional goal.',['/session/title','/session/goal'],['showDetails'],({content:c},s)=>[...block('/session/title',c?.title,'heading'),...(s.showDetails?block('/session/goal',c?.goal):[])]),
  define('now','현재 활동','Current activity, optional detail/next action, and reported status.',['/now'],['showDetails'],({content:c},s)=>c?.now?[...block('/now/title',c.now.title,'heading'),...(s.showDetails?[...block('/now/detail',c.now.detail),...block('/now/next',c.now.next)]:[]),...block('/now/status',status[c.now.status],'label')]:[]),
  define('recap','지금까지','A bounded list of recap lines.',['/session/recap'],['maxItems'],({content:c},s)=>(c?.recap??[]).slice(0,s.maxItems).flatMap((text,i)=>block(`/session/recap/${i}`,text))),
  define('events','주요 사건','Recent non-retracted timeline items with uncertainty preserved.',['/events/*'],['maxItems'],({content:c},s)=>(c?.events??[]).slice(0,s.maxItems).flatMap(e=>[...block(`/events/${e.id}/text`,e.text),...(e.certainty==='tentative'?block(`/events/${e.id}/certainty`,'검토 중','label'):[])])),
  define('pin','고정 안내','An unexpired viewer notice.',['/pin'],[],({content:c})=>c?.pin?[{path:'/pin/text',text:c.pin.text,role:'body',expiresAt:c.pin.expiresAt}]:[]),
  define('work','외부 작업','Selected or latest non-retracted reported work.',['/workItems/*'],['showDetails'],({content:c},s)=>c?.workItem?[...block(`/workItems/${c.workItem.id}/title`,c.workItem.title,'heading'),...(s.showDetails?block(`/workItems/${c.workItem.id}/publicResult`,c.workItem.publicResult):[]),...block(`/workItems/${c.workItem.id}/status`,status[c.workItem.status],'label')]:[]),
  awayWidget
];
if(new Set(WIDGET_PLUGINS.map(p=>p.type)).size!==WIDGET_PLUGINS.length) throw new Error('Duplicate widget plugin type.');
export function widgetPlugin(type:string):WidgetPlugin|undefined{return WIDGET_PLUGINS.find(p=>p.type===type);}
export function widgetCatalog(){return WIDGET_PLUGINS.map(({project,...metadata})=>metadata);}
