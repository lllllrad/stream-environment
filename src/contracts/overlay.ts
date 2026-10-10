import type { PublicContent, PublicSnapshot } from './types.ts';

export type Overflow = 'clip' | 'ellipsis' | 'shrink' | 'scroll';
export type WidgetSettings = {fontSize:number;minFontSize:number;padding:number;maxLines:number;overflow:Overflow;background:string;color:string;showDetails:boolean;maxItems:number;message:string;detail:string};
export type WidgetInstance = {id:string;type:string;x:number;y:number;width:number;height:number;visible:boolean;settings:WidgetSettings};
export type Overlay = {id:string;name:string;width:number;height:number};
export type Scene = {id:string;name:string};
export type Layout = {overlayId:string;sceneId:string;revision:number;widgets:WidgetInstance[]};
export type OverlayConfig = {revision:number;activeSceneId:string;overlays:Overlay[];scenes:Scene[];layouts:Layout[]};
export type WidgetBlock = {path:string;text:string;role:'heading'|'body'|'label';expiresAt?:string|null};
export type RenderedWidget = WidgetInstance & {blocks:WidgetBlock[]};
export type OverlayFrame = {id:string;name:string;width:number;height:number;sceneId:string;sceneName:string;configRevision:number;layoutRevision:number;widgets:RenderedWidget[]};
export type WidgetContext = {content:PublicContent|null;scene:Scene};
export type Rect = {x:number;y:number;width:number;height:number};
export type FieldVisibility = {path:string;text:string;visibleText:string;totalCodePoints:number;visibleCodePoints:number;visibleRanges:{start:number;end:number}[];truncated:boolean;fontSize:number;rect:Rect};
export type WidgetVisibility = {id:string;type:string;rect:Rect;visible:boolean;overflow:Overflow;scrolling:boolean;overlaps:string[];fields:FieldVisibility[]};
export type VisibilityReport = {width:number;height:number;overlayId:string;sceneId:string;configRevision:number;layoutRevision:number;widgets:WidgetVisibility[]};
export type RenderPreview = {snapshot:PublicSnapshot;sessionRevision:number;configRevision:number;changedPaths:string[];hypothetical:true;report?:VisibilityReport;image?:{mimeType:'image/png';base64:string}};

export const DEFAULT_SETTINGS: WidgetSettings = {fontSize:26,minFontSize:16,padding:20,maxLines:3,overflow:'ellipsis',background:'#1b2220',color:'#f3f5ed',showDetails:true,maxItems:3,message:'잠시 자리 비움',detail:'곧 돌아오겠습니다.'};
export const widgetSettingsSchema = {type:'object',additionalProperties:false,required:Object.keys(DEFAULT_SETTINGS),properties:{
  fontSize:{type:'integer',minimum:12,maximum:80},minFontSize:{type:'integer',minimum:12,maximum:80},padding:{type:'integer',minimum:0,maximum:64},maxLines:{type:'integer',minimum:1,maximum:20},overflow:{enum:['clip','ellipsis','shrink','scroll']},background:{type:'string',pattern:'^(#[0-9a-fA-F]{6}|transparent)$'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},showDetails:{type:'boolean'},maxItems:{type:'integer',minimum:1,maximum:10},message:{type:'string',maxLength:160},detail:{type:'string',maxLength:300}
}};
export const widgetInstanceSchema = {type:'object',additionalProperties:false,required:['id','type','x','y','width','height','visible','settings'],properties:{id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'},type:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,59}$'},x:{type:'integer',minimum:0},y:{type:'integer',minimum:0},width:{type:'integer',minimum:48,maximum:3840},height:{type:'integer',minimum:32,maximum:2160},visible:{type:'boolean'},settings:widgetSettingsSchema}};
