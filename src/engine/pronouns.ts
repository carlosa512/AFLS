import type { Coach, Medic, Staff } from './types';

const MAN = { he: 'he', He: 'He', him: 'him', his: 'his', His: 'His' } as const;
const WOMAN = { he: 'she', He: 'She', him: 'her', his: 'her', His: 'Her' } as const;

/** The pronouns for text about one person: scouts and medics can be women (`woman` is set at creation), coaches never are. */
export const pron = (p: Coach | Staff | Medic) => ('woman' in p && p.woman === true ? WOMAN : MAN);
