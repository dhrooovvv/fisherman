import { defineConfig } from 'vite';
export default defineConfig({base:'./',build:{cssCodeSplit:false,outDir:'dist/client',assetsInlineLimit:0,target:'es2022',sourcemap:false,rollupOptions:{output:{format:'iife',entryFileNames:'game.js',inlineDynamicImports:true}}},server:{fs:{allow:['..']}}});
