// HALCYON FRONT — game mode definitions (architecture contract, see ARCHITECTURE.md).

import type { BotDifficulty, GameConfig, MapId, ModeId } from './types';

export interface ModeDef {
  id: ModeId;
  nameKey: string;
  descKey: string;
  teams: boolean;
  timeLimit: number;
  scoreLimit: number;
  maxPlayers: number;
  /** Maps this mode can be played on. */
  maps: MapId[];
  countdown: number;
}

export const MODES: Record<ModeId, ModeDef> = {
  tdm: {
    id: 'tdm',
    nameKey: 'mode.tdm.name',
    descKey: 'mode.tdm.desc',
    teams: true,
    timeLimit: 7 * 60,
    scoreLimit: 50,
    maxPlayers: 10,
    maps: ['gantry', 'pastel', 'observatory'],
    countdown: 3,
  },
  control: {
    id: 'control',
    nameKey: 'mode.control.name',
    descKey: 'mode.control.desc',
    teams: true,
    timeLimit: 8 * 60,
    scoreLimit: 400,
    maxPlayers: 10,
    maps: ['gantry', 'pastel', 'observatory'],
    countdown: 3,
  },
  ffa: {
    id: 'ffa',
    nameKey: 'mode.ffa.name',
    descKey: 'mode.ffa.desc',
    teams: false,
    timeLimit: 6 * 60,
    scoreLimit: 25,
    maxPlayers: 8,
    maps: ['gantry', 'pastel', 'observatory'],
    countdown: 3,
  },
  range: {
    id: 'range',
    nameKey: 'mode.range.name',
    descKey: 'mode.range.desc',
    teams: false,
    timeLimit: 0,
    scoreLimit: 0,
    maxPlayers: 1,
    maps: ['range'],
    countdown: 0,
  },
};

export function makeGameConfig(
  mode: ModeId,
  map: MapId,
  opts: { botFill?: boolean; botDifficulty?: BotDifficulty; roomCode?: string; tutorial?: boolean } = {},
): GameConfig {
  const m = MODES[mode];
  return {
    mode,
    map,
    timeLimit: m.timeLimit,
    scoreLimit: m.scoreLimit,
    maxPlayers: m.maxPlayers,
    botFill: opts.botFill ?? true,
    botDifficulty: opts.botDifficulty ?? 'veteran',
    countdown: m.countdown,
    roomCode: opts.roomCode,
    tutorial: opts.tutorial,
  };
}
