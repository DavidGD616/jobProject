import type { ApplyAdapter, ApplyContext, ApplyFieldPlan, ApplyPlan } from "./types";

function profileField(context: ApplyContext, key: string, label: string, required = false): ApplyFieldPlan {
  const value = context.profile.resumeJson[key as keyof typeof context.profile.resumeJson];
  return { key, label, value: typeof value === "string" ? value : null, selector: null, required, source: "profile" };
}

function planFor(context: ApplyContext, adapter: "greenhouse" | "lever" | "generic", selectors: Record<string, string>): ApplyPlan {
  const resumePath = context.resumeVariant?.pdfPath;
  return {
    adapter,
    url: context.job.url,
    fields: [
      profileField(context, "name", "Full name", true),
      profileField(context, "email", "Email", true),
      profileField(context, "phone", "Phone"),
      profileField(context, "location", "Location"),
      { key: "resume", label: "Resume upload", value: resumePath ?? null, selector: selectors.resume, required: true, source: "resume_variant" },
      { key: "cover_letter", label: "Cover letter", value: context.resumeVariant?.coverLetter ?? context.application.coverLetter ?? null, selector: selectors.coverLetter, required: false, source: "resume_variant" },
    ],
    customQuestions: ["Review every custom question in the ATS form manually; this workflow will never guess or submit answers."],
    submissionBlocked: true,
    instructions: [
      "Open the original application URL in a local browser.",
      "Confirm each populated field and upload the selected resume yourself.",
      "Answer custom questions in your own words.",
      "Stop here and click Submit yourself after reviewing the completed form.",
    ],
  };
}

export const greenhouseAdapter: ApplyAdapter = {
  id: "greenhouse",
  matches: (url) => /greenhouse\.io|boards\.greenhouse/i.test(url),
  buildPlan: (context) => planFor(context, "greenhouse", {
    resume: "input[type=file][name*=resume], input[type=file]",
    coverLetter: "textarea[name*=cover], textarea[id*=cover]",
  }),
};

export const leverAdapter: ApplyAdapter = {
  id: "lever",
  matches: (url) => /jobs\.lever\.co|lever\.co/i.test(url),
  buildPlan: (context) => planFor(context, "lever", {
    resume: "input[type=file]",
    coverLetter: "textarea[name*=cover], textarea[id*=cover]",
  }),
};

export const genericAdapter: ApplyAdapter = {
  id: "generic",
  matches: () => true,
  buildPlan: (context) => planFor(context, "generic", { resume: "input[type=file]", coverLetter: "textarea" }),
};

export const applyAdapters: readonly ApplyAdapter[] = [greenhouseAdapter, leverAdapter, genericAdapter];

export function adapterForUrl(url: string): ApplyAdapter {
  return applyAdapters.find((adapter) => adapter.matches(url)) ?? genericAdapter;
}
