import { useRef, useState } from 'react';

// Card dell'allegato del rapporto a video: dropzone finché non c'è niente,
// poi nome, formato, peso e le azioni. Stesso schema del caricamento foto.

const ACCEPT = '.pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLabel(type = '', name = '') {
  if (type.includes('pdf') || name.toLowerCase().endsWith('.pdf')) return 'PDF';
  if (type.includes('spreadsheet') || name.toLowerCase().endsWith('.xlsx')) return 'XLSX';
  return 'File';
}

function formatUploadedAt(value) {
  if (!value) return '';
  const date = String(value).slice(0, 10).split('-');
  if (date.length !== 3) return '';
  return `${date[2]}/${date[1]}/${date[0]}`;
}

export default function AttachmentCard({
  attachment = null,
  pendingFileName = '',
  disabled = false,
  readOnly = false,
  onSelect,
  onDelete,
  onDownload
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function pick(files) {
    const file = files?.[0];
    if (file && onSelect) onSelect(file);
  }

  if (!attachment && !pendingFileName) {
    if (readOnly) {
      return <div className="empty-state" style={{ padding: '20px' }}>Nessun allegato su questo rapporto.</div>;
    }
    return (
      <div
        className={`attachment-dropzone${dragging ? ' is-dragging' : ''}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) pick(event.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
      >
        <strong>Trascina qui il PDF o l’XLSX</strong>
        <span>oppure clicca per scegliere il file (max 10 MB)</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(event) => { pick(event.target.files); event.target.value = ''; }}
        />
      </div>
    );
  }

  const name = attachment?.name || pendingFileName;
  return (
    <div className="attachment-card">
      <div className="attachment-meta">
        <strong>{name}</strong>
        <span>
          {attachment
            ? `${formatLabel(attachment.type, name)} · ${formatSize(attachment.size)}${attachment.uploadedAt ? ` · caricato il ${formatUploadedAt(attachment.uploadedAt)}` : ''}`
            : 'In attesa del primo salvataggio'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {attachment && onDownload ? (
          <button type="button" className="ghost-button" onClick={onDownload}>Scarica</button>
        ) : null}
        {!readOnly ? (
          <>
            <button type="button" className="ghost-button" disabled={disabled} onClick={() => inputRef.current?.click()}>
              Sostituisci
            </button>
            <button type="button" className="ghost-button" disabled={disabled} onClick={onDelete}>
              Elimina
            </button>
          </>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(event) => { pick(event.target.files); event.target.value = ''; }}
        />
      </div>
    </div>
  );
}
