import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { PocketPingClient } from '../client';

interface Props {
  client: PocketPingClient;
  onDone: () => void;
}

// 1..5 emoji faces — mirrors the bridge notification (lib/bridges csatFace).
const FACES: { score: number; emoji: string; label: string }[] = [
  { score: 1, emoji: '😡', label: 'Very unhappy' },
  { score: 2, emoji: '😕', label: 'Unhappy' },
  { score: 3, emoji: '😐', label: 'Neutral' },
  { score: 4, emoji: '🙂', label: 'Happy' },
  { score: 5, emoji: '😍', label: 'Very happy' },
];

export function CsatCard({ client, onDone }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const submit = async (finalScore: number) => {
    setIsSubmitting(true);
    setError('');
    try {
      await client.submitCsat(finalScore, comment);
      setSubmitted(true);
      // Briefly show the thank-you, then dismiss.
      setTimeout(onDone, 2200);
    } catch {
      setError('Could not send your rating. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div class="pp-csat pp-csat-thanks">
        <span class="pp-csat-thanks-emoji">{score ? FACES[score - 1].emoji : '🙏'}</span>
        <span>Thanks for your feedback!</span>
      </div>
    );
  }

  return (
    <div class="pp-csat">
      <div class="pp-csat-title">How was our help?</div>
      <div class="pp-csat-faces" role="radiogroup" aria-label="Rate this conversation">
        {FACES.map((f) => (
          <button
            key={f.score}
            type="button"
            role="radio"
            aria-checked={score === f.score}
            aria-label={f.label}
            title={f.label}
            class={`pp-csat-face ${score === f.score ? 'selected' : ''}`}
            disabled={isSubmitting}
            onClick={() => {
              setScore(f.score);
              // No comment yet → one-tap submit. If they want to comment, the
              // textarea below stays available until they submit.
              if (!comment.trim()) {
                void submit(f.score);
              }
            }}
          >
            {f.emoji}
          </button>
        ))}
      </div>

      {score !== null && !isSubmitting && (
        <div class="pp-csat-comment">
          <textarea
            class="pp-csat-textarea"
            placeholder="Tell us more… (optional)"
            value={comment}
            maxLength={1000}
            onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
          />
          <button
            type="button"
            class="pp-csat-submit"
            disabled={isSubmitting}
            onClick={() => score !== null && submit(score)}
          >
            Send
          </button>
        </div>
      )}

      {error && <div class="pp-csat-error">{error}</div>}

      {!isSubmitting && (
        <button type="button" class="pp-csat-dismiss" onClick={onDone}>
          Dismiss
        </button>
      )}
    </div>
  );
}
