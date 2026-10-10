import type { OverlayFrame, RenderPreview } from '../contracts/overlay.ts';

// Render the real geometry privately, then redact ungranted fields from reports/images.
// A WeakMap prevents this source from becoming a serializable API response property.
const sources=new WeakMap<RenderPreview,OverlayFrame>();
export function inspectionSource(preview:RenderPreview){return sources.get(preview)??preview.snapshot.overlay!;}
export function attachInspection(preview:RenderPreview,frame:OverlayFrame){sources.set(preview,frame);return preview;}
