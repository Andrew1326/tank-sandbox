import type { GunParams, HullParams, SimParams } from '../sim/params';
import type { FlagEvent, KillEvent, ShotEvent, TankInput } from '../sim/tank';
import type { WorldSnap } from '../sim/world';

export const NET_PORT = 9401;
export const SNAP_EVERY = 2; // server ticks per snapshot

export type ClientMsg =
  | { t: 'hello'; hull: string; gun: string; name: string }
  | { t: 'in'; seq: number; i: TankInput }
  | { t: 'ping'; c: number }
  | { t: 'cmd'; c: 'upright' | 'respawn' | 'targets' }
  | { t: 'loadout'; hull: string; gun: string }
  | { t: 'tune'; sim: SimParams; hulls: Record<string, HullParams>; guns: Record<string, GunParams> };

export type ServerMsg =
  | { t: 'welcome'; id: number; map: string; sim: SimParams; hulls: Record<string, HullParams>; guns: Record<string, GunParams> }
  | ({ t: 'snap'; tick: number; ack: number; players: number; shots: ShotEvent[]; kills: KillEvent[]; flagEvents: FlagEvent[]; score: ScoreRow[] } & WorldSnap)
  | { t: 'pong'; c: number }
  | { t: 'tune'; sim: SimParams; hulls: Record<string, HullParams>; guns: Record<string, GunParams> };

export interface ScoreRow { id: number; name: string; team: number; k: number; d: number; caps: number }

export function cleanInput(i: Partial<TankInput> | undefined): TankInput {
  const axis = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);
  return { throttle: axis(i?.throttle), steer: axis(i?.steer), turret: axis(i?.turret), center: !!i?.center, fire: !!i?.fire, boost: !!i?.boost };
}
