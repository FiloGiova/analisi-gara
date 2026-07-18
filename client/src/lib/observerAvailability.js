import { formatDate } from './formatters.js';

export function availabilityOnDate(observer, dateValue) {
  const date = String(dateValue || '').slice(0, 10);
  if (!date) return null;
  return (observer?.unavailabilities || []).find((item) => (
    item.startDate <= date && item.endDate >= date
  )) || null;
}

export function formatAvailabilityPeriod(availability) {
  if (!availability) return '';
  if (availability.startDate === availability.endDate) {
    return formatDate(availability.startDate);
  }
  return `${formatDate(availability.startDate)} – ${formatDate(availability.endDate)}`;
}

export function observerOptionForDate(observer, dateValue) {
  const unavailability = availabilityOnDate(observer, dateValue);
  return {
    value: String(observer.id),
    label: observer.displayName,
    disabled: Boolean(unavailability),
    tone: unavailability ? 'danger' : '',
    statusLabel: unavailability ? 'INDISPONIBILE' : '',
    description: unavailability ? formatAvailabilityPeriod(unavailability) : ''
  };
}
