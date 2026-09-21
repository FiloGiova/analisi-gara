export default function JudgementBadge({ value }) {
  return <span className="status-badge judgement-badge" data-rating={value}>{value || 'Giudizio non inserito'}</span>;
}
