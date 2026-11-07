// Material presets: name and density (kg/m^3) used for mass properties.

import type { MaterialRef } from './types';

export const MATERIALS: MaterialRef[] = [
  { name: 'Plain Carbon Steel', density: 7800 },
  { name: 'Stainless Steel (304)', density: 8000 },
  { name: 'Alloy Steel', density: 7700 },
  { name: 'Cast Iron', density: 7200 },
  { name: 'Aluminum 6061', density: 2700 },
  { name: 'Aluminum 7075', density: 2810 },
  { name: 'Brass', density: 8500 },
  { name: 'Copper', density: 8900 },
  { name: 'Titanium (Ti-6Al-4V)', density: 4430 },
  { name: 'ABS', density: 1040 },
  { name: 'PLA', density: 1240 },
  { name: 'PETG', density: 1270 },
  { name: 'Nylon 6/6', density: 1140 },
  { name: 'Acrylic (PMMA)', density: 1190 },
  { name: 'Polycarbonate', density: 1200 },
  { name: 'Oak', density: 750 },
  { name: 'Pine', density: 510 },
  { name: 'Glass', density: 2500 },
];
