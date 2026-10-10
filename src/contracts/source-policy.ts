export type PublicationPolicy = 'proposal_only' | 'apply_allowed';
export type ContentSource = {id:string;label:string;paths:string[];defaultPolicy:PublicationPolicy};
export type EffectiveSource = ContentSource & {policy:PublicationPolicy};
export const publicationPolicies = ['proposal_only','apply_allowed'] as const;
