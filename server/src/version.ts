// The Gnomon version this server was built from (the app's, set by scripts/build.mjs).
declare const __GNOMON_VERSION__: string | undefined;
export const VERSION: string = typeof __GNOMON_VERSION__ === 'string' ? __GNOMON_VERSION__ : 'dev';
