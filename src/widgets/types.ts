import type { WidgetBlock, WidgetContext, WidgetSettings } from '../contracts/overlay.ts';

// Trusted build-time plugins receive only public-shaped content, never credentials/audit/provenance.
export type WidgetPlugin = {type:string;version:number;label:string;description:string;sourcePaths:string[];settingsKeys:(keyof WidgetSettings)[];defaults?:Partial<WidgetSettings>;directControl?:{settingsKeys:(keyof WidgetSettings)[]};project:(context:WidgetContext,settings:WidgetSettings)=>WidgetBlock[]};
