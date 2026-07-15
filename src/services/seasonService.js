import { currentSportSeason } from '../../shared/reportTemplate.js';
import { dbAll } from '../database/db.js';

export async function listAvailableSeasons() {
  const rows = await dbAll(`
    SELECT sport_season
    FROM (
      SELECT sport_season FROM games
      UNION
      SELECT sport_season FROM reports
      UNION
      SELECT sport_season FROM competition_sources
      UNION
      SELECT sport_season FROM referee_season_categories
      UNION
      SELECT sport_season FROM instructor_competition_assignments
    ) seasons
    WHERE sport_season IS NOT NULL AND TRIM(sport_season) <> ''
    ORDER BY sport_season DESC
  `);

  return Array.from(new Set([
    currentSportSeason(),
    ...rows.map((row) => String(row.sport_season).trim())
  ]));
}
