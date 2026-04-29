const STATS: ReadonlyArray<{ num: string; label: string }> = [
  { num: '~3.8s', label: 'Median generation' },
  { num: '64×64', label: 'Valid MC atlas' },
  { num: '16', label: 'Color palette' },
  { num: 'MIT', label: 'Open source' },
];

export default function LandingStrip() {
  return (
    <section className="landing-strip" aria-label="Project facts">
      <div className="landing-container landing-strip__inner">
        {STATS.map((stat, i) => (
          <div key={stat.label} className="landing-strip__stat-wrap">
            <div className="landing-strip__stat">
              <span className="landing-strip__num">{stat.num}</span>
              <span className="landing-strip__label">{stat.label}</span>
            </div>
            {i < STATS.length - 1 && <span className="landing-strip__sep" />}
          </div>
        ))}
      </div>
    </section>
  );
}
