'use client';

/**
 * M11 Unit 2: 1200×630 WebP OG preview image generator.
 *
 * Renders a headless three.js scene (separate from the editor's live
 * R3F canvas) of the painted model, 3/4 isometric angle, three-point
 * lighting. Exports via `canvas.toBlob(cb, 'image/webp', 0.85)`.
 *
 * Per DESIGN §11.6. Runs client-side to avoid server GPU costs.
 *
 * Fail-soft: if WebGL is unavailable or the encode fails, returns
 * `null` and logs a warning. Caller (PublishDialog handler in Unit 6)
 * treats null as "publish without OG" per plan D5.
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

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OG_QUALITY = 0.85;

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

/**
 * Render the painted skin as a 1200×630 WebP. Returns null if WebGL
 * is unavailable, the encode fails, or any other render-time error
 * fires. Caller must handle null gracefully.
 *
 * `source` accepts either the editor's 64×64 TextureManager canvas or
 * a raw HTMLCanvasElement — both wrap cleanly into a THREE.CanvasTexture.
 */
export async function generateOGImage(
  source: HTMLCanvasElement,
  variant: SkinVariant,
): Promise<Blob | null> {
  let renderer: WebGLRenderer | null = null;
  const geometries: BoxGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  let texture: CanvasTexture | null = null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = OG_WIDTH;
    canvas.height = OG_HEIGHT;

    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // required for toBlob
    });
    renderer.setSize(OG_WIDTH, OG_HEIGHT, false);

    const scene = new Scene();

    // Three-point lighting per DESIGN §11.6.
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

    const camera = new PerspectiveCamera(35, OG_WIDTH / OG_HEIGHT, 0.1, 100);
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
      canvas.toBlob(
        (b) => resolve(b),
        'image/webp',
        OG_QUALITY,
      );
    });

    return blob;
  } catch (err) {
    console.warn('og-image: generation failed, publish will proceed without OG', err);
    return null;
  } finally {
    // Dispose GPU resources. Order matters: texture last because it's
    // still referenced by materials at this point.
    for (const mat of materials) mat.dispose();
    for (const geo of geometries) geo.dispose();
    texture?.dispose();
    renderer?.dispose();
  }
}
