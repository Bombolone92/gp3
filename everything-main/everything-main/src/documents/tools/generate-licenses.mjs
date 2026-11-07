import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const sections = ['Third-party notices for Documents\n\nThe application and original canvas engine are MIT licensed.\nThis file lists installed runtime dependencies, including packages retained for import helpers.\nDevelopment tools are recorded in package-lock.json.'];
const seen = new Set();
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev) continue;
  const dir = path.join(root, location);
  if (!fs.existsSync(dir)) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const key = `${meta.name}@${meta.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const licenses = fs.readdirSync(dir).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name) && fs.statSync(path.join(dir, name)).isFile());
  if (!licenses.length) throw new Error(`Missing license text for ${key}`);
  sections.push(`${key} — ${meta.license}\n${typeof meta.repository === 'object' ? meta.repository.url : meta.repository || ''}\n\n${licenses.map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n\n')}`);
}
sections.push(`Noto Sans — OFL-1.1\nhttps://github.com/notofonts/latin-greek-cyrillic\n\n${fs.readFileSync(path.join(root, 'public/fonts/OFL.txt'), 'utf8')}`);
sections.push(`Bebas Neue — OFL-1.1\nhttps://github.com/dharmatype/Bebas-Neue\n\n${fs.readFileSync(path.join(root, 'public/fonts/BebasNeue-OFL.txt'), 'utf8')}`);
for (const [family, file, repository] of [['Oswald', 'Oswald', 'OswaldFont'], ['Open Sans', 'OpenSans', 'opensans']]) {
  sections.push(`${family} — OFL-1.1\nhttps://github.com/googlefonts/${repository}\n\n${fs.readFileSync(path.join(root, `public/fonts/${file}-OFL.txt`), 'utf8')}`);
}
sections.push(`Source Sans Pro — OFL-1.1\nhttps://github.com/adobe-fonts/source-sans\n\n${fs.readFileSync(path.join(root, 'public/fonts/SourceSansPro-OFL.txt'), 'utf8')}`);
sections.push(`Source Sans Pro Italic 1.075 � OFL-1.1\nhttps://github.com/adobe-fonts/source-sans\n\n${fs.readFileSync(path.join(root, 'public/fonts/SourceSansPro-1.075-OFL.txt'), 'utf8')}`);
sections.push(`Selawik - OFL-1.1\nhttps://github.com/microsoft/Selawik\n\n${fs.readFileSync(path.join(root, 'public/fonts/Selawik-OFL.txt'), 'utf8')}`);
sections.push(`Karla - OFL-1.1\nhttps://github.com/googlefonts/karla\n\n${fs.readFileSync(path.join(root, 'public/fonts/Karla-OFL.txt'), 'utf8')}`);
sections.push(`Montserrat - OFL-1.1\nhttps://github.com/JulietaUla/Montserrat\n\n${fs.readFileSync(path.join(root, 'public/fonts/Montserrat-OFL.txt'), 'utf8')}`);
fs.writeFileSync(path.join(root, 'public/licenses/THIRD_PARTY.txt'), sections.join('\n\n' + '='.repeat(72) + '\n\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n');
console.log(`Generated third-party notices for ${seen.size} runtime packages, Noto Sans, Bebas Neue, Oswald, Open Sans, Source Sans Pro, Selawik, Karla and Montserrat.`);
