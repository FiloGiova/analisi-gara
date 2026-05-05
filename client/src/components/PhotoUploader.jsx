import { useRef, useState } from 'react';
import UserAvatar from './UserAvatar.jsx';

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.85;

async function resizeImage(file) {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  if (scale === 1 && file.size < 800 * 1024) {
    bitmap.close?.();
    return file;
  }
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) return file;
  return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export default function PhotoUploader({
  photoPath,
  name,
  onUpload,
  onDelete,
  size = 96,
  label = 'Foto profilo'
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function handleChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setBusy('upload');
    try {
      const prepared = await resizeImage(file);
      await onUpload(prepared);
    } catch (err) {
      setError(err.message || 'Upload non riuscito.');
    } finally {
      setBusy('');
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setError('');
    setBusy('delete');
    try {
      await onDelete();
    } catch (err) {
      setError(err.message || 'Eliminazione non riuscita.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="photo-uploader">
      <UserAvatar photoPath={photoPath} name={name} size={size} ring />
      <div className="photo-uploader-actions">
        <span className="photo-uploader-label">{label}</span>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ghost-button"
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(busy)}
          >
            {busy === 'upload' ? 'Carico...' : photoPath ? 'Cambia foto' : 'Carica foto'}
          </button>
          {photoPath && onDelete ? (
            <button type="button" className="danger-button" onClick={handleDelete} disabled={Boolean(busy)}>
              {busy === 'delete' ? 'Rimuovo...' : 'Rimuovi'}
            </button>
          ) : null}
        </div>
        {error ? <small style={{ color: 'var(--danger)' }}>{error}</small> : null}
        <small style={{ color: 'var(--muted)' }}>JPEG/PNG/WEBP, max 2 MB. Verrà ridimensionata a 1024 px.</small>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  );
}
