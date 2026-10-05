import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
export default defineConfig(({mode})=>({plugins:[svelte()],build:{outDir:"dist/pages",emptyOutDir:true,rollupOptions:{input:"cloudflare/site/index.html"}},define:{"import.meta.env.VITE_SINGLE_USER":JSON.stringify("false"),"import.meta.env.VITE_LOCAL_COURSE":JSON.stringify(mode==="localcourse")}}));
