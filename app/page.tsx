import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-ui-base px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight text-text-primary sm:text-5xl md:text-6xl">
          A free, open-source 3D Minecraft skin editor for the web.
        </h1>
        <p className="max-w-xl text-balance text-base text-text-secondary sm:text-lg">
          Paint. See your skin live on a 3D model. Export and play.
        </p>
      </div>

      <Link
        href="/editor"
        className="rounded-md bg-accent px-6 py-3 text-base font-semibold text-canvas transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Open the editor
      </Link>

      <footer className="absolute bottom-6 text-xs text-text-muted">
        MIT licensed. Free and open source.
      </footer>
    </main>
  );
}
