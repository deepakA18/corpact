import Link from 'next/link';

/**
 * A bitmap C on the same 8-cell square as the hero plate and the tape, so the mark is made of the
 * page's own pixel. Monochrome on purpose: it inherits the theme, the footer and the favicon without
 * any colour management. No gradient, no radius, no stroke.
 */
const MARK = [
  '..####..',
  '.######.',
  '.##..##.',
  '.##.....',
  '.##.....',
  '.##..##.',
  '.######.',
  '..####..',
];

export function LogoMark({ size = 20 }: { size?: number }) {
  const cells: Array<{ x: number; y: number }> = [];
  MARK.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') cells.push({ x, y });
    });
  });

  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 8 8"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export function Logo({ suffix, href = '/' }: { suffix?: string; href?: string }) {
  return (
    <Link href={href} className="logo">
      <LogoMark />
      <span className="logo-word">Corpact</span>
      {suffix && <span className="logo-suffix">{suffix}</span>}
    </Link>
  );
}
