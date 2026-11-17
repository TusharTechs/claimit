import { loadFont as loadDisplay } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as loadSans } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

export const display = loadDisplay('normal', { weights: ['500', '700', '800'], subsets: ['latin'] }).fontFamily;
export const sans = loadSans('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }).fontFamily;
export const mono = loadMono('normal', { weights: ['400', '500', '700'], subsets: ['latin'] }).fontFamily;

// The app's own palette (web/src/index.css), so the film and the product read as one thing.
export const C = {
  ink: '#17120e', ink2: '#3a312a', muted: '#7a6e64', line: '#eadfd3', paper: '#fff7ee', card: '#ffffff',
  hot: '#ff4a1c', hotDark: '#d93a10', hotSoft: '#ffe6dc', sun: '#ffb400', sunSoft: '#fff1cc',
  mint: '#0b8457', mintSoft: '#dbf5e9', plum: '#2b1838',
};
export const FPS = 30;
export const W = 1920;
export const H = 1080;
