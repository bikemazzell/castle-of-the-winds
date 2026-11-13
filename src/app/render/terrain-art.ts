import { PixelArt, pixelCanvas, type Pixel } from './pixel-art';
import { createStairArt } from './stair-art';

/** New 32px terrain. Resource-style keys remain stable for saved tile definitions. */
export function terrainPixels(name: string): Pixel[] {
  const a = new PixelArt();
  const base: Record<string, string> = {bm120:'#353b3b',bm124:'#514d43',bm6:'#394f35',bm2:'#786c53',bm182:'#293f50',bm5:'#263e30',bm213:'#373e39'};
  if (!base[name]) throw new Error(`Unknown terrain: ${name}`);
  a.rect(0, 0, 32, 32, base[name]);
  // Fixed arithmetic adds texture without consuming the simulation RNG.
  for (let k = 0; k < 38; k++) {
    const x = (k * 19 + k * k * 3) % 31, y = (k * 7 + Math.floor(k / 3) * 5) % 31;
    a.rect(x, y, 1 + k % 2, 1, k % 3 ? '#ffffff09' : '#00000016');
  }
  if (name === 'bm120') {
    for (let row = 0; row < 4; row++) {
      const y = row * 8;
      a.rect(0,y,32,1,'#242b2c');
      a.rect(0,y+1,32,1,'#69706a');
      a.rect(0,y+7,32,1,'#2d3334');
      for (let x = row % 2 ? 7 : 15; x < 32; x += 16) {
        a.rect(x,y+1,1,6,'#252b2d'); if (x+1<32) a.rect(x+1,y+2,1,5,'#59615c');
      }
    }
  } else if (name === 'bm124' || name === 'bm2') {
    for (let k=0;k<8;k++) {
      const x=(k*11+3)%27, y=(k*17+5)%29;
      a.rect(x,y,3+k%2,2,name==='bm124'?'#666154':'#8d8167');
      a.rect(x+1,y+2,3,1,'#00000020');
    }
  } else if (name === 'bm6' || name === 'bm5') {
    for(let k=0;k<15;k++) {
      const x=(k*13+2)%28,y=(k*7+4)%28;
      a.rect(x,y+2,3,1,name==='bm6'?'#4a663e':'#38563a');
      a.rect(x+1,y,1,3,name==='bm6'?'#60734b':'#496847');
    }
    if(name==='bm5') for(let k=0;k<5;k++) {
      a.rect(3+k*6,5+k%3*8,4,3,'#182e25');
      a.rect(3+k*6,4+k%3*8,3,1,'#638052');
    }
  } else if (name === 'bm182') {
    for(let k=0;k<7;k++) {
      const x=(k*7+2)%23,y=k*4+2;
      a.rect(x,y,7,1,'#4b6773'); a.rect(x+3,y+1,5,1,'#345463');
    }
  } else if (name === 'bm213') {
    a.rect(3,1,26,31,'#282d2c'); a.rect(4,2,24,29,'#77786a');
    a.rect(7,4,18,28,'#694e38');
    for(let x=8;x<25;x+=4) { a.rect(x,5,1,26,'#947153'); a.rect(x+2,5,1,27,'#47392f'); }
    a.rect(7,9,18,2,'#333b3d'); a.rect(7,24,18,2,'#333b3d');
    a.rect(21,17,2,3,'#c6ad70'); a.rect(4,2,24,2,'#a3a08a');
  }
  return a.pixels;
}
export function createTerrainArt(name: string): HTMLCanvasElement {
  if(name==='bm220') return createStairArt('up');
  if(name==='bm221') return createStairArt('down');
  return pixelCanvas(terrainPixels(name));
}
