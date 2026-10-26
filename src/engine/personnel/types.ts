/** Saved state for staged personnel transactions; normal careers stay off until the lifecycle is complete. */
export interface PersonnelState {
  version: 1;
  /** Remains off until the complete transaction lifecycle is available. */
  enabled: boolean;
  profile: 'afls-2026-v1';
  /** `settledWeek`: waivers settle once a week, before its first kickoff. */
  clock?: { season: number; cutdown: boolean; settledWeek?: number };
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
  elevations?: {
    season: number;
    records: Elevation[];
    /** A same-club departure after use cannot erase the season's restriction. */
    blocked: Record<string, true>;
  };
  /** Step 6: own squad players kept for next season on futures deals, by club, for the season whose squads they are. */
  futures?: {
    season: number;
    /** Your (or a club's) explicit choices; absent: the staff's picks. */
    kept: Record<number, number[]>;
    /** Who actually signed at the new league year, by club (read by the mail). */
    signed?: Record<number, number[]>;
  };
  /** The one-time offer to switch practice squads on was made (existing careers). */
  offered?: true;
  /** Step 5: other clubs signing squad players to their 53, and each club's two weekly protections. */
  poaching?: {
    season: number;
    /** Pending offers; another club's stay private. */
    offers: PoachOffer[];
    /** Public outcomes, the latest 96. */
    results: PoachResult[];
    /** This week's protections by club, locked at the week's settle. */
    locked: { week: number; ids: Record<number, number[]> };
    /** "Always protect", per club, at most two, kept while the player stays on that squad. */
    pins: Record<number, number[]>;
  };
  waivers?: {
    nextId: number;
    /** The open batch: new releases join it, and a settle resolves every batch before the next one. */
    batch: number;
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
  batch: number;
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
  batch: number;
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

/**
 * Seasons of service: completed seasons with six or more regular-season games on the 53 (or called up) or IR,
 * through `through`, plus a bitmask of credited weeks in season `through + 1`. A tuple keeps thousands small.
 */
export type PlayerService = [through: number, seasons: number, weeks: number];

/** Only kept while a game is in progress, so live-game roster edits cannot rewrite service. */
export interface ServiceAssignment {
  playerId: number;
  list: 'active' | 'injuredReserve' | 'elevated';
}

/** A planned call-up reserves cap room; only a filed call-up consumes a use and earns pay. */
export interface Elevation {
  playerId: number;
  teamId: number;
  gameId: number;
  status: 'planned' | 'active' | 'reverted' | 'cancelled';
  /** Frozen at filing, in $K. Extra cap replaces, rather than duplicates, the squad check. */
  additionalCap: number;
  creditedToContract?: true;
  weeklyPay: number;
  reason?: string;
}
export interface GameDayPlan {
  /** Omitted means staff chooses. Explicit choices are validated again at kickoff. */
  dressedIds?: number[];
  emergencyQbId?: number;
}
export interface GameDayList {
  teamId: number;
  dressedIds: number[];
  inactiveIds: number[];
  elevatedIds: number[];
  emergencyQbId?: number;
}

export interface PoachOffer {
  playerId: number;
  teamId: number;
  years: 1 | 2;
}

export interface PoachResult {
  playerId: number;
  fromTeamId: number;
  /** null: no club signed him, and `reason` says why this club's offer failed. */
  toTeamId: number | null;
  /** The club whose offer this result answers. */
  teamId: number;
  season: number;
  week: number;
  reason?: string;
}
