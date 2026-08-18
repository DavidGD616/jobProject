/** Strip discovery provenance accidentally included in a stored company label. */
export function displayCompanyName(name: string): string {
  return name.replace(/\s*\(https?:\/\/[^)]+\)\s*$/i, "").trim() || name;
}
