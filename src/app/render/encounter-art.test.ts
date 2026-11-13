import { expect, it } from 'vitest';
import { NPC_ROLES, PROP_KINDS } from '../../engine/map';
import { encounterPixels, propPixels } from './encounter-art';
it('gives each neutral role and discovery distinct original pixel art inside its tile', () => {
    for (const images of [NPC_ROLES.map(encounterPixels), PROP_KINDS.map(propPixels)]) {
        expect(new Set(images.map(p => JSON.stringify(p))).size).toBe(images.length);
        for (const pixels of images) {
            expect(pixels.length).toBeGreaterThan(3);
            for (const [x, y, w, h] of pixels) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(x + w).toBeLessThanOrEqual(32);
                expect(y + h).toBeLessThanOrEqual(32);
            }
        }
    }
});
