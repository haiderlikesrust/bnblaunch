export const coinPath = (id: string) => '/token/' + encodeURIComponent(id);
export function coinUrl(origin: string, id: string) {
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid public origin');
  return url.origin + coinPath(id);
}
