import { createRoot } from 'react-dom/client';
import { OverlayRenderer } from './overlay-renderer.tsx';
import type { OverlayFrame, VisibilityReport } from '../contracts/overlay.ts';
declare global {interface Window {__frame:OverlayFrame;__report?:VisibilityReport}}
createRoot(document.getElementById('root')!).render(<OverlayRenderer frame={window.__frame} onMeasured={report=>{window.__report=report;}}/>);
