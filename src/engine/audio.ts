// Audio hook (PLAN.md Task 1.9). Scan of CASTLE1.EXE/CASTLE2.EXE found no
// RIFF/WAVE/MIDI resources (CASTLE.INI exposes a SoundEffects key, but no
// sampled audio ships in the binaries), so the game plays silent. This module
// keeps the engine hook so a future sound source can drop in without touching
// callers. It is a deliberate no-op, not a gap.

export interface AudioHook {
  /** Fire-and-forget effect playback. Silent by design. */
  playSfx(_name: string): void;
}

export const silentAudio: AudioHook = {
  playSfx() {
    /* intentional no-op: no audio resources exist in the originals */
  },
};
