import type { ContentSource } from '../contracts/source-policy.ts';
import { ensure } from '../contracts/errors.ts';
import { pathAllowed } from '../contracts/validation.ts';

// Trusted source policy plugins. Enforcement is independent of layouts and visibility.
export const CONTENT_SOURCES: ContentSource[] = [
  {id:'session',label:'세션 정보',paths:['/session/title','/session/goal'],defaultPolicy:'proposal_only'},
  {id:'now',label:'현재 활동',paths:['/now'],defaultPolicy:'proposal_only'},
  {id:'recap',label:'지금까지',paths:['/session/recap'],defaultPolicy:'proposal_only'},
  {id:'events',label:'주요 사건',paths:['/events/*'],defaultPolicy:'proposal_only'},
  {id:'pin',label:'고정 안내',paths:['/pin'],defaultPolicy:'proposal_only'},
  {id:'work',label:'외부 작업',paths:['/workItems/*'],defaultPolicy:'proposal_only'}
];
ensure(new Set(CONTENT_SOURCES.map(s=>s.id)).size===CONTENT_SOURCES.length,'SOURCE_CONFIGURATION','Duplicate content source policy ID.');
export function sourcesForPath(path:string):ContentSource[]{return CONTENT_SOURCES.filter(s=>pathAllowed(path,s.paths));}
