/**
 * Full-viewport background matching agentone-pwa's Background component.
 * Layers: base surface → center glow → left ellipse → right ellipse → dark overlay.
 * Rendered at z-index -1 so all page content sits above it.
 */
export function Background() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        overflow: 'hidden',
        background: '#1e1f2a',
      }}
    >
      {/* Center glow — blurred, top-center */}
      <div
        style={{
          position: 'absolute',
          width: 3535,
          height: 3356,
          left: 'calc(45.83% + 64.5px)',
          top: -2756,
          transform: 'translateX(-50%)',
          filter: 'blur(37px)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/bg-center-glow.png"
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            objectFit: 'cover',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Left ellipse — oversized, off-screen left */}
      <div
        style={{
          position: 'absolute',
          width: 2138,
          height: 2716,
          left: -1283,
          top: -916,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/bg-ellipse-home.svg"
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            display: 'block',
          }}
        />
      </div>

      {/* Right ellipse — same SVG, mirrored by position */}
      <div
        style={{
          position: 'absolute',
          width: 2138,
          height: 2716,
          left: 'calc(50% + 100px)',
          top: -916,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/bg-ellipse-home.svg"
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            display: 'block',
          }}
        />
      </div>

      {/* Dark overlay — matches agentone rgba(0,0,0,0.5) */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
    </div>
  );
}
