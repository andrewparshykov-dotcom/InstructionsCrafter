import React, { useRef, useEffect } from "react";

// Layered animated hero icon for the Playground page. Inline SVG (so it scales
// crisp at any size), split into three logical layers — background, document,
// play-circle — each at a different conceptual depth.
//
// Two simultaneous motions per layer:
//
//   1. Slow vertical floating, driven by CSS keyframes. Each layer has its
//      own period and phase offset so they never sync up — the icon feels
//      breathy and organic instead of mechanical.
//
//   2. Mouse parallax, driven by JS. As the cursor moves anywhere in the
//      window, each layer shifts in the cursor's direction at a different
//      rate. Background shifts least, play button shifts most. The result
//      is a real 3D tilt feel without any actual 3D.
//
// To compose these two motions on the same SVG element we'd hit a CSS
// transform conflict (keyframe transform vs. inline transform both set
// `transform`). The structure works around it by wrapping each layer in a
// floating <g> (keyframe owns it) which then contains the parallax <g>
// (JS owns it via inline style). Transforms compose naturally.

const IconHero = () => {
  const stageRef = useRef(null);
  const docRef = useRef(null);
  const playRef = useRef(null);

  useEffect(() => {
    let raf = null;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const apply = () => {
      // Easing: move 12% of the way to target each frame for smooth follow.
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;

      if (docRef.current) {
        docRef.current.style.transform = `translate(${currentX * 8}px, ${currentY * 8}px)`;
      }
      if (playRef.current) {
        playRef.current.style.transform = `translate(${currentX * 14}px, ${currentY * 14}px)`;
      }

      // Keep animating as long as we're not at rest.
      if (
        Math.abs(currentX - targetX) > 0.02 ||
        Math.abs(currentY - targetY) > 0.02
      ) {
        raf = requestAnimationFrame(apply);
      } else {
        raf = null;
      }
    };

    const handleMouseMove = (e) => {
      // Normalize relative to viewport center so the parallax responds to
      // window-wide cursor position, not just over the icon. Feels more alive.
      targetX = (e.clientX - window.innerWidth / 2) / window.innerWidth;
      targetY = (e.clientY - window.innerHeight / 2) / window.innerHeight;
      if (raf === null) raf = requestAnimationFrame(apply);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={stageRef} className="hero-stage">
      <style>{heroCss}</style>
      <svg
        viewBox="0 0 280 280"
        className="hero-svg"
        aria-hidden="true"
      >
        <defs>
          <filter id="hero-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="12" stdDeviation="22" floodColor="#1F4FA8" floodOpacity="0.14" />
          </filter>
          <filter id="hero-shadow-play" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="10" stdDeviation="18" floodColor="#1F4FA8" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Document — body, fold, three lines. Enlarged to fill the viewBox. */}
        <g className="hero-float-doc">
          <g ref={docRef}>
            <g filter="url(#hero-shadow)">
              <path
                d="M 50 32 L 168 32 L 232 96 L 232 232 Q 232 244 220 244 L 50 244 Q 38 244 38 232 L 38 44 Q 38 32 50 32 Z"
                fill="white"
                stroke="#3080F8"
                strokeWidth="9"
                strokeLinejoin="round"
              />
            </g>
            <path
              d="M 168 32 L 232 96 L 180 96 Q 168 96 168 84 Z"
              fill="#3080F8"
            />
            <line
              x1="68"
              y1="120"
              x2="202"
              y2="120"
              stroke="#3080F8"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <line
              x1="68"
              y1="158"
              x2="202"
              y2="158"
              stroke="#3080F8"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <line
              x1="68"
              y1="196"
              x2="160"
              y2="196"
              stroke="#3080F8"
              strokeWidth="10"
              strokeLinecap="round"
            />
          </g>
        </g>

        {/* Play button — front-most layer, biggest motion */}
        <g className="hero-float-play">
          <g ref={playRef}>
            <circle
              cx="220"
              cy="222"
              r="46"
              fill="#3080F8"
              filter="url(#hero-shadow-play)"
            />
            <path d="M 206 200 L 206 244 L 248 222 Z" fill="white" />
          </g>
        </g>
      </svg>
    </div>
  );
};

const heroCss = `
  .hero-stage {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    min-width: 0;
    min-height: 0;
  }
  .hero-svg {
    width: 100%;
    height: auto;
    max-width: min(calc(100vh - 100px), 100%);
    max-height: calc(100vh - 100px);
    display: block;
    overflow: visible;
  }
  .hero-float-halo,
  .hero-float-doc,
  .hero-float-play {
    transform-origin: center;
    transform-box: fill-box;
    will-change: transform;
  }
  .hero-float-halo { animation: hero-halo-pulse 9s ease-in-out infinite; }
  .hero-float-doc  { animation: hero-float-doc 6s ease-in-out infinite -1.5s; }
  .hero-float-play { animation: hero-float-play 7s ease-in-out infinite -3s; }

  @keyframes hero-halo-pulse {
    0%, 100% { transform: scale(1); opacity: 0.95; }
    50%      { transform: scale(1.05); opacity: 0.7; }
  }
  @keyframes hero-float-doc {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-8px); }
  }
  @keyframes hero-float-play {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-14px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-float-halo,
    .hero-float-doc,
    .hero-float-play {
      animation: none;
    }
  }
`;

export default IconHero;
