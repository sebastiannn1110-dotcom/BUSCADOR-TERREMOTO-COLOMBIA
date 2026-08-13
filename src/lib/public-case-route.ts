export function decodePublicCaseSlug(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function publicCasePath(slug: string) {
  return `/persona/${encodeURIComponent(decodePublicCaseSlug(slug))}`;
}
