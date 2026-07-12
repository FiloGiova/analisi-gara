import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { Field, TextArea } from './Field.jsx';

function hasAnyEvaluationContent(evaluation) {
  if (!evaluation || !evaluation.sections) return false;
  return Object.values(evaluation.sections).some((section) => {
    if (!section) return false;
    const ratings = section.ratings || {};
    if (Object.values(ratings).some((value) => Boolean(value))) return true;
    return Boolean(section.comment && section.comment.trim());
  });
}

function hasMinimumData(reportData) {
  if (!reportData) return false;
  if (!reportData.teamHome?.trim() || !reportData.teamAway?.trim()) return false;
  return hasAnyEvaluationContent(reportData.evaluation);
}

export default function JudgmentAIHelper({ reportData, value, onChange }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [hasGenerated, setHasGenerated] = useState(Boolean(value && value.trim()));
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const minimumDataMissing = !hasMinimumData(reportData);
  const generateDisabled = loading || minimumDataMissing;
  const reviseDisabled = loading || !feedback.trim() || !value || !value.trim();

  async function runGenerate() {
    if (value && value.trim().length > 0) {
      const ok = window.confirm('Sovrascrivere il giudizio attuale?');
      if (!ok) return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.generateJudgment(reportData);
      if (!mountedRef.current) return;
      onChange(data.judgment || '');
      setHasGenerated(true);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof ApiError ? err.message : 'Generazione non riuscita.';
      setError(message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function runRevise() {
    setLoading(true);
    setError('');
    try {
      const data = await api.reviseJudgment({
        currentJudgment: value || '',
        observerFeedback: feedback
      });
      if (!mountedRef.current) return;
      onChange(data.judgment || '');
      setFeedback('');
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof ApiError ? err.message : 'Revisione non riuscita.';
      setError(message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  const generateTitle = minimumDataMissing
    ? 'Compila almeno squadre e una sezione di valutazione.'
    : '';

  return (
    <div className="judgment-ai-helper" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Giudizio globale">
        <TextArea
          rows={5}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Punti di forza, aree di miglioramento, sintesi finale..."
        />
      </Field>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="primary-button"
          onClick={runGenerate}
          disabled={generateDisabled}
          title={generateTitle}
        >
          {loading && !feedback ? 'Generazione in corso…' : '✦ Genera giudizio globale'}
        </button>
      </div>

      {error ? <div className="error-banner"><span>{error}</span></div> : null}

      {hasGenerated ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder='Es: "enfatizza la gestione del gioco fermo"'
            maxLength={500}
            disabled={loading}
            style={{ flex: '1 1 280px' }}
          />
          <button
            type="button"
            className="ghost-button"
            onClick={runRevise}
            disabled={reviseDisabled}
          >
            {loading && feedback ? 'Riscrittura in corso…' : 'Riscrivi'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
