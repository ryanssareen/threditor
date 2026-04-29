'use client';

import { useEffect, useRef, useState } from 'react';

type Topic = 'bug' | 'feature' | 'press' | 'other';

const TOPICS: ReadonlyArray<{ value: Topic; label: string }> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature idea' },
  { value: 'press', label: 'Press' },
  { value: 'other', label: 'Other' },
];

type InfoRow = {
  label: string;
  value: string;
  href?: string;
};

const INFO: ReadonlyArray<InfoRow> = [
  { label: 'Email', value: 'team@threditor.app', href: 'mailto:team@threditor.app' },
  { label: 'GitHub', value: 'github.com/threditor/threditor', href: 'https://github.com/threditor/threditor' },
  { label: 'Discord', value: 'discord.gg/threditor', href: 'https://discord.gg/threditor' },
  { label: 'Press', value: 'press@threditor.app', href: 'mailto:press@threditor.app' },
  { label: 'Status', value: 'All systems normal · status.threditor.app' },
];

const MESSAGE_MAX = 800;
const NAME_MAX = 60;

type Errors = Partial<Record<'name' | 'email' | 'message', string>>;

export default function LandingContact() {
  const [topic, setTopic] = useState<Topic>('bug');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
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

  function showToast(kind: 'success' | 'error', text: string) {
    setToast({ kind, text });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const topicLabel =
        TOPICS.find((t) => t.value === topic)?.label.toLowerCase() ?? topic;
      showToast('success', `Sent. We'll reply about your ${topicLabel} within 48h.`);
      setName('');
      setEmail('');
      setMessage('');
      setTopic('bug');
    } catch {
      showToast('error', "Couldn't send. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const counterOver = message.length >= MESSAGE_MAX;

  return (
    <section id="contact" className="section">
      <div className="landing-container">
        <header className="section__head">
          <p className="section__eyebrow">Contact</p>
          <h2 className="section__title">
            Found a bug? Want a feature?{' '}
            <span className="section__title-accent">Tell us.</span>
          </h2>
          <p className="section__lede">
            We read everything. Real humans, no support queue, replies usually
            within 48 hours.
          </p>
        </header>

        <div className="contact__layout">
          <div className="contact__info">
            <p className="contact__info-copy">
              Threditor is built by a tiny team. The fastest path to a fix is a
              clear repro — paste the prompt, attach a screenshot, tell us your
              browser. For partnerships and press, reach out below or by email.
            </p>
            <ul className="contact__info-list">
              {INFO.map((row) => (
                <li key={row.label} className="contact__info-row">
                  <span className="contact__info-label">{row.label}</span>
                  {row.href !== undefined ? (
                    <a
                      className="contact__info-value"
                      href={row.href}
                      target={row.href.startsWith('http') ? '_blank' : undefined}
                      rel={row.href.startsWith('http') ? 'noreferrer' : undefined}
                    >
                      {row.value}
                    </a>
                  ) : (
                    <span className="contact__info-value">{row.value}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

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
                aria-describedby={errors.name !== undefined ? 'contact-name-error' : undefined}
                autoComplete="name"
                required
              />
              <span id="contact-name-error" className="contact__error">
                {errors.name ?? ''}
              </span>
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
                aria-describedby={errors.email !== undefined ? 'contact-email-error' : undefined}
                autoComplete="email"
                required
              />
              <span id="contact-email-error" className="contact__error">
                {errors.email ?? ''}
              </span>
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
                aria-describedby={errors.message !== undefined ? 'contact-message-error' : 'contact-message-counter'}
                maxLength={MESSAGE_MAX}
                required
              />
              <span id="contact-message-error" className="contact__error">
                {errors.message ?? ''}
              </span>
            </div>

            <div className="contact__form-footer">
              <span
                id="contact-message-counter"
                className="contact__counter"
                data-warn={counterOver ? 'true' : 'false'}
              >
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
        </div>
      </div>
      {toast !== null && (
        <div
          className="toast"
          data-kind={toast.kind}
          role="status"
          aria-live="polite"
        >
          <span className="toast__dot" />
          <span>{toast.text}</span>
        </div>
      )}
    </section>
  );
}
