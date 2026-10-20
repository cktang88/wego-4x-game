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
}

export interface ChatMsg { at: number; seat: number | null; to: number | null; text: string }

export interface CreateGameReq {
  name?: string;
  seed?: number;
  seats: { kind: 'human' | 'ai'; name?: string; aiLevel?: 'novice' | 'standard' | 'expert' }[];
  rules?: unknown;
  deadlineHours?: number;
}

/** Server -> client */
export type ServerMsg =
  | { type: 'view'; meta: GameMeta; view: PlayerView; mySubmission: Submission | null; chat: ChatMsg[] }
  | { type: 'meta'; meta: GameMeta }
  | { type: 'chat'; msg: ChatMsg }
  | { type: 'history'; turn: number; result: TurnResult | null }
  | { type: 'error'; error: string };

/** Client -> server */
export type ClientMsg =
  | { type: 'submit'; submission: Submission }
  | { type: 'unsubmit' }
  | { type: 'chat'; text: string; to: number | null }
  | { type: 'history'; turn: number }
  | { type: 'ping' };
