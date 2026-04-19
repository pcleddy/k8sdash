/**
 * Convert a Kubernetes creationTimestamp (ISO 8601 string or Date) into a
 * compact human-friendly age string: "5d", "3h", "42m", "<1m".
 */
export function age(timestamp) {
  if (!timestamp) return '?';
  const created = new Date(timestamp);
  const seconds = Math.floor((Date.now() - created.getTime()) / 1000);
  if (seconds < 60) return '<1m';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
