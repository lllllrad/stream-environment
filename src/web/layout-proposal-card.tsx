import { useEffect, useRef, useState } from 'react';
import type { LayoutProposal, LayoutProposalPreview } from '../contracts/layout-proposals.ts';
import { widgetZIndex, widgetsBackToFront, type WidgetInstance } from '../contracts/overlay.ts';
import { ProposalScreen } from './proposal-screen.tsx';
import type { PublicSnapshot } from '../contracts/types.ts';

type Decision = { decision: 'approve' | 'reject'; expectedProposalRevision: number; expectedConfigRevision?: number; expectedLayoutRevision?: number; expectedControlRevision?: number; acknowledgeStale?: boolean; allowDisclosure?: boolean };
type Api = <T>(path: string) => Promise<T>;
const settingsLabels:Record<string,string>={fontSize:'글자 크기',minFontSize:'최소 글자 크기',padding:'여백',maxLines:'최대 줄',overflow:'넘침 동작',background:'배경색',color:'글자색',showDetails:'세부 내용',maxItems:'최대 항목',message:'상태 문구',detail:'상태 설명'};
function WidgetValue({widget,keys}:{widget?:WidgetInstance;keys:string[]}) {
  if(!widget)return <span>위젯 없음</span>;
  return <div><p>{widget.type} · {widget.visible?'표시':'숨김'} · ({widget.x}, {widget.y}) · {widget.width} × {widget.height} · z-index {widgetZIndex(widget)}</p><dl>{Object.entries(widget.settings).filter(([key])=>keys.includes(key)).map(([key,value])=><div key={key}><dt>{settingsLabels[key]??key}</dt><dd>{typeof value==='boolean'?(value?'켜짐':'꺼짐'):String(value)||'없음'}</dd></div>)}</dl></div>;
}
export function LayoutProposalCard({proposal:p,busy,api,decide}:{proposal:LayoutProposal;busy:boolean;api:Api;decide:(input:Decision)=>Promise<void>}) {
  const [open,setOpen]=useState(true),[preview,setPreview]=useState<LayoutProposalPreview|null>(null),[error,setError]=useState(''),[reviewed,setReviewed]=useState(false),[staleReviewed,setStaleReviewed]=useState(false),[disclosureReviewed,setDisclosureReviewed]=useState(false);
  const [published,setPublished]=useState<PublicSnapshot|null>(null);
  const revision=useRef('');
  const [pluginKeys,setPluginKeys]=useState<Record<string,string[]>>({});
  useEffect(()=>{if(!open)return;let cancelled=false;void api<{plugins:{type:string;settingsKeys:string[]}[]}>('/admin/overlays').then(catalog=>{if(!cancelled)setPluginKeys(Object.fromEntries(catalog.plugins.map(p=>[p.type,p.settingsKeys])));}).catch(()=>{});return()=>{cancelled=true;};},[open,api]);
  const keys=(widget?:WidgetInstance)=>['fontSize','minFontSize','padding','maxLines','overflow','background','color',...(widget?pluginKeys[widget.type]??[]:[])];
  useEffect(()=>{
    setPreview(null);setPublished(null);setReviewed(false);setStaleReviewed(false);setDisclosureReviewed(false);revision.current='';
    if(!open)return;let cancelled=false,loading=false;
    const load=()=>{if(loading)return;loading=true;void Promise.all([api<LayoutProposalPreview>(`/admin/layout-proposals/${p.id}/preview`),api<PublicSnapshot>(`/display/${p.change.overlayId}/snapshot`)]).then(([value,output])=>{
      if(cancelled)return;const key=JSON.stringify([value.proposalRevision,value.configRevision,value.layoutRevision,value.controlRevision]);
      if(key!==revision.current){setReviewed(false);setStaleReviewed(false);setDisclosureReviewed(false);revision.current=key;}
      setPreview(value);setPublished(output);setError('');
    }).catch(e=>{if(!cancelled){setPreview(null);setError((e as Error).message);}}).finally(()=>{loading=false;});};
    load();const timer=setInterval(load,2000);return()=>{cancelled=true;clearInterval(timer);};
  },[open,p.id,api]);
  const changed=preview?[...new Set([...preview.beforeWidgets,...preview.afterWidgets].map(w=>w.id))].filter(id=>JSON.stringify(preview.beforeWidgets.find(w=>w.id===id))!==JSON.stringify(preview.afterWidgets.find(w=>w.id===id))):[];
  return <article className="proposal-card layout-proposal-card" aria-label={`레이아웃 제안 ${p.change.provenance.reason}`}><div className="proposal-head"><div><span className="badge">레이아웃 제안</span> <span className="badge">{p.change.provenance.disclosure}</span><h3>{p.change.provenance.reason}</h3><p>{p.change.overlayId} · {p.change.sceneId} · 기준 레이아웃 REV {p.change.baseRevision} · {p.actorId==='anonymous'?'익명 제안 · 제출자 미인증':p.actorId}</p></div></div>
    <button className="button quiet" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'레이아웃 비교 닫기':'레이아웃 비교 열기'}</button>
    {open&&(error?<p role="alert">{error}</p>:!preview?<p role="status">미리보기를 불러오는 중…</p>:<section className="proposal-visual" aria-label="레이아웃 제안 비교"><h4>{preview.after.overlay?.name} · {preview.after.overlay?.width} × {preview.after.overlay?.height} · {preview.after.overlay?.sceneName}</h4><p>현재 레이아웃 REV {preview.layoutRevision} · {preview.stale?'오래된 제안입니다. 현재 구성을 통째로 대체하므로 변경 의도를 다시 확인하세요.':'현재 저장된 레이아웃과 비교합니다.'}</p><p>{preview.publication==='published'?'자동 게시 중입니다. 승인하면 이 씬의 배치가 즉시 송출됩니다.':preview.publication==='held'?'게시 보류 중입니다. 승인한 배치는 게시 재개할 때 반영됩니다.':preview.publication==='hidden'?'출력 숨김 중입니다. 승인한 배치는 게시 재개할 때 반영됩니다.':'현재 송출 선택 씬이 아닙니다. 이 씬을 송출 선택할 때 반영됩니다.'}</p>
      <ProposalScreen before={preview.before} after={preview.after} published={published}/>
      <p>겹침 순서 (뒤 → 앞): {widgetsBackToFront(preview.beforeWidgets).map(w=>`${w.id} (z=${widgetZIndex(w)})`).join(' → ')||'없음'} → 제안: {widgetsBackToFront(preview.afterWidgets).map(w=>`${w.id} (z=${widgetZIndex(w)})`).join(' → ')||'없음'}</p>
      {changed.map(id=><div className="proposal-diff" key={id}><h4>{id}</h4><div className="diff-columns"><div><small>현재</small><WidgetValue widget={preview.beforeWidgets.find(w=>w.id===id)} keys={keys(preview.beforeWidgets.find(w=>w.id===id))}/></div><div><small>제안</small><WidgetValue widget={preview.afterWidgets.find(w=>w.id===id)} keys={keys(preview.afterWidgets.find(w=>w.id===id))}/></div></div></div>)}
      <label className="check-field"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>배치·크기·표시 내용과 잘림·겹침을 검토했습니다.</span></label>
      {preview.stale&&<label className="check-field"><input type="checkbox" checked={staleReviewed} onChange={e=>setStaleReviewed(e.target.checked)}/><span>최신 레이아웃을 제안 구성으로 대체하는 것을 확인했습니다.</span></label>}
      {p.change.provenance.disclosure!=='public'&&<label className="check-field"><input type="checkbox" checked={disclosureReviewed} onChange={e=>setDisclosureReviewed(e.target.checked)}/><span>위젯 문구와 설정이 공개 가능한지 검토하고 허용합니다.</span></label>}
    </section>)}
    <div className="row-actions"><button className="button primary" disabled={busy||!open||!preview||!reviewed||(preview.stale&&!staleReviewed)||(p.change.provenance.disclosure!=='public'&&!disclosureReviewed)} onClick={()=>preview&&void decide({decision:'approve',expectedProposalRevision:preview.proposalRevision,expectedConfigRevision:preview.configRevision,expectedLayoutRevision:preview.layoutRevision,expectedControlRevision:preview.controlRevision,acknowledgeStale:staleReviewed,allowDisclosure:disclosureReviewed})}>레이아웃 승인</button><button className="button" disabled={busy} onClick={()=>void decide({decision:'reject',expectedProposalRevision:p.revision})}>레이아웃 제안 거절</button></div>
  </article>;
}
