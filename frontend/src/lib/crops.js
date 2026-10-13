// Fallback art for listings without photos: a tinted field in the crop's own colour.
const CROPS = {
  tomato: ["🍅", "#fbe3df", "#c4372c"],
  onion: ["🧅", "#f6e6ef", "#8f3d6a"],
  potato: ["🥔", "#f4ead9", "#8a6a38"],
  brinjal: ["🍆", "#ece6f6", "#5b3d8f"],
  carrot: ["🥕", "#fde8d6", "#c9621d"],
  beans: ["🫛", "#e4f2e3", "#2f7a36"],
  banana: ["🍌", "#fdf3d0", "#a57d0c"],
  mango: ["🥭", "#fdecd0", "#c27a0e"],
  okra: ["🥒", "#e5f1df", "#3f7a2a"],
  cabbage: ["🥬", "#e7f4e2", "#3b7d34"],
  "green chilli": ["🌶️", "#e6f3e4", "#2b7a35"],
  cauliflower: ["🥦", "#eef3e9", "#53784a"],
  drumstick: ["🌿", "#e6f1e3", "#3c6e3a"],
  coconut: ["🥥", "#efe7de", "#6f5440"],
  paddy: ["🌾", "#f7efd6", "#8c7424"],
  rice: ["🌾", "#f7efd6", "#8c7424"],
  wheat: ["🌾", "#f7efd6", "#8c7424"],
  garlic: ["🧄", "#f3efe8", "#7a6a55"],
  corn: ["🌽", "#fbf1d2", "#a8840c"],
  maize: ["🌽", "#fbf1d2", "#a8840c"],
  lemon: ["🍋", "#fbf5d2", "#9a8a10"],
  grapes: ["🍇", "#ede5f4", "#5d3b84"],
  apple: ["🍎", "#fbe4e1", "#b5302a"],
  cucumber: ["🥒", "#e5f2e1", "#3a7a33"],
  pumpkin: ["🎃", "#fde7d2", "#c15f15"],
  ginger: ["🫚", "#f6ecd9", "#8a6a2f"],
  peas: ["🫛", "#e4f2e3", "#2f7a36"],
};

export function cropArt(crop = "") {
  const c = CROPS[crop.toLowerCase()] || ["🧺", "#e8edfa", "#2747a8"];
  return { emoji: c[0], bg: c[1], fg: c[2] };
}

export const CROP_SUGGESTIONS = Object.keys(CROPS)
  .map((c) => c.replace(/\b\w/g, (m) => m.toUpperCase()))
  .filter((c, i, a) => a.indexOf(c) === i);
