/** Cosmetic selection visits every line once without consuming game randomness. */
export function speechIndex(length: number, seed: number, sequence: number, key: string): number {
    if (length <= 1) return 0;
    let hash = seed >>> 0;
    for (const letter of key) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0;
    let stride = hash % length || 1;
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    while (gcd(stride, length) !== 1) stride++;
    const step = Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) % length : 0;
    return (hash % length + step * stride) % length;
}
