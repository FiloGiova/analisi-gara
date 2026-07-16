import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../lib/api.js';
import { useCompetitions } from '../lib/competitions.jsx';

const emptyForm = {
  value: '',
  label: '',
  ccEmails: '',
  emailSignature: '',
  sortOrder: 0,
  active: true
};

// Anteprima locale del template: stessa sostituzione fatta dal server.
function renderTemplatePreview(template, values) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

const PREVIEW_VALUES = {
  nomeArbitro: 'Mario Rossi',
  numeroGara: '000123',
  campionato: 'Divisione Regionale 1',
  dataGara: '2026-03-01',
  squadre: 'Città Alfa - Città Beta',
  ruolo: '1° arbitro',
  firma: 'Formatori Divisione Regionale 1'
};

function EmailTemplateCard() {
  const [template, setTemplate] = useState('');
  const [placeholders, setPlaceholders] = useState([]);
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.getEmailTemplate()
      .then((data) => {
        setTemplate(data.template);
        setPlaceholders(data.placeholders || []);
        setDefaultTemplate(data.defaultTemplate);
        setIsDefault(data.isDefault);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossibile caricare il modello email.'));
  }, []);

  async function handleSave(nextTemplate) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.saveEmailTemplate(nextTemplate);
      setTemplate(data.template);
      setIsDefault(data.isDefault);
      setSuccess(data.isDefault ? 'Ripristinato il modello di default.' : 'Modello email salvato.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio del modello non riuscito.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="common-card">
      <div className="section-heading">
        <div>
          <h2>Modello email</h2>
          <p>
            Corpo dell'email con cui i rapporti vengono inviati agli arbitri, uguale per tutti i campionati.
            Segnaposto disponibili: {placeholders.map((key) => `{{${key}}}`).join(', ')}.
          </p>
        </div>
        {!isDefault ? (
          <button type="button" className="ghost-button" onClick={() => handleSave('')} disabled={busy}>
            Ripristina default
          </button>
        ) : null}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSave(template);
        }}
      >
        <label className="field">
          Testo del modello
          <textarea
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            rows={9}
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
          />
          <small>La firma ({'{{firma}}'}) è quella configurata sul campionato della gara.</small>
        </label>

        <div className="field" style={{ marginTop: '12px' }}>
          <span>Anteprima con dati di esempio</span>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: 'var(--paper)',
              border: '1px solid var(--line)',
              borderRadius: '10px',
              padding: '12px',
              fontSize: '0.85rem',
              margin: '6px 0 0'
            }}
          >
            {renderTemplatePreview(template, PREVIEW_VALUES)}
          </pre>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || template === defaultTemplate && isDefault}
          >
            {busy ? 'Salvataggio...' : 'Salva modello'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Modal({ title, children, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Chiudi</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function AdminCompetitionsPage({ currentUser }) {
  const { reload: reloadShared } = useCompetitions();
  const [competitions, setCompetitions] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadCompetitions() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listCompetitions();
      setCompetitions(data.competitions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare i campionati.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentUser.role === 'admin') {
      loadCompetitions();
    } else {
      setLoading(false);
    }
  }, [currentUser.role]);

  if (currentUser.role !== 'admin') {
    return (
      <div className="empty-state">
        <h2>Area riservata agli admin</h2>
      </div>
    );
  }

  function openCreate() {
    setEditId(null);
    setForm({ ...emptyForm, sortOrder: competitions.length + 1 });
    setShowModal(true);
  }

  function openEdit(competition) {
    setEditId(competition.id);
    setForm({
      value: competition.value,
      label: competition.label,
      ccEmails: competition.ccEmails,
      emailSignature: competition.emailSignature,
      sortOrder: competition.sortOrder,
      active: competition.active
    });
    setShowModal(true);
  }

  function updateForm(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      if (editId) {
        await api.updateCompetition(editId, form);
        setSuccess('Campionato aggiornato.');
      } else {
        await api.createCompetition(form);
        setSuccess('Campionato creato.');
      }
      setShowModal(false);
      setForm(emptyForm);
      setEditId(null);
      await loadCompetitions();
      reloadShared();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Salvataggio non riuscito.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(competition) {
    setError('');
    setSuccess('');
    try {
      await api.updateCompetition(competition.id, { active: !competition.active });
      setSuccess(competition.active ? 'Campionato disattivato: sparisce dalle nuove selezioni.' : 'Campionato riattivato.');
      await loadCompetitions();
      reloadShared();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aggiornamento non riuscito.');
    }
  }

  return (
    <div className="page-stack">
      {showModal ? (
        <Modal title={editId ? 'Modifica campionato' : 'Nuovo campionato'} onClose={() => setShowModal(false)}>
          <form className="modal-form" onSubmit={handleSubmit}>
            <label className="field">
              Codice
              <input
                value={form.value}
                onChange={(event) => updateForm('value', event.target.value)}
                placeholder="es. DR2"
                required
                readOnly={Boolean(editId)}
                disabled={Boolean(editId)}
              />
              {editId ? (
                <small>Il codice non è modificabile: è la chiave salvata su rapporti, gare e assegnazioni.</small>
              ) : (
                <small>Codice breve e stabile (es. DR1, Serie C): una volta creato non si potrà cambiare.</small>
              )}
            </label>
            <label className="field">
              Nome
              <input
                value={form.label}
                onChange={(event) => updateForm('label', event.target.value)}
                placeholder="es. Divisione Regionale 2"
              />
            </label>
            <label className="field">
              CC email rapporti
              <input
                value={form.ccEmails}
                onChange={(event) => updateForm('ccEmails', event.target.value)}
                placeholder="es. formatori.dr2@fip.it, designatore@fip.it"
              />
              <small>Indirizzi separati da virgola, messi in copia a ogni invio dei rapporti di questo campionato.</small>
            </label>
            <label className="field">
              Firma email
              <input
                value={form.emailSignature}
                onChange={(event) => updateForm('emailSignature', event.target.value)}
                placeholder={`es. Formatori ${form.label || form.value || 'campionato'}`}
              />
              <small>Compare in chiusura dell'email. Vuota = "Formatori&nbsp;{form.label || '<nome campionato>'}".</small>
            </label>
            <label className="field">
              Ordinamento
              <input
                type="number"
                value={form.sortOrder}
                onChange={(event) => updateForm('sortOrder', Number(event.target.value))}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setShowModal(false)}>Annulla</button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Salvataggio...' : editId ? 'Salva modifiche' : 'Crea campionato'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      <section className="dashboard-hero admin-hero">
        <div>
          <p className="eyebrow">Amministrazione</p>
          <h1>Campionati</h1>
          <p>Crea e rinomina i campionati, imposta i CC delle email e la firma per ognuno.</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="hero-button" onClick={openCreate}>
            + Nuovo campionato
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}

      <section className="common-card">
        <div className="section-heading">
          <div>
            <h2>Campionati configurati</h2>
            <p>I campionati disattivati restano sui dati storici ma spariscono dalle nuove selezioni.</p>
          </div>
        </div>

        {loading ? <div className="empty-state">Caricamento campionati...</div> : null}
        {!loading && competitions.length === 0 ? (
          <div className="empty-state">Nessun campionato configurato.</div>
        ) : null}

        {!loading && competitions.length > 0 ? (
          <div className="users-list">
            {competitions.map((competition) => (
              <article className="user-row" key={competition.id}>
                <div>
                  <span className="match-number">{competition.value}</span>
                  <h3>{competition.label}</h3>
                  <p>
                    CC: {competition.ccEmails || '—'}
                    {' · '}
                    Firma: {competition.emailSignature || `Formatori ${competition.label}`}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'center' }}>
                  <span
                    className={`status-badge ${competition.active ? 'status-final' : 'status-draft'}`}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {competition.active ? 'Attivo' : 'Disattivo'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <button type="button" className="ghost-button" onClick={() => openEdit(competition)}>
                    Modifica
                  </button>
                  <button type="button" className="ghost-button" onClick={() => toggleActive(competition)}>
                    {competition.active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <EmailTemplateCard />
    </div>
  );
}
