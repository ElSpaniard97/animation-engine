// Timeline math for a sequence of shots played back to back. Pure, so it is shared by preview,
// export and tests. A shot only needs a numeric `settings.duration` (seconds) here.

export const MAX_SHOTS = 50;

const length = (shot) => +shot.settings.duration;

/** Length of the whole sequence in seconds. */
export function totalDuration(shots) {
  return shots.reduce((sum, shot) => sum + length(shot), 0);
}

/** Time in the sequence where shot `index` begins. */
export function shotStart(shots, index) {
  return totalDuration(shots.slice(0, index));
}

/**
 * The shot playing at sequence time `t` and the time inside it. A cut belongs to the shot that
 * starts there; the very end of the sequence belongs to the last shot.
 */
export function shotAt(shots, t) {
  let start = 0;
  for (let index = 0; index < shots.length; index++) {
    const end = start + length(shots[index]);
    if (t < end || index === shots.length - 1)
      return { index, local: Math.min(Math.max(t - start, 0), end - start) };
    start = end;
  }
  return null;
}

/** Returns a copy of `shots` with the shot at `from` moved to `to` (clamped to the ends). */
export function moveShot(shots, from, to) {
  const result = [...shots];
  const [shot] = result.splice(from, 1);
  result.splice(Math.max(0, Math.min(to, result.length)), 0, shot);
  return result;
}

/** "m:ss" for the transport and timeline. */
export function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

export const TRANSITION_SECONDS = 0.5;

/**
 * What is on screen at sequence time `t`: the shot under the playhead plus, during the first
 * TRANSITION_SECONDS of a shot that fades or crossfades in, how far in it is (`mix`, 0–1).
 * A crossfade blends from the previous shot, which keeps playing past its end (`previous`);
 * the first shot has nothing to blend from, so it fades in from black instead.
 */
export function frameAt(shots, t) {
  const at = shotAt(shots, t);
  if (!at) return null;
  const transition = shots[at.index].settings.transition || 'cut';
  if (transition === 'cut' || at.local >= TRANSITION_SECONDS) return { ...at, transition: 'cut', mix: 1 };
  const mix = at.local / TRANSITION_SECONDS;
  if (transition === 'crossfade' && at.index > 0) {
    const index = at.index - 1;
    return { ...at, transition, mix, previous: { index, local: length(shots[index]) + at.local } };
  }
  return { ...at, transition: 'fade', mix };
}
