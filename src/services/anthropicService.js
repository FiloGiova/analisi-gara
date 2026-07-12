import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { buildGenerationMessages, buildRevisionMessages } from './judgmentPromptBuilder.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_TOKENS = 600;

async function callAnthropic({ system, messages, temperature, userId }) {
  if (!config.anthropicApiKey) {
    throw new HttpError(500, 'AI non configurata.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': config.anthropicApiVersion,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: MAX_TOKENS,
        temperature,
        system,
        messages
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new HttpError(504, 'Timeout AI.');
    }
    console.error('[ai] Errore di rete verso Anthropic:', err.message);
    throw new HttpError(502, 'Servizio AI non disponibile.');
  }
  clearTimeout(timeout);

  if (!response.ok) {
    let upstreamMessage = '';
    try {
      const body = await response.json();
      upstreamMessage = body?.error?.message || '';
    } catch (_) {
      // ignora — manteniamo solo lo status
    }
    console.error(`[ai] Anthropic ${response.status}: ${upstreamMessage || '(no body)'}`);
    throw new HttpError(502, 'Servizio AI non disponibile.', { upstreamStatus: response.status });
  }

  const data = await response.json().catch(() => null);
  const block = data?.content?.[0];
  const text = block?.type === 'text' ? String(block.text || '').trim() : '';
  if (!text) {
    throw new HttpError(502, 'Risposta AI non valida.');
  }

  if (data?.usage) {
    const userInfo = userId ? ` user=${userId}` : '';
    console.log(`[ai]${userInfo} model=${config.anthropicModel} input=${data.usage.input_tokens ?? '?'} output=${data.usage.output_tokens ?? '?'}`);
  }

  return text;
}

export async function generateJudgment(reportData, { userId } = {}) {
  const { system, messages } = buildGenerationMessages(reportData);
  return callAnthropic({ system, messages, temperature: 0.4, userId });
}

export async function reviseJudgment(currentJudgment, observerFeedback, { userId } = {}) {
  const { system, messages } = buildRevisionMessages(currentJudgment, observerFeedback);
  return callAnthropic({ system, messages, temperature: 0.3, userId });
}
