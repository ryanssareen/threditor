/**
 * M8 Unit 4: luminance shader module for the 3D viewport.
 *
 * - Shared `grayscaleUniform` object. Every patched material references
 *   the same `.value`, so toggling the flag propagates to every mesh
 *   without a shader recompile and without needing
 *   `material.customProgramCacheKey` management.
 *
 * - `#include <opaque_fragment>` is the three.js 0.184 chunk token.
 *   It was renamed from `<output_fragment>` in three r152/r154
 *   (migration guide). Using the old token silently no-ops because
 *   `replace()` matches nothing — a DESIGN §10 snippet had the old
 *   token; M8 Unit 0 corrected it.
 *
 * - Luma formula: Rec. 601 weights (0.299, 0.587, 0.114). Good enough
 *   for value-contrast checking; the alternatives (Rec. 709, perceptual
 *   luma) change the shade marginally and aren't worth the debate.
 *
 * - The patch is idempotent: if a material already has an
 *   onBeforeCompile, we compose instead of overwrite.
 *
 * - Pure module: no React, no zustand, no three imports beyond types.
 *   The subscriber lives in PlayerModel (Unit 5).
 */

import type { Material } from 'three';

type GrayscaleUniform = { value: boolean };

export const grayscaleUniform: GrayscaleUniform = { value: false };

const GRAYSCALE_TAG = '__threditor_grayscale_patched__';

type PatchedMaterial = Material & {
  [GRAYSCALE_TAG]?: boolean;
};

/**
 * Attach the grayscale shader patch to a three.js material. Safe to
 * call multiple times on the same material — subsequent calls are
 * no-ops.
 */
export function patchMaterial(material: Material): void {
  const m = material as PatchedMaterial;
  if (m[GRAYSCALE_TAG] === true) return;
  m[GRAYSCALE_TAG] = true;

  const prior = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prior === 'function') prior.call(material, shader, renderer);

    // Share the uniform REFERENCE. three mutates shader.uniforms during
    // compile, but the shared object identity is preserved, so mutating
    // grayscaleUniform.value propagates to the GPU on the next frame.
    shader.uniforms.uGrayscale = grayscaleUniform;

    shader.fragmentShader =
      'uniform bool uGrayscale;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        #include <opaque_fragment>
        if (uGrayscale) {
          float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
          gl_FragColor.rgb = vec3(luma);
        }
        `,
      );
  };
}

/** Test-only helper: reset the patch tag so the same material can be re-patched. */
export function __resetPatchTagForTest(material: Material): void {
  (material as PatchedMaterial)[GRAYSCALE_TAG] = undefined;
}
