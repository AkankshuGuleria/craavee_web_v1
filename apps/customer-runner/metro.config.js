// Metro configuration for an npm-workspaces monorepo.
//
// Without the two settings below, Metro resolves only from this app's own
// node_modules tree. That breaks here because npm hoists most packages to
// the workspace root: `expo` and `react-native` live at
// <root>/node_modules, while `nativewind` stays nested under this app
// (tailwindcss 3 vs 4 across the workspace prevents hoisting it).
//
// The NativeWind Babel preset sets jsxImportSource, so
// `react-native-css-interop/jsx-runtime` is injected into every file Metro
// transforms — including hoisted ones. A hoisted file at
// <root>/node_modules/expo/... then has to resolve a module that only
// exists under this app, which fails with:
//
//   UnableToResolveError: react-native-css-interop/jsx-runtime
//     from <root>/node_modules/expo/src/launch/withDevTools.ios.tsx
//
// watchFolders lets Metro read files outside this app; nodeModulesPaths
// tells it where packages may live. Both paths are derived from __dirname,
// so this stays correct on any machine, in CI, and on EAS Build.
//
// See docs/engineering/NATIVE_APP_READINESS_REPORT.md.
const path = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace, so edits to packages/* trigger a rebuild
//    and hoisted dependencies are readable at all.
config.watchFolders = [workspaceRoot];

// 2. Resolve packages from this app first, then the workspace root. Order
//    matters: a package present in both should resolve to the app's copy.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. Ignore macOS AppleDouble sidecars.
//
//    This repository lives on an exFAT volume, where macOS writes a `._x`
//    companion file next to every file it touches (see
//    docs/audit/PHASE_0_REPOSITORY_AUDIT.md). They are gitignored, but they
//    are still on disk, and Metro's crawler happily picks them up and tries
//    to parse them as source:
//
//      TransformError: app/(auth)/._verify.tsx
//        SyntaxError: Unexpected character '\u0000' (1:0)
//
//    They are binary, so every one of them is a hard bundle failure. This is
//    a filesystem artefact rather than a project file, so it is excluded at
//    the resolver rather than deleted — deleting them only works until the
//    next time a file is touched.
config.resolver.blockList = [/(^|\/)\._[^/]*$/];

module.exports = withNativeWind(config, { input: "./global.css" });
