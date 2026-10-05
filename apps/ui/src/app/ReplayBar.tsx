/** Playback controls for a ReplayAdapter: play/pause, step, speed, scrub. Keys: p . s 0 e. */
import { useEffect, useState } from 'preact/hooks';
import type { PlaybackState, ReplayAdapter } from '../adapters/replay';
import { KeyHint } from '../components/KeyHint';
import { msText } from '../lib/format';
import { useKeys } from '../lib/keys';

export function ReplayBar({ replay }: { replay: ReplayAdapter }) {
  const [st, setSt] = useState<PlaybackState>(replay.state);
  useEffect(() => replay.subscribe(setSt), [replay]);
  useKeys({
    p: () => replay.toggle(),
    '.': () => replay.step(),
    s: () => replay.cycleSpeed(),
    '0': () => replay.seek(0),
    e: () => replay.toEnd(),
  });
  return (
    <div class="replay" role="group" aria-label="Replay controls">
      <button type="button" class="btn" onClick={() => replay.toggle()} aria-keyshortcuts="p">
        {st.playing ? 'Pause' : 'Play'} <KeyHint keys="p" />
      </button>
      <button type="button" class="btn" onClick={() => replay.step()} aria-keyshortcuts=".">
        Step <KeyHint keys="." />
      </button>
      <button type="button" class="btn" onClick={() => replay.cycleSpeed()} aria-keyshortcuts="s">
        {st.speed}× speed <KeyHint keys="s" />
      </button>
      <input
        type="range"
        min={0}
        max={st.total}
        value={st.pos}
        aria-label="Replay position (events delivered)"
        onInput={(e) => replay.seek(Number((e.target as HTMLInputElement).value))}
      />
      <span>
        event {st.pos} of {st.total} · {msText(st.t)} of {msText(st.duration)} on the event timeline
      </span>
    </div>
  );
}
