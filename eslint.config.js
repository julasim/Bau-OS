import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  // Der Electron-Preload ist per Konstruktion CommonJS: ein Preload mit
  // `sandbox: true` bekommt von Electron ein eingeschränktes `require` und
  // kann kein ESM sein. Er läuft ausserdem im Renderer-Kontext, `location`
  // ist dort ein Global. Die Regeln sind für den restlichen Baum richtig und
  // bleiben dort scharf — hier waeren sie schlicht falsch.
  {
    files: ["electron/preload.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { require: "readonly", module: "writable", location: "readonly", window: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Bau-Skripte als reines ESM-JavaScript: die Node-Globals sind hier echt.
  // (In den .ts-Dateien greift `no-undef` gar nicht — typescript-eslint
  //  schaltet die Regel fuer TypeScript ab, weil der Compiler das prueft.)
  {
    files: ["scripts/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  { ignores: ["dist/", "dist-electron/", "release/", "node_modules/", "docs/", "tools/"] },
);
