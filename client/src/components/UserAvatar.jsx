function initialsOf(text) {
  if (!text) return '?';
  const parts = String(text).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
}

export default function UserAvatar({ photoPath, name, size = 40, ring = false }) {
  const dimension = `${size}px`;
  const fontSize = `${Math.round(size * 0.4)}px`;
  const baseStyle = {
    width: dimension,
    height: dimension,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize,
    overflow: 'hidden',
    boxShadow: ring ? '0 0 0 3px rgba(255,255,255,0.65), 0 8px 18px rgba(16,37,45,0.16)' : '0 4px 10px rgba(16,37,45,0.12)'
  };

  if (photoPath) {
    return (
      <span style={baseStyle} className="user-avatar">
        <img
          src={`/api/photos/profiles/${encodeURIComponent(photoPath)}`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }

  return (
    <span
      style={{
        ...baseStyle,
        background: 'linear-gradient(135deg, var(--blue), var(--teal))',
        color: '#fff'
      }}
      className="user-avatar"
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
