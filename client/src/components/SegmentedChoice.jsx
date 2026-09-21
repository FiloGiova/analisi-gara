export default function SegmentedChoice({ label, options, value, onChange, compact = false, tone = '' }) {
  return (
    <div className={`choice-block ${compact ? 'choice-compact' : ''} ${tone === 'judgement' ? 'choice-judgement' : ''}`}>
      {label ? <div className="choice-label">{label}</div> : null}
      <div className="segmented-choice" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option}
            data-rating={option}
            role="radio"
            aria-checked={value === option}
            tabIndex={value === option || (!options.includes(value) && option === options[0]) ? 0 : -1}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = options.indexOf(option);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + options.length) % options.length;
              onChange(options[next]);
              event.currentTarget.parentElement.children[next].focus();
            }}
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
