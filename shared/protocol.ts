// Wire protocol shared by server and client.
import type { PlayerView } from './sim/view.ts';
import type { Submission, TurnResult } from './sim/types.ts';

export interface SeatInfo {
  seat: number;
  name: string;
  kind: 'human' | 'ai';
  aiLevel: 'novice' | 'standard' | 'expert';
  claimed: boolean;       // a human has taken this seat
  submitted: boolean;     // orders are in for the current turn
  online: boolean;
  missedTurns: number;
}

export interface GameMeta {
  id: string;
  name: string;
  createdAt: number;
  turn: number;
  seats: SeatInfo[];
  deadline: number | null;      // epoch ms when the current turn auto-resolves
  deadlineHours: number;
  winner: number | null;
  winReason: string;
  mode?: 'wego' | 'live';
  live?: { speed: number; tick: number; nextTickAt: number; tickMs: number; ticksPerCycle: number };
}

export interface ChatMsg { at: number; seat: number | null; to: number | null; text: string }

/** POST /api/games body. Everything is validated server-side; unknown/invalid rule keys are dropped. */
export interface CreateGameReq {
  name?: string;
  seed?: number;
  seats?: { kind: 'human' | 'ai'; name?: string; aiLevel?: 'novice' | 'standard' | 'expert' }[];
  rules?: unknown;
  deadlineHours?: number;
  mode?: 'wego' | 'live';
  liveSpeed?: string;        // key of LIVE_SPEEDS
}

/** Server -> client */
export type ServerMsg =
  | { type: 'view'; meta: GameMeta; view: PlayerView; mySubmission: Submission | null; chat: ChatMsg[] }
  | { type: 'meta'; meta: GameMeta }
  | { type: 'chat'; msg: ChatMsg }
  | { type: 'history'; turn: number; tick?: number; result: TurnResult | null }
  | { type: 'error'; error: string; code?: string };

/** Client -> server */
export type ClientMsg =
  | { type: 'submit'; submission: Submission; turn?: number }   // turn: the turn these orders were planned for (stale ones are rejected)
  | { type: 'unsubmit' }
  | { type: 'chat'; text: string; to: number | null }
  | { type: 'history'; turn: number; tick?: number }   // tick: LIVE only (default: the cycle's first stored tick)
  | { type: 'liveOrder'; order: unknown }
  | { type: 'liveCancel'; index: number }
  | { type: 'liveFree'; action: unknown }
  | { type: 'liveHalt'; fleet: number }
  | { type: 'ping' };
