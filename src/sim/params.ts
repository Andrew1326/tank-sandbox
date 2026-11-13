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
  stability: number; // multiplies resistance to being tipped and pitched
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
  turretSpeed: number;
  turretAccel: number;
  fireDelay: number;
  reload: number;
  impact: number;
  recoil: number;
  range: number;
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
    turnSpeed: 130, turnAccel: 190, antiTurnAccel: 350, comY: -0.18, stability: 3,
  },
  Ranger: {
    name: 'Ranger', halfW: 1.4, halfH: 0.45, halfL: 2.0, mass: 2600,
    topSpeed: 7.5, accel: 7.5, reverseAccel: 10, coastDecel: 7, lateralAccel: 18.5,
    turnSpeed: 115, turnAccel: 170, antiTurnAccel: 300, comY: -0.12, stability: 1,
  },
  Anvil: {
    name: 'Anvil', halfW: 1.75, halfH: 0.55, halfL: 2.3, mass: 5000,
    topSpeed: 4.5, accel: 6, reverseAccel: 8, coastDecel: 7, lateralAccel: 14,
    turnSpeed: 85, turnAccel: 130, antiTurnAccel: 250, comY: -0.15, stability: 1,
  },
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
  turretSpeed: 90,
  turretAccel: 400,
  fireDelay: 0.0,
  reload: 1.5,
  impact: 7000,
  recoil: 3500,
  range: 300,
  autoAimUp: 8,
  autoAimDown: 10,
  boostSpeed: 1.4,
  boostAccel: 1.4,
  boostTime: 30,
  shoveAbsorb: 0,
  shoveThreshold: 1.5,
  pushHold: 3,
  pushDrag: 3,
});
