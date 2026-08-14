import assert from "node:assert/strict";
import test from "node:test";

import type {
  NormalizedPosting,
  SourceAdapter,
  SourceFetchConfig,
} from "@/sources";

type FixturePosting = {
  id: number;
  title: string;
  url: string;
  htmlDescription: string;
};

const fixtureAdapter: SourceAdapter<FixturePosting> = {
  async fetch(config: SourceFetchConfig): Promise<FixturePosting[]> {
    void config;
    return [
      {
        id: 42,
        title: "Software Engineer - Remote",
        url: "https://example.test/jobs/42",
        htmlDescription: "<p>Build useful things.</p>",
      },
    ];
  },

  normalize(raw: Readonly<FixturePosting>): NormalizedPosting {
    return {
      url: raw.url,
      title: raw.title,
      titleNorm: raw.title.replace(" - Remote", "").toLowerCase(),
      description: raw.htmlDescription.replace(/<[^>]+>/g, ""),
    };
  },

  sourceId(raw: Readonly<FixturePosting>): string {
    return String(raw.id);
  },
};

test("an adapter returns raw postings through fetch", async () => {
  const postings = await fixtureAdapter.fetch({
    company: {
      id: 1,
      name: "Example Co",
      atsType: "fixture",
      atsToken: "example",
      careersUrl: null,
    },
    userAgent: "job-hunt-agent-test/1.0",
    timeoutMs: 5_000,
  });

  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.id, 42);
});

test("normalize is deterministic and does not mutate the raw posting", () => {
  const raw: FixturePosting = {
    id: 42,
    title: "Software Engineer - Remote",
    url: "https://example.test/jobs/42",
    htmlDescription: "<p>Build useful things.</p>",
  };
  const before = structuredClone(raw);

  const first = fixtureAdapter.normalize(raw);
  const second = fixtureAdapter.normalize(raw);

  assert.deepEqual(raw, before);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    url: "https://example.test/jobs/42",
    title: "Software Engineer - Remote",
    titleNorm: "software engineer",
    description: "Build useful things.",
  });
});

test("sourceId is stable and separate from content", () => {
  const raw: FixturePosting = {
    id: 42,
    title: "Software Engineer - Remote",
    url: "https://example.test/jobs/42",
    htmlDescription: "<p>Build useful things.</p>",
  };

  assert.equal(fixtureAdapter.sourceId(raw), "42");
  assert.equal(
    fixtureAdapter.sourceId({ ...raw, htmlDescription: "<p>Updated</p>" }),
    "42",
  );
});
