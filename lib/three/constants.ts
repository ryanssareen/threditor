/**
 * M2: shared constants for the 3D player model.
 * All values pinned here are load-bearing for M3-M7 downstream work.
 * Changing any value requires re-verifying the affected milestone's acceptance tests.
 */

// Skin atlas size (Minecraft Java 1.8+ 64x64 layout)
export const SKIN_ATLAS_SIZE = 64;

// Camera (A.2 in plan inputs — ChatGPT round 4, reframed for full-body shot)
//
// Original ChatGPT spec: position (0, 1.4, 3.2), target (0, 1.2, 0), FOV 32°.
// That framed an upper-torso shot — it clipped the arms and legs on the
// 1.85-unit-tall humanoid. At FOV 32°, vertical extent visible at distance D
// is `2·D·tan(16°)`. For D=3.2, extent ≈ 1.83 — exactly the model height,
// zero margin. Worse, look-target Y=1.2 put the frame's bottom around Y=0.4,
// cutting legs (Y=0–0.65) entirely.
//
// Reframed to full-body shot:
//   D=4.5 → vertical extent ≈ 2.58 units (~0.7 units margin around the model)
//   Target Y=0.9 centers vertically on the model's midpoint
//
// Lesson for future spec consultations: pass the model's bounding-box
// dimensions in the prompt. ChatGPT's round-4 response assumed a shorter
// subject than our actual humanoid.
export const CAMERA_POSITION: readonly [number, number, number] = [0, 1.4, 4.5];
export const CAMERA_LOOK_TARGET: readonly [number, number, number] = [0, 0.9, 0];
export const CAMERA_FOV = 32;

// Idle micro-orbit (A.3 — ChatGPT round 4)
// INVARIANT: zero allocations in the useFrame that consumes these.
export const IDLE_ORBIT_START_SEC = 0.5;
export const IDLE_ORBIT_PERIOD_SEC = 9; // midpoint of 8-10s spec
export const IDLE_ORBIT_AMPLITUDE_RAD = 0.0524; // 3° in radians
export const IDLE_ORBIT_RADIUS = 4.5; // must match CAMERA_POSITION[2]

// Idle breathing (A.4 — DESIGN.md §6, ChatGPT round 3)
export const BREATHING_FREQ_HZ = 1.5;
export const BREATHING_AMPLITUDE = 0.01;
export const HEAD_BASE_Y = 1.4;

// Rim-light color (A.7 — ChatGPT round 3, low-confidence per plan Q3)
// M2 pins this constant but does NOT consume it. First use is M3 hover rim-light.
export const RIM_LIGHT_COLOR = 0x7fd6ff;

// Derived (pre-computed to avoid per-frame trig setup cost)
export const TWO_PI = Math.PI * 2;
export const BREATHING_ANGULAR = TWO_PI * BREATHING_FREQ_HZ;
export const ORBIT_ANGULAR = TWO_PI / IDLE_ORBIT_PERIOD_SEC;
