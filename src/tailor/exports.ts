import { unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface GeneratedResumeExport {
  id: number;
  pdfPath: string | null;
}

export interface RemoveGeneratedResumeExportsOptions {
  variants: readonly GeneratedResumeExport[];
  exportDirectory?: string;
  unlinkFile?: (path: string) => Promise<void>;
}

export interface RemoveGeneratedResumeExportsResult {
  filesRemoved: string[];
}

function isPathInside(path: string, directory: string): boolean {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory === "" || (!pathFromDirectory.startsWith(`..${sep}`) && pathFromDirectory !== ".." && !isAbsolute(pathFromDirectory));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Return only the exports generated for a known resume variant. A stored PDF
 * path is followed only when it is the expected filename inside EXPORT_DIR.
 */
export function generatedResumeExportPaths(input: {
  variantId: number;
  pdfPath: string | null;
  exportDirectory: string;
}): string[] {
  const htmlFile = `resume-variant-${input.variantId}.html`;
  const pdfFile = `resume-variant-${input.variantId}.pdf`;
  const storedPdfPath = input.pdfPath ? resolve(input.pdfPath) : null;
  const storedPdfIsExport = storedPdfPath !== null
    && basename(storedPdfPath) === pdfFile
    && isPathInside(storedPdfPath, input.exportDirectory);
  return [...new Set([
    join(input.exportDirectory, htmlFile),
    join(input.exportDirectory, pdfFile),
    ...(storedPdfIsExport && storedPdfPath ? [storedPdfPath, join(dirname(storedPdfPath), htmlFile)] : []),
  ])];
}

/** Remove only local HTML/PDF files owned by the supplied generated variants. */
export async function removeGeneratedResumeExports(
  options: RemoveGeneratedResumeExportsOptions,
): Promise<RemoveGeneratedResumeExportsResult> {
  const exportDirectory = resolve(options.exportDirectory ?? process.env.EXPORT_DIR ?? "data/exports");
  const removeFile = options.unlinkFile ?? unlink;
  const filesRemoved: string[] = [];

  for (const variant of options.variants) {
    for (const path of generatedResumeExportPaths({
      variantId: variant.id,
      pdfPath: variant.pdfPath,
      exportDirectory,
    })) {
      try {
        await removeFile(path);
        filesRemoved.push(path);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  }

  return { filesRemoved };
}
