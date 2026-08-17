import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { resumeVariants } from "@/db/schema";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteProps): Promise<Response> {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new Response("Not found", { status: 404 });
  const variant = db.select().from(resumeVariants).where(eq(resumeVariants.id, id)).get();
  if (!variant) return new Response("Not found", { status: 404 });
  const format = new URL(request.url).searchParams.get("format") === "html" ? "html" : "pdf";
  const configuredDirectory = resolve(process.env.EXPORT_DIR ?? "data/exports");
  const path = resolve(configuredDirectory, `resume-variant-${id}.${format}`);
  if (basename(path) !== `resume-variant-${id}.${format}`) return new Response("Not found", { status: 404 });
  try {
    const content = await readFile(path);
    return new Response(content, {
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="resume-variant-${id}.${format}"`,
      },
    });
  } catch {
    return new Response("Export is not available yet", { status: 404 });
  }
}
