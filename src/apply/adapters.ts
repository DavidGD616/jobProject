import type { ApplyAdapter, ApplyContext, ApplyFieldPlan, ApplyPlan } from "./types";

function profileField(context: ApplyContext, key: string, label: string, required = false): ApplyFieldPlan {
  const value = context.profile.resumeJson[key as keyof typeof context.profile.resumeJson];
  return { key, label, value: typeof value === "string" ? value : null, selector: null, required, source: "profile" };
}

function profileFieldWithSelector(context: ApplyContext, key: string, label: string, selector: string | null, required = false): ApplyFieldPlan {
  const field = profileField(context, key, label, required);
  return { ...field, selector };
}

function nameParts(name: string | undefined): { first: string | null; last: string | null } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    first: parts[0] ?? null,
    last: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

type ApplySelectors = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone: string;
  location?: string;
  resume: string;
  coverLetter: string;
};

function planFor(context: ApplyContext, adapter: "greenhouse" | "lever" | "generic", selectors: ApplySelectors): ApplyPlan {
  const resumePath = context.resumeVariant?.pdfPath;
  const names = nameParts(context.profile.resumeJson.name);
  const nameFields = selectors.firstName || selectors.lastName
    ? [
      { key: "first_name", label: "First name", value: names.first, selector: selectors.firstName ?? null, required: true, source: "profile" as const },
      { key: "last_name", label: "Last name", value: names.last, selector: selectors.lastName ?? null, required: true, source: "profile" as const },
    ]
    : [profileFieldWithSelector(context, "name", "Full name", selectors.name ?? null, true)];
  return {
    adapter,
    url: context.job.url,
    fields: [
      ...nameFields,
      profileFieldWithSelector(context, "email", "Email", selectors.email, true),
      profileFieldWithSelector(context, "phone", "Phone", selectors.phone),
      profileFieldWithSelector(context, "location", "Location", selectors.location ?? null),
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
    firstName: "input[name=first_name]",
    lastName: "input[name=last_name]",
    email: "input[name=email]",
    phone: "input[name=phone]",
    location: "input[name=location]",
    resume: "input[type=file][name*=resume], input[type=file]",
    coverLetter: "textarea[name*=cover], textarea[id*=cover]",
  }),
};

export const leverAdapter: ApplyAdapter = {
  id: "lever",
  matches: (url) => /jobs\.lever\.co|lever\.co/i.test(url),
  buildPlan: (context) => planFor(context, "lever", {
    name: "input[name=name]",
    email: "input[name=email]",
    phone: "input[name=phone]",
    location: "input[name=location]",
    resume: "input[type=file]",
    coverLetter: "textarea[name*=cover], textarea[id*=cover]",
  }),
};

export const genericAdapter: ApplyAdapter = {
  id: "generic",
  matches: () => true,
  buildPlan: (context) => planFor(context, "generic", {
    name: "input[name=name]",
    email: "input[type=email]",
    phone: "input[type=tel]",
    location: "input[name=location]",
    resume: "input[type=file]",
    coverLetter: "textarea",
  }),
};

export const applyAdapters: readonly ApplyAdapter[] = [greenhouseAdapter, leverAdapter, genericAdapter];

export function adapterForUrl(url: string): ApplyAdapter {
  return applyAdapters.find((adapter) => adapter.matches(url)) ?? genericAdapter;
}
