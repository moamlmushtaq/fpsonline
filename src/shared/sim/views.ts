// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — read-only views of the simulation for the network layer:
// compact quantized PlayerSnaps, pickup snaps, scoreboard rows and results.
// ─────────────────────────────────────────────────────────────────────────────

import { activeWeapon } from '../combat';
import { SIM_DT } from '../constants';
import { q2, q3 } from '../math';
import type { ScoreboardRow } from '../protocol';
import type { GameConfig, MatchResults, PlayerResult, PlayerSnap, Team } from '../types';
import {
  PF_ADS,
  PF_AIR,
  PF_ALIVE,
  PF_CHARGING,
  PF_CROUCH,
  PF_MANTLE,
  PF_PROTECTED,
  PF_RELOAD,
  PF_SLIDE,
  PF_SPRINT,
  PF_SWAP,
  WEAPON_IDS,
} from '../types';
import type { SimPlayer } from './player';

const WEAPON_INDEX = new Map(WEAPON_IDS.map((w, i) => [w, i] as const));

/** Compact remote-player state (positions 0.01 m, angles 0.001 rad). View angles exclude recoil. */
export function playerSnap(p: SimPlayer): PlayerSnap {
  const m = p.move;
  const c = p.combat;
  let f = 0;
  if (p.alive) f |= PF_ALIVE;
  if (m.crouch) f |= PF_CROUCH;
  if (m.slideT > 0) f |= PF_SLIDE;
  if (m.sprint) f |= PF_SPRINT;
  if (c.adsT > 0.5) f |= PF_ADS;
  if (c.reloadT > 0) f |= PF_RELOAD;
  if (!m.onGround) f |= PF_AIR;
  if (m.mantleT > 0) f |= PF_MANTLE;
  if (p.protectedT > 0) f |= PF_PROTECTED;
  if (c.chargeT > 0) f |= PF_CHARGING;
  if (c.swapT > 0) f |= PF_SWAP;
  return {
    id: p.ident.id,
    x: q2(m.pos.x),
    y: q2(m.pos.y),
    z: q2(m.pos.z),
    vx: q2(m.vel.x),
    vy: q2(m.vel.y),
    vz: q2(m.vel.z),
    yaw: q3(p.lastCmd.yaw),
    pitch: q3(p.lastCmd.pitch),
    f,
    w: WEAPON_INDEX.get(activeWeapon(c)) ?? 0,
    hp: Math.max(0, Math.ceil(p.health)),
    c: Math.round(m.crouchT * 100),
  };
}

/** Scoreboard rows (ping is filled in by the Room). */
export function scoreboardRows(players: readonly SimPlayer[]): ScoreboardRow[] {
  return players.map((p) => ({
    id: p.ident.id,
    kills: p.stats.kills,
    deaths: p.stats.deaths,
    assists: p.stats.assists,
    score: p.stats.score,
    objectiveTime: Math.round(p.stats.objectiveTime),
    ping: 0,
  }));
}

/** Match results; players sorted by score (MVP first). */
export function buildResults(
  config: GameConfig,
  simPlayers: readonly SimPlayer[],
  outcome: { winner: Team; winnerPlayer: number; draw: boolean },
  teamScores: readonly [number, number],
  liveTicks: number,
): MatchResults {
  const players: PlayerResult[] = simPlayers
    .map((p) => ({
      id: p.ident.id,
      name: p.ident.name,
      team: p.ident.team,
      faction: p.ident.faction,
      isBot: p.ident.isBot,
      level: p.ident.level,
      namecard: p.ident.cosmetics.namecard,
      stats: { ...p.stats, objectiveTime: Math.round(p.stats.objectiveTime * 10) / 10 },
    }))
    .sort((a, b) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths || a.id - b.id);
  return {
    mode: config.mode,
    map: config.map,
    winner: outcome.winner,
    winnerPlayer: outcome.winnerPlayer,
    draw: outcome.draw,
    teamScores: [Math.floor(teamScores[0]), Math.floor(teamScores[1])],
    players,
    mvp: players.length ? players[0].id : -1,
    duration: Math.round(liveTicks * SIM_DT),
  };
}
