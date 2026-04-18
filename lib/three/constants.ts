/**
 * M2: shared constants for the 3D player model.
 * All values pinned here are load-bearing for M3-M7 downstream work.
 * Changing any value requires re-verifying the affected milestone's acceptance tests.
 */

// Skin atlas size (Minecraft Java 1.8+ 64x64 layout)
export const SKIN_ATLAS_SIZE = 64;

// Camera (A.2 in plan inputs — ChatGPT round 4)
export const CAMERA_POSITION: readonly [number, number, number] = [0, 1.4, 3.2];
export const CAMERA_LOOK_TARGET: readonly [number, number, number] = [0, 1.2, 0];
export const CAMERA_FOV = 32;

// Idle micro-orbit (A.3 — ChatGPT round 4)
// INVARIANT: zero allocations in the useFrame that consumes these.
export const IDLE_ORBIT_START_SEC = 0.5;
export const IDLE_ORBIT_PERIOD_SEC = 9; // midpoint of 8-10s spec
export const IDLE_ORBIT_AMPLITUDE_RAD = 0.0524; // 3° in radians
export const IDLE_ORBIT_RADIUS = 3.2; // matches CAMERA_POSITION[2]

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
