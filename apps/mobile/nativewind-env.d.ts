/// <reference types="nativewind/types" />

// nativewind/types augments RN component props with `className` but doesn't
// declare CSS as an importable module — without this, `import '../global.css'`
// fails typecheck even though Metro/NativeWind handle it fine at bundle time.
declare module '*.css';
