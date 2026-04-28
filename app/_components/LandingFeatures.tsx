const FEATURES: ReadonlyArray<{ num: string; title: string; body: string }> = [
  {
    num: '01',
    title: 'Prompt → skin',
    body: 'Cloudflare Workers AI runs SDXL Lightning, then quantizes to a 16-color palette and emits a Minecraft-valid 64×64 atlas. No "almost a skin" output — it\'s always loadable.',
  },
  {
    num: '02',
    title: 'Sub-4-second p50',
    body: 'Groq fronts the prompt-shaping step at ~600 tokens/sec. Cloudflare\'s edge GPU does the image. You see a result before you\'ve finished re-reading what you typed.',
  },
  {
    num: '03',
    title: 'Live 3D preview',
    body: 'React Three Fiber renders the model the moment a pixel changes. Orbit, zoom, toggle the overlay. No "render" button.',
  },
  {
    num: '04',
    title: 'Pencil, bucket, picker, mirror',
    body: 'The five tools you actually need, with keyboard shortcuts (B, E, I, G, M). Mirror mode for symmetry. Unlimited undo.',
  },
  {
    num: '05',
    title: 'Edit AI output',
    body: 'Every generation lands as a new layer. Tune the helmet, repaint the boots, keep what works. The AI is a starting point — not a black box.',
  },
  {
    num: '06',
    title: 'Free forever',
    body: 'Open-source, MIT licensed. No "credits", no paywalls. Self-host the worker if you want. Sub-cent generation costs make this sustainable.',
  },
];

export default function LandingFeatures() {
  return (
    <section id="features" className="section">
      <div className="landing-container">
        <header className="section__head">
          <p className="section__eyebrow">What you get</p>
          <h2 className="section__title">
            Six things that make threditor{' '}
            <span className="section__title-accent">different</span>.
          </h2>
          <p className="section__lede">
            Most browser skin editors are either fast OR good. We chose both —
            by spending the AI budget on quality and the engineering budget on
            the paint loop.
          </p>
        </header>

        <div className="features__grid">
          {FEATURES.map((feature) => (
            <article key={feature.num} className="feature-card">
              <span className="feature-card__num">{feature.num}</span>
              <h3 className="feature-card__title">{feature.title}</h3>
              <p className="feature-card__body">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
