import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { config } from '../config.js';
import { dbGet, dbRun } from '../database/db.js';
import { putObject } from './storageService.js';
import {
  CLOSING_FIELDS,
  bandForVote,
  deriveSeason,
  formatVote,
  getRefereeLabel,
  getRefereeNumber,
  matchCharacteristicsForPayload,
  sectionsForPayload,
  templateVersionOf
} from '../../shared/reportTemplate.js';

function safeSeasonSegment(season) {
  const raw = String(season || '').replace('/', '-');
  const cleaned = raw.replace(/[^a-zA-Z0-9-]/g, '');
  return cleaned || 'no-season';
}

const PAGE = {
  size: 'A4',
  margin: 34,
  bottomSafe: 58
};

const COLORS = {
  ink: '#10252d',
  muted: '#65747b',
  blue: '#123c69',
  teal: '#1d6f78',
  paper: '#fbfaf6',
  card: '#ffffff',
  cardSoft: '#f5faf8',
  line: '#d7e4df',
  comment: '#fff8ea',
  commentLine: '#ead7ad',
  warning: '#f0b84f',
  standard: '#6f7c85',
  quality: '#15745b',
  neutral: '#eef4f2'
};

// Scala a cinque livelli: gli estremi portano il colore pieno, i due gradini
// intermedi la stessa tinta smorzata, lo standard resta neutro. La difficoltà
// della gara usa una rampa monocromatica, dal più chiaro al più scuro.
const RATING_STYLES = {
  'Migliorabile': { fill: '#f0b84f', text: '#3f2b09' },
  'Sotto lo standard': { fill: '#fbe9c8', text: '#74501d', stroke: '#ead7ad' },
  'Standard': { fill: '#dce4e7', text: '#2a3e47', stroke: '#c0ccd1' },
  'Sopra lo standard': { fill: '#d3ebdb', text: '#186b47', stroke: '#a8d5bc' },
  'Di qualità': { fill: '#15745b', text: '#ffffff' },
  'Eccellente': { fill: '#15745b', text: '#ffffff' },
  'Facile': { fill: '#f1f4f5', text: '#45555c', stroke: '#d8dfe2' },
  'Di normale difficoltà': { fill: '#d6dee1', text: '#33434a', stroke: '#c0ccd1' },
  'Normale': { fill: '#d6dee1', text: '#33434a', stroke: '#c0ccd1' },
  'Impegnativa': { fill: '#a9b6bc', text: '#17262c', stroke: '#93a3ab' },
  'Difficile': { fill: '#55636b', text: '#ffffff' },
  'N.V.': { fill: '#ffffff', text: COLORS.standard, stroke: COLORS.standard },
  'N/V': { fill: '#ffffff', text: COLORS.standard, stroke: COLORS.standard }
};

const FONT_FILES = {
  regular: 'node_modules/@fontsource/montserrat/files/montserrat-latin-400-normal.woff',
  medium: 'node_modules/@fontsource/montserrat/files/montserrat-latin-500-normal.woff',
  semibold: 'node_modules/@fontsource/montserrat/files/montserrat-latin-600-normal.woff',
  bold: 'node_modules/@fontsource/montserrat/files/montserrat-latin-700-normal.woff',
  extrabold: 'node_modules/@fontsource/montserrat/files/montserrat-latin-800-normal.woff'
};

const FONTS = {
  regular: 'Montserrat',
  medium: 'Montserrat-Medium',
  semibold: 'Montserrat-SemiBold',
  bold: 'Montserrat-Bold',
  extrabold: 'Montserrat-ExtraBold'
};

function safeFilePart(value) {
  const cleaned = String(value || 'rapporto')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'rapporto';
}

function extractSurname(fullName) {
  const tokens = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return '';
  if (tokens.length === 1) return tokens[0];

  const first = tokens[0];
  const second = tokens[1];
  const firstLooksLikeSurname = first === first.toUpperCase() && second !== second.toUpperCase();
  const allCaps = tokens.every((token) => token === token.toUpperCase());
  if (allCaps) return first;
  return firstLooksLikeSurname ? first : tokens[tokens.length - 1];
}

async function refereeSurnameForRole(report, role) {
  const refereeId = role === 'first'
    ? report.data?.firstRefereeId || report.firstRefereeId
    : report.data?.secondRefereeId || report.secondRefereeId;
  if (refereeId) {
    const row = await dbGet('SELECT last_name FROM referees WHERE id = ?', [refereeId]);
    if (row?.last_name) return row.last_name;
  }
  const refereeName = role === 'first' ? report.data.firstRefereeName : report.data.secondRefereeName;
  return extractSurname(refereeName);
}

function textOrDash(value) {
  return value ? String(value) : '-';
}

function findLogoPath() {
  const candidates = [
    path.join(config.rootDir, 'client', 'public', 'logo-fip.png'),
    path.join(config.rootDir, 'dist', 'client', 'logo-fip.png')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function registerFonts(doc) {
  try {
    let loaded = false;
    for (const [key, relativePath] of Object.entries(FONT_FILES)) {
      const fontPath = path.join(config.rootDir, relativePath);
      if (fs.existsSync(fontPath)) {
        doc.registerFont(FONTS[key], fontPath);
        loaded = true;
      }
    }
    doc.__customFontsLoaded = loaded;
    return loaded;
  } catch (error) {
    console.warn('Impossibile caricare Montserrat nel PDF, uso font standard.', error.message);
    doc.__customFontsLoaded = false;
    return false;
  }
}

function fontName(doc, weight = 'regular') {
  return doc.__customFontsLoaded ? FONTS[weight] : weight === 'regular' ? 'Helvetica' : 'Helvetica-Bold';
}

function setFont(doc, weight = 'regular', size = 9, color = COLORS.ink) {
  doc.font(fontName(doc, weight)).fontSize(size).fillColor(color);
  return doc;
}

function drawPageBackground(doc) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.paper);
  doc.circle(doc.page.width + 48, -24, 145).fill('#edf6f3');
  doc.circle(-42, doc.page.height + 18, 125).fill('#fff2dc');
  doc.restore();
}

function addPage(doc) {
  doc.addPage();
  drawPageBackground(doc);
}

function ensureSpace(doc, height = 90) {
  if (doc.y + height > doc.page.height - PAGE.bottomSafe) {
    addPage(doc);
    doc.y = PAGE.margin;
  }
}

function ratingStyle(value) {
  return RATING_STYLES[value] || { fill: COLORS.neutral, text: COLORS.muted, stroke: COLORS.line };
}

const CHIP_FONT_SIZE = 6.7;

// Il chip si dimensiona sull'opzione più lunga del gruppo, così misura e
// disegno cadono sempre sulla stessa larghezza e le etichette restano su una
// riga anche con "SOPRA LO STANDARD".
function chipWidthForGroup(doc, group) {
  setFont(doc, 'semibold', CHIP_FONT_SIZE);
  const widest = (group.options || []).reduce(
    (max, option) => Math.max(max, doc.widthOfString(String(option).toUpperCase())),
    0
  );
  return Math.max(62, Math.ceil(widest) + 14);
}

function addRatingChip(doc, value, x, y, width = 74) {
  const style = ratingStyle(value);
  doc.save();
  if (style.stroke) {
    doc.roundedRect(x, y, width, 16, 8).fillAndStroke(style.fill, style.stroke);
  } else {
    doc.roundedRect(x, y, width, 16, 8).fill(style.fill);
  }
  setFont(doc, 'semibold', CHIP_FONT_SIZE, style.text).text(textOrDash(value).toUpperCase(), x + 5, y + 4.2, {
    width: width - 10,
    align: 'center',
    lineBreak: false
  });
  doc.restore();
}

function labelValue(doc, label, value, x, y, width) {
  setFont(doc, 'semibold', 6.8, COLORS.teal).text(label.toUpperCase(), x, y, { width });
  setFont(doc, 'medium', 8.4, COLORS.ink).text(textOrDash(value), x, y + 10, {
    width,
    lineGap: 0.4
  });
}

function addHeader(doc, report, role) {
  const logoPath = findLogoPath();
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const refereeName = role === 'first' ? report.data.firstRefereeName : report.data.secondRefereeName;

  if (logoPath) {
    doc.image(logoPath, left, 28, { width: 124 });
  }

  setFont(doc, 'extrabold', 13.2, COLORS.blue).text('VALUTAZIONE PRESTAZIONE', left + 154, 30, {
    width: width - 154
  });
  setFont(doc, 'extrabold', 16.5, COLORS.teal).text('ARBITRALE', left + 154, 47, {
    width: width - 154
  });
  setFont(doc, 'medium', 7.2, COLORS.muted).text('Rapporto osservatore - versione digitale', left + 154, 67);

  doc.save();
  doc.roundedRect(left, 82, width, 92, 16).fillAndStroke(COLORS.card, COLORS.line);
  doc.roundedRect(left, 82, 7, 92, 3).fill(COLORS.teal);
  doc.restore();

  const colW = (width - 42) / 3;
  labelValue(doc, 'Osservatore', report.data.observerName, left + 18, 96, colW);
  labelValue(doc, 'Data', report.data.reportDate, left + 18 + colW + 12, 96, colW);
  labelValue(doc, 'Gara', report.data.matchNumber, left + 18 + (colW + 12) * 2, 96, colW);
  labelValue(doc, 'Campionato', report.data.competition, left + 18, 132, colW);
  labelValue(doc, 'Squadre', `${textOrDash(report.data.teamHome)} - ${textOrDash(report.data.teamAway)}`, left + 18 + colW + 12, 132, colW);
  labelValue(doc, 'Risultato', `${textOrDash(report.data.scoreHome)} - ${textOrDash(report.data.scoreAway)}`, left + 18 + (colW + 12) * 2, 132, colW);

  doc.save();
  doc.roundedRect(left, 188, width, 40, 13).fillAndStroke('#eff8f5', '#b8dcd4');
  doc.circle(left + 23, 208, 12).fill(COLORS.blue);
  setFont(doc, 'bold', 8, '#ffffff').text(getRefereeNumber(role), left + 19.6, 203.8, { width: 7, align: 'center' });
  setFont(doc, 'semibold', 8, COLORS.teal).text(getRefereeLabel(role).toUpperCase(), left + 44, 199);
  setFont(doc, 'bold', 11, COLORS.ink).text(textOrDash(refereeName), left + 44, 210, { width: width - 62 });
  doc.restore();

  doc.y = 246;
}

function addSectionHeader(doc, section, x, y, width) {
  doc.save();
  doc.roundedRect(x, y, width, 22, 8).fill(COLORS.blue);
  setFont(doc, 'bold', 8.4, '#ffffff').text(section.title.toUpperCase(), x + 10, y + 6.8, { width: width - 20 });
  doc.restore();
}

function measureRatingGroups(doc, section, width) {
  let total = 0;
  let lastCategory = null;

  for (const group of section.groups) {
    if (section.id === 'technique' && group.category && group.category !== lastCategory) {
      if (lastCategory) total += 8;
      total += 16;
      lastCategory = group.category;
    }

    const chipWidth = chipWidthForGroup(doc, group);
    setFont(doc, 'medium', 7.5, COLORS.ink);
    const labelHeight = doc.heightOfString(group.label, {
      width: width - chipWidth - 26,
      lineGap: 0.2
    });
    total += Math.max(18, labelHeight + 4);
  }
  return total;
}

function addRatingGroups(doc, section, sectionData, x, y, width) {
  let cursorY = y;
  let lastCategory = null;
  for (const group of section.groups) {
    if (section.id === 'technique' && group.category && group.category !== lastCategory) {
      if (lastCategory) {
        doc.save();
        doc
          .moveTo(x, cursorY + 2)
          .lineTo(x + width, cursorY + 2)
          .strokeColor('#d7e4df')
          .lineWidth(0.7)
          .stroke();
        doc.restore();
        cursorY += 8;
      }

      setFont(doc, 'bold', 7.7, COLORS.teal).text(group.category.toUpperCase(), x, cursorY, {
        width,
        characterSpacing: 0.25
      });
      cursorY += 16;
      lastCategory = group.category;
    }

    const value = sectionData?.ratings?.[group.id];
    const chipWidth = chipWidthForGroup(doc, group);
    const label = section.description && section.groups.length === 1 ? section.description : group.label;
    setFont(doc, 'medium', 7.5, COLORS.ink).text(label, x, cursorY + 3, {
      width: width - chipWidth - 26,
      lineGap: 0.2
    });
    addRatingChip(doc, value, x + width - chipWidth, cursorY, chipWidth);
    cursorY += Math.max(18, doc.heightOfString(label, { width: width - chipWidth - 26 }) + 4);
  }
  return cursorY;
}

function measureCommentBox(doc, label, comment, width, { important = false } = {}) {
  const padding = important ? 14 : 10;
  const titleHeight = important ? 15 : 12;
  setFont(doc, important ? 'bold' : 'medium', important ? 9.6 : 8.2, COLORS.ink);
  const textHeight = doc.heightOfString(textOrDash(comment), {
    width: width - padding * 2,
    lineGap: important ? 2 : 1.4
  });
  return Math.max(important ? 64 : 42, padding * 2 + titleHeight + textHeight);
}

function addCommentBox(doc, label, comment, x, y, width, { important = false } = {}) {
  const height = measureCommentBox(doc, label, comment, width, { important });
  const padding = important ? 14 : 10;

  doc.save();
  doc.roundedRect(x, y, width, height, important ? 14 : 9).fillAndStroke(
    important ? '#eef6ff' : COLORS.comment,
    important ? '#9fc4e8' : COLORS.commentLine
  );
  doc.roundedRect(x, y, important ? 8 : 5, height, important ? 4 : 3).fill(important ? COLORS.blue : '#d9a64d');
  setFont(doc, 'bold', important ? 10 : 7.8, important ? COLORS.blue : '#8a5a18').text(label, x + padding, y + padding, {
    width: width - padding * 2
  });
  setFont(doc, important ? 'semibold' : 'semibold', important ? 9.4 : 8.1, COLORS.ink).text(textOrDash(comment), x + padding, y + padding + (important ? 18 : 13), {
    width: width - padding * 2,
    lineGap: important ? 2 : 1.4
  });
  doc.restore();

  return height;
}

function measureSection(doc, section, sectionData, width) {
  let height = 22 + 10;
  const descriptionIsRatingLabel = section.description && section.groups.length === 1;
  if (section.description && !descriptionIsRatingLabel) {
    setFont(doc, 'regular', 7.2, COLORS.muted);
    height += doc.heightOfString(section.description, { width: width - 22 }) + 6;
  }
  height += measureRatingGroups(doc, section, width - 22);
  if (section.commentLabel) {
    height += 8 + measureCommentBox(doc, section.commentLabel, sectionData?.comment, width - 22);
  }
  return height + 12;
}

function addSection(doc, section, sectionData) {
  const x = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const height = measureSection(doc, section, sectionData, width);

  ensureSpace(doc, Math.min(height, doc.page.height - PAGE.margin * 2));
  const y = doc.y;

  doc.save();
  doc.roundedRect(x, y, width, height, 13).fillAndStroke(COLORS.cardSoft, '#e2ece8');
  doc.restore();

  addSectionHeader(doc, section, x, y, width);
  let cursorY = y + 32;

  const descriptionIsRatingLabel = section.description && section.groups.length === 1;
  if (section.description && !descriptionIsRatingLabel) {
    setFont(doc, 'regular', 7.2, COLORS.muted).text(section.description, x + 11, cursorY, { width: width - 22 });
    cursorY += doc.heightOfString(section.description, { width: width - 22 }) + 7;
  }

  cursorY = addRatingGroups(doc, section, sectionData, x + 11, cursorY, width - 22);

  if (section.commentLabel) {
    cursorY += 7;
    cursorY += addCommentBox(doc, `${section.commentLabel}:`, sectionData?.comment, x + 11, cursorY, width - 22);
  }

  doc.y = y + height + 9;
}

function addCommonMatchSection(doc, report) {
  addSection(doc, matchCharacteristicsForPayload(report.data), report.data.matchCharacteristics);
}

function addClosingTitle(doc, title) {
  const x = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  if (doc.y >= 90 || doc.__closingTitleDone) return;
  doc.__closingTitleDone = true;
  setFont(doc, 'semibold', 7.2, COLORS.teal).text('SINTESI FINALE', x, doc.y, { width });
  setFont(doc, 'extrabold', 21, COLORS.blue).text(title, x, doc.y + 10, { width });
  doc.y += 46;
}

function addGlobalJudgement(doc, evaluation) {
  const x = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const height = measureCommentBox(doc, 'GIUDIZIO GLOBALE', evaluation?.globalJudgement, width, { important: true });
  ensureSpace(doc, height + 18);
  addClosingTitle(doc, 'Giudizio globale');

  addCommentBox(doc, 'GIUDIZIO GLOBALE', evaluation?.globalJudgement, x, doc.y, width, { important: true });
  doc.y += height + 10;
}

function addLabelledRow(doc, label, value) {
  const x = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const text = textOrDash(value);
  const padding = 12;
  const labelWidth = 175;
  const textWidth = width - labelWidth - padding * 3;
  setFont(doc, 'medium', 8.4, COLORS.ink);
  const textHeight = doc.heightOfString(text, { width: textWidth, lineGap: 1.2 });
  const height = Math.max(42, padding * 2 + textHeight);
  ensureSpace(doc, height + 10);
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, width, height, 10).fillAndStroke('#ffffff', COLORS.line);
  setFont(doc, 'semibold', 7.5, COLORS.teal).text(label.toUpperCase(), x + padding, y + padding, {
    width: labelWidth
  });
  setFont(doc, 'medium', 8.4, COLORS.ink).text(text, x + padding * 2 + labelWidth, y + padding, {
    width: textWidth,
    lineGap: 1.2
  });
  doc.restore();
  doc.y = y + height + 8;
}

function addTechnicalErrors(doc, evaluation) {
  addLabelledRow(doc, 'Eventuali errori tecnici', evaluation?.technicalErrors || 'NO');
}

// Note aggiuntive ed errori tecnici sono due righe brevi: stanno affiancate,
// come nel resto delle schede.
function addLabelledPair(doc, left, right) {
  const x = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const gap = 9;
  const rightWidth = 232;
  const leftWidth = width - rightWidth - gap;
  const padding = 12;
  const boxes = [
    { ...left, x, width: leftWidth, labelWidth: 96 },
    { ...right, x: x + leftWidth + gap, width: rightWidth, labelWidth: 92 }
  ];

  setFont(doc, 'medium', 8.4, COLORS.ink);
  const height = boxes.reduce((max, box) => {
    const textWidth = box.width - box.labelWidth - padding * 3;
    return Math.max(max, padding * 2 + doc.heightOfString(textOrDash(box.value), { width: textWidth, lineGap: 1.2 }));
  }, 42);

  ensureSpace(doc, height + 10);
  const y = doc.y;
  doc.save();
  for (const box of boxes) {
    const textWidth = box.width - box.labelWidth - padding * 3;
    doc.roundedRect(box.x, y, box.width, height, 10).fillAndStroke(COLORS.card, COLORS.line);
    setFont(doc, 'semibold', 7.5, COLORS.teal).text(box.label.toUpperCase(), box.x + padding, y + padding, {
      width: box.labelWidth
    });
    setFont(doc, 'medium', 8.4, COLORS.ink).text(textOrDash(box.value), box.x + padding * 2 + box.labelWidth, y + padding, {
      width: textWidth,
      lineGap: 1.2
    });
  }
  doc.restore();
  doc.y = y + height + 8;
}

// Chiusura della v2: fascia a sinistra, voto a destra. La potenzialità resta
// fuori dal PDF anche adesso che il voto è visibile all'arbitro.
function addBandAndVote(doc, evaluation) {
  const x = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const height = 56;
  ensureSpace(doc, height + 12);
  const y = doc.y;
  const voteWidth = 108;
  const bandWidth = width - voteWidth - 9;
  const band = evaluation?.band || bandForVote(evaluation?.vote) || '';
  const style = ratingStyle(band);

  doc.save();
  doc.roundedRect(x, y, bandWidth, height, 12).fillAndStroke(COLORS.card, COLORS.line);
  setFont(doc, 'semibold', 7.5, COLORS.teal).text('FASCIA', x + 16, y + 13, { width: bandWidth - 32 });

  if (band) {
    setFont(doc, 'bold', 10.5);
    const chipWidth = Math.ceil(doc.widthOfString(band.toUpperCase())) + 34;
    if (style.stroke) {
      doc.roundedRect(x + 16, y + 26, chipWidth, 20, 10).fillAndStroke(style.fill, style.stroke);
    } else {
      doc.roundedRect(x + 16, y + 26, chipWidth, 20, 10).fill(style.fill);
    }
    setFont(doc, 'bold', 10.5, style.text).text(band.toUpperCase(), x + 16, y + 31.5, {
      width: chipWidth,
      align: 'center',
      lineBreak: false
    });
  } else {
    setFont(doc, 'medium', 10, COLORS.muted).text('-', x + 16, y + 29);
  }

  doc.roundedRect(x + bandWidth + 9, y, voteWidth, height, 12).fill(COLORS.blue);
  setFont(doc, 'extrabold', 21, '#ffffff').text(textOrDash(formatVote(evaluation?.vote)), x + bandWidth + 9, y + 12, {
    width: voteWidth,
    align: 'center'
  });
  setFont(doc, 'semibold', 7, '#9fc0de').text('VOTO', x + bandWidth + 9, y + 37, {
    width: voteWidth,
    align: 'center',
    characterSpacing: 0.8
  });
  doc.restore();

  doc.y = y + height + 8;
}

function addClosingSection(doc, evaluation, version) {
  if (version === 1) {
    addGlobalJudgement(doc, evaluation);
    addTechnicalErrors(doc, evaluation);
    return;
  }

  const x = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  for (const field of CLOSING_FIELDS) {
    if (field.id === 'technicalErrors' || field.id === 'additionalNotes') continue;
    const height = measureCommentBox(doc, field.label, evaluation?.[field.id], width, { important: true });
    ensureSpace(doc, height + 18);
    addClosingTitle(doc, 'Giudizio finale');
    addCommentBox(doc, field.label.toUpperCase(), evaluation?.[field.id], x, doc.y, width, { important: true });
    doc.y += height + 9;
  }

  addLabelledPair(
    doc,
    { label: 'Note aggiuntive', value: evaluation?.additionalNotes },
    { label: 'Errori tecnici', value: evaluation?.technicalErrors || 'NO' }
  );
  addBandAndVote(doc, evaluation);
}

function addFooter(doc, report, role) {
  const bottom = doc.page.height - PAGE.margin - 14;
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    setFont(doc, 'regular', 6.9, '#789').text(
      `Rapporto gara ${textOrDash(report.data.matchNumber)} - arbitro ${getRefereeNumber(role)} - pagina ${i + 1}/${pages.count}`,
      PAGE.margin,
      bottom,
      { width: doc.page.width - PAGE.margin * 2, align: 'center' }
    );
  }
}

export async function getPdfFileInfo(report, role) {
  const matchPart = safeFilePart(report.data.matchNumber || report.matchNumber || report.id);
  const surnamePart = safeFilePart((await refereeSurnameForRole(report, role)) || `arbitro${getRefereeNumber(role)}`);
  const fileName = `${matchPart}_${surnamePart}.pdf`;
  const season = report.sportSeason || deriveSeason(report.data?.reportDate || report.reportDate);
  const key = `output/${safeSeasonSegment(season)}/report-${report.id}/${fileName}`;
  return { key, fileName };
}

// Rende il PDF in memoria e restituisce un Buffer (nessuna scrittura su disco).
export function buildReportPdf(report, role) {
  const evaluation = report.data.evaluations?.[role];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: PAGE.size,
      margin: PAGE.margin,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `${report.data.matchNumber || 'Rapporto'} - ${role === 'first' ? report.data.firstRefereeName : report.data.secondRefereeName}`,
        Author: report.data.observerName || 'FischioLab'
      }
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    registerFonts(doc);
    drawPageBackground(doc);
    addHeader(doc, report, role);
    addCommonMatchSection(doc, report);

    for (const section of sectionsForPayload(report.data)) {
      addSection(doc, section, evaluation?.sections?.[section.id]);
    }

    addClosingSection(doc, evaluation, templateVersionOf(report.data));

    // La potenzialita resta deliberatamente fuori dall'export PDF.
    addFooter(doc, report, role);
    doc.end();
  });
}

// Genera il PDF, lo carica su Storage e registra l'export. Restituisce anche il
// buffer, così il chiamante può servirlo/allegarlo senza rileggerlo da Storage.
export async function generatePdfForRole(report, role) {
  const { key, fileName } = await getPdfFileInfo(report, role);
  const buffer = await buildReportPdf(report, role);
  await putObject(key, buffer, 'application/pdf');
  await dbRun(
    `INSERT INTO exports (report_id, referee_role, file_name, file_path) VALUES (?, ?, ?, ?)`,
    [report.id, role, fileName, key]
  );
  return { role, fileName, key, buffer };
}

export async function generateReportPdfs(report) {
  return Promise.all([generatePdfForRole(report, 'first'), generatePdfForRole(report, 'second')]);
}
