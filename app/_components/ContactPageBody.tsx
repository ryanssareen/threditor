'use client';

import { useEffect, useRef, useState } from 'react';

type Topic = 'bug' | 'feature' | 'press' | 'other';

const TOPICS: ReadonlyArray<{ value: Topic; label: string }> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature idea' },
  { value: 'press', label: 'Press' },
  { value: 'other', label: 'Other' },
];

type InfoRow = { label: string; value: string; href?: string };

// Only include real, working contact channels. Placeholders from the
// design (Discord, Press inbox, Status page) are omitted because they
// don't exist yet — better to show nothing than a dead link.
const INFO: ReadonlyArray<InfoRow> = [
  {
    label: 'Email',
    value: 'ryansareen6@gmail.com',
    href: 'mailto:ryansareen6@gmail.com',
  },
  {
    label: 'GitHub',
    value: 'github.com/ryanssareen/threditor',
    href: 'https://github.com/ryanssareen/threditor',
  },
];

const MESSAGE_MAX = 800;
const NAME_MAX = 60;

type Errors = Partial<Record<'name' | 'email' | 'message', string>>;

export default function ContactPageBody() {
  const [topic, setTopic] = useState<Topic>('bug');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  function validate(): Errors {
    const next: Errors = {};
    if (name.trim().length === 0) next.name = 'Name is required.';
    if (email.trim().length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Enter a valid email.';
    }
    if (message.trim().length < 10) {
      next.message = 'Message must be at least 10 characters.';
    }
    return next;
  }

  function showToast(kind: 'success' | 'error', text: string): void {
    setToast({ kind, text });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          topic,
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const code = data.error ?? `http_${res.status}`;
        showToast(
          'error',
          code === 'service_misconfigured'
            ? "Email isn't set up yet — try again later."
            : "Couldn't send. Try again or email us directly.",
        );
        return;
      }
      setSent(true);
      const topicLabel = TOPICS.find((t) => t.value === topic)?.label.toLowerCase() ?? topic;
      showToast('success', `Sent. We'll reply about your ${topicLabel} within 48h.`);
    } catch {
      showToast('error', "Couldn't send. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const counterOver = message.length >= MESSAGE_MAX;

  return (
    <div className="contact-page">
      <div className="landing-container">
        <div className="contact-grid">
          <aside className="contact-info">
            <p className="contact-info__copy">
              Threditor is built by a tiny team. The fastest path to a fix is a
              clear repro — paste the prompt, attach a screenshot, tell us your
              browser. For partnerships and press, reach out using the form or
              by email.
            </p>

            <ul className="contact-list" aria-label="Contact details">
              {INFO.map((row) => (
                <li key={row.label} className="contact-list__item">
                  <span className="contact-list__k">{row.label}</span>
                  {row.href !== undefined ? (
                    <a
                      className="contact-list__v"
                      href={row.href}
                      target={row.href.startsWith('http') ? '_blank' : undefined}
                      rel={row.href.startsWith('http') ? 'noreferrer' : undefined}
                    >
                      {row.value}
                    </a>
                  ) : (
                    <span className="contact-list__v">{row.value}</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="contact-response-note">
              <span className="contact-response-note__dot" aria-hidden="true" />
              <p>
                <strong>Typical response time: under 48 hours.</strong>
                <br />
                Bug reports with a clear repro get prioritised. Attach your
                prompt and browser version for the fastest fix.
              </p>
            </div>
          </aside>

          <div>
            {sent ? (
              <div className="contact__form" style={{ textAlign: 'center', padding: '32px' }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 56,
                    height: 56,
                    margin: '0 auto 16px',
                    borderRadius: 9999,
                    background: 'rgba(34,197,94,0.1)',
                    border: '1px solid rgba(34,197,94,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    color: '#22c55e',
                  }}
                >
                  ✓
                </div>
                <h3 style={{ margin: 0, fontSize: 20 }}>Message sent.</h3>
                <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)', fontSize: 14 }}>
                  We&apos;ll be in touch within 48 hours.
                </p>
              </div>
            ) : (
              <form className="contact__form" onSubmit={handleSubmit} noValidate>
                <div className="contact__field">
                  <label className="contact__label" htmlFor="contact-name">
                    Name <span className="contact__label-req">*</span>
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    className="contact__control"
                    placeholder="ember"
                    value={name}
                    maxLength={NAME_MAX}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={errors.name !== undefined}
                    autoComplete="name"
                    required
                  />
                  <span className="contact__error">{errors.name ?? ''}</span>
                </div>

                <div className="contact__field">
                  <label className="contact__label" htmlFor="contact-email">
                    Email <span className="contact__label-req">*</span>
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    className="contact__control"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={errors.email !== undefined}
                    autoComplete="email"
                    required
                  />
                  <span className="contact__error">{errors.email ?? ''}</span>
                </div>

                <div className="contact__field">
                  <span className="contact__label">Topic</span>
                  <div className="contact__topics" role="radiogroup" aria-label="Topic">
                    {TOPICS.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        role="radio"
                        aria-checked={topic === t.value}
                        className="contact__topic"
                        onClick={() => setTopic(t.value)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="contact__field">
                  <label className="contact__label" htmlFor="contact-message">
                    Message <span className="contact__label-req">*</span>
                  </label>
                  <textarea
                    id="contact-message"
                    className="contact__control"
                    placeholder="What happened, and what did you expect?"
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
                    aria-invalid={errors.message !== undefined}
                    maxLength={MESSAGE_MAX}
                    required
                  />
                  <span className="contact__error">{errors.message ?? ''}</span>
                </div>

                <div className="contact__form-footer">
                  <span className="contact__counter" data-warn={counterOver ? 'true' : 'false'}>
                    {message.length} / {MESSAGE_MAX}
                  </span>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    disabled={submitting}
                    aria-busy={submitting}
                  >
                    {submitting ? 'Sending…' : 'Send message →'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {toast !== null && (
        <div className="toast" data-kind={toast.kind} role="status" aria-live="polite">
          <span className="toast__dot" />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
