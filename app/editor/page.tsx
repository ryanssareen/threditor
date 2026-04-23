import { EditorLayout } from './_components/EditorLayout';

// M11: EditorHeader is now rendered inside EditorLayout so the Publish
// handler has direct access to the store + TextureManager. Removing
// the wrapper div that M10 added — EditorLayout's own return value
// now includes the fixed header and the reduced-height content stack.
export default function EditorPage() {
  return <EditorLayout />;
}
