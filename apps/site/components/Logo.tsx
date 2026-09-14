import Link from 'next/link';

/** A token whose balance steps up with no transfer: the multiplier change Corpact accounts for. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="corpact-mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8fb2ff" />
          <stop offset="0.55" stopColor="#4f6bff" />
          <stop offset="1" stopColor="#2a3fd6" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#corpact-mark)" />
      <path d="M8 21.5h5.2v-4.6h5.6V11h5.2" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="11" r="2.2" fill="#fff" />
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
