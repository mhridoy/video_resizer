// Similarity scores are not calibrated probabilities. Use conservative margins;
// ambiguous photos remain included rather than being dropped to fill a quota.
export const VISION_LABELS = [
  ['an empty shipping container interior with no cargo', 'photos', 0],
  ['a shipping container interior one quarter full of cargo', 'photos', 25],
  ['a shipping container interior half full of cargo', 'photos', 50],
  ['a shipping container interior three quarters full of cargo', 'photos', 75],
  ['a shipping container interior completely full of cargo', 'photos', 100],
  ['closed exterior doors of a shipping container', 'closed', ''],
  ['a close up photograph of a container bolt security seal', 'seals', ''],
  ['a scanned printed document or invoice on paper', 'documents', ''],
  ['an unrelated scene or a close up of cargo without a view of the container interior', 'photos', ''],
];
export function interpretLocalVision(scores) {
  const ranked = scores.filter(x => VISION_LABELS.some(([label]) => label === x.label) && Number.isFinite(x.score) && x.score >= 0 && x.score <= 1).sort((a,b)=>b.score-a.score);
  const top = ranked[0], next = ranked[1];
  if (!top || !next) return { category:'photos', stage:'', confidence:0, reason:'Local model could not classify this view; kept for review.' };
  const [,category,stage] = VISION_LABELS.find(([label])=>label===top.label);
  const certain = top.score >= .85 && top.score-next.score >= .35;
  return { category: certain || (category === 'seals' && top.score >= .7) ? category : 'photos', stage:certain ? stage : '', confidence:top.score,
    reason:certain ? 'Local CLIP visual estimate; verify loading percentage before replacing originals.' : 'Local model is uncertain; photo kept for review.' };
}
