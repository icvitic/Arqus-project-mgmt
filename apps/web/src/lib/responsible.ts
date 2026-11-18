/**
 * WP1.22 – koraci statusa koje sučelje nudi odgovornoj osobi (zrcalo `RESPONSIBLE_TRANSITIONS` u
 * packages/domain/src/responsible.ts; jedina provjera koja vrijedi je na poslužitelju).
 */
const NEXT: Record<'deliverable' | 'task', Record<string, string[]>> = {
  deliverable: { planned: ['in_progress', 'submitted'], in_progress: ['planned', 'submitted'], rejected: ['in_progress', 'submitted'] },
  task: { planned: ['in_progress', 'done'], in_progress: ['planned', 'done'] },
};
export const responsibleNext = (kind: 'deliverable' | 'task', from: string): string[] => NEXT[kind][from] ?? [];
/** Status zadatka u muškom rodu („zadatak”). */
export const TASK_STATUS: Record<string, string> = { planned: 'planiran', in_progress: 'u tijeku', done: 'gotov', cancelled: 'otkazan' };
