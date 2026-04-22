// @vitest-environment node
//
// M8 Unit 4: grayscale-shader tests.
//
// Tests verify:
//   - patchMaterial installs an onBeforeCompile that adds the luma branch
//   - multiple materials share the same grayscaleUniform reference
//   - re-patching the same material is a no-op
//   - the new token `<opaque_fragment>` is used (NOT the old
//     `<output_fragment>`) so the replace actually happens when the
//     shader compiles on a real three.js instance

import { describe, expect, it } from 'vitest';

import {
  __resetPatchTagForTest,
  grayscaleUniform,
  patchMaterial,
} from '../lib/editor/grayscale-shader';

// Minimal mock that looks enough like three.js Material to exercise the
// patch logic without importing three (keeps this test in the node env).
type Shader = {
  uniforms: Record<string, { value: unknown }>;
  fragmentShader: string;
};

type MockMaterial = {
  onBeforeCompile?: (shader: Shader, renderer: unknown) => void;
};

// A realistic-ish r184 fragment shader fragment so the replace has a
// real target. Taken from three.js' meshphysical.glsl.js skeleton.
const SAMPLE_FRAGMENT_SHADER = `
void main() {
  #include <clipping_planes_fragment>
  vec4 diffuseColor = vec4( diffuse, opacity );
  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  vec3 totalEmissiveRadiance = emissive;
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`.trim();

function runPatch(m: MockMaterial): Shader {
  const shader: Shader = {
    uniforms: {},
    fragmentShader: SAMPLE_FRAGMENT_SHADER,
  };
  m.onBeforeCompile?.(shader, {} as unknown);
  return shader;
}

describe('grayscale-shader', () => {
  it('grayscaleUniform starts at value=false', () => {
    expect(grayscaleUniform.value).toBe(false);
  });

  it('patchMaterial installs an onBeforeCompile callback', () => {
    const m: MockMaterial = {};
    expect(m.onBeforeCompile).toBeUndefined();
    patchMaterial(m as unknown as import('three').Material);
    expect(typeof m.onBeforeCompile).toBe('function');
  });

  it('patched shader contains the luma calculation', () => {
    const m: MockMaterial = {};
    patchMaterial(m as unknown as import('three').Material);
    const shader = runPatch(m);
    expect(shader.fragmentShader).toContain('uniform bool uGrayscale');
    expect(shader.fragmentShader).toContain('float luma = dot');
    expect(shader.fragmentShader).toContain('vec3(0.299, 0.587, 0.114)');
  });

  it('patched shader replaced opaque_fragment, not output_fragment', () => {
    const m: MockMaterial = {};
    patchMaterial(m as unknown as import('three').Material);
    const shader = runPatch(m);
    // After replace, opaque_fragment should still appear (it's included
    // at the top of the replacement block) — but the luma branch
    // should appear AFTER it.
    const opaqueIdx = shader.fragmentShader.indexOf('#include <opaque_fragment>');
    const lumaIdx = shader.fragmentShader.indexOf('float luma = dot');
    expect(opaqueIdx).toBeGreaterThan(-1);
    expect(lumaIdx).toBeGreaterThan(opaqueIdx);
    // And the old token should NOT be anywhere.
    expect(shader.fragmentShader).not.toContain('#include <output_fragment>');
  });

  it('patched shader binds shader.uniforms.uGrayscale to the shared reference', () => {
    const m: MockMaterial = {};
    patchMaterial(m as unknown as import('three').Material);
    const shader = runPatch(m);
    expect(shader.uniforms.uGrayscale).toBe(grayscaleUniform);
  });

  it('two materials patched independently share the same uniform identity', () => {
    const m1: MockMaterial = {};
    const m2: MockMaterial = {};
    patchMaterial(m1 as unknown as import('three').Material);
    patchMaterial(m2 as unknown as import('three').Material);
    const s1 = runPatch(m1);
    const s2 = runPatch(m2);
    expect(s1.uniforms.uGrayscale).toBe(s2.uniforms.uGrayscale);
    expect(s1.uniforms.uGrayscale).toBe(grayscaleUniform);
  });

  it('re-patching a material is a no-op (idempotent)', () => {
    const m: MockMaterial = {};
    patchMaterial(m as unknown as import('three').Material);
    const first = m.onBeforeCompile;
    patchMaterial(m as unknown as import('three').Material);
    expect(m.onBeforeCompile).toBe(first);
  });

  it('patchMaterial composes with a pre-existing onBeforeCompile', () => {
    let priorCalls = 0;
    const m: MockMaterial = {
      onBeforeCompile: () => {
        priorCalls += 1;
      },
    };
    // Force-reset the tag because we faked a prior callback before
    // patch. (In production, patchMaterial always runs on fresh
    // materials; this test case covers the composition branch.)
    __resetPatchTagForTest(m as unknown as import('three').Material);
    patchMaterial(m as unknown as import('three').Material);
    const shader = runPatch(m);
    expect(priorCalls).toBe(1);
    expect(shader.fragmentShader).toContain('float luma = dot');
  });

  it('flipping grayscaleUniform.value does not require recompile (reference-shared)', () => {
    const m: MockMaterial = {};
    patchMaterial(m as unknown as import('three').Material);
    const shader = runPatch(m);
    expect(shader.uniforms.uGrayscale.value).toBe(false);
    grayscaleUniform.value = true;
    expect(shader.uniforms.uGrayscale.value).toBe(true);
    // Cleanup — tests after this expect the uniform at false.
    grayscaleUniform.value = false;
  });
});
