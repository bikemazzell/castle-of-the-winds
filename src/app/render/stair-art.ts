/** Presentation artwork for the two stair tiles; original resources stay intact. */
export function createStairArt(direction: 'up' | 'down'): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 32;
  const ctx = tile.getContext('2d');
  if (!ctx) return tile;
  const rect = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  // Stone frame around a recessed flight, with a landing at the near edge.
  rect(1, 2, 23, 28, '#242723');
  rect(2, 3, 21, 26, '#777565');
  rect(4, 4, 17, 23, '#171d20');
  rect(2, 3, 21, 1, '#b3ad94');
  rect(2, 4, 1, 24, '#aaa58d');
  rect(22, 4, 1, 25, '#44483e');
  const shades = direction === 'up'
    ? ['#c0b79b', '#ada58e', '#999480', '#85836f', '#747361']
    : ['#484d46', '#5a5e52', '#707262', '#898774', '#a5a18a'];
  for (let step = 0; step < 5; step++) {
    const x = 7 - Math.floor(step / 2);
    const width = 11 + 2 * Math.floor(step / 2);
    const y = 6 + step * 4;
    rect(x, y, width, 3, shades[step]!);
    rect(x, y + 3, width, 1, '#30372f');
    rect(x, y, width, 1, direction === 'up' ? '#d0c5a6' : '#92927c');
  }
  rect(3, 27, 19, 2, '#b3ad94');
  rect(4, 28, 17, 1, '#85836f');
  // One outlined arrow, not a repeating brush. Its shape carries direction.
  const arrow = direction === 'up'
    ? ['...#...', '..###..', '.#####.', '#######', '..###..', '..###..', '..###..', '..###..', '..###..']
    : ['..###..', '..###..', '..###..', '..###..', '..###..', '#######', '.#####.', '..###..', '...#...'];
  for (const outline of [true, false]) {
    arrow.forEach((row, y) => [...row].forEach((pixel, x) => {
      if (pixel !== '#') return;
      if (outline) rect(23 + x, 10 + y, 3, 3, '#161d21');
      else rect(24 + x, 11 + y, 1, 1, '#e0c079');
    }));
  }
  return tile;
}
