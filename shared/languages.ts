// Languages for kid screens, the family wall and read-aloud. The parent app stays in English for now.
export const LANGUAGES = [
  { id: 'en', name: 'English', speech: 'en-US' },
  { id: 'es', name: 'Español', speech: 'es-ES' },
  { id: 'fr', name: 'Français', speech: 'fr-FR' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['id'];
export const LANG_IDS = LANGUAGES.map((l) => l.id) as Lang[];
export const isLang = (v: unknown): v is Lang => LANG_IDS.includes(v as Lang);
