export default function SegmentedChoice({ label, options, value, onChange, compact = false }) {
  return (
    <div className={`choice-block ${compact ? 'choice-compact' : ''}`}>
      {label ? <div className="choice-label">{label}</div> : null}
      <div className="segmented-choice" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option}
            data-rating={option}
            className={value === option ? 'is-selected' : ''}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
