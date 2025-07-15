export const getSubdomain = (hostname: string) => {
  const parts = hostname.split('.');

  let subdomain = null;

  if (hostname.endsWith('localhost')) {
    if (parts.length > 1) {
      subdomain = parts[0];
    }
  } else {
    if (parts.length > 2) {
      subdomain = parts[0];
    }
  }

  return subdomain
}
