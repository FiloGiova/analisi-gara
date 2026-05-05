import { useState } from 'react';
import { EVALUATION_SECTIONS, POTENTIAL_OPTIONS, getRefereeLabel } from '../../../shared/reportTemplate.js';
import SegmentedChoice from './SegmentedChoice.jsx';
import { Field, TextArea, TextInput } from './Field.jsx';
import ConfirmModal from './ConfirmModal.jsx';

function groupTechniqueItems(groups) {
  return groups.reduce((acc, group) => {
    const category = group.category || 'Valutazioni';
    if (!acc.has(category)) acc.set(category, []);
    acc.get(category).push(group);
    return acc;
  }, new Map());
}

function isSectionComplete(section, sectionData) {
  return (
    section.groups.every((g) => Boolean(sectionData?.ratings?.[g.id])) &&
    (!section.requiredCommentForFinal || Boolean(sectionData?.comment?.trim()))
  );
}

function TechniqueCard({ category, groups, sectionData, onRatingChange, compact = false }) {
  return (
    <div className={`technique-subcard ${compact ? 'technique-subcard-compact' : ''}`}>
      <h4>{category}</h4>
      {groups.map((group) => (
        <SegmentedChoice
          key={group.id}
          label={groups.length === 1 ? null : group.label}
          options={group.options}
          value={sectionData.ratings[group.id]}
          onChange={(rating) => onRatingChange(group.id, rating)}
          compact
        />
      ))}
    </div>
  );
}

function RatingCard({ group, value, onChange }) {
  const match = group.label.match(/^(\d+\.\d+)\s+([\s\S]*)/);
  const number = match ? match[1] : null;
  const text = match ? match[2] : group.label;
  return (
    <div className="rating-card">
      {number && <span className="rating-card-number">{number}</span>}
      <h4>{text}</h4>
      <SegmentedChoice
        options={group.options}
        value={value}
        onChange={onChange}
        compact
      />
    </div>
  );
}

function CopyConfirmModal({ fromRole, onConfirm, onCancel }) {
  return (
    <ConfirmModal
      title="Copia valutazione"
      confirmLabel="Sì, copia"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      Stai per copiare la valutazione del <strong>{getRefereeLabel(fromRole)}</strong> su questa scheda.
      {' '}<strong>Le modifiche non salvate andranno perse.</strong> Vuoi continuare?
    </ConfirmModal>
  );
}

export default function EvaluationEditor({ role, refereeName, value, onChange, otherRole, onCopyFromOther }) {
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);

  function updateSection(sectionId, updater) {
    const current = value.sections[sectionId];
    onChange({
      ...value,
      sections: {
        ...value.sections,
        [sectionId]: updater(current)
      }
    });
  }

  function setRating(sectionId, groupId, rating) {
    updateSection(sectionId, (section) => ({
      ...section,
      ratings: { ...section.ratings, [groupId]: rating }
    }));
  }

  function setComment(sectionId, comment) {
    updateSection(sectionId, (section) => ({ ...section, comment }));
  }

  function setVote(rawValue) {
    const vote = rawValue.replace(/\D/g, '').slice(0, 2);
    onChange({ ...value, vote });
  }

  return (
    <div className="evaluation-editor">
      {showCopyConfirm && (
        <CopyConfirmModal
          fromRole={otherRole}
          onConfirm={() => { setShowCopyConfirm(false); onCopyFromOther(); }}
          onCancel={() => setShowCopyConfirm(false)}
        />
      )}

      <div className="evaluation-hero">
        <div>
          <p>{role === 'first' ? 'Scheda 1° arbitro' : 'Scheda 2° arbitro'}</p>
          <h2>{refereeName || 'Nome arbitro non inserito'}</h2>
        </div>
        {onCopyFromOther && (
          <button type="button" className="ghost-button" onClick={() => setShowCopyConfirm(true)}>
            Copia da {getRefereeLabel(otherRole)}
          </button>
        )}
      </div>

      {EVALUATION_SECTIONS.map((section) => {
        const sectionData = value.sections[section.id];
        const isTechnique = section.id === 'technique';
        const isMultiGroup = !isTechnique && section.groups.length > 1;
        const techniqueCategories = isTechnique ? [...groupTechniqueItems(section.groups)] : [];
        const mainTechniqueCategories = techniqueCategories.slice(0, 3);
        const compactTechniqueCategories = techniqueCategories.slice(3);
        const complete = isSectionComplete(section, sectionData);

        return (
          <section className="evaluation-card" key={section.id}>
            <div className="section-heading">
              <div>
                <h3>{section.title}</h3>
                {section.description ? <p>{section.description}</p> : null}
              </div>
              {complete && <span className="section-check">✓</span>}
            </div>

            {isTechnique ? (
              <div className="technique-grid">
                {mainTechniqueCategories.map(([category, groups]) => (
                  <TechniqueCard
                    key={category}
                    category={category}
                    groups={groups}
                    sectionData={sectionData}
                    onRatingChange={(groupId, rating) => setRating(section.id, groupId, rating)}
                  />
                ))}
                <div className="technique-stack">
                  {compactTechniqueCategories.map(([category, groups]) => (
                    <TechniqueCard
                      key={category}
                      category={category}
                      groups={groups}
                      sectionData={sectionData}
                      onRatingChange={(groupId, rating) => setRating(section.id, groupId, rating)}
                      compact
                    />
                  ))}
                </div>
              </div>
            ) : isMultiGroup ? (
              <div className="rating-cards-grid">
                {section.groups.map((group) => (
                  <RatingCard
                    key={group.id}
                    group={group}
                    value={sectionData.ratings[group.id]}
                    onChange={(rating) => setRating(section.id, group.id, rating)}
                  />
                ))}
              </div>
            ) : (
              <div className="rating-grid">
                {section.groups.map((group) => (
                  <SegmentedChoice
                    key={group.id}
                    label={group.label}
                    options={group.options}
                    value={sectionData.ratings[group.id]}
                    onChange={(rating) => setRating(section.id, group.id, rating)}
                  />
                ))}
              </div>
            )}

            {section.commentLabel ? (
              <Field label={section.commentLabel}>
                <TextArea
                  value={sectionData.comment || ''}
                  onChange={(event) => setComment(section.id, event.target.value)}
                  placeholder="Scrivi qui il commento da riportare nel rapporto..."
                />
              </Field>
            ) : null}
          </section>
        );
      })}

      <section className="evaluation-card closing-card">
        <Field label="Giudizio globale">
          <TextArea
            rows={5}
            value={value.globalJudgement}
            onChange={(event) => onChange({ ...value, globalJudgement: event.target.value })}
            placeholder="Punti di forza, aree di miglioramento, sintesi finale..."
          />
        </Field>

        <Field label="Eventuali errori tecnici">
          <TextArea
            value={value.technicalErrors}
            onChange={(event) => onChange({ ...value, technicalErrors: event.target.value })}
            placeholder="Indicare tipo di errore e riferimento tempo di gioco. Se assenti: NO"
          />
        </Field>

        <Field label="Voto">
          <TextInput
            className="vote-input"
            inputMode="numeric"
            maxLength={2}
            value={value.vote || ''}
            onChange={(event) => setVote(event.target.value)}
            placeholder="00"
          />
        </Field>
      </section>

      <section className="evaluation-card private-card">
        <div className="section-heading">
          <div>
            <h3>Potenzialità</h3>
            <p>Campo interno: non sarà visibile nei PDF esportati.</p>
          </div>
          <span className="private-pill">Non esportata</span>
        </div>

        <SegmentedChoice
          label="Livello"
          options={POTENTIAL_OPTIONS}
          value={value.potential.level}
          onChange={(level) => onChange({ ...value, potential: { ...value.potential, level } })}
          compact
        />

        <Field label="Motivazione privata">
          <TextArea
            value={value.potential.comment}
            onChange={(event) => onChange({ ...value, potential: { ...value.potential, comment: event.target.value } })}
            placeholder="Nota interna non inclusa nel PDF..."
          />
        </Field>
      </section>
    </div>
  );
}
