import type { Control, Session, SessionExport } from '../contracts/types.ts';

export function sessionExport(session: Session, control: Control, exportedAt = new Date().toISOString()): SessionExport {
  const s = session;
  const workItems = s.workItems.filter(w => !w.retractedAt).map(w => ({ id: w.id, title: w.title, status: w.status, publicResult: w.publicResult }));
  return {
    schemaVersion: '1.0', kind: 'session_content_export', exportedAt, timezone: 'Asia/Seoul',
    publication: control.activeSessionId !== s.id ? 'not_applicable' : control.mode === 'auto' ? 'published' : control.mode === 'hold' ? 'held' : 'hidden',
    session: {
      id: s.id, status: s.status, title: s.title, goal: s.goal, recap: [...s.recap], revision: s.revision, createdAt: s.createdAt, startedAt: s.startedAt, endedAt: s.endedAt,
      lastActivity: s.now ? { title: s.now.title, detail: s.now.detail, status: s.now.status, next: s.now.next } : null,
      pin: s.pin && (!s.pin.expiresAt || s.pin.expiresAt > exportedAt) ? { text: s.pin.text, expiresAt: s.pin.expiresAt } : null,
      events: s.events.filter(e => !e.retractedAt).sort((a,b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id)).map(e => ({ id: e.id, kind: e.kind, text: e.text, occurredAt: e.occurredAt, certainty: e.certainty })),
      workItems, selectedWorkId: workItems.some(w => w.id === s.selectedWorkId) ? s.selectedWorkId : null
    }
  };
}

// Preserve original wording as literal text rather than active HTML/Markdown/link syntax.
function literal(value: string): string {
  return value.replace(/[!-/:-@\[-`{-~]/g, '\\$&');
}

export function exportMarkdown(record: SessionExport): string {
  const s = record.session;
  const lines = ['# Session content export', '', 'This is the current editorial record, not a publication history or a database backup.', 'Original content wording is preserved. Retracted items, expired notices and private operational data are excluded.', '',
    `- **Session ID:** ${literal(s.id)}`, `- **Revision:** ${s.revision}`, `- **Status:** ${s.status}`, `- **Exported at (UTC):** ${record.exportedAt}`, `- **Display timezone:** ${record.timezone}`, `- **Publication state at export:** ${record.publication}`,
    `- **Created at (UTC):** ${s.createdAt}`, `- **Started at (UTC):** ${s.startedAt ?? 'Not started'}`, `- **Ended at (UTC):** ${s.endedAt ?? 'Not ended'}`, '', '## Session', '', `**Title:** ${literal(s.title)}`, '', `**Goal:** ${literal(s.goal)}`, '', '## Recap', ''];
  lines.push(...(s.recap.length ? s.recap.map(text => `- ${literal(text)}`) : ['No recap recorded.']));
  lines.push('', '## Last recorded activity', '');
  if (s.lastActivity) {
    const now = s.lastActivity;
    lines.push(`**Title:** ${literal(now.title)}`, '', `**Detail:** ${literal(now.detail)}`, '', `**Reported status:** ${now.status}`, '', `**Next:** ${now.next ? literal(now.next) : 'Not recorded'}`);
    if (s.status === 'ended') lines.push('', 'The session has ended. This activity is retained as a historical record, not a live activity.');
  } else lines.push('No activity recorded.');
  lines.push('', '## Timeline', '');
  lines.push(...(s.events.length ? s.events.map(e => `- ${e.occurredAt} | ${e.kind} | ${e.certainty} | ${literal(e.text)} (ID: ${literal(e.id)})`) : ['No visible events recorded.']));
  lines.push('', '## Viewer notice', '', s.pin ? literal(s.pin.text) : 'No current notice.');
  if (s.pin?.expiresAt) lines.push('', `**Expires at (UTC):** ${s.pin.expiresAt}`);
  lines.push('', '## Reported external work', '');
  lines.push(...(s.workItems.length ? s.workItems.flatMap(w => [`- **${literal(w.title)}** | ${w.status}${w.id === s.selectedWorkId ? ' | Selected for display' : ''}`, `  - ID: ${literal(w.id)}`, `  - Public result: ${w.publicResult ? literal(w.publicResult) : 'Not recorded'}`]) : ['No visible work recorded.']));
  lines.push('', 'Work statuses are producer reports, not proof of execution or completion.', '');
  return lines.join('\n');
}
