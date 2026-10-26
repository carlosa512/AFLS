import type { Coach, GeneralManager, Medic, Staff } from './types';

const MAN = { he: 'he', He: 'He', him: 'him', his: 'his', His: 'His' } as const;
const WOMAN = { he: 'she', He: 'She', him: 'her', his: 'her', His: 'Her' } as const;

/** The pronouns for text about one person: scouts, medics and GMs can be women (`woman` is set at creation), coaches never are. */
export const pron = (p: Coach | Staff | Medic | GeneralManager) => ('woman' in p && p.woman === true ? WOMAN : MAN);
