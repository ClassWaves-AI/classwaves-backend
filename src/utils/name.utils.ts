export function composeDisplayName(options: {
  given?: string | null;
  family?: string | null;
  preferred?: string | null;
}): string {
  const given = (options.preferred || options.given || '').trim();
  const family = (options.family || '').trim();
  return [given, family].filter(Boolean).join(' ').trim();
}

