// Mini line-chart SVG: una o più curve con punti, asse Y fisso (default 0..2).
// `series` = [{ label, color, points: [{ x: number, y: number|null, title?: string }] }]

const PADDING_X = 16;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;

function buildPath(points, scaleX, scaleY) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.y == null) { pen = false; continue; }
    const cmd = pen ? 'L' : 'M';
    d += `${cmd}${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

export default function Sparkline({
  series = [],
  yMin = 0,
  yMax = 2,
  width = 220,
  height = 80,
  yLabels = ['Migliorabile', 'Standard', 'Qualità']
}) {
  const innerW = width - PADDING_X * 2;
  const innerH = height - PADDING_TOP - PADDING_BOTTOM;

  const allPoints = series.flatMap((s) => s.points);
  const validPoints = allPoints.filter((p) => p.y != null);
  if (validPoints.length === 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="sparkline">
        <text
          x={width / 2}
          y={height / 2 + 4}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize="11"
        >
          Nessun dato
        </text>
      </svg>
    );
  }

  const xs = allPoints.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xRange = xMax - xMin || 1;

  const scaleX = (x) => PADDING_X + ((x - xMin) / xRange) * innerW;
  const scaleY = (y) => PADDING_TOP + (1 - (y - yMin) / (yMax - yMin)) * innerH;

  const yTicks = [];
  for (let v = yMin; v <= yMax; v += 1) yTicks.push(v);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="sparkline"
    >
      {yTicks.map((v) => (
        <line
          key={v}
          x1={PADDING_X}
          x2={width - PADDING_X}
          y1={scaleY(v)}
          y2={scaleY(v)}
          stroke="rgba(18,60,105,0.08)"
          strokeWidth="1"
          strokeDasharray={v === Math.floor((yMin + yMax) / 2) ? '2,3' : '0'}
        />
      ))}

      {series.map((s, idx) => {
        const path = buildPath(s.points, scaleX, scaleY);
        return (
          <g key={`${s.label || idx}-${idx}`}>
            {path ? (
              <path
                d={path}
                fill="none"
                stroke={s.color || 'var(--blue)'}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {s.points.map((p, i) =>
              p.y == null ? null : (
                <circle
                  key={i}
                  cx={scaleX(p.x)}
                  cy={scaleY(p.y)}
                  r={3}
                  fill={s.color || 'var(--blue)'}
                  stroke="#fff"
                  strokeWidth="1.2"
                >
                  {p.title ? <title>{p.title}</title> : null}
                </circle>
              )
            )}
          </g>
        );
      })}

      {yLabels.map((lab, i) => (
        <text
          key={lab}
          x={PADDING_X - 4}
          y={scaleY(yMin + i) + 3}
          textAnchor="end"
          fill="var(--muted)"
          fontSize="8"
        >
          {i === 0 ? '–' : i === yLabels.length - 1 ? '+' : ''}
        </text>
      ))}
    </svg>
  );
}
