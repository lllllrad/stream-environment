import type { WidgetInstance, WidgetSettings } from './overlay.ts';
import { widgetSettingsSchema } from './overlay.ts';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { ensure } from './errors.ts';

export type WidgetTarget = {overlayId:string;sceneId:string;widgetId:string};
export type Controller = {id:string;role:'controller';name:string;allowedSceneIds:string[];widgets:WidgetTarget[];revoked:boolean;lastUsedAt:string|null;tokenHash?:string};
export type DirectCommand = {requestId:string;expectedConfigRevision:number;sceneId:string;overlayId?:string;widgetId?:string;visible?:boolean;settings?:Partial<WidgetSettings>};
export type DirectReceipt = {ok:true;requestId:string;outcome:'applied'|'no_change';configRevision:number;publication:'published'|'held'|'hidden'|'not_applicable'};
export type DirectContext = {configRevision:number;activeSceneId:string;mode:'auto'|'hold'|'hidden';scenes:{id:string;name:string}[];widgets:(WidgetTarget&{widget:WidgetInstance;settingsKeys:(keyof WidgetSettings)[]})[]};
const id={type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'};
const common={requestId:{type:'string',format:'uuid'},expectedConfigRevision:{type:'integer',minimum:0},sceneId:id};
export const directSceneSchema={type:'object',additionalProperties:false,required:Object.keys(common),properties:common};
export const directWidgetSchema={type:'object',additionalProperties:false,required:[...Object.keys(common),'overlayId','widgetId'],properties:{...common,overlayId:id,widgetId:id,visible:{type:'boolean'},settings:{type:'object',additionalProperties:false,minProperties:1,properties:widgetSettingsSchema.properties}},anyOf:[{properties:{visible:{}},required:['visible']},{properties:{settings:{}},required:['settings']}]};
const ajv=new Ajv({strict:true,allErrors:true});(addFormats as unknown as (a:Ajv)=>void)(ajv);
const validators={scene:ajv.compile<DirectCommand>(directSceneSchema),widget:ajv.compile<DirectCommand>(directWidgetSchema)};
export function parseDirectCommand(action:'scene'|'widget',raw:unknown):DirectCommand{ensure(validators[action](raw),'SCHEMA_VALIDATION','Invalid direct control command.');return structuredClone(raw);}
