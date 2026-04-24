import Link from 'next/link';

const FEATURES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: '10 starter templates',
    body: 'Pick a base, then make it yours. Classic and Slim proportions supported.',
  },
  {
    title: 'Unlimited undo',
    body: 'Experiment fearlessly. Every stroke is reversible, even across layers.',
  },
  {
    title: 'Live 3D preview',
    body: 'Paint the UV atlas or paint straight on the model — both surfaces share the same buffer.',
  },
  {
    title: 'Minecraft-ready export',
    body: 'Download a 64×64 PNG that drops into Minecraft as-is. No account, no ads.',
  },
];

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-ui-base text-text-primary">
      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center sm:py-24">
        <div className="flex max-w-3xl flex-col items-center gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
            threditor
          </p>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-text-primary sm:text-5xl md:text-6xl">
            A free, open-source 3D Minecraft skin editor for the web.
          </h1>
          <p className="max-w-xl text-balance text-base text-text-secondary sm:text-lg">
            Paint. Preview on a live 3D model. Export a Minecraft-ready PNG.
            No account required.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/editor"
            prefetch={false}
            data-testid="hero-cta"
            className="rounded-md bg-accent px-6 py-3 text-base font-semibold text-canvas transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Open the editor
          </Link>
          <Link
            href="/gallery"
            prefetch={false}
            data-testid="hero-gallery"
            className="rounded-md border border-ui-border bg-transparent px-6 py-3 text-base font-medium text-text-primary transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Browse gallery
          </Link>
        </div>
      </section>

      <section className="border-t border-ui-border px-6 py-12">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
            What you get
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FEATURES.map(({ title, body }) => (
              <li
                key={title}
                className="rounded-md border border-ui-border bg-ui-surface p-4"
              >
                <h3 className="font-mono text-sm font-medium text-text-primary">
                  {title}
                </h3>
                <p className="mt-1 text-sm text-text-secondary">{body}</p>
              </li>
            ))}
          </ul>

          <div className="flex justify-center pt-4">
            <Link
              href="/editor"
              prefetch={false}
              data-testid="secondary-cta"
              className="font-mono text-sm text-accent hover:text-accent-hover"
            >
              Start painting →
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-ui-border px-6 py-6 text-center text-xs text-text-muted">
        MIT licensed ·{' '}
        <a
          href="https://github.com/ryanssareen/threditor"
          className="text-text-secondary hover:text-text-primary"
          data-testid="footer-github"
        >
          GitHub
        </a>{' '}
        · Not affiliated with Mojang or Microsoft.
      </footer>
    </main>
  );
}
