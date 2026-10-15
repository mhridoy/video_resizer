export const LOADING_STAGES = [0, 25, 50, 75, 100];
export const PHOTOS_PER_STAGE = 4;

export function similarPhotos(a, b) {
  if (!a || !b || Math.abs(a.aspect - b.aspect) > 0.04) return false;
  const distance = a.hash.reduce((sum, bit, i) => sum + (bit !== b.hash[i] ? 1 : 0), 0);
  const colorDistance = a.colors.reduce((sum, value, i) => sum + Math.abs(value - b.colors[i]), 0) / a.colors.length;
  return distance <= 5 && colorDistance < 12;
}

// Stage comes from vision or a manual selection, never file order. Call once per
// shipment/source. Unknown photos and all non-loading evidence remain available.
export function suggestLoadingPhotos(items) {
  const decisions = new Map();
  const stageOf = item => item.manualStage ?? item.ai?.stage ?? '';
  for (const stage of LOADING_STAGES) {
    const candidates = items.filter(item => item.kind === 'image' && item.category === 'photos' && stageOf(item) === stage)
      .sort((a, b) => (b.ai?.quality || 0) - (a.ai?.quality || 0) || a.path.localeCompare(b.path, undefined, { numeric: true }));
    const kept = [];
    for (const photo of candidates) {
      const duplicate = kept.find(other => similarPhotos(photo.fingerprint, other.fingerprint)
        || photo.ai?.duplicateOf === String(other.id) || other.ai?.duplicateOf === String(photo.id));
      const included = !duplicate && kept.length < PHOTOS_PER_STAGE;
      if (included) kept.push(photo);
      decisions.set(photo.id, { included, stage, selectionReason: duplicate
        ? `Similar to ${duplicate.file?.name || duplicate.path}` : included
          ? `${stage}%: selected distinct photo (${kept.length}/${PHOTOS_PER_STAGE})`
          : `${stage}%: four better distinct photos retained` });
    }
  }
  return items.map(item => ({ id: item.id, ...(decisions.get(item.id) || {
    included: true, stage: '', selectionReason: item.category === 'photos'
      ? 'Stage uncertain: kept for review; no percentage invented.' : 'Kept: video, seal, closed doors or document',
  }) }));
}
