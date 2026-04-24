import Link from 'next/link';

export default function ProfileNotFound() {
  return (
    <main
      data-testid="profile-not-found"
      className="flex min-h-dvh flex-col items-center justify-center bg-ui-base px-6 py-12 text-center text-text-primary"
    >
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
        404
      </p>
      <h1 className="mt-3 text-3xl font-semibold">Profile not found.</h1>
      <p className="mt-2 max-w-md text-sm text-text-secondary">
        The user you&apos;re looking for hasn&apos;t published a skin yet, or
        the username is spelled differently.
      </p>
      <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row">
        <Link
          href="/gallery"
          prefetch={false}
          className="rounded border border-ui-border px-4 py-2 text-sm text-text-secondary hover:border-accent/60 hover:text-accent"
        >
          Browse gallery
        </Link>
        <Link
          href="/editor"
          prefetch={false}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-canvas hover:bg-accent-hover"
        >
          Open the editor
        </Link>
      </div>
    </main>
  );
}
