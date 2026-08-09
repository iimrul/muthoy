// MuthoyLoadingScreen.tsx
// Full-screen transition overlay for the Muthoy app.
// Transparent overlay with a blurred backdrop (whatever is behind it shows through, blurred).
// Animated pill-in-palm mark with dual pulse rings and orbiting dots.
// Self-contained, offline, respects reduced-motion.

export function MuthoyLoadingScreen() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        background: "rgba(236, 253, 245, 0.4)",
      }}
    >
      <svg width="200" height="180" viewBox="0 0 200 180" role="img" xmlns="http://www.w3.org/2000/svg">
        <title>Muthoy</title>
        <defs>
          <linearGradient id="mg6" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#10B981" /><stop offset="1" stopColor="#065F46" />
          </linearGradient>
          <style>{`
            @keyframes v6-drop { 0%{transform:translateY(-22px);opacity:0} 30%{opacity:1} 50%{transform:translateY(3px)} 68%{transform:translateY(-4px)} 84%{transform:translateY(1px)} 100%{transform:translateY(0);opacity:1} }
            @keyframes v6-catch { 0%,38%{transform:scale(1)} 52%{transform:scale(1.03)} 100%{transform:scale(1)} }
            @keyframes v6-ring { 0%{r:28;opacity:.55} 80%,100%{r:70;opacity:0} }
            @keyframes v6-orbit { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
            .v6-capsule{animation:v6-drop 1.8s cubic-bezier(.34,1.56,.5,1) infinite;transform-origin:100px 92px}
            .v6-palm{animation:v6-catch 1.8s ease-in-out infinite;transform-origin:100px 118px}
            .v6-ring1{animation:v6-ring 1.8s ease-out infinite;transform-origin:center}
            .v6-ring2{animation:v6-ring 1.8s ease-out .6s infinite;transform-origin:center}
            .v6-orbit{animation:v6-orbit 2.6s linear infinite;transform-origin:100px 108px}
            @media (prefers-reduced-motion:reduce){.v6-capsule,.v6-palm,.v6-ring1,.v6-ring2,.v6-orbit{animation:none}}
          `}</style>
        </defs>
        <circle className="v6-ring1" cx="100" cy="108" r="28" fill="none" stroke="#10B981" strokeWidth="2.5" />
        <circle className="v6-ring2" cx="100" cy="108" r="28" fill="none" stroke="#34D399" strokeWidth="2" />
        <g className="v6-orbit">
          <circle cx="100" cy="44" r="3.5" fill="#059669" />
          <circle cx="100" cy="172" r="2.5" fill="#34D399" />
        </g>
        <g className="v6-palm">
          <path d="M68 102 q-12 3 -13 22 q-2 23 16 35 q18 13 29 13 q11 0 29 -13 q18 -12 16 -35 q-1 -19 -13 -22 q-5 19 -32 19 q-27 0 -32 -19 z" fill="url(#mg6)" strokeLinejoin="round" />
          <circle cx="68" cy="102" r="6" fill="url(#mg6)" />
          <circle cx="82" cy="96" r="6" fill="url(#mg6)" />
          <circle cx="100" cy="94" r="6" fill="url(#mg6)" />
          <circle cx="118" cy="96" r="6" fill="url(#mg6)" />
          <circle cx="132" cy="102" r="6" fill="url(#mg6)" />
        </g>
        <g className="v6-capsule">
          <g transform="rotate(40 100 90)">
            <rect x="84" y="76" width="32" height="26" rx="13" fill="url(#mg6)" />
            <path d="M97 76 a13 13 0 0 0 0 26 h3 v-26 z" fill="#ECFDF5" opacity="0.92" />
            <circle cx="91" cy="89" r="2" fill="#059669" />
          </g>
        </g>
      </svg>
    </div>
  );
}

export default MuthoyLoadingScreen;
