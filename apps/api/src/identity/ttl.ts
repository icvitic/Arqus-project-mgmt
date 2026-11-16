/** "8h" / "30m" / "1d" / "3600" → sekunde (isti zapis kao jose setExpirationTime). */
export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(ttl.trim());
  if (!m) throw new Error(`Neispravan AUTH_TOKEN_TTL: ${ttl}`);
  return Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]!]!;
}
