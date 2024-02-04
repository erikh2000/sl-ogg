import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'sl-web-ogg',
      fileName: (format) => `sl-web-ogg.${format}.js`
    },
    rollupOptions: {
      external: [],
      output: [
        {
          format: 'es',   // ES module format
          dir: 'dist',
          entryFileNames: '[name].es.js'
        },{
          format: 'cjs',  // CommonJS format
          dir: 'dist',
          entryFileNames: '[name].cjs.js',
          exports: 'named'
        },{
          format: 'umd',  // UMD format
          dir: 'dist',
          entryFileNames: '[name].umd.js',
          name: 'sl-web-ogg'
        }
      ]
    },
    sourcemap: true
  }
});