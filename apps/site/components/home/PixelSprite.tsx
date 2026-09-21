type Sprite = 'exchange' | 'wallet' | 'ledger';

/** 16×16 pixel marks. Each cell is a hard square - no strokes, no rounding. */
const SPRITES: Record<Sprite, string[]> = {
  exchange: [
    '..............',
    '......11......',
    '.....1111.....',
    '....1.11.1....',
    '...11111111...',
    '...1.2..2.1...',
    '...1......1...',
    '...1.2..2.1...',
    '...1......1...',
    '...1.2..2.1...',
    '...11111111...',
    '....1....1....',
    '....1....1....',
    '..3311111133..',
  ],
  wallet: [
    '..............',
    '..1111111111..',
    '..1........1..',
    '..1.3333...1..',
    '..1........1..',
    '11111111111111',
    '1............1',
    '1........22..1',
    '1.......2222.1',
    '1........22..1',
    '1............1',
    '11111111111111',
    '..............',
    '..............',
  ],
  ledger: [
    '..............',
    '..111111111...',
    '..1.2.2.2.11..',
    '..1.......1.1.',
    '..1.2.2.2.1.1.',
    '..1.......1.1.',
    '..1.2.2.2.1.1.',
    '..1.......1.1.',
    '..1.333.3.1.1.',
    '..1.......111.',
    '..1.2.2.2.1...',
    '..1.......1...',
    '..111111111...',
    '..............',
  ],
};

const FILLS: Record<string, string> = {
  '1': 'var(--text)',
  '2': 'var(--accent)',
  '3': 'var(--amber)',
};

export function PixelSprite({ name }: { name: Sprite }) {
  const rows = SPRITES[name];
  const cells: Array<{ x: number; y: number; fill: string }> = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = FILLS[ch];
      if (fill) cells.push({ x, y, fill });
    });
  });

  return (
    <svg className="pixel-sprite" viewBox="0 0 14 14" width="42" height="42" aria-hidden="true" shapeRendering="crispEdges">
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill={c.fill} />
      ))}
    </svg>
  );
}
