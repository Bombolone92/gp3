const features = {
  ownership: {
    title: 'Know who<br>owns what', sub: 'Your ownership, at a glance.',
    chapter: '01 / OWNERSHIP', context: 'OWNERSHIP BY CLASS', caption: '10 million fully diluted shares',
  },
  fundraising: {
    title: 'See dilution<br>before you raise', sub: 'Explore your next funding round.',
    chapter: '02 / FUNDRAISING', context: '$5M SERIES A SCENARIO', caption: '$18M valuation before investment',
  },
  hiring: {
    title: 'Plan equity<br>for every hire', sub: 'See what your hiring plan needs.',
    chapter: '03 / HIRING', context: 'OPTION POOL FORECAST', caption: 'Eight planned hires. One clear forecast.',
  },
  exit: {
    title: 'Know what<br>an exit means', sub: 'See who receives what.',
    chapter: '04 / EXIT SCENARIOS', context: '$60M EXIT SCENARIO', caption: 'Potential proceeds by holder',
  },
};
const q = new URLSearchParams(location.search);
const feature = q.get('feature') || 'ownership';
const format = q.get('format') || 'desktop';
const config = features[feature];
document.body.className = `${feature} ${format}`;
document.querySelector('h1').innerHTML = format === 'tablet' ? config.title.replace('<br>', ' ') : config.title;
document.querySelector('.copy p').textContent = config.sub;
document.querySelector('.chapter').textContent = config.chapter;
document.querySelector('.context').textContent = config.context;
if (format === 'tablet' && feature === 'fundraising') document.querySelector('.context').textContent = '$5M RAISE AT $18M VALUATION';
if (format === 'tablet' && feature === 'ownership') document.querySelector('.context').textContent = 'OWNERSHIP DETAIL · 10M SHARES';
document.querySelector('.caption').textContent = config.caption;
document.querySelectorAll('.sequence i')[Object.keys(features).indexOf(feature)].className = 'active';
const frame = document.querySelector('iframe');
frame.src = `./ui.html?feature=${feature}&format=${format}`;
frame.addEventListener('load', async () => {
  const wait = () => new Promise(resolve => requestAnimationFrame(resolve));
  while (!frame.contentWindow.assetReady) await wait();
  const nativeHeight = Math.ceil(frame.contentDocument.querySelector('#detail').getBoundingClientRect().height);
  frame.style.height = `${nativeHeight}px`;
  const scale = parseFloat(getComputedStyle(document.body).getPropertyValue('--ui-scale'));
  const box = document.querySelector('.ui-frame');
  box.style.height = `${nativeHeight * scale}px`;
  await document.fonts.ready;
  window.assetReady = true;
});
