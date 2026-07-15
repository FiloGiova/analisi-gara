function asList(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function legacyCompetitions(user) {
  const value = user?.instructorCompetitions?.length
    ? user.instructorCompetitions
    : user?.instructorCompetition || user?.formatterCompetitions || user?.formatterCompetition || user?.formatter_competition;
  return [...new Set(asList(value).map((item) => String(item || '').trim()).filter(Boolean))];
}

export function instructorAssignmentsForUser(user) {
  if (!Array.isArray(user?.instructorAssignments)) return [];
  return user.instructorAssignments
    .map((assignment) => ({
      sportSeason: String(assignment?.sportSeason || assignment?.season || '').trim(),
      competitions: [...new Set(asList(assignment?.competitions).map((item) => String(item || '').trim()).filter(Boolean))]
    }))
    .filter((assignment) => assignment.sportSeason && assignment.competitions.length);
}

export function instructorCompetitionsForSeason(user, season = '') {
  if (user?.role !== 'instructor') return [];
  const assignments = instructorAssignmentsForUser(user);
  if (Array.isArray(user?.instructorAssignments)) {
    const cleanSeason = String(season || '').trim();
    const selected = cleanSeason
      ? assignments.filter((assignment) => assignment.sportSeason === cleanSeason)
      : assignments;
    return [...new Set(selected.flatMap((assignment) => assignment.competitions))];
  }
  return legacyCompetitions(user);
}
