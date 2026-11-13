import type {TrapKind,TrapState} from '../../engine/types';
import type {Camera} from './camera';
import type {Ctx2D} from './renderer';
import {PixelArt,type Pixel} from './pixel-art';

export const TRAP_NAMES:Record<TrapKind,string>={pit:'Pit',trap_door:'Trap door',dart:'Dart trap',blade:'Blade trap',fire:'Fire trap',acid:'Acid trap',gas:'Gas trap',poison:'Poison trap',teleport:'Teleport trap'};
const EDGE='#edb15b', DARK='#171920', METAL='#b6b4ab';
const cache=new Map<TrapKind,readonly Pixel[]>();
export function trapPixels(kind:TrapKind):readonly Pixel[]{
  const cached=cache.get(kind);if(cached)return cached;
  const a=new PixelArt();
  a.rect(6,10,20,14,'#49463d');a.rect(8,11,16,11,DARK);
  switch(kind){
    case 'pit':
      for(let x=9;x<24;x+=5){a.rect(x,17,3,4,METAL);a.rect(x+1,14,1,3,METAL);}break;
    case 'trap_door':
      a.rect(8,11,15,10,'#8d7250');for(let x=9;x<23;x+=4)a.rect(x,11,1,10,'#514535');
      a.rect(14,12,2,5,EDGE);a.rect(12,16,6,2,EDGE);a.rect(14,18,2,2,EDGE);break;
    case 'dart':
      a.rect(8,15,13,2,METAL);a.rect(19,12,2,8,EDGE);a.rect(21,14,2,4,EDGE);a.rect(23,15,2,2,EDGE);break;
    case 'blade':
      a.rect(14,8,4,18,METAL);a.rect(7,15,18,4,METAL);a.rect(12,13,8,8,'#7e827f');a.rect(15,16,2,2,DARK);break;
    case 'fire':
      a.rect(10,14,12,8,'#a34b36');a.rect(12,10,8,10,'#e18d47');a.rect(14,7,3,10,'#e18d47');a.rect(14,14,4,7,'#f5d780');break;
    case 'acid':
      a.rect(9,17,14,4,'#6b9654');a.rect(12,15,8,3,'#b5cc73');a.rect(11,10,2,3,'#b5cc73');a.rect(20,12,2,3,'#b5cc73');break;
    case 'gas':
      a.rect(9,17,14,3,'#81966c');a.rect(8,10,6,4,'#a8b394');a.rect(15,7,8,4,'#a8b394');a.rect(18,12,6,3,'#81966c');break;
    case 'poison':
      a.rect(12,9,8,11,'#7a9d85');a.rect(14,6,4,3,METAL);a.rect(14,11,4,4,'#e4d5aa');a.rect(14,12,1,1,DARK);a.rect(17,12,1,1,DARK);break;
    case 'teleport':
      a.rect(10,12,12,2,'#b5a0d4');a.rect(20,14,2,7,'#b5a0d4');a.rect(10,19,10,2,'#b5a0d4');a.rect(10,14,2,5,'#b5a0d4');a.rect(14,15,4,2,'#ded0ef');break;
  }
  cache.set(kind,a.pixels);return a.pixels;
}

export function drawTrap(ctx:Ctx2D,camera:Camera,trap:TrapState,outlineOnly=false):void{
  const cell=camera.worldToScreen(trap.x,trap.y),scale=camera.tile/32;
  const rect=(x:number,y:number,w:number,h:number,color:string)=>{ctx.fillStyle=color;ctx.fillRect(cell.x+x*scale,cell.y+y*scale,w*scale,h*scale);};
  if(!outlineOnly)for(const [x,y,w,h,color] of trapPixels(trap.kind))rect(x,y,w,h,color);
  else for(const [x,y,dx,dy] of [[2,2,1,1],[28,2,-1,1],[2,28,1,-1],[28,28,-1,-1]]){
    rect(x!,y!,2,2,EDGE);rect(x!+dx!*2,y!,4,2,EDGE);rect(x!,y!+dy!*2,2,4,EDGE);
  }
}
