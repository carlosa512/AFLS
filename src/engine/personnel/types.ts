/** Personnel foundations only: transaction queues arrive with the calendar/waiver step. */
export interface PersonnelState {
  version: 1;
  /** Remains off until the complete transaction lifecycle is available. */
  enabled: boolean;
  profile: 'afls-2026-v1';
}

/** Active and IR continue to use the existing employer and `ir` record. */
export interface SquadMembership {
  kind: 'practiceSquad' | 'practiceSquadInjured';
}

export type RosterList = 'active' | 'injuredReserve' | SquadMembership['kind'] | 'unattached' | 'retired';

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
