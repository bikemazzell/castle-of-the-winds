/** One bounded ambient timer. Action effects retain their own rAF scheduling. */
export function createAmbient(draw: () => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = false, dead = false;
    const tick = (): void => { timer = undefined; if (!active || dead)
        return; draw(); timer = setTimeout(tick, 1000 / 12); };
    return {
        setActive(value: boolean): void { active = value && !dead; if (!active && timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        } if (active && timer === undefined)
            timer = setTimeout(tick, 1000 / 12); },
        destroy(): void { dead = true; active = false; if (timer !== undefined)
            clearTimeout(timer); timer = undefined; },
    };
}
export function idlePose(kind: string, now: number, id: number, reduced: boolean): {
    x: number;
    y: number;
    height: number;
    width: number;
} {
    if (reduced)
        return { x: 0, y: 0, height: 1, width: 1 };
    const wave = Math.sin(now / 430 + id * 2.399);
    if (kind === 'float')
        return { x: 0, y: wave * 0.045, height: 1, width: 1 };
    if (kind === 'wings')
        return { x: 0, y: wave * 0.025, height: 1, width: 0.90 + wave * 0.10 };
    if (kind === 'pulse')
        return { x: 0, y: 0, height: 0.96 + wave * 0.04, width: 1 - wave * 0.025 };
    return { x: 0, y: 0, height: 0.98 + wave * 0.02, width: 1 };
}
