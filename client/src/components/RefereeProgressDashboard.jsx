import { useEffect, useMemo, useState } from 'react';
import { RATING_SCALE_MAX, REPORT_TEMPLATE_VERSION, sectionsForVersion } from '../../../shared/reportTemplate.js';
import { api } from '../lib/api.js';
import Sparkline from './Sparkline.jsx';
import { formatMatchNumber, formatVote } from '../lib/formatters.js';

const GROUP_COLORS = ['#123c69', '#1d6f78', '#e27d36', '#6f7c85', '#a04ea0', '#15745b'];

function groupBySectionCategory(section) {
  const map = new Map();
  for (const group of section.groups) {
    const cat = group.category || section.title;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(group);
  }
  return [...map.entries()].map(([category, groups]) => ({ category, groups }));
}

function buildSeriesForGroups(groups, matches, sectionId) {
  return groups.map((group, idx) => {
    const points = matches.map((m, i) => {
      const key = `${sectionId}.${group.id}`;
      const value = m.ratings?.[key];
      return {
        x: i,
        y: value ?? null,
        title: m.matchNumber
          ? `Gara ${formatMatchNumber(m.matchNumber)} (${m.date}): ${value ?? 'N/V'}`
          : `${m.date}: ${value ?? 'N/V'}`
      };
    });
    return {
      label: group.label,
      color: GROUP_COLORS[idx % GROUP_COLORS.length],
      points
    };
  });
}

function ProgressCard({ section, matches, yMax }) {
  const isMulti = section.groups.length > 1;
  const isTechnique = section.id === 'technique';
  const categories = isTechnique ? groupBySectionCategory(section) : null;
  const [activeCat, setActiveCat] = useState(0);

  let series;
  if (isTechnique && categories) {
    const groups = categories[activeCat]?.groups || [];
    series = buildSeriesForGroups(groups, matches, section.id);
  } else {
    series = buildSeriesForGroups(section.groups, matches, section.id);
  }

  return (
    <div className="progress-card">
      <header className="progress-card-header">
        <h3>{section.title}</h3>
        {section.description ? <p>{section.description}</p> : null}
      </header>

      {isTechnique && categories ? (
        <div className="progress-tabs">
          {categories.map((cat, idx) => (
            <button
              key={cat.category}
              type="button"
              className={idx === activeCat ? 'is-active' : ''}
              onClick={() => setActiveCat(idx)}
            >
              {cat.category.replace(/^\d+\.\d+\s+/, '')}
            </button>
          ))}
        </div>
      ) : null}

      <Sparkline series={series} height={isMulti ? 96 : 72} yMax={yMax} />

      {isMulti ? (
        <div className="progress-legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              <span>{s.label.replace(/^\d+\.\d+(\.\d+)?\s+/, '')}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function RefereeProgressDashboard({ refereeId, season }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!refereeId) return;
    setLoading(true);
    setError('');
    api.getRefereeProgress(refereeId, { season })
      .then((res) => setData(res.progress))
      .catch((err) => setError(err.message || 'Impossibile caricare l\'andamento.'))
      .finally(() => setLoading(false));
  }, [refereeId, season]);

  const matches = data?.matches || [];
  const videoMatches = data?.videoMatches || [];
  // Le curve seguono la struttura con cui i rapporti della stagione sono stati
  // scritti, altrimenti una stagione in archivio resterebbe vuota.
  const sections = sectionsForVersion(data?.templateVersion || REPORT_TEMPLATE_VERSION);
  const scaleMax = data?.ratingScaleMax || RATING_SCALE_MAX;

  const trendIcon = useMemo(() => {
    if (!data) return '';
    if (data.trend === 'up') return '▲';
    if (data.trend === 'down') return '▼';
    return '–';
  }, [data]);

  if (!refereeId) return null;
  if (loading) return <div className="empty-state" style={{ padding: 18 }}>Caricamento andamento…</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!matches.length) {
    return (
      <div className="empty-state" style={{ padding: 18 }}>
        <h3>Andamento non ancora disponibile</h3>
        <p>
          I grafici appaiono dopo i primi rapporti completi della stagione.
          {videoMatches.length
            ? ` Le ${videoMatches.length} visionature a video contano come rapporti, ma non hanno valutazioni per sezione.`
            : ''}
        </p>
      </div>
    );
  }

  return (
    <section className="progress-dashboard">
      <header className="progress-dashboard-header">
        <div>
          <p className="eyebrow">Andamento stagione</p>
          <h2>Curva delle valutazioni</h2>
          <p className="progress-subtitle">{matches.length} rapporti finalizzati · {data.season}</p>
        </div>
        {data.averageVote != null ? (
          <div className="progress-vote-pill">
            <span className="progress-vote-trend">{trendIcon}</span>
            <strong>{formatVote(data.averageVote)}</strong>
            <small>media voto</small>
          </div>
        ) : null}
      </header>

      {videoMatches.length ? (
        <div className="progress-video-strip">
          <span className="progress-video-label">A video ({videoMatches.length})</span>
          {videoMatches.map((match) => (
            <span
              key={match.id}
              className="progress-video-tick judgement-badge"
              data-rating={match.judgement}
              title={`${match.matchNumber ? `Gara ${formatMatchNumber(match.matchNumber)} · ` : ''}${match.date}${match.judgement ? ` · ${match.judgement}` : ''}`}
            >
              {match.judgement || 'visionatura'}
            </span>
          ))}
        </div>
      ) : null}

      <div className="progress-grid">
        {sections.map((section) => (
          <ProgressCard key={section.id} section={section} matches={matches} yMax={scaleMax} />
        ))}
      </div>
    </section>
  );
}
