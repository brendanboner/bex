/**
 * BEX Logo — geometric hex/circuit mark with "BEX" wordmark.
 * Uses the BEX cyan accent palette.
 */

interface BexLogoProps {
  /** Size of the logo mark (height in px). Default 32. */
  size?: number;
  /** Whether to show the wordmark next to the mark. Default true. */
  showWordmark?: boolean;
  /** Whether to show the tagline "FORGE" under the wordmark. Default false. */
  showTagline?: boolean;
  className?: string;
}

export function BexLogo({ size = 32, showWordmark = true, showTagline = false, className = '' }: BexLogoProps) {
  const s = size;
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Mark: angular hexagon with lightning bolt cutout */}
      <svg
        width={s}
        height={s}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Outer hex shape */}
        <polygon
          points="20,2 36,11 36,29 20,38 4,29 4,11"
          fill="none"
          stroke="rgb(137,129,229)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Inner fill - slightly dark */}
        <polygon
          points="20,6 33,13.5 33,26.5 20,34 7,26.5 7,13.5"
          fill="rgba(137,129,229,0.08)"
        />
        {/* Lightning bolt — top node to bottom */}
        <path
          d="M23 9 L15 22 L21 22 L17 31 L25 18 L19 18 Z"
          fill="rgb(137,129,229)"
          stroke="rgb(137,129,229)"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* Corner accent dots */}
        <circle cx="20" cy="2" r="1.5" fill="rgb(167,139,250)" />
        <circle cx="36" cy="11" r="1.5" fill="rgb(167,139,250)" />
        <circle cx="36" cy="29" r="1.5" fill="rgb(167,139,250)" />
        <circle cx="20" cy="38" r="1.5" fill="rgb(167,139,250)" />
        <circle cx="4" cy="29" r="1.5" fill="rgb(167,139,250)" />
        <circle cx="4" cy="11" r="1.5" fill="rgb(167,139,250)" />
      </svg>

      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span
            style={{
              fontSize: s * 0.55,
              fontWeight: 800,
              letterSpacing: '0.05em',
              background: 'linear-gradient(135deg, rgb(137,129,229), rgb(196,181,253))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1,
            }}
          >
            BEX
          </span>
          {showTagline && (
            <span
              style={{
                fontSize: s * 0.22,
                fontWeight: 600,
                letterSpacing: '0.2em',
                color: 'rgb(110,120,160)',
                lineHeight: 1.4,
                marginTop: 2,
              }}
            >
              FORGE
            </span>
          )}
        </span>
      )}
    </span>
  );
}
