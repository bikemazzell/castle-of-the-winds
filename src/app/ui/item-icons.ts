import type { EquipSlot, ItemDefRuntime } from '../../engine/types';
import type { Pixel } from '../render/pixel-art';

const NS = 'http://www.w3.org/2000/svg';
/** Render original pixel artwork without a canvas dependency. */
export function pixelSvg(pixels: readonly Pixel[], size = 32): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  for (const [x, y, width, height, fill] of pixels) {
    const rect = document.createElementNS(NS, 'rect');
    for (const [key, value] of Object.entries({ x, y, width, height, fill })) rect.setAttribute(key, String(value));
    svg.append(rect);
  }
  return svg;
}

/** Small, newly drawn equipment silhouettes in the early Windows RPG style. */
export function itemIcon(def?: ItemDefRuntime, slot?: EquipSlot): HTMLElement {
  const host = document.createElement('span');
  host.className = 'item-icon'; host.setAttribute('aria-hidden', 'true');
  const kind = slot ?? def?.slot ?? (/potion/i.test(def?.name ?? '') ? 'potion' : /scroll/i.test(def?.name ?? '') ? 'scroll' : /arrow|bolt/i.test(def?.name ?? '') ? 'ammo' : 'bag');
  host.dataset.icon = kind;
  const pixels: Pixel[] = [];
  const ink = '#28272d', metal = '#aab7c0', light = '#e4e5cb', brown = '#9a6b3e', gold = '#d1ae57', red = '#9f3b3f';
  const block = (x: number, y: number, w: number, h: number, c: string): void => { pixels.push([x-1,y-1,w+2,h+2,ink],[x,y,w,h,c]); };
  switch (kind) {
    case 'weapon':
      block(8,2,2,9,metal); block(5,10,8,1,gold); block(8,12,2,3,brown); pixels.push([8,2,1,8,light]); break;
    case 'shield':
      block(4,3,9,8,brown); block(6,11,5,2,brown); pixels.push([4,3,9,1,gold],[8,4,1,9,metal],[6,6,5,1,metal]); break;
    case 'armor':
      block(5,4,7,9,metal); block(2,3,3,4,metal); block(12,3,3,4,metal); pixels.push([6,4,2,7,light],[8,12,4,1,brown]); break;
    case 'helm':
      block(4,5,9,6,metal); block(6,3,5,2,metal); pixels.push([4,10,3,3,metal],[11,10,2,3,metal],[5,5,2,4,light],[7,9,4,1,ink]); break;
    case 'boots':
      block(3,4,3,7,brown); block(3,11,5,2,brown); block(10,4,3,7,brown); block(10,11,5,2,brown); break;
    case 'gauntlets':
      block(3,4,3,8,metal); block(6,8,2,3,metal); block(10,4,3,8,metal); block(13,8,2,3,metal); break;
    case 'bracers':
      block(3,4,4,8,brown); block(10,4,4,8,brown); pixels.push([3,5,4,1,metal],[3,10,4,1,metal],[10,5,4,1,metal],[10,10,4,1,metal]); break;
    case 'cloak':
      block(6,3,5,3,red); block(4,6,9,6,red); block(2,12,13,2,red); pixels.push([6,6,1,7,'#d16b61']); break;
    case 'ring1': case 'ring2':
      block(5,5,7,7,gold); pixels.push([7,7,3,3,ink]); block(7,3,3,2,'#67a8be'); break;
    case 'amulet':
      pixels.push([4,2,1,7,gold],[12,2,1,7,gold],[5,9,7,1,gold]); block(7,9,3,4,'#67a8be'); break;
    case 'potion':
      block(7,2,3,4,brown); block(5,6,7,7,'#7fbbba'); pixels.push([6,9,5,3,red],[6,7,1,2,light]); break;
    case 'scroll':
      block(4,4,9,9,'#cdbb86'); block(3,3,9,2,light); block(5,12,9,2,light); pixels.push([6,7,5,1,brown],[6,9,4,1,brown]); break;
    case 'ammo':
      block(8,4,1,10,brown); pixels.push([7,3,3,2,metal],[8,2,1,1,light],[6,11,2,3,light]); break;
    default:
      block(5,3,7,2,brown); block(3,6,11,8,brown); pixels.push([4,7,1,5,gold],[5,5,7,1,gold]);
  }
  host.append(pixelSvg(pixels, 18));
  return host;
}
