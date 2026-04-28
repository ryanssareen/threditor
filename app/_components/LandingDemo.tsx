'use client';

import { useEffect, useRef, useState } from 'react';

const SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'forest knight, mossy leather', prompt: 'a forest knight in mossy leather armor' },
  { label: 'redstone wizard, glowing staff', prompt: 'redstone wizard with a glowing staff' },
  { label: 'lava golem, cracked obsidian', prompt: 'lava golem with cracked obsidian skin' },
  { label: 'snow-pirate captain', prompt: 'snow-pirate captain in a frosted hat' },
];

const STACK: ReadonlyArray<{ name: string; role: string }> = [
  { name: 'groq · llama-3.1-70b', role: 'prompt shaping · ~600 tok/s' },
  { name: 'cloudflare workers ai', role: 'sdxl lightning · edge gpu' },
  { name: 'image-q · rgbquant', role: '16-color quantize · ciede2000' },
  { name: 'react three fiber', role: 'live 3d preview · 60 fps' },
];

const PIPELINE_STEPS: ReadonlyArray<{ label: string; ms: number }> = [
  { label: 'Shaping prompt with Groq…', ms: 600 },
  { label: 'Generating 512×512 with Cloudflare…', ms: 1400 },
  { label: 'Quantizing to 16 colors (CIEDE2000)…', ms: 600 },
  { label: 'Decoding RLE → 64×64 atlas…', ms: 400 },
];

const PLACEHOLDER = 'a glow-in-the-dark astronaut with a cyan visor';

type DemoState = 'idle' | 'busy' | 'done';

export default function LandingDemo() {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<DemoState>('idle');
  const [statusText, setStatusText] = useState(
    'Idle. Type a prompt or pick a suggestion.',
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, []);

  function fillFromChip(value: string) {
    setPrompt(value);
    inputRef.current?.focus();
  }

  async function runFakePipeline() {
    if (state === 'busy') return;
    const trimmed = (prompt.trim().length > 0 ? prompt : PLACEHOLDER).trim();
    cancelRef.current = { cancelled: false };
    const token = cancelRef.current;
    setState('busy');
    let elapsed = 0;
    for (const step of PIPELINE_STEPS) {
      if (token.cancelled) return;
      setStatusText(step.label);
      await delay(step.ms);
      elapsed += step.ms;
    }
    if (token.cancelled) return;
    const seconds = (elapsed / 1000).toFixed(1);
    const truncated =
      trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
    setStatusText(`Done in ${seconds}s · "${truncated}"`);
    setState('done');
  }

  return (
    <section id="how" className="section section--demo">
      <div className="landing-container">
        <header className="section__head">
          <p className="section__eyebrow">How it works</p>
          <h2 className="section__title">
            One <span className="section__title-accent">prompt</span>. Three
            hops. A skin.
          </h2>
          <p className="section__lede">
            Your prompt fans out across two of the fastest inference platforms
            on the internet, then collapses back into a 4 KB PNG.
          </p>
        </header>

        <div className="demo__stack">
          {STACK.map((item) => (
            <div key={item.name} className="demo__stack-item">
              <div className="demo__stack-name">{item.name}</div>
              <div className="demo__stack-role">{item.role}</div>
            </div>
          ))}
        </div>

        <div className="demo__panel" id="demo">
          <p className="demo__panel-eyebrow">
            Try a prompt — local-only demo, no network call
          </p>
          <div className="demo__row">
            <input
              ref={inputRef}
              type="text"
              className="demo__input"
              placeholder={PLACEHOLDER}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runFakePipeline();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runFakePipeline()}
              disabled={state === 'busy'}
            >
              Generate ✨
            </button>
          </div>
          <div className="demo__chips">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.prompt}
                type="button"
                className="demo__chip"
                onClick={() => fillFromChip(s.prompt)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="demo__status" data-state={state}>
            <span className="demo__status-dot" />
            <span>{statusText}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
