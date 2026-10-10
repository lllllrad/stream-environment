import {useCallback,useEffect,useRef,useState} from 'react';
import type {PublicSnapshot} from '../contracts/types.ts';
import type {OverlayFrame,VisibilityReport} from '../contracts/overlay.ts';
import {OverlayRenderer} from './overlay-renderer.tsx';
import {ScaledPreview} from './renderer.tsx';
import {VisibilityDetails} from './overlay-editor.tsx';

type View='after'|'before'|'published';
const names:Record<View,string>={after:'제안 적용 후',before:'현재 저장된 화면',published:'현재 송출 화면'};
export function ProposalScreen({before,after,published}:{before:PublicSnapshot;after:PublicSnapshot;published:PublicSnapshot|null}){
  const [view,setView]=useState<View>('after'),[zoom,setZoom]=useState('fit'),[expanded,setExpanded]=useState(false),[available,setAvailable]=useState(600),[report,setReport]=useState<VisibilityReport|null>(null);
  const [availableHeight,setAvailableHeight]=useState(window.innerHeight*.65);
  const host=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDialogElement>(null),stableFrame=useRef<{key:string;frame:OverlayFrame}|null>(null);
  const expandButton=useRef<HTMLButtonElement>(null),wasExpanded=useRef(false);
  const snapshot=view==='after'?after:view==='before'?before:published;
  const rawFrame=snapshot?.overlay,key=JSON.stringify(rawFrame);
  // Keep an unchanged scroll animation running across periodic preview refreshes.
  if(rawFrame&&key!==stableFrame.current?.key)stableFrame.current={key,frame:rawFrame};
  const frame=rawFrame?stableFrame.current!.frame:null;
  const width=frame?.width??after.overlay?.width??1920,height=frame?.height??after.overlay?.height??1080,scale=zoom==='fit'?Math.min(1,available/width,availableHeight/height):Number(zoom);
  const measured=useCallback((value:VisibilityReport)=>setReport(value),[]);
  useEffect(()=>{
    const node=host.current;if(!node)return;
    const resize=()=>{const style=getComputedStyle(node);setAvailableHeight(Math.max(1,parseFloat(style.maxHeight)-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth)));};
    const observer=new ResizeObserver(([entry])=>{setAvailable(Math.max(1,entry.contentRect.width));resize();});observer.observe(node);resize();window.addEventListener('resize',resize);
    return()=>{observer.disconnect();window.removeEventListener('resize',resize);};
  },[expanded]);
  useEffect(()=>{if(expanded)dialog.current?.showModal();else{dialog.current?.close();if(wasExpanded.current)expandButton.current?.focus();}wasExpanded.current=expanded;},[expanded]);
  const screen=()=> <>
    <div className="proposal-screen-toolbar">
      <div className="proposal-screen-views" role="group" aria-label="검토 화면 선택">{(['after','before','published'] as View[]).map(value=><button key={value} type="button" className="button quiet" aria-pressed={view===value} disabled={value==='published'&&!published} onClick={()=>setView(value)}>{names[value]}</button>)}</div>
      <label>화면 배율<select aria-label="검토 화면 배율" value={zoom} onChange={e=>setZoom(e.target.value)}><option value="fit">화면에 맞춤</option><option value="0.5">50%</option><option value="1">100% · 원본 크기</option></select></label>
      <button ref={expandButton} type="button" className="button quiet" onClick={()=>setExpanded(v=>!v)}>{expanded?'확대 화면 닫기':'크게 보기'}</button>
    </div>
    <p className="proposal-screen-caption">{names[view]} · {width} × {height}{frame&&` · ${frame.sceneName}`} · {Math.round(scale*100)}%{view==='published'?' · 실제 공개된 화면입니다.':' · 승인 전 검토용 화면입니다.'}</p>
    <div ref={host} className="proposal-screen-viewport" role="region" aria-label="검토 화면 캔버스" data-review-view={view}>
      <div className="proposal-screen-canvas" style={{width:width*scale,height:height*scale}}>
        {frame?<div style={{width,height,transform:`scale(${scale})`,transformOrigin:'top left'}}><OverlayRenderer frame={frame} onMeasured={measured}/></div>:snapshot?<ScaledPreview snapshot={snapshot} width={width*scale}/>:null}
        {view==='published'&&snapshot?.mode==='hidden'&&<div className="proposal-screen-empty">현재 출력이 숨겨져 있습니다.</div>}
      </div>
    </div>
    <p className="muted">체크무늬는 투명 영역입니다. 원본 크기에서는 화면을 스크롤해 글자·잘림·겹침을 확인할 수 있습니다.</p>
    {frame&&<VisibilityDetails report={report}/>}
  </>;
  return <div className="proposal-screen">{!expanded&&screen()}<dialog ref={dialog} className="proposal-screen-dialog" aria-label="제안 화면 확대 검토" onClose={()=>setExpanded(false)}>{expanded&&screen()}</dialog></div>;
}
