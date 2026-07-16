// Invio email tramite l'API HTTPS di Brevo (https://developers.brevo.com):
// stessa interfaccia `sendMail` del transporter nodemailer, così emailService
// non distingue tra i due driver. Necessario su Render Free, dove le porte
// SMTP in uscita (25/465/587) sono bloccate; l'API viaggia sulla 443.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

let fetchImpl = (...args) => globalThis.fetch(...args);

export function setBrevoFetchForTests(fn) {
  fetchImpl = fn;
}

// 'FischioLab <a@b.it>' → { name: 'FischioLab', email: 'a@b.it' }; 'a@b.it' → { email: 'a@b.it' }.
export function parseSender(from) {
  const match = String(from || '').match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (match) {
    const name = (match[1] || '').trim();
    return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
  }
  return { email: String(from || '').trim() };
}

export function createBrevoTransport(apiKey) {
  return {
    async sendMail(message) {
      const payload = {
        sender: parseSender(message.from),
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text
      };
      if (Array.isArray(message.cc) && message.cc.length) {
        payload.cc = message.cc.map((email) => ({ email }));
      }
      if (Array.isArray(message.attachments) && message.attachments.length) {
        payload.attachment = message.attachments.map((item) => ({
          name: item.filename,
          content: Buffer.from(item.content).toString('base64')
        }));
      }

      const response = await fetchImpl(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.json())?.message || '';
        } catch (_) {
          detail = '';
        }
        // Il messaggio finisce nel log invii (report_email_log.error_message).
        throw new Error(`Brevo ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      return response.json().catch(() => ({}));
    }
  };
}
