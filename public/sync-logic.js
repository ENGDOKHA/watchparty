// Shared sync math — loaded by the browser AND by unittest.js in Node.
// Kept pure (no DOM, no network) so it can be tested directly.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Tuning
  const SOFT_DRIFT = 0.35;       // below this: do nothing (avoids constant fiddling)
  const HARD_DRIFT = 2.5;        // above this: jump, we're too far off to ease back
  const HARD_COOLDOWN_MS = 4000; // never hard-jump more often than this (kills ping-pong)
  const SOFT_RATE = 0.05;        // ±5% speed nudge for gentle catch-up
  const MAX_SKIP = 90;           // cap a stall catch-up skip (seconds)

  /**
   * Decide how to correct playback.
   * drift = myTime - groupTime  (positive = I'm ahead)
   * Returns { action:'none'|'soft'|'hard', rate }
   */
  function decide(drift, now, lastHardAt) {
    const a = Math.abs(drift);
    if (!isFinite(drift)) return { action: 'none', rate: 1 };
    if (a > HARD_DRIFT && (now - lastHardAt) >= HARD_COOLDOWN_MS) {
      return { action: 'hard', rate: 1 };
    }
    if (a > SOFT_DRIFT) {
      // If I'm ahead, slow down slightly; if behind, speed up slightly.
      return { action: 'soft', rate: drift > 0 ? 1 - SOFT_RATE : 1 + SOFT_RATE };
    }
    return { action: 'none', rate: 1 };
  }

  // Map between my copy's timeline and the shared "movie timeline".
  // offset = how far my copy is ahead of the shared timeline (e.g. longer intro).
  function toMovieTime(localTime, offset) { return localTime - offset; }
  function toLocalTime(movieTime, offset) { return movieTime + offset; }

  // After a buffering stall, how far to skip forward to rejoin the group.
  // We continue from where the group is, instead of resuming where we froze.
  function stallSkip(stalledMs) {
    const s = Math.max(0, stalledMs) / 1000;
    return Math.min(s, MAX_SKIP);
  }

  // Should this incoming message be applied, or is it stale/out of order?
  function isFresh(seq, lastSeq) {
    return typeof seq !== 'number' || seq > lastSeq;
  }

  // ---- quality selection (per viewer, never shared) ----
  function resNum(q) {
    const m = String((q && (q.resolution || q.name)) || '').match(/(\d+)/);
    return m ? +m[1] : -1;
  }
  function qKey(q) { return String((q && (q.name || q.resolution)) || ''); }

  function playable(list) {
    return (Array.isArray(list) ? list : []).filter(q => q && q.videoUrl);
  }
  function bestQuality(list) {
    const ps = playable(list);
    if (!ps.length) return null;
    return [...ps].sort((a, b) => resNum(a) - resNum(b)).pop();
  }
  /**
   * Pick the stream this viewer should get: their remembered preference when the
   * title offers it, otherwise the best available. Falls back to null if nothing plays.
   */
  function chooseQuality(list, preferredKey) {
    const ps = playable(list);
    if (!ps.length) return null;
    if (preferredKey) {
      const hit = ps.find(q => qKey(q) === preferredKey);
      if (hit) return hit;
    }
    return bestQuality(ps);
  }
  // Highest first, for the dropdown.
  function sortedQualities(list) {
    return playable(list).sort((a, b) => resNum(b) - resNum(a));
  }

  return {
    decide, toMovieTime, toLocalTime, stallSkip, isFresh,
    resNum, qKey, bestQuality, chooseQuality, sortedQualities,
    SOFT_DRIFT, HARD_DRIFT, HARD_COOLDOWN_MS, MAX_SKIP,
  };
});
