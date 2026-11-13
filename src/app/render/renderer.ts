import { drawActionFeedback, type ActionCue } from './action-feedback';
import { movementPosition } from './movement';
import { idlePose } from './ambient';
import { creatureAppearance } from './creature-catalog';
import { drawEnvironmentTile } from './environment-art';
import type { Environment } from './environment';
import type { TownBuilding } from '../scenes/town';
import { drawImpacts, type Impact } from './impacts';
/**
 * Canvas map renderer: draws the seen/visible level around the player using
 * tile sprites from the extracted game art. Rendering is fully injected
 * (context, sprites, scheduler) so it tests headlessly and integrates with
 * any canvas source.
 */

import { idx, LEVEL_SIZE, type Entity, type Level } from '../../engine/map';
import type { Camera, Point } from './camera';
import { TILE_FLOOR, TILE_STAIRS_DOWN, TILE_STAIRS_UP } from '../../engine/dungeon';
import { actorSpriteName } from './actor-art';

/** Minimal 2D-context surface the renderer needs (mockable). */
export interface Ctx2D {
  fillStyle: string;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

export interface TileStyle {
  sprite?: string | null;
}

export interface SceneInput {
  /** Debug view only; never changes the engine's visibility planes. */
  revealMap?: boolean;
  visual?: { seed:number;turn:number;now:number;reduced:boolean;environment?:Environment;buildings?:TownBuilding[];hero?:unknown;impacts?:readonly Impact[] };
  level: Level;
  /** 4096-byte seen/memory plane. */
  seen: Uint8Array;
  /** 4096-byte currently-visible plane. */
  visible: Uint8Array;
  player: Point;
  playerGender?: 'male' | 'female';
  entities?: Entity[];
  /** Optional, bounded turn effects. Omit when reduced motion is enabled. */
  animation?: { player?: ActorMotion; entities?: ReadonlyMap<number, ActorMotion> };
  groundItems?: { x: number; y: number }[];
  /** Detect Monsters: mark seen-but-unseen monsters with a dim marker. */
  sense?: boolean;
  /** Route/selection overlay (UI plan Phase 4). Drawn only on seen cells. */
  overlay?: RouteOverlay;
}

/** A presentation effect, independent of the authoritative turn state. */
export interface ActorMotion {
  kind: 'move' | 'attack' | 'hit';
  progress: number;
  from?: Point;
  source?: Point;
  path?: Point[];
  direction?: Point;
}

/** What the controller wants highlighted on the map. */
export interface RouteOverlay {
  feedback?: {cues:ActionCue[];progress:number};
  /** Cell pending touch confirmation (selection ring). */
  selected?: Point;
  /** Route cells to tint (preview or active travel queue). */
  route?: Point[];
  /** Final destination cell (accent ring). */
  destination?: Point;
  /** Cell that will be attacked (danger ring). */
  attack?: Point;
  /** Spell targeting (UI plan Phase 6): valid-cell tint + selected cell. */
  targeting?: { cell?: Point };
  /** Brief cast feedback (UI plan Phase 6): tinted cells fading out. */
  flash?: { cells: Point[]; alpha: number; color?: string };
}

export interface RenderStyles {
  /** tile byte (decimal string) -> style. */
  tiles: Record<string, TileStyle>;
  /** sprite name -> drawable image. */
  sprites: Record<string, unknown>;
}

const BG = '#000';
const FALLBACK_KNOWN = '#3a3450';
const FALLBACK_UNKNOWN = '#05030a';
const FOG_ALPHAS = [0, 0.42, 0.60, 0.74, 0.86] as const;

function isVisible(visible: Uint8Array, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < LEVEL_SIZE && y < LEVEL_SIZE && Boolean(visible[idx(x, y)]);
}

/** Search at most three cells around a remembered tile, never the full level. */
function memoryShade(visible: Uint8Array, x: number, y: number): number {
  for (let distance = 1; distance <= 3; distance++) {
    for (let dy = -distance; dy <= distance; dy++) {
      for (let dx = -distance; dx <= distance; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
        if (isVisible(visible, x + dx, y + dy)) return FOG_ALPHAS[distance]!;
      }
    }
  }
  return FOG_ALPHAS[4];
}

/** Feather inside known cells only; the unknown side remains fully opaque. */
function featherFog(ctx: Ctx2D, visible: Uint8Array, wx: number, wy: number, x: number, y: number, tile: number): void {
  const width = Math.max(1, Math.floor(tile / 12));
  for (let band = 0; band < 3; band++) {
    ctx.fillStyle = `rgba(4,2,10,${(3 - band) * 0.09})`;
    const inset = band * width;
    if (!isVisible(visible, wx - 1, wy)) ctx.fillRect(x + inset, y, width, tile);
    if (!isVisible(visible, wx + 1, wy)) ctx.fillRect(x + tile - inset - width, y, width, tile);
    if (!isVisible(visible, wx, wy - 1)) ctx.fillRect(x, y + inset, tile, width);
    if (!isVisible(visible, wx, wy + 1)) ctx.fillRect(x, y + tile - inset - width, tile, width);
  }
}

function actorOffset(scene: SceneInput, position: Point, motion?: ActorMotion): Point {
  if (!motion || !Number.isFinite(motion.progress)) return { x: 0, y: 0 };
  const progress = Math.max(0, Math.min(1, motion.progress));
  if (progress === 1) return { x: 0, y: 0 };
  if (motion.kind === 'move' && motion.from) {
    const source=motion.source??motion.from;
    if(Math.abs(source.x-position.x)+Math.abs(source.y-position.y)!==1 || !scene.seen[idx(source.x,source.y)] || !isVisible(scene.visible,source.x,source.y)) return {x:0,y:0};
    const displayed=movementPosition(position,motion);
    return {x:displayed.x-position.x,y:displayed.y-position.y};
  }
  if (motion.kind === 'attack' && motion.direction) {
    const dx = Math.sign(motion.direction.x);
    const dy = Math.sign(motion.direction.y);
    if (!isVisible(scene.visible, position.x + dx, position.y + dy)) return { x: 0, y: 0 };
    const amount = Math.sin(progress * Math.PI) * 0.24;
    return { x: dx * amount, y: dy * amount };
  }
  if (motion.kind === 'hit') return { x: Math.sin(progress * Math.PI * 4) * (1 - progress) * 0.055, y: 0 };
  return { x: 0, y: 0 };
}

function drawActor(ctx: Ctx2D, camera: Camera, scene: SceneInput, position: Point, image: unknown, motion?: ActorMotion, identity = 0, idle = 'breathe'): void {
  const cell = camera.worldToScreen(position.x, position.y);
  const offset = actorOffset(scene, position, motion);
  // Integer offsets retain the original pixel edges through every frame.
  const pose = scene.visual && !motion ? idlePose(idle, scene.visual.now, identity, scene.visual.reduced) : {x:0,y:0,height:1,width:1};
  const height = Math.round(camera.tile * pose.height), width = Math.round(camera.tile * pose.width);
  ctx.drawImage(image, cell.x + Math.round(offset.x * camera.tile + (camera.tile-width)/2), cell.y + Math.round(offset.y * camera.tile + pose.y*camera.tile + camera.tile-height), width, height);
}
const ENTITY_COLORS: Record<string, string> = {
  monster: '#e05656',
  npc: '#7bd88f',
};
const PLAYER_COLOR = '#ffd76a';
const ITEM_COLOR = '#c9a86a';
const ROUTE_TINT = 'rgba(216,181,109,0.3)';
const DESTINATION_RING = '#d8b56d'; // accent
const SELECTION_RING = '#f1e8d6'; // ink
const ATTACK_RING = '#ef7b78'; // danger
const TARGET_TINT = 'rgba(132,183,242,0.10)'; // mana, faint
const TARGET_RING = '#84b7f2'; // mana
const FLASH_COLOR = 'rgba(216,181,109,0.55)'; // accent, brief cast feedback
const SENSE_MONSTER = '#9a5b5b'; // Detect Monsters: dim, distinct from live markers

function marker(
  ctx: Ctx2D,
  camera: Camera,
  x: number,
  y: number,
  color: string,
  fraction: number,
): void {
  const cell = camera.worldToScreen(x, y);
  const size = camera.tile * fraction;
  const inset = (camera.tile - size) / 2;
  ctx.fillStyle = color;
  ctx.fillRect(cell.x + inset, cell.y + inset, size, size);
}

/** Hollow square (4 border rects) around a cell. */
function ring(
  ctx: Ctx2D,
  camera: Camera,
  x: number,
  y: number,
  color: string,
): void {
  const cell = camera.worldToScreen(x, y);
  const t = Math.max(2, Math.floor(camera.tile / 8));
  ctx.fillStyle = color;
  ctx.fillRect(cell.x, cell.y, camera.tile, t);
  ctx.fillRect(cell.x, cell.y + camera.tile - t, camera.tile, t);
  ctx.fillRect(cell.x, cell.y + t, t, camera.tile - 2 * t);
  ctx.fillRect(cell.x + camera.tile - t, cell.y + t, t, camera.tile - 2 * t);
}

/** Draw one full frame of the map viewport. */
export function renderFrame(
  ctx: Ctx2D,
  camera: Camera,
  scene: SceneInput,
  styles: RenderStyles,
): void {
  const { tile } = camera;
  if (scene.revealMap) {
    const revealed = new Uint8Array(LEVEL_SIZE * LEVEL_SIZE).fill(1);
    scene = { ...scene, seen: revealed, visible: revealed };
  }
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, camera.cols * tile, camera.rows * tile);

  for (let row = 0; row < camera.rows + Number(!Number.isInteger(camera.originY)); row++) {
    for (let col = 0; col < camera.cols + Number(!Number.isInteger(camera.originX)); col++) {
      const wx = Math.floor(camera.originX) + col;
      const wy = Math.floor(camera.originY) + row;
      if (wx >= LEVEL_SIZE || wy >= LEVEL_SIZE) continue;
      const i = idx(wx, wy);
      if (!scene.seen[i]) continue;

      const {x:sx,y:sy} = camera.worldToScreen(wx,wy);
      const def = styles.tiles[String(scene.level.tiles[i] ?? 0)];
      const img = def?.sprite ? styles.sprites[def.sprite] : undefined;
      if (img !== undefined) {
        const tileKind = scene.level.tiles[i];
        if (tileKind === TILE_STAIRS_UP || tileKind === TILE_STAIRS_DOWN) {
          const floorName = styles.tiles[String(TILE_FLOOR)]?.sprite;
          const floor = floorName ? styles.sprites[floorName] : undefined;
          if (floor) ctx.drawImage(floor, sx, sy, tile, tile);
        }
        ctx.drawImage(img, sx, sy, tile, tile);
      } else {
        ctx.fillStyle = def ? FALLBACK_KNOWN : FALLBACK_UNKNOWN;
        ctx.fillRect(sx, sy, tile, tile);
      }
      if (scene.visual) drawEnvironmentTile(ctx, {tileKind:scene.level.tiles[i]!,x:wx,y:wy,sx,sy,tile,
        seed:scene.visual.seed,level:scene.level,now:scene.visual.now,reduced:scene.visual.reduced,
        visible:!!scene.visible[i],environment:scene.visual.environment,buildings:scene.visual.buildings,turn:scene.visual.turn});
      if (!scene.visible[i]) {
        ctx.fillStyle = `rgba(4,2,10,${memoryShade(scene.visible, wx, wy)})`;
        ctx.fillRect(sx, sy, tile, tile);
      } else if (!scene.revealMap) {
        featherFog(ctx, scene.visible, wx, wy, sx, sy, tile);
      }
    }
  }

  if (scene.visual?.impacts) drawImpacts(ctx,camera,scene.visual.impacts,scene.seen,scene.visible,scene.visual.now,scene.visual.reduced);

  for (const item of scene.groundItems ?? []) {
    if (scene.seen[idx(item.x, item.y)]) {
      marker(ctx, camera, item.x, item.y, ITEM_COLOR, 0.4);
    }
  }

  // Actors (monsters/NPCs) draw only on CURRENTLY VISIBLE cells: they move,
  // so remembered-but-not-visible cells show terrain without them (A08).
  // Exception: a Detect Monsters sense marks seen-but-unseen monsters with a
  // distinct dim marker — kept visually separate from true visibility (Task 4).
  // Ground items stay seen-based: they are static knowledge.
  for (const entity of scene.entities ?? []) {
    if (scene.visible[idx(entity.x, entity.y)]) {
      const sprite = styles.sprites[actorSpriteName(entity.name)] ?? styles.sprites['actor:unknown'];
      if (sprite) {
        drawActor(ctx, camera, scene, entity, sprite, scene.animation?.entities?.get(entity.id),entity.id,creatureAppearance(entity.name).idle);
      } else {
        marker(ctx, camera, entity.x, entity.y, ENTITY_COLORS[entity.kind] ?? ENTITY_COLORS.monster!, 0.6);
      }
    } else if (scene.sense && entity.kind === 'monster' && scene.seen[idx(entity.x, entity.y)]) {
      marker(ctx, camera, entity.x, entity.y, SENSE_MONSTER, 0.4);
    }
  }

  // Route/selection overlay — drawn only on SEEN cells so overlays can never
  // reveal hidden map or actors (Phase 4 acceptance).
  const overlay = scene.overlay;
  if (overlay) {
    for (const step of overlay.route ?? []) {
      if (!scene.seen[idx(step.x, step.y)]) continue;
      const cell = camera.worldToScreen(step.x, step.y);
      ctx.fillStyle = ROUTE_TINT;
      ctx.fillRect(cell.x, cell.y, tile, tile);
    }
    if (overlay.destination && scene.seen[idx(overlay.destination.x, overlay.destination.y)]) {
      ring(ctx, camera, overlay.destination.x, overlay.destination.y, DESTINATION_RING);
    }
    if (overlay.selected && scene.seen[idx(overlay.selected.x, overlay.selected.y)]) {
      ring(ctx, camera, overlay.selected.x, overlay.selected.y, SELECTION_RING);
    }
    if (overlay.attack && scene.seen[idx(overlay.attack.x, overlay.attack.y)]) {
      ring(ctx, camera, overlay.attack.x, overlay.attack.y, ATTACK_RING);
    }
    if (overlay.targeting) {
      // Valid-target hint: a faint tint over every currently VISIBLE cell
      // (attack spells may target any visible cell — engine rule, UI plan §8).
      // Camera-window cells only; never over remembered fog.
      for (let row = 0; row < camera.rows + Number(!Number.isInteger(camera.originY)); row++) {
        for (let col = 0; col < camera.cols + Number(!Number.isInteger(camera.originX)); col++) {
          const wx = Math.floor(camera.originX) + col;
          const wy = Math.floor(camera.originY) + row;
          if (wx >= LEVEL_SIZE || wy >= LEVEL_SIZE) continue;
          if (!scene.visible[idx(wx, wy)]) continue;
          const cell = camera.worldToScreen(wx, wy);
          ctx.fillStyle = TARGET_TINT;
          ctx.fillRect(cell.x, cell.y, tile, tile);
        }
      }
      const sel = overlay.targeting.cell;
      if (sel && scene.seen[idx(sel.x, sel.y)]) {
        ring(ctx, camera, sel.x, sel.y, TARGET_RING);
      }
    }
    if (overlay.flash && overlay.flash.alpha > 0) {
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = overlay.flash.alpha;
      ctx.fillStyle = overlay.flash.color ?? FLASH_COLOR;
      for (const cell of overlay.flash.cells) {
        if (!scene.seen[idx(cell.x, cell.y)]) continue;
        const s = camera.worldToScreen(cell.x, cell.y);
        ctx.fillRect(s.x, s.y, tile, tile);
        // Deterministic sparks stay inside the affected known cell.
        const progress = Math.max(0, Math.min(1, 1 - overlay.flash.alpha));
        const radius = tile * (0.08 + progress * 0.30);
        const size = Math.max(1, Math.round(tile / 16));
        ctx.fillStyle = '#fff0bd';
        for (let spark = 0; spark < 6; spark++) {
          const angle = spark * Math.PI / 3 + progress * 0.7;
          ctx.fillRect(Math.round(s.x + tile / 2 + Math.cos(angle) * radius - size / 2),
            Math.round(s.y + tile / 2 + Math.sin(angle) * radius - size / 2), size, size);
        }
        ctx.fillStyle = overlay.flash.color ?? FLASH_COLOR;
      }
      ctx.globalAlpha = prevAlpha;
    }
  }

  const hero = scene.visual?.hero ?? styles.sprites[`actor:hero:${scene.playerGender ?? 'female'}`]
    ?? styles.sprites['actor:hero'];
  if (hero) {
    drawActor(ctx, camera, scene, scene.player, hero, scene.animation?.player);
  } else {
    marker(ctx, camera, scene.player.x, scene.player.y, PLAYER_COLOR, 0.6);
  }
  if (overlay?.feedback) drawActionFeedback(ctx,camera,overlay.feedback.cues,scene.visible,overlay.feedback.progress);
}

export interface Renderer {
  /** Flag the scene as changed; the loop redraws on its next tick. */
  markDirty(): void;
  /** Draw immediately (used by tests and one-shot renders). */
  renderOnce(): void;
  /** Begin the rAF loop (no-op draws while clean). */
  start(): void;
  stop(): void;
}

/**
 * Dirty-flag render loop (F24): a frame is scheduled ONLY when the scene is
 * dirty — idle scenes schedule nothing. `markDirty` arms one pump; repeated
 * calls coalesce; dirtiness raised DURING a draw chains exactly one more
 * frame; `stop` cancels any pending pump and `start` reschedules if the dirty
 * flag survived. Driven by an injected scheduler (requestAnimationFrame in
 * the app).
 */
export function createRenderer(
  draw: () => void,
  schedule: (cb: () => void) => number,
  cancel: (handle: number) => void,
): Renderer {
  let dirty = true;
  let running = false;
  let handle: number | null = null;

  const pump = (): void => {
    handle = null;
    if (dirty) {
      dirty = false;
      draw();
    }
    // The draw closure may have marked the scene dirty again (flash fades,
    // reentrant markDirty) — chain exactly one follow-up frame for that.
    if (running && dirty && handle === null) handle = schedule(pump);
  };

  return {
    markDirty(): void {
      dirty = true;
      if (running && handle === null) handle = schedule(pump);
    },
    renderOnce(): void {
      dirty = false;
      draw();
    },
    start(): void {
      if (running) return;
      running = true;
      if (dirty && handle === null) handle = schedule(pump);
    },
    stop(): void {
      running = false;
      if (handle !== null) {
        cancel(handle);
        handle = null;
      }
    },
  };
}
