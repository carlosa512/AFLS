/**
 * A played game in small pieces, from one team's side: the line score, the key team stats, the player of
 * the game and the team's other standouts. The recap mail and Home's last game both use them.
 */
import { impact, playerOfTheGame } from '../engine/awards';
import type { Game, League, Player, StatLine } from '../engine/types';
import { PlayerAvatar, PlayerLink, TeamChip } from './components';
import { gameClock } from './format';
import { honorLine } from './screens/Stats';

/** Points by quarter (overtime as OT), the team's row marked. */
export function LineScore({ league, game, teamId }: { league: League; game: Game; teamId: number }) {
  const r = game.result!;
  return (
    <table className="line-score" aria-label="Score by quarter">
      <thead>
        <tr>
          <th>Team</th>
          {r.quarters.home.map((_, i) => (
            <th key={i} className="num">
              {i < 4 ? i + 1 : 'OT'}
            </th>
          ))}
          <th className="num">T</th>
        </tr>
      </thead>
      <tbody>
        {(['away', 'home'] as const).map((k) => {
          const id = k === 'home' ? game.homeId : game.awayId;
          return (
            <tr key={k} className={id === teamId ? 'is-user' : undefined}>
              <td>
                <TeamChip team={league.teams[id]} />
              </td>
              {r.quarters[k].map((q, i) => (
                <td key={i} className="num">
                  {q}
                </td>
              ))}
              <td className="num" style={{ fontWeight: 700 }}>
                {k === 'home' ? r.homeScore : r.awayScore}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** One key stat, ours against theirs, the better side bold. */
function KeyStat({
  label,
  ours,
  theirs,
  better,
}: {
  label: string;
  ours: string;
  theirs: string;
  better: 'us' | 'them' | null;
}) {
  return (
    <div className="key-stat">
      <span className={better === 'us' ? 'best' : undefined}>{ours}</span>
      <span className="muted">{label}</span>
      <span className={better === 'them' ? 'best' : undefined}>{theirs}</span>
    </div>
  );
}

const side = (a: number, b: number, more = true): 'us' | 'them' | null =>
  a === b ? null : a > b === more ? 'us' : 'them';
const rate = (c: number, a: number) => (a ? c / a : 0);

/** Yards, turnovers, third downs, possession and penalties, side by side. */
export function KeyStats({ league, game, teamId }: { league: League; game: Game; teamId: number }) {
  const r = game.result!;
  const home = game.homeId === teamId;
  const [ours, theirs] = home ? [r.home, r.away] : [r.away, r.home];
  const opp = league.teams[home ? game.awayId : game.homeId];
  return (
    <div aria-label="Key team stats">
      <div className="key-stat key-stat-head">
        <span className="eyebrow">{league.teams[teamId].abbrev}</span>
        <span />
        <span className="eyebrow">{opp.abbrev}</span>
      </div>
      <KeyStat
        label="Total yards"
        ours={String(ours.totalYds)}
        theirs={String(theirs.totalYds)}
        better={side(ours.totalYds, theirs.totalYds)}
      />
      <KeyStat
        label="Turnovers"
        ours={String(ours.turnovers)}
        theirs={String(theirs.turnovers)}
        better={side(ours.turnovers, theirs.turnovers, false)}
      />
      <KeyStat
        label="Third down"
        ours={`${ours.thirdDownConv}/${ours.thirdDownAtt}`}
        theirs={`${theirs.thirdDownConv}/${theirs.thirdDownAtt}`}
        better={side(rate(ours.thirdDownConv, ours.thirdDownAtt), rate(theirs.thirdDownConv, theirs.thirdDownAtt))}
      />
      <KeyStat
        label="Possession"
        ours={gameClock(ours.top)}
        theirs={gameClock(theirs.top)}
        better={side(ours.top, theirs.top)}
      />
      <KeyStat
        label="Penalties"
        ours={`${ours.penalties}-${ours.penaltyYds}`}
        theirs={`${theirs.penalties}-${theirs.penaltyYds}`}
        better={side(ours.penaltyYds, theirs.penaltyYds, false)}
      />
    </div>
  );
}

/** The player of the game, with his line. */
export function GameStar({ league, game }: { league: League; game: Game }) {
  const r = game.result!;
  const star = playerOfTheGame(league, game);
  const p = star !== null ? league.players[star] : undefined;
  if (!p) return null;
  const team = league.teams[r.playerTeams[p.id]];
  return (
    <div className="potg">
      <PlayerAvatar player={p} team={team ?? null} size={36} game={game} />
      <span>
        <span className="eyebrow">Player of the game</span>
        <span style={{ display: 'block' }}>
          <PlayerLink league={league} player={p} short bold />{' '}
          <span className="muted small">
            {p.position} · {team?.abbrev}
          </span>
        </span>
        <span className="small">{honorLine(p, r.playerStats[p.id])}</span>
      </span>
    </div>
  );
}

/** A team's best players in a game, on the player-of-the-game scale, leaving him out. */
export function standouts(league: League, game: Game, teamId: number, n: number): { p: Player; line: StatLine }[] {
  const r = game.result!;
  const star = playerOfTheGame(league, game);
  return Object.entries(r.playerStats)
    .map(([id, line]) => ({ p: league.players[Number(id)], line }))
    .filter(({ p }) => p && r.playerTeams[p.id] === teamId && p.id !== star)
    .map((x) => ({ ...x, v: impact(x.p, x.line) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, n);
}

/** Standouts as rows: position, name, line. */
export function Standouts({ league, rows }: { league: League; rows: { p: Player; line: StatLine }[] }) {
  return (
    <>
      {rows.map(({ p, line }) => (
        <div className="standout" key={p.id}>
          <span className="pos">{p.position}</span>
          <span style={{ minWidth: 0 }}>
            <PlayerLink league={league} player={p} short /> <span className="muted small">{honorLine(p, line)}</span>
          </span>
        </div>
      ))}
    </>
  );
}

/** The game in a line, from one team's side: "Led 17–10 at the half; lost the second half 6–16." */
export function gameStory(game: Game, teamId: number): string {
  const r = game.result!;
  const home = game.homeId === teamId;
  const [us, them] = home ? [r.quarters.home, r.quarters.away] : [r.quarters.away, r.quarters.home];
  const sum = (q: number[], from: number, to: number) => q.slice(from, to).reduce((a, b) => a + b, 0);
  const [a, b] = [sum(us, 0, 2), sum(them, 0, 2)];
  const [c, d] = [sum(us, 2, 4), sum(them, 2, 4)];
  const half =
    a > b ? `Led ${a}–${b} at the half` : a < b ? `Trailed ${a}–${b} at the half` : `Tied ${a}–${b} at the half`;
  const second =
    c > d
      ? `won the second half ${c}–${d}`
      : c < d
        ? `lost the second half ${c}–${d}`
        : `played the second half even, ${c}–${d}`;
  const [e, f] = [sum(us, 4, us.length), sum(them, 4, them.length)];
  const ot =
    us.length <= 4
      ? ''
      : e > f
        ? ', then won it in overtime'
        : e < f
          ? ', then lost it in overtime'
          : ', and overtime settled nothing';
  return `${half}; ${second}${ot}.`;
}
