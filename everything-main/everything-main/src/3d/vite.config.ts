import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

export default defineConfig({
  plugins: [puterLocalhost('3d')],
});
