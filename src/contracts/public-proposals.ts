import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { ensure } from './errors.ts';
import { DEFAULT_SETTINGS, widgetInstanceSchema, type WidgetInstance, type OverlayConfig } from './overlay.ts';
import { layoutChangeSchema, type LayoutChange } from './layout-proposals.ts';
import { LIMITS, normalize } from './validation.ts';
import type { EffectiveSource } from './source-policy.ts';
import type { PublicSnapshot, Session } from './types.ts';
import type { WidgetPlugin } from '../widgets/types.ts';

export type PublicWidget = Omit<WidgetInstance,'settings'> & {settings?:Partial<WidgetInstance['settings']>};
export type PublicLayoutChange = Omit<LayoutChange,'widgets'> & {widgets:PublicWidget[]};
export type PublicProposalContext = {session:Pick<Session,'id'|'status'|'revision'>|null;aiWritesEnabled:boolean;limits:typeof LIMITS;sources:EffectiveSource[];plugins:Omit<WidgetPlugin,'project'>[];config:Omit<OverlayConfig,'layouts'> & {layouts:(Omit<OverlayConfig['layouts'][number],'widgets'> & {widgets:PublicWidget[]})[]};outputs:PublicSnapshot[]};
export const publicWidgetSchema={...widgetInstanceSchema,required:widgetInstanceSchema.required.filter(k=>k!=='settings'),properties:{...widgetInstanceSchema.properties,settings:{...widgetInstanceSchema.properties.settings,required:[],description:'Partial settings. Omitted keys on an existing widget retain their stored values, including private captions. New instances use normal defaults.'}}};
export const publicLayoutChangeSchema={...layoutChangeSchema,title:'PublicLayoutChange',properties:{...layoutChangeSchema.properties,widgets:{...layoutChangeSchema.properties.widgets,items:publicWidgetSchema,description:'Complete widget array for operator review. Omitted existing settings are retained; geometry/order/visibility are explicit. Omitted instances are proposed for removal.'}}};
const ajv=new Ajv({strict:true,allErrors:true});(addFormats as unknown as (a:Ajv)=>void)(ajv);
const validate=ajv.compile<PublicLayoutChange>(publicLayoutChangeSchema);
export function parsePublicLayoutChange(raw:unknown):PublicLayoutChange{
  ensure(Buffer.byteLength(JSON.stringify(raw)??'')<=LIMITS.maxBytes,'BODY_TOO_LARGE','Request exceeds 64 KiB.');
  const value=normalize(raw);ensure(validate(value),'SCHEMA_VALIDATION','Invalid public layout proposal contract.');return value;
}
export function mergePublicWidgets(widgets:PublicWidget[],existing:WidgetInstance[]):WidgetInstance[]{
  return widgets.map(widget=>({...widget,settings:{...DEFAULT_SETTINGS,...existing.find(w=>w.id===widget.id)?.settings,...widget.settings}}));
}
