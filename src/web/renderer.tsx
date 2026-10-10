import type { CSSProperties } from 'react';
import type { PublicSnapshot } from '../contracts/types.ts';
import './renderer.css';
import { DIMENSIONS } from '../contracts/display.ts';
import { OverlayRenderer } from './overlay-renderer.tsx';
export { DIMENSIONS };
export const STATUS: Record<string, string> = { prepared: '준비', active: '진행 중', paused: '일시정지', ended: '종료', preparing: '준비 중', in_progress: '진행 중', blocked: '확인 필요', complete: '완료', queued: '대기', running: '작업 중', succeeded: '완료 보고', failed: '실패 보고', cancelled: '취소' };
const KIND: Record<string, string> = { topic: '주제 전환', progress: '진행', decision: '결정', result: '결과', correction: '정정' };
export function time(value: string): string { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
export function Broadcast({ snapshot }: { snapshot: PublicSnapshot | null }) {
  if (snapshot?.overlay && snapshot.mode !== 'hidden') return <OverlayRenderer frame={snapshot.overlay}/>;
  if (!snapshot?.content || snapshot.mode === 'hidden') return null;
  const c = snapshot.content, preset = snapshot.preset;
  return <div className={`broadcast preset-${preset} ${snapshot.compact ? 'layout-compact' : ''}`} data-preset={preset}>
    <header className="broadcast-header">
      <div className="broadcast-brand"><span className="brand-mark">F</span><span>오늘의 활동</span></div>
      <span className={`broadcast-status state-${c.status}`}><i />{STATUS[c.status]}</span>
      <h1>{c.title}</h1>
      {preset === 'full' && c.goal && <p className="broadcast-goal">{c.goal}</p>}
    </header>
    <div className="broadcast-body">
      {c.now ? <section className="broadcast-now">
        <div className="section-label"><span className="label-number">01</span> 지금 하는 일</div>
        <h2>{c.now.title}</h2>
        {preset !== 'lower' && c.now.detail && <p className="now-detail">{c.now.detail}</p>}
        <div className="now-footer"><span className={`activity-status state-${c.now.status}`}><i />{STATUS[c.now.status]}</span>
          {preset !== 'lower' && c.now.next && <p className="next-activity"><span>다음</span>{c.now.next}</p>}
        </div>
      </section> : c.status !== 'ended' ? <section className="broadcast-now"><div className="section-label">지금 하는 일</div><h2>활동 준비 중</h2></section> : null}
      {preset !== 'lower' && <>
        {c.recap && c.recap.length > 0 && <section className="broadcast-recap"><div className="section-label"><span className="label-number">02</span> 지금까지</div><ol>{c.recap.map((line, i) => <li key={i}><span className="recap-index">{String(i + 1).padStart(2, '0')}</span><p>{line}</p></li>)}</ol></section>}
        {c.events && c.events.length > 0 && <section className="broadcast-events"><div className="section-label"><span className="label-number">03</span> 주요 사건</div><ul>{c.events.map(e => <li key={e.id}><div className="event-meta"><span>{KIND[e.kind]}</span><time>{time(e.occurredAt)}</time>{e.certainty === 'tentative' && <b>검토 중</b>}</div><p>{e.text}</p></li>)}</ul></section>}
        {c.pin && <section className="broadcast-pin"><div className="section-label">고정 안내</div><p>{c.pin.text}</p></section>}
        {c.workItem && <section className="broadcast-work"><div className="section-label">외부 작업 <span className={`work-state state-${c.workItem.status}`}>{STATUS[c.workItem.status]}</span></div><h3>{c.workItem.title}</h3>{c.workItem.publicResult && <p>{c.workItem.publicResult}</p>}</section>}
      </>}
    </div>
    {preset === 'full' && <footer className="broadcast-footer"><span>FRAME / ACTIVITY</span><span>지금의 활동과, 그 맥락.</span></footer>}
  </div>;
}
export function ScaledPreview({ snapshot, width = 280 }: { snapshot: PublicSnapshot | null; width?: number }) {
  const [w, h] = snapshot?.overlay ? [snapshot.overlay.width,snapshot.overlay.height] : DIMENSIONS[snapshot?.preset ?? 'side']; const ratio = width / w;
  return <div className="preview-scale" style={{ width, height: h * ratio }}><div className="preview-canvas" style={{ width: w, height: h, transform: `scale(${ratio})`, '--canvas-scale': ratio } as CSSProperties}><Broadcast snapshot={snapshot} /></div></div>;
}
