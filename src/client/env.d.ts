/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SINGLE_USER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
