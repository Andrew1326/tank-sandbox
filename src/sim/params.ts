// Hull numbers are in metres, kilograms, seconds and degrees.
export interface HullParams {
  name: string;
  halfW: number;
  halfH: number;
  halfL: number;
  mass: number;
  topSpeed: number;
  accel: number;
  reverseAccel: number;
  coastDecel: number;
  lateralAccel: number;
  turnSpeed: number;
  turnAccel: number;
  antiTurnAccel: number;
  comY: number;
  hp: number;
  stability: number; // multiplies resistance to being tipped and pitched
}

export interface GunParams {
  name: string;
  kind: 'hitscan' | 'projectile' | 'stream' | 'sniper';
  damage: number; // per hit, or per second for a stream
  reload: number; // seconds between shots, not counting the delay
  delay: number; // charge-up between pressing fire and the shot
  impact: number; // N·s on the target
  recoil: number; // N·s on the shooter
  turretSpeed: number;
  turretAccel: number;
  range: number;
  projSpeed: number; // projectile guns only
  // stream guns only
  cone: number; // half-angle of the spray, degrees
  tank: number; // seconds of continuous fire in a full tank
  refill: number; // seconds to refill from empty
  temp: number; // how fast it heats (+) or chills (-) the target, per second
  pierce: number; // how many tanks a shot goes on through after the first
  pierceKeep: number; // share of damage and impact left after each one
  // sniper only: `delay` is the time to bring the scope up, `damage` the quick unscoped shot
  maxDamage: number; // a fully charged scoped shot
  scopeCharge: number; // seconds in the scope to reach full charge
  scopeTurn: number; // share of turret speed left while scoped, for fine aim
}

export interface SimParams {
  gravity: number;
  suspFreq: number;
  suspDamping: number;
  clearance: number;
  droop: number;
  raysPerSide: number;
  trackInset: number;
  gripFullDeg: number;
  gripZeroDeg: number;
  driveHeight: number;
  sideHeight: number;
  invertSteerInReverse: boolean;
  angularDamping: number;
  impactShove: number; // share of a hit that moves the target bodily; the turning part is always kept
  impactTilt: number; // 1 = hit pushes where it lands, 0 = pushes through the centre of mass height
  respawnTime: number;
  spawnShield: number;
  burnDps: number; // damage per second to a fully heated tank
  heatFade: number; // how fast heat wears off, per second
  coldFade: number;
  freezeSlow: number; // share of speed lost when fully frozen
  flagReturn: number; // seconds a dropped flag waits before going home
  pitchUp: number; // how far the gun can be raised, degrees
  pitchDown: number;
  pitchSpeed: number; // degrees per second
  autoAimUp: number;
  autoAimDown: number;
  boostSpeed: number;
  boostAccel: number;
  boostTime: number;
  shoveAbsorb: number;
  shoveThreshold: number;
  pushHold: number;
  pushDrag: number;
}

export const HULLS: Record<string, HullParams> = {
  Dart: {
    name: 'Dart', halfW: 1.15, halfH: 0.38, halfL: 1.75, mass: 2200,
    topSpeed: 10, accel: 8.5, reverseAccel: 12, coastDecel: 8, lateralAccel: 27,
    turnSpeed: 130, turnAccel: 190, antiTurnAccel: 350, comY: -0.18, stability: 3, hp: 190,
  },
  Ranger: {
    name: 'Ranger', halfW: 1.4, halfH: 0.45, halfL: 2.0, mass: 2600,
    topSpeed: 7.5, accel: 7.5, reverseAccel: 10, coastDecel: 7, lateralAccel: 18.5,
    turnSpeed: 115, turnAccel: 170, antiTurnAccel: 300, comY: -0.12, stability: 1, hp: 270,
  },
  Anvil: {
    name: 'Anvil', halfW: 1.75, halfH: 0.55, halfL: 2.3, mass: 5000,
    topSpeed: 4.5, accel: 6, reverseAccel: 8, coastDecel: 7, lateralAccel: 14,
    turnSpeed: 85, turnAccel: 130, antiTurnAccel: 250, comY: -0.15, stability: 1, hp: 330,
  },
};

// Slug: the all-rounder. Lance: slow charged shot that hits very hard. Pulse: a stream of slow bolts for close range.
export const GUNS: Record<string, GunParams> = {
  Slug: { name: 'Slug', kind: 'hitscan', damage: 60, reload: 1.5, delay: 0, impact: 7000, recoil: 3500, turretSpeed: 90, turretAccel: 400, range: 300, projSpeed: 0, cone: 0, tank: 0, refill: 0, temp: 0, pierce: 0, pierceKeep: 1, maxDamage: 0, scopeCharge: 0, scopeTurn: 1 },
  Lance: { name: 'Lance', kind: 'hitscan', damage: 170, reload: 4.2, delay: 0.9, impact: 15000, recoil: 9000, turretSpeed: 60, turretAccel: 300, range: 400, projSpeed: 0, cone: 0, tank: 0, refill: 0, temp: 0, pierce: 4, pierceKeep: 0.75, maxDamage: 0, scopeCharge: 0, scopeTurn: 1 },
  Pulse: { name: 'Pulse', kind: 'projectile', damage: 16, reload: 0.28, delay: 0, impact: 1300, recoil: 350, turretSpeed: 115, turretAccel: 500, range: 85, projSpeed: 70, cone: 0, tank: 0, refill: 0, temp: 0, pierce: 0, pierceKeep: 1, maxDamage: 0, scopeCharge: 0, scopeTurn: 1 },
  // Hawk: hold fire to look down the scope; the tank stands still and the shot builds up. A tap fires a weak snap shot.
  Hawk: { name: 'Hawk', kind: 'sniper', damage: 45, reload: 3, delay: 0.3, impact: 9000, recoil: 5000, turretSpeed: 75, turretAccel: 350, range: 500, projSpeed: 0, cone: 0, tank: 0, refill: 0, temp: 0, pierce: 0, pierceKeep: 1, maxDamage: 200, scopeCharge: 2.2, scopeTurn: 0.3 },
  // Ember sets the target alight: it glows, and keeps burning after the flame stops.
  Ember: { name: 'Ember', kind: 'stream', damage: 48, reload: 0, delay: 0, impact: 0, recoil: 0, turretSpeed: 120, turretAccel: 500, range: 17, projSpeed: 0, cone: 11, tank: 5, refill: 7, temp: 0.6, pierce: 0, pierceKeep: 1, maxDamage: 0, scopeCharge: 0, scopeTurn: 1 },
  // Frost does less damage but ices the target up, slowing its tracks and turret.
  Frost: { name: 'Frost', kind: 'stream', damage: 36, reload: 0, delay: 0, impact: 0, recoil: 0, turretSpeed: 120, turretAccel: 500, range: 17, projSpeed: 0, cone: 11, tank: 6, refill: 8, temp: -0.55, pierce: 0, pierceKeep: 1, maxDamage: 0, scopeCharge: 0, scopeTurn: 1 },
};

export const defaultSim = (): SimParams => ({
  gravity: 9.81,
  suspFreq: 1.9,
  suspDamping: 0.55,
  clearance: 0.28,
  droop: 0.22,
  raysPerSide: 4,
  trackInset: 0.18,
  gripFullDeg: 40,
  gripZeroDeg: 55,
  driveHeight: 0.6,
  sideHeight: 0.3,
  invertSteerInReverse: false,
  angularDamping: 0.3,
  impactShove: 0.35,
  impactTilt: 0.4,
  respawnTime: 4,
  spawnShield: 2,
  burnDps: 20,
  heatFade: 0.22,
  coldFade: 0.18,
  freezeSlow: 0.75,
  flagReturn: 20,
  pitchUp: 22,
  pitchDown: 10,
  pitchSpeed: 40,
  autoAimUp: 3,
  autoAimDown: 3,
  boostSpeed: 1.4,
  boostAccel: 1.4,
  boostTime: 30,
  shoveAbsorb: 0,
  shoveThreshold: 1.5,
  pushHold: 3,
  pushDrag: 3,
});
