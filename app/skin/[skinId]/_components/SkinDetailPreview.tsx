'use client';

/**
 * M13.1: always-on 3D viewer for the skin detail page.
 *
 * Server Components can't use `next/dynamic` with `ssr: false`, so we
 * isolate the dynamic import inside this tiny client wrapper. The
 * three.js bundle streams in after the shell paints; while it does,
 * the loading skeleton holds the aspect-square slot open so layout
 * doesn't jump when the Canvas mounts.
 */

import dynamic from 'next/dynamic';

const SkinPreview3D = dynamic(
  () =>
    import('@/app/gallery/_components/SkinPreview3D').then((mod) => ({
      default: mod.SkinPreview3D,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="skin-detail-preview-loading"
        className="h-full w-full animate-pulse bg-ui-base"
      />
    ),
  },
);

type Props = {
  skinUrl: string;
  variant: 'classic' | 'slim';
};

export function SkinDetailPreview({ skinUrl, variant }: Props) {
  return (
    <SkinPreview3D
      skinUrl={skinUrl}
      variant={variant}
      className="h-full w-full"
    />
  );
}
