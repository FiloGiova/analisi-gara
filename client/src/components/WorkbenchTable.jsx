import StatusBadge from './StatusBadge.jsx';
import { formatMatchNumber } from '../lib/formatters.js';

function relativeDate(value) {
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} giorni fa`;
  return new Date(value).toLocaleDateString('it-IT');
}

function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('it-IT'); } catch (_) { return value; }
}

function surname(lastName, fullName) {
  return String(lastName || fullName || '').trim() || null;
}

function SortTh({ col, label, sortColumn, sortDir, onSort, style }) {
  const active = sortColumn === col;
  const cls = ['sortable', active ? 'sort-active' : '', active && sortDir === 'asc' ? 'sort-asc' : ''].filter(Boolean).join(' ');
  return (
    <th className={cls} style={style} onClick={() => onSort(col)}>{label}</th>
  );
}

function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5.5 1h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1ZM2 3.5A.5.5 0 0 1 2.5 3h10a.5.5 0 0 1 0 1H12l-.87 8.28A1.5 1.5 0 0 1 9.64 13.5H5.36a1.5 1.5 0 0 1-1.49-1.22L3 4H2.5A.5.5 0 0 1 2 3.5ZM4.01 4l.86 8.09a.5.5 0 0 0 .5.41h4.26a.5.5 0 0 0 .5-.41L10.99 4H4.01Z" fill="currentColor"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M6 9L1.5 4.5H4.5V1H7.5V4.5H10.5L6 9Z"/>
      <rect x="1" y="10.25" width="10" height="1.5" rx="0.75"/>
    </svg>
  );
}

export default function WorkbenchTable({ reports, sortColumn, sortDir, onSort, onNavigate, onExport, onDelete, exportingId, canManage, currentUser }) {
  const isReferee = currentUser?.role === 'referee';
  const canSeeObserver = currentUser?.role === 'admin' || currentUser?.role === 'instructor';

  if (!reports.length) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="workbench-table">
        <thead>
          <tr>
            <SortTh col="matchNumber" label="Gara" sortColumn={sortColumn} sortDir={sortDir} onSort={onSort} style={{ width: 80 }} />
            <th>Squadre</th>
            <th style={{ width: 84 }}>Risultato</th>
            <th style={{ width: 120 }}>Campionato</th>
            <SortTh col="reportDate" label="Data" sortColumn={sortColumn} sortDir={sortDir} onSort={onSort} style={{ width: 100 }} />
            {canSeeObserver && <th style={{ width: 120 }}>Osservatore</th>}
            <th style={{ width: 110 }}>Arbitri</th>
            <th style={{ width: 100 }}>Stato</th>
            <SortTh col="updatedAt" label="Agg." sortColumn={sortColumn} sortDir={sortDir} onSort={onSort} style={{ width: 90 }} />
            <th style={{ width: 72, textAlign: 'right' }}>Azioni</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const [teamHome, teamAway] = (report.teams || '').split(' - ');
            const exporting = exportingId === report.id;
            const surnameFirst = surname(report.firstRefereeSurname, report.firstRefereeName);
            const surnameSecond = surname(report.secondRefereeSurname, report.secondRefereeName);
            return (
              <tr key={report.id} onClick={() => onNavigate(report.id)}>
                <td className="match-num-cell">#{formatMatchNumber(report.matchNumber, report.id)}</td>
                <td className="teams-cell">
                  {teamHome || '—'}
                  <span className="vs-sep">vs</span>
                  {teamAway || '—'}
                </td>
                <td className="score-cell">{report.result || '—'}</td>
                <td><span className="competition-chip">{report.competition || '—'}</span></td>
                <td>{formatDate(report.reportDate)}</td>
                {canSeeObserver && <td>{report.observerName || '—'}</td>}
                <td className="referees-cell">
                  {surnameFirst ? <span className="referee-surname">{surnameFirst}</span> : null}
                  {surnameSecond ? <span className="referee-surname">{surnameSecond}</span> : null}
                  {!surnameFirst && !surnameSecond ? '—' : null}
                </td>
                <td><StatusBadge status={report.status} /></td>
                <td className="updated-cell">{relativeDate(report.updatedAt)}</td>
                <td>
                  <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                    {!isReferee && (
                      <button type="button" className="ghost-button btn-with-icon" onClick={() => onExport(report)} disabled={exporting}>
                        {exporting ? '…' : <><DownloadIcon />PDF</>}
                      </button>
                    )}
                    {canManage(report) && (
                      <button type="button" className="btn-icon btn-icon-danger" onClick={() => onDelete(report)} title="Elimina rapporto">
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
