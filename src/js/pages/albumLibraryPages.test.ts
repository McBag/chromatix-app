import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pagesDir = dirname(fileURLToPath(import.meta.url));

const pages = ['AlbumArray.jsx', 'RecentlyAdded.jsx', 'RandomAlbums.jsx'] as const;

const hasTitleBlockChild = (source: string, component: 'ViewList' | 'ViewGrid'): boolean =>
  new RegExp(`<${component}[\\s\\S]*?>[\\s\\S]*\\{titleBlock\\}[\\s\\S]*?</${component}>`).test(source);

describe('Album library pages', () => {
  test.each(pages)('%s passes the title block as ViewList and ViewGrid children', (fileName) => {
    const source = readFileSync(join(pagesDir, fileName), 'utf8');
    expect(hasTitleBlockChild(source, 'ViewList')).toBe(true);
    expect(hasTitleBlockChild(source, 'ViewGrid')).toBe(true);
  });
});
