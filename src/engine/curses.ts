/** Optional player dialogue. Never advances world time or any random generator. */
export const CURSE_LINES = {
  hurt: [
    'Fuck! That was load-bearing skin!',
    'You rusty bastard! I was using that rib!',
    'Shit on a shipwreck, that hurt!',
    'Ow, fuck! My blood belongs on the inside!',
    'Bollocks! That bruise had only just healed!',
    'You hit like a mule with a fucking grudge!',
  ],
  surprised: [
    'What the fuck crawled out of that corner?',
    'Shit! Give a sailor some warning!',
    'Well, fuck my compass. That was not on the map.',
    'Where in the bastard deep did you come from?',
    'Fuck! I nearly jumped out of my own boots!',
    'Surprise, my arse! Try knocking next time!',
  ],
  trap: [
    'Who left this fucking hole in the floor?',
    'Shit! The architecture has turned against me!',
    'Bollocks to whoever wired that bastard thing!',
    'A trap. Of course. Why have a normal fucking corridor?',
    'Fuck this floor and the mason who laid it!',
    'I have sailed through storms with fewer fucking spikes!',
  ],
  victory: [
    'Down you go, you noisy bastard!',
    'Ha! Put that in your fucking prophecy!',
    'Still standing, still swearing. Fucking excellent!',
    'That is one less bastard between me and a drink!',
    'Fuck yes! Somebody ring the dinner bell!',
    'Victory tastes like dust and a shitload of relief!',
  ],
  combat: [
    'Come on, you bastard! I have a tavern to get back to!',
    'I have fought nastier shit over the last biscuit!',
    'Hold still, you slippery fuck!',
    'A fair fight? Fuck that, I brought a weapon!',
    'Your face is making a very fucking persuasive target!',
    'I am too sober for this shit!',
  ],
  search: [
    'More fucking dust. At least it is free.',
    'There had better be gold under this shit.',
    'A bone. Wonderful. The floor is shedding its fucking skeleton.',
    'Where did the clever bastard hide the latch?',
    'I found fuck-all, but I found it thoroughly.',
    'This wall is full of shit. Possibly also a door.',
  ],
  idle: [
    'My feet hurt, my flask is empty, and this place smells like shit.',
    'I could be on a beach. A fucking beach.',
    'Who builds this many stairs? A bastard with wings?',
    'Even the rats look fed up with this shit.',
    'A quiet moment. Nobody fucking ruin it.',
    'Bollocks. I forgot what I came down here for.',
  ],
  barter: [
    'That much? Does it steer the fucking ship as well?',
    'I asked for a price, not a fucking ransom!',
    'I have paid less for a boat with fewer holes than this shit.',
    'Throw in a drink and we might have a fucking deal.',
    'For that price, the bastard thing had better polish itself.',
    'My purse just said fuck off. I am inclined to agree.',
  ],
} as const;
export type CurseContext = keyof typeof CURSE_LINES;

/** Consecutive sequence values rotate through unique lines, including at wraparound. */
export function curseLine(seed: number, sequence: number, context: CurseContext, speaker: string): string {
  const lines = CURSE_LINES[context];
  const step = Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) : 0;
  const offset = ((Math.imul(seed, 2654435761) >>> 0) % lines.length + step % lines.length) % lines.length;
  return `${speaker}: ${lines[offset]}`;
}
