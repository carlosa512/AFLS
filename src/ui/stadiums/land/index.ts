/** The kinds of land a building can stand in. Each follows the lie of the land round a real ground, nothing more. */
import type { Scene, SettingUse } from '../types';
import {
  boat,
  box,
  bridge,
  BRICK,
  city,
  crane,
  highway,
  houses,
  lined,
  lot,
  marsh,
  P,
  patch,
  railYard,
  ship,
  STEEL,
  street,
  tower,
  water,
  woods,
} from './kit';

type Painter<K extends SettingUse['kind']> = (s: Scene, use: Extract<SettingUse, { kind: K }>) => void;
const pickFrom = (s: Scene, list: string[]) => list[Math.floor(s.rng.next() * list.length)];

/** In town: car parks round the ground, then the streets and blocks of the city just beyond. */
const town: Painter<'town'> = (s, use) => {
  if (use.lots) lot(s, -118, 118, 126, 158);
  for (const sgn of [-1, 1]) {
    if (use.lots) lot(s, sgn > 0 ? 134 : -190, sgn > 0 ? 190 : -134, 18, 112);
    street(s, [sgn * 127, -40], [sgn * 127, 160], 6);
  }
  street(s, [-430, 120], [430, 120], 7, '#6f757a', 0.7);
  lined(s, -430, 430, 115.5);
  city(s, { z0: 168, height: use.height, palette: use.palette });
  for (const sgn of [-1, 1])
    for (const z of [30, 74])
      for (const x of [222, 268]) tower(s, sgn * x, z, 34, 30, 14 + s.rng.next() * 20, pickFrom(s, use.palette));
};

/** Out of town: acres of car park, a road, low sheds, and woods packed tight behind. */
const outOfTown: Painter<'outOfTown'> = (s, use) => {
  const tar = s.snowy ? '#5a6066' : '#4b5056';
  const road = s.snowy ? '#7d848a' : '#6f757a';
  lot(s, -230, 230, 138, 186, tar); // nearer than 138 it is hidden behind the far stand
  for (const sgn of [-1, 1]) {
    lot(s, sgn > 0 ? 134 : -230, sgn > 0 ? 230 : -134, 4, 112, tar);
    street(s, [sgn * 127, -40], [sgn * 127, 190], 6, road, 0.3);
  }
  street(s, [-430, 191], [430, 191], 8, road, 0.6);
  s.pen.poly(
    [P(-460, 0, 196), P(460, 0, 196), P(460, 0, 330), P(-460, 0, 330)],
    s.tone(s.snowy ? '#c6d0d4' : '#4f6b4a'),
  );
  // the frame's top edge sees ground 236 yards out and about 260 either side: no trees are planted past that
  woods(s, -270, 270, 198, 240, use.trees);
  if (use.shops) {
    // a low shopping street beside the ground
    street(s, [134, 122], [300, 122], 5, road, 0.4);
    for (let x = 146; x < 300; x += 26)
      tower(s, x, 128, 22, 14, 5 + s.rng.next() * 3, pickFrom(s, ['#b08a6e', '#c9c2b0', '#9a6b55']));
  }
  if (use.sheds)
    for (const [x, w] of [
      [-250, 44],
      [262, 38],
    ])
      box(s, x, 150, w, 26, 7, '#8f6f5b');
};

/** On a river: the water at the door, bridges over it, a boat, and a town on the far bank. */
const river: Painter<'river'> = (s, use) => {
  const trees = use.trees ?? 'round';
  if (use.city) city(s, { z0: 198, height: 'high', palette: [...STEEL, ...BRICK], ground: '#7a7f83' });
  else {
    s.pen.poly([P(-480, 0, 190), P(480, 0, 190), P(480, 0, 330), P(-480, 0, 330)], s.tone('#4f6b4a'));
    woods(s, -300, 300, 216, 242, trees, () => 0, 3.8);
  }
  water(s, 124, 190);
  if (!use.city) {
    const bank: [number, number, number][] = [
      [-190, 30, 9],
      [-146, 26, 13],
      [-102, 34, 8],
      [-20, 30, 11],
      [24, 24, 16],
      [150, 32, 9],
      [196, 28, 12],
      [240, 30, 8],
    ];
    for (const [x, w, h] of bank) tower(s, x, 196, w, 16, h, pickFrom(s, BRICK));
  }
  street(s, [-430, 119], [430, 119], 6, '#6f757a', 0.6);
  lot(s, 134, 190, 20, 112);
  lined(s, -430, 430, 123.2, trees);
  const spans: [number, string][] = [
    [108, '#4f5a62'],
    [-232, '#a5562f'],
  ];
  for (const [x, col] of spans.slice(0, use.bridges)) bridge(s, x, 124, 190, col);
  if (use.boat) {
    box(s, -34, 150, 30, 9, 2.4, '#f1efe8');
    box(s, -36, 151.5, 22, 6, 3, '#f7f5ee', 2.4);
    box(s, -36, 152.5, 14, 4, 2.4, '#f1efe8', 5.4);
    for (const x of [-30, -26]) box(s, x, 153.5, 1.6, 1.6, 7, '#2b2d31', 7.8);
    box(s, -52, 151, 4, 7, 5.5, s.colors[0]);
    s.pen.line([P(-70, 0.1, 152), P(-56, 0.1, 154.5), P(-70, 0.1, 157)], 'rgba(255,255,255,.5)', 0.4);
  }
};

/** The middle of town: towers on every side. */
const downtown: Painter<'downtown'> = (s, use) => {
  city(s, { z0: 126, height: 'high', palette: use.palette, ground: '#80857f', glass: use.glass });
  for (const sgn of [-1, 1]) {
    street(s, [sgn * 127, -40], [sgn * 127, 124], 6);
    for (const z of [12, 52, 90])
      for (const x of [150, 196, 242])
        tower(s, sgn * x, z, 30, 28, 16 + s.rng.next() * 55, pickFrom(s, use.palette), use.glass);
    if (use.streetTrees) woods(s, sgn > 0 ? 130 : -142, sgn > 0 ? 142 : -130, 0, 110, 'round', () => 0, 6);
  }
};

/** A suburb: car parks by the ground, then streets of houses, perhaps beyond a canal. */
const suburb: Painter<'suburb'> = (s, use) => {
  lot(s, -200, 200, 138, 168);
  for (const sgn of [-1, 1]) {
    lot(s, sgn > 0 ? 134 : -220, sgn > 0 ? 220 : -134, 6, 112);
    street(s, [sgn * 127, -40], [sgn * 127, 170], 6);
  }
  street(s, [-430, 172], [430, 172], 7, '#6f757a', 0.6);
  lined(s, -300, 300, 177, use.trees);
  if (use.canal) {
    s.pen.poly(patch(-480, 480, 181, 192), s.tone('#5f97a8'));
    lined(s, -300, 300, 194, use.trees);
  }
  houses(s, -300, 300, use.canal ? 200 : 186, 244, use.trees);
  for (const sgn of [-1, 1]) lined(s, sgn > 0 ? 226 : -280, sgn > 0 ? 280 : -226, 60, use.trees);
};

/** Marshland: channels and reeds beyond the car parks, a highway through it. */
const marshland: Painter<'marsh'> = (s, use) => {
  marsh(s, 150, 330);
  lot(s, -210, 210, 126, 150);
  for (const sgn of [-1, 1]) {
    lot(s, sgn > 0 ? 134 : -230, sgn > 0 ? 230 : -134, 4, 112);
    street(s, [sgn * 127, -40], [sgn * 127, 150], 6);
  }
  if (use.highway) highway(s, 196);
};

/** In town by the water: rail yards behind the ground, brick blocks beyond them, then the harbor and its ships. */
const harbor: Painter<'harbor'> = (s) => {
  railYard(s, 138, 164);
  for (const sgn of [-1, 1]) {
    lot(s, sgn > 0 ? 134 : -200, sgn > 0 ? 200 : -134, 10, 112);
    street(s, [sgn * 127, -40], [sgn * 127, 136], 6);
  }
  street(s, [-430, 168], [430, 168], 6, '#6f757a', 0.6);
  for (let x = -280; x < 280; x += 40)
    tower(s, x + 20, 174, 28 + s.rng.next() * 8, 18, 9 + s.rng.next() * 12, pickFrom(s, BRICK));
  water(s, 200, 330, '#5f8fa6');
  s.pen.poly(patch(-460, 460, 196, 200), s.tone('#8d9296'));
  for (const x of [-170, 40]) {
    s.pen.poly(patch(x - 5, x + 5, 200, 232), s.tone('#8d9296'));
    ship(s, x + 34, 210, 46);
  }
  crane(s, -120, 200);
  crane(s, 96, 200);
};

/** On a lake: a shore road, docks with ships and cranes, and the water running to the top of the picture. */
const lake: Painter<'lake'> = (s, use) => {
  water(s, 160, 340, '#5a8ba8');
  for (const sgn of [-1, 1]) {
    lot(s, sgn > 0 ? 134 : -200, sgn > 0 ? 200 : -134, 10, 112);
    street(s, [sgn * 127, -40], [sgn * 127, 150], 6);
  }
  lot(s, -110, 110, 138, 148);
  street(s, [-430, 153], [430, 153], 6, '#6f757a', 0.7);
  s.pen.poly(patch(-460, 460, 157, 161), s.tone('#9a9d98'));
  if (use.docks) {
    for (const x of [-200, -60, 110]) {
      s.pen.poly(patch(x - 7, x + 7, 160, 205), s.tone('#8d9296'));
      crane(s, x, 164);
      crane(s, x, 186);
    }
    ship(s, -132, 172, 50);
    ship(s, 40, 190, 44);
  } else {
    lined(s, -300, 300, 151);
    for (let n = 0; n < 46; n++) boat(s, -150 + (n % 12) * 9 + s.rng.next() * 3, 166 + Math.floor(n / 12) * 7);
  }
};

/** Where two rivers meet: one across behind the ground, one coming in from the side, bridges, and the city beyond. */
const confluence: Painter<'confluence'> = (s) => {
  city(s, { z0: 196, height: 'high', palette: [...STEEL, ...BRICK], ground: '#7a7f83' });
  water(s, 124, 186);
  s.pen.poly(patch(-250, -190, 150, 340), s.tone('#6f9db3'));
  street(s, [-430, 119], [430, 119], 6, '#6f757a', 0.6);
  lined(s, -430, 430, 123);
  for (const sgn of [-1, 1]) lot(s, sgn > 0 ? 134 : -190, sgn > 0 ? 190 : -134, 16, 112);
  for (const x of [-120, 20, 150]) bridge(s, x, 124, 186, '#d9a514');
};

export const SETTINGS: { [K in SettingUse['kind']]: Painter<K> } = {
  none: () => {},
  town,
  outOfTown,
  river,
  downtown,
  suburb,
  marsh: marshland,
  harbor,
  lake,
  confluence,
};
