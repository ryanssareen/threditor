'use client';

/**
 * M13 Unit 2: profile header.
 *
 * Renders avatar + display name + @username + stats (skin count,
 * total likes, join month) and an "Edit profile" button that is only
 * visible when the signed-in user IS the profile owner.
 *
 * Ownership is decided entirely client-side against the signed-in
 * `user.uid` from useAuth — the server never emits an edit button,
 * which means the cached SSR HTML is identical for all viewers and
 * the profile page stays safe to cache at the CDN.
 *
 * Avatar fallback: when `photoURL === null` we render a 96×96 square
 * with the first letter of the display name. Firebase `User.photoURL`
 * from Google OAuth works but may 403 on aggressive ad-blockers;
 * `onError` swaps back to the initial fallback so the header never
 * shows a broken-image glyph.
 */

import { useState } from 'react';

import { useAuth } from '@/app/_providers/AuthProvider';

import { EditProfileDialog } from './EditProfileDialog';

type Props = {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
  joinedLabel: string | null;
  skinCount: number;
  totalLikes: number;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div
        className="font-mono text-lg font-semibold text-text-primary"
        data-testid={`profile-stat-${label.toLowerCase()}`}
      >
        {value}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </div>
    </div>
  );
}

export function ProfileHeader({
  uid,
  username,
  displayName,
  photoURL,
  joinedLabel,
  skinCount,
  totalLikes,
}: Props) {
  const { user } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const isOwner = user !== null && user.uid === uid;
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';
  const showImage = photoURL !== null && !avatarBroken;

  return (
    <section
      data-testid="profile-header"
      className="mb-8 rounded-lg border border-ui-border bg-ui-surface p-6"
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ui-border bg-ui-base text-3xl font-semibold text-text-secondary"
          data-testid="profile-avatar"
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoURL}
              alt={`${displayName}'s avatar`}
              width={96}
              height={96}
              className="h-full w-full object-cover"
              onError={() => setAvatarBroken(true)}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span aria-hidden="true">{initial}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1
            className="truncate text-2xl font-semibold text-text-primary"
            data-testid="profile-display-name"
          >
            {displayName}
          </h1>
          <p
            className="mt-0.5 font-mono text-sm text-text-secondary"
            data-testid="profile-username"
          >
            @{username}
          </p>
          {joinedLabel !== null && (
            <p
              className="mt-1 font-mono text-xs text-text-muted"
              data-testid="profile-joined"
            >
              Joined {joinedLabel}
            </p>
          )}
        </div>

        {isOwner && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            data-testid="profile-edit-button"
            className="shrink-0 rounded border border-ui-border px-4 py-2 text-sm text-text-secondary transition-colors hover:border-accent/60 hover:text-accent"
          >
            Edit profile
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 border-t border-ui-border pt-4 sm:grid-cols-2">
        <Stat label="Skins" value={skinCount} />
        <Stat label="Likes" value={totalLikes} />
      </div>

      {isOwner && (
        <EditProfileDialog
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          currentDisplayName={displayName}
          username={username}
        />
      )}
    </section>
  );
}
