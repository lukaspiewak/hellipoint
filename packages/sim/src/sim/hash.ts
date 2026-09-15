import type { SimState } from './state.js';

/**
 * FNV-1a nad kanoniczną serializacją stanu mutowalnego.
 * Liczby zmiennoprzecinkowe hashowane po bitach, nie po reprezentacji dziesiętnej —
 * test determinizmu ma wykrywać różnice na poziomie ULP, nie dopiero na drugim miejscu po przecinku.
 */
export function stateHash(s: SimState): string {
  const h = new Fnv();

  h.int(s.tick);
  h.float(s.ore);
  h.float(s.storedEnergy);
  h.float(s.evacCharge);
  h.float(s.evacAlarmRemaining);
  h.int(s.evacUnlockTick);
  h.float(s.killsBySun);
  h.float(s.killsByTurret);
  h.str(s.phase);
  h.int(s.nextUnitId);

  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b === null) continue;
    h.int(i);
    h.str(b.type);
    h.float(b.hp);
    h.int(b.powered ? 1 : 0);
  }

  for (let i = 0; i < s.oreRemaining.length; i++) {
    if (s.oreRemaining[i] === 0) continue;
    h.int(i);
    h.float(s.oreRemaining[i]);
  }

  for (const p of s.pentagons) {
    h.float(p.spawnAccumulator);
    h.float(p.eruptionCooldown);
    h.int(p.eruptionArmed ? 1 : 0);
  }

  for (const u of s.units) {
    h.int(u.id);
    h.str(u.type);
    h.int(u.cellId);
    h.float(u.pos.x); h.float(u.pos.y); h.float(u.pos.z);
    h.float(u.hp);
    h.float(u.exposure);
  }

  return h.digest();
}

class Fnv {
  private hash = 0x811c9dc5;
  private readonly buf = new DataView(new ArrayBuffer(8));

  private byte(b: number): void {
    this.hash ^= b & 0xff;
    this.hash = Math.imul(this.hash, 0x01000193) >>> 0;
  }

  int(v: number): void {
    this.buf.setInt32(0, v | 0);
    for (let i = 0; i < 4; i++) this.byte(this.buf.getUint8(i));
  }

  float(v: number): void {
    this.buf.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.byte(this.buf.getUint8(i));
  }

  str(v: string): void {
    for (let i = 0; i < v.length; i++) this.byte(v.charCodeAt(i));
    this.byte(0);
  }

  digest(): string {
    return (this.hash >>> 0).toString(16).padStart(8, '0');
  }
}
