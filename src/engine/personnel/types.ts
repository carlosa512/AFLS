/** Saved state for staged personnel transactions; normal careers stay off until the lifecycle is complete. */
export interface PersonnelState {
  version: 1;
  /** Remains off until the complete transaction lifecycle is available. */
  enabled: boolean;
  profile: 'afls-2026-v1';
  clock?: { season: number; minute: number; cutdown: boolean };
  squads?: {
    season: number;
    offers: SquadOffer[];
    returns: SquadOffer[];
    results: { playerId: number; teamId: number; weeklyPay: number }[];
    payroll: {
      week: number;
      earned: Record<number, number>;
      receipts: Record<string, number>;
      credits?: Record<string, number>;
    };
  };
  waivers?: {
    nextId: number;
    originalOrder: { season: number; teams: number[] };
    pending: WaiverEntry[];
    claims: WaiverClaim[];
    results: WaiverResult[];
    aiWindow?: { key: string; awards: Record<number, number> };
  };
}

export interface WaiverClaim {
  entryId: number;
  teamId: number;
  /** Order in this club's list; winners do not lose their league priority. */
  preference: number;
  cutIds: number[];
  /** Subset of cutIds: only after an award, invite these released players back on new squad deals. */
  squadReturnIds?: number[];
  /** Alternatives in the same group can produce at most one award per batch. */
  group?: string;
  /** AI budget floor, rechecked after every earlier award. User claims may omit it. */
  minCapSpace?: number;
  automatic?: true;
}

export interface WaiverEntry {
  id: number;
  playerId: number;
  fromTeamId: number;
  season: number;
  deadline: number;
  contract: import('../types').Contract;
  /** Financial state frozen at the release request, not recalculated after the clock moves. */
  paid: number;
  paidBefore: number;
  postJune1: boolean;
  release: { thisYear: number; nextYear: number };
  assigned: { thisYear: number; nextYear: number };
}

export interface WaiverResult {
  entryId: number;
  playerId: number;
  fromTeamId: number;
  toTeamId: number | null;
  season: number;
  deadline: number;
  /** Only the user's own unsuccessful instructions are retained; opposing bids stay private. */
  userReason?: string;
}

/** Active and IR continue to use the existing employer and `ir` record. */
export interface SquadMembership {
  kind: 'practiceSquad' | 'practiceSquadInjured';
  agreement?: { season: number; weeklyPay: number; startWeek: number; paidThrough: number };
}

export interface SquadOffer {
  playerId: number;
  teamId: number;
  weeklyPay: number;
  /** A return invitation has no exclusivity: the player can accept another club's offer. */
  formerTeam?: true;
}

export type RosterList = 'active' | 'injuredReserve' | SquadMembership['kind'] | 'waivers' | 'unattached' | 'retired';

/** Named tuples keep thousands of service records small in exported JSON saves. */
export type ServiceSeason = [
  accruedWeeks: number,
  salaryWeeks: number,
  pensionWeeks: number,
  /** null means the dressing list was not recorded, rather than zero game-day activations. */
  activeWeeks: number | null,
  postseasonPension?: number,
  incomplete?: true,
];

export interface ServiceTotals {
  accrued: number;
  salary: number;
  pension: number;
}

export interface PlayerService {
  /** Prior history is deliberately not reconstructed from statistical appearances. */
  baseline: [throughSeason: number, accrued: number, salary: number, pension: number, estimated: boolean];
  seasons: Record<number, ServiceSeason>;
  /** Completed-season flags and active counts, encoded by archiveService (never weekly snapshots). */
  /** Index zero is baseline's throughSeason + 1; null denotes an unobserved season. */
  history: (number | null)[];
}

/** Only kept while a game is in progress, so live-game roster edits cannot rewrite service. */
export interface ServiceAssignment {
  playerId: number;
  list: 'active' | 'injuredReserve';
}
