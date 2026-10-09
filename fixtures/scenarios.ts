import type { Operation } from '../src/contracts/types.ts';
export type Scenario = { title: string; goal: string; operations: Operation[]; hidden?: boolean };
const fixedTime = '2026-10-09T13:20:00Z';
const activity = { title: '두 설정의 결과 비교', detail: '같은 조건에서 어떤 차이가 생기는지 확인하고 있습니다.', status: 'in_progress' as const, next: '차이가 생기는 조건 정리' };
export const scenarios: Record<string, Scenario> = {
  empty: { title: '활동 준비', goal: '새로운 활동을 준비합니다.', operations: [] },
  minimal: { title: '설정 비교 실험', goal: '같은 조건에서 결과의 차이를 확인합니다.', operations: [{ op: 'set_now', value: activity }] },
  normal: { title: '작은 도구를 만드는 오후', goal: '시청자와 함께 실험하고 결과를 정리합니다.', operations: [
    { op: 'set_now', value: { ...activity, title: '결과를 비교하고 정리하는 중' } },
    { op: 'update_session', fields: { recap: ['비교에 사용할 두 가지 설정을 정했습니다.', '같은 입력에서 결과가 어떻게 달라지는지 확인합니다.', '발견한 차이는 다음 실험의 기준으로 남깁니다.'] } },
    { op: 'upsert_event', event: { id: 'comparison', kind: 'decision', text: '같은 입력과 조건을 유지해 공정하게 비교하기로 했습니다.', occurredAt: fixedTime, certainty: 'confirmed' } },
    { op: 'set_pin', value: { text: '이 화면은 실제 진행 내용을 짧게 정리한 공개용 안내입니다.', expiresAt: null } },
    { op: 'upsert_work_item', workItem: { id: 'research', title: '두 설정의 차이 조사', status: 'running', publicResult: '확인된 내용부터 짧게 정리하고 있습니다.' } }
  ] },
  optional_none: { title: '오늘의 이야기', goal: '지금까지의 맥락을 공유합니다.', operations: [{ op: 'set_now', value: { ...activity, next: null } }, { op: 'update_session', fields: { recap: ['설정 비교를 위한 준비를 마쳤습니다.'] } }] },
  tentative: { title: '비교 결과 검토', goal: '확인되지 않은 해석은 검토 중으로 표시합니다.', operations: [{ op: 'set_now', value: { ...activity, status: 'blocked' } }, { op: 'upsert_event', event: { id: 'tentative', kind: 'result', text: '입력 길이가 차이의 원인일 수 있어 추가 확인이 필요합니다.', occurredAt: fixedTime, certainty: 'tentative' } }] },
  failed: { title: '외부 작업 상태', goal: '공개 가능한 작업 결과만 표시합니다.', operations: [{ op: 'set_now', value: { ...activity, status: 'paused' } }, { op: 'upsert_work_item', workItem: { id: 'failure', title: '비교 자료 정리', status: 'failed', publicResult: '자료 수집을 완료하지 못했습니다. 범위를 줄여 다시 확인할 예정입니다.' } }] },
  maximum: { title: '한글과English😀'.repeat(5).slice(0, 55), goal: '공개 화면의 최대 길이에서도 활동과 맥락을 읽을 수 있도록 여러 종류의 글자를 함께 확인합니다. '.repeat(2).slice(0,100), operations: [
    { op: 'set_now', value: { title: '가나다라마바사아자차카타파하'.repeat(4).slice(0,48), detail: '한글과 English 그리고 😀 이모지를 섞어서 설명을 읽고 화면의 넘침을 확인합니다. '.repeat(3).slice(0,120), status: 'in_progress', next: '다음 활동의 최대 길이도 검토합니다. '.repeat(4).slice(0,60) } },
    { op: 'update_session', fields: { recap: [1,2,3].map(i => `${i}번째 핵심 맥락: `.padEnd(100, '가')) } },
    ...[1,2,3].map(i => ({ op: 'upsert_event' as const, event: { id: `max_${i}`, kind: 'decision' as const, text: `${i}번째 사건 EnglishLONGWORDWITHOUTSPACES`.padEnd(100,'W'), occurredAt: fixedTime, certainty: 'tentative' as const } })),
    { op: 'set_pin', value: { text: '고정 안내의 최대 길이를 확인합니다. '.padEnd(100,'가'), expiresAt: null } },
    { op: 'upsert_work_item', workItem: { id: 'maxwork', title: '공개 작업명의 최대 길이를 확인합니다. '.padEnd(60,'가'), status: 'failed', publicResult: '공개 가능한 실패 결과를 정리하고 있습니다. '.padEnd(160,'W') } }
  ] },
  hidden: { title: '숨겨진 활동', goal: '긴급 숨김에서는 이전 내용이 노출되지 않습니다.', operations: [{ op: 'set_now', value: activity }], hidden: true }
};
scenarios.maximum_work = { ...scenarios.maximum, operations: scenarios.maximum.operations.filter(op=>op.op!=='set_pin') };
scenarios.crowded = { title:'가'.repeat(45),goal:'나'.repeat(75),operations:[
  {op:'set_now',value:{title:'다'.repeat(30),detail:'라'.repeat(80),status:'in_progress',next:'마'.repeat(60)}},
  {op:'update_session',fields:{recap:['바'.repeat(70),'사'.repeat(70),'아'.repeat(70)]}},
  ...[1,2,3].map(i=>({op:'upsert_event' as const,event:{id:`crowded_${i}`,kind:'decision' as const,text:'자'.repeat(70),occurredAt:fixedTime,certainty:'confirmed' as const}})),
  {op:'set_pin',value:{text:'차'.repeat(70),expiresAt:null}}
] };
