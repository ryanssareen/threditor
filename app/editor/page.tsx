import { EditorHeader } from '../_components/EditorHeader';
import { EditorLayout } from './_components/EditorLayout';

export default function EditorPage() {
  return (
    <>
      <EditorHeader />
      {/* Header is fixed at 56px (h-14); offset the editor so it
          doesn't sit behind it. EditorLayout uses h-dvh internally;
          the pt-14 wrapper does NOT add to its height because the
          inner element's h-dvh overrides. Instead, the editor's
          root height is reduced in EditorLayout.tsx to match. */}
      <div>
        <EditorLayout />
      </div>
    </>
  );
}
