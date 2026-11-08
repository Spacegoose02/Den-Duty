// Rocky's den: each kid's own room on their board. Kids buy furniture with points (levels unlock fancier things),
// and the room gets tidier or messier with how their chores have gone the last few days.

export type DenSpot = 'wall' | 'floor' | 'corner' | 'window' | 'ceiling';

export const DEN_ITEMS = [
  { id: 'rug', icon: '🟫', name: 'Cozy rug', price: 5, level: 1, spot: 'floor' },
  { id: 'plant', icon: '🪴', name: 'Plant', price: 8, level: 1, spot: 'corner' },
  { id: 'lamp', icon: '🪔', name: 'Lamp', price: 10, level: 1, spot: 'corner' },
  { id: 'poster', icon: '🖼️', name: 'Poster', price: 10, level: 1, spot: 'wall' },
  { id: 'books', icon: '📚', name: 'Bookshelf', price: 12, level: 1, spot: 'corner' },
  { id: 'teddy', icon: '🧸', name: 'Teddy bear', price: 12, level: 1, spot: 'floor' },
  { id: 'clock', icon: '🕰️', name: 'Clock', price: 15, level: 2, spot: 'wall' },
  { id: 'beanbag', icon: '🛋️', name: 'Beanbag', price: 20, level: 2, spot: 'floor' },
  { id: 'curtains', icon: '🪟', name: 'Window', price: 20, level: 2, spot: 'window' },
  { id: 'lights', icon: '✨', name: 'Fairy lights', price: 25, level: 2, spot: 'ceiling' },
  { id: 'guitar', icon: '🎸', name: 'Guitar', price: 30, level: 3, spot: 'corner' },
  { id: 'aquarium', icon: '🐠', name: 'Aquarium', price: 35, level: 3, spot: 'floor' },
  { id: 'telescope', icon: '🔭', name: 'Telescope', price: 40, level: 3, spot: 'window' },
  { id: 'trophy', icon: '🏆', name: 'Trophy shelf', price: 45, level: 4, spot: 'wall' },
  { id: 'disco', icon: '🪩', name: 'Disco ball', price: 50, level: 4, spot: 'ceiling' },
  { id: 'arcade', icon: '🕹️', name: 'Arcade machine', price: 60, level: 4, spot: 'floor' },
  { id: 'rocket', icon: '🚀', name: 'Rocket model', price: 70, level: 5, spot: 'corner' },
  { id: 'castle', icon: '🏰', name: 'Toy castle', price: 80, level: 5, spot: 'floor' },
  { id: 'rainbow', icon: '🌈', name: 'Rainbow mural', price: 90, level: 6, spot: 'wall' },
  { id: 'crown', icon: '👑', name: 'Golden crown', price: 120, level: 7, spot: 'wall' },
] as const satisfies readonly { id: string; icon: string; name: string; price: number; level: number; spot: DenSpot }[];

export type DenItemId = (typeof DEN_ITEMS)[number]['id'];
export const denItem = (id: string) => DEN_ITEMS.find((i) => i.id === id);

export type Tidiness = 'sparkling' | 'tidy' | 'messy' | 'very-messy';
export const TIDY_TEXT: Record<Tidiness, string> = {
  sparkling: 'Sparkling clean! ✨',
  tidy: 'Nice and tidy',
  messy: 'Getting a bit messy',
  'very-messy': 'Uh oh, what a mess!',
};
/** Things lying around when the den is messy (more of them the messier it is). */
export const MESS = ['🧦', '🍕', '📦', '👟', '🍌', '🧃', '📄', '🧩'];

/** From the share of chores done (null when nothing was due). */
export function tidinessOf(share: number | null): Tidiness {
  if (share == null || share >= 0.9) return share == null ? 'tidy' : 'sparkling';
  if (share >= 0.6) return 'tidy';
  if (share >= 0.3) return 'messy';
  return 'very-messy';
}
