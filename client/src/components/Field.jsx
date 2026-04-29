export function Field({ label, children, hint, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function TextInput(props) {
  return <input {...props} />;
}

export function TextArea(props) {
  return <textarea rows={props.rows || 4} {...props} />;
}
