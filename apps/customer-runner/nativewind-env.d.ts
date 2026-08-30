/// <reference types="nativewind/types" />

// `nativewind/types` augments React Native's component props (className,
// etc.) but does not declare an ambient module for `*.css` side-effect
// imports (confirmed by reading react-native-css-interop's own types.d.ts:
// it only adds `declare module "react-native" { ... }`). Metro handles the
// actual `import "./global.css"` at bundle time via the NativeWind Babel/
// Metro plugins; `tsc` has no knowledge of that pipeline and needs this
// declaration to type-check the import statement itself.
declare module "*.css";
