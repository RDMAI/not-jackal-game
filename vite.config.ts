import { defineConfig } from 'vite';

// Use relative base so the built site works on GitHub Pages
// (https://<user>.github.io/<repo>/) as well as custom domains.
export default defineConfig({
  base: './',
});
