import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-12 text-text-primary">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="mb-2 text-2xl font-semibold">Skin not found</h1>
        <p className="mb-6 text-text-secondary">
          This skin may have been deleted or the link is wrong.
        </p>
        <Link
          href="/"
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-canvas hover:bg-accent-hover"
        >
          Back to editor
        </Link>
      </div>
    </main>
  );
}
