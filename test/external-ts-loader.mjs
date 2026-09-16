// Use the TypeScript loader for every .ts file. Node's native type stripping
// does not transform parameter properties, which are used by the upstream
// tests and implementation and are still supported by the package's Node
// engine range. The loader also handles the .ts sources shipped inside
// node_modules, which Node otherwise refuses to type-strip.
import { readFile } from "node:fs/promises";
import ts from "typescript";

const isTypeScript = (url) => url.endsWith(".ts");

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== "ERR_MODULE_NOT_FOUND" ||
      (!specifier.startsWith(".") &&
        !specifier.startsWith("file:") &&
        !specifier.startsWith("#"))
    ) {
      throw error;
    }
    return nextResolve(`${specifier}.ts`, context);
  }
}

export async function load(url, context, nextLoad) {
  if (!isTypeScript(url)) return nextLoad(url, context);
  const source = await readFile(new URL(url), "utf8");
  return {
    format: "module",
    shortCircuit: true,
    source: ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
      fileName: new URL(url).pathname,
    }).outputText,
  };
}
