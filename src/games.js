export const ioGames = [
  {
    title: 'Diep.io',
    url: 'https://diep.io/',
    reason: 'Tank arena classic. Good quick background chaos.'
  },
  {
    title: 'Mope.io',
    url: 'https://mope.io/',
    reason: 'Animal survival loop with fast restarts.'
  },
  {
    title: 'Mope.io v1',
    url: 'https://v1.mope.io/',
    reason: 'Old Mope version, useful if v2 is not the mood.'
  },
  {
    title: 'Slither.io',
    url: 'https://slither.io/',
    reason: 'Snake arena classic and extremely waiting-room compatible.'
  },
  {
    title: 'Agar.io',
    url: 'https://agar.io/',
    reason: 'Cell-eating classic. Simple enough to play while a shot runs.'
  },
  {
    title: 'Skribbl.io',
    url: 'https://skribbl.io/',
    reason: 'Good party/browser fallback, especially with collaborators.'
  },
  {
    title: 'Krunker.io',
    url: 'https://krunker.io/',
    reason: 'Fast browser FPS. Likely better in an external tab if embedding blocks.'
  },
  {
    title: 'Shell Shockers',
    url: 'https://shellshock.io/',
    reason: 'Egg FPS. Dumb in the right way.'
  },
  {
    title: 'Zombs Royale',
    url: 'https://zombsroyale.io/',
    reason: 'Battle royale-ish replacement energy for the old surviv.io slot.'
  },
  {
    title: 'Smash Karts',
    url: 'https://smashkarts.io/',
    reason: 'Arcade kart chaos that fits the app tone.'
  },
  {
    title: 'LOLBeans.io',
    url: 'https://lolbeans.io/',
    reason: 'Obstacle-course multiplayer for a lighter roulette roll.'
  }
];

export function pickIoGame(previousUrl = '') {
  const candidates = ioGames.filter((game) => game.url !== previousUrl);
  return candidates[Math.floor(Math.random() * candidates.length)] || ioGames[0];
}
