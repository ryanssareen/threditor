'use client';

/**
 * M12 Unit 1: 128×128 WebP thumbnail generator for the gallery grid.
 *
 * Same rendering pipeline as lib/editor/og-image.ts (three-point
 * lighting, 3/4 isometric angle, Nearest-filtered CanvasTexture), but
 * at 128×128 and 0.75 WebP quality so each thumbnail is 10–20 KB. At
 * 60 skins per gallery page that is ≤ 1.2 MB of image payload — well
 * inside the Vercel edge bandwidth envelope.
 *
 * Fail-soft: returns null on any error. The publish pipeline falls
 * back to storing the raw 64×64 PNG as the thumbnail URL when this
 * returns null (see app/editor/_components/EditorLayout.tsx).
 *
 * Disposal (COMPOUND M11 invariant): renderer, every BoxGeometry, every
 * MeshStandardMaterial, and the CanvasTexture are disposed in the
 * finally block. Heap snapshot verification matches og-image.ts.
 */

import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

import {
  getUVs,
  mapBoxUVs,
  partDims,
  partPosition,
  type PlayerPart,
  type SkinVariant,
} from '@/lib/three/geometry';

const THUMB_SIZE = 128;
const THUMB_QUALITY = 0.75;

const PARTS: readonly PlayerPart[] = [
  'head',
  'body',
  'rightArm',
  'leftArm',
  'rightLeg',
  'leftLeg',
  'headOverlay',
  'bodyOverlay',
  'rightArmOverlay',
  'leftArmOverlay',
  'rightLegOverlay',
  'leftLegOverlay',
];

export async function generateThumbnail(
  source: HTMLCanvasElement,
  variant: SkinVariant,
): Promise<Blob | null> {
  let renderer: WebGLRenderer | null = null;
  const geometries: BoxGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  let texture: CanvasTexture | null = null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;

    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);

    const scene = new Scene();

    const keyLight = new DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(5, 5, 5).normalize();
    scene.add(keyLight);

    const fillLight = new DirectionalLight(0xaaccff, 0.4);
    fillLight.position.set(-3, 2, 4).normalize();
    scene.add(fillLight);

    const backLight = new DirectionalLight(0xffffff, 0.6);
    backLight.position.set(0, 3, -5).normalize();
    scene.add(backLight);

    scene.add(new AmbientLight(0xffffff, 0.3));

    const camera = new PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(2.5, 1.5, 3.5);
    camera.lookAt(new Vector3(0, 0.8, 0));

    texture = new CanvasTexture(source);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const uvs = getUVs(variant);

    for (const part of PARTS) {
      const [w, h, d] = partDims(variant, part);
      const geo = new BoxGeometry(w, h, d);
      mapBoxUVs(geo, uvs[part]);
      geometries.push(geo);

      const isOverlay = part.endsWith('Overlay');
      const mat = new MeshStandardMaterial({
        map: texture,
        transparent: isOverlay,
        alphaTest: isOverlay ? 0.01 : 0,
        depthWrite: !isOverlay,
      });
      materials.push(mat);

      const mesh = new Mesh(geo, mat);
      const [px, py, pz] = partPosition(variant, part);
      mesh.position.set(px, py, pz);
      scene.add(mesh);
    }

    renderer.render(scene, camera);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', THUMB_QUALITY);
    });

    return blob;
  } catch (err) {
    console.warn('thumbnail: generation failed, publish falls back to raw PNG', err);
    return null;
  } finally {
    for (const mat of materials) mat.dispose();
    for (const geo of geometries) geo.dispose();
    texture?.dispose();
    renderer?.dispose();
  }
}
