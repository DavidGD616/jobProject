import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createHnHiringDiscovery,
  parseHnHiringCandidate,
  parseHnHiringComment,
} from "@/discovery";
import type {
  HnHiringDiscoveryConfig,
  HnHiringDiscoveryDependencies,
} from "@/discovery";
import { allowAllRobotsPolicy } from "@/sources";

const stories = JSON.parse(
  readFileSync("tests/fixtures/discovery/hn-stories.json", "utf8"),
);
const comments = JSON.parse(
  readFileSync("tests/fixtures/discovery/hn-comments.json", "utf8"),
);
// Sanitized fields from live Algolia responses recorded on 2026-08-14. Edge
// cases below intentionally use small synthetic payloads.

const config = {
  timeoutMs: 5_000,
  maxAttempts: 2,
  retryBaseDelayMs: 0,
  maxConcurrentRequests: 1,
  minRequestIntervalMs: 0,
  storySearchHitsPerPage: 10,
  maxStories: 12,
  maxStoryPages: 10,
  commentHitsPerPage: 100,
  maxCommentPages: 10,
  userAgent: "job-hunt-agent-test/1.0 (+https://example.test/contact)",
};

function testDiscovery(
  configOverrides: Partial<HnHiringDiscoveryConfig> = config,
  dependencies: HnHiringDiscoveryDependencies = {},
) {
  return createHnHiringDiscovery(configOverrides, {
    robotsPolicy: allowAllRobotsPolicy,
    ...dependencies,
  });
}

test("HN hiring discovery chooses the latest monthly thread and parses candidates", async () => {
  const requestedUrls: string[] = [];
  const discovery = testDiscovery(config, {
    fetchImpl: async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      return new Response(
        JSON.stringify(url.includes("tags=comment%2Cstory_49156683") ? comments : stories),
      );
    },
  });

  const candidates = await discovery.discover();

  assert.deepEqual(candidates, [
    {
      name: "Stream",
      atsType: "ashby",
      atsToken: "stream",
      discoveredVia: "hn_hiring",
    },
    {
      name: "PermitFlow",
      atsType: "ashby",
      atsToken: "permitflow",
      discoveredVia: "hn_hiring",
    },
  ]);
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0]!, /search_by_date/);
  assert.match(requestedUrls[1]!, /story_49156683/);
});

test("HN hiring discovery accepts a reproducible story ID and retries rate limits", async () => {
  let requests = 0;
  const delays: number[] = [];
  const discovery = testDiscovery(config, {
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify(comments));
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  const candidates = await discovery.discover({ storyId: 49156683 });

  assert.equal(requests, 2);
  assert.deepEqual(delays, [0]);
  assert.equal(candidates.length, 2);
});

test("HN hiring discovery uses a bounded rolling set of monthly threads", async () => {
  const monthlyStories = {
    hits: [
      {
        objectID: "49156683",
        title: "Ask HN: Who is hiring? (August 2026)",
      },
      {
        objectID: "234567",
        title: "Ask HN: Who is hiring? (July 2026)",
      },
    ],
  };
  const priorMonthComments = {
    hits: [
      {
        objectID: "6",
        parent_id: 234567,
        comment_text:
          "<p>Company: Zeta<br><a href=\"https://boards.greenhouse.io/zeta/jobs/1\">Apply</a></p>",
      },
    ],
    nbPages: 1,
  };
  const discovery = testDiscovery(config, {
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("story_49156683")) {
        return new Response(JSON.stringify(comments));
      }
      if (url.includes("story_234567")) {
        return new Response(JSON.stringify(priorMonthComments));
      }
      return new Response(JSON.stringify(monthlyStories));
    },
  });

  const candidates = await discovery.discover();

  assert.equal(candidates.at(-1)?.name, "Zeta");
  assert.equal(candidates.length, 3);
});

test("HN hiring discovery reads every reported comment page", async () => {
  const secondPage = {
    hits: [
      {
        objectID: "5",
        parent_id: 49156683,
        comment_text:
          "<p>Company: Epsilon<br><a href=\"https://jobs.lever.co/epsilon/opening\">Apply</a></p>",
      },
    ],
    nbPages: 2,
  };
  const discovery = testDiscovery(config, {
    fetchImpl: async (input) => {
      const page = new URL(String(input)).searchParams.get("page");
      return new Response(
        JSON.stringify(page === "1" ? secondPage : { ...comments, nbPages: 2 }),
      );
    },
  });

  const candidates = await discovery.discover({ storyId: 49156683 });

  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ["Stream", "PermitFlow", "Epsilon"],
  );
});

test("HN hiring discovery ignores replies beneath a company listing", async () => {
  const reply = {
    objectID: "reply",
    parent_id: 49284614,
    comment_text:
      '<p>Company: Reply Corp<br><a href="https://jobs.lever.co/reply-corp/role">Apply</a></p>',
  };
  const discovery = testDiscovery(config, {
    fetchImpl: async () =>
      new Response(JSON.stringify({ ...comments, hits: [...comments.hits, reply] })),
  });

  const candidates = await discovery.discover({ storyId: 49156683 });

  assert.deepEqual(
    candidates.map((candidate) => candidate.name),
    ["Stream", "PermitFlow"],
  );
});

test("HN hiring discovery follows search pages until it finds monthly threads", async () => {
  const firstStoryPage = {
    hits: [{ objectID: "other", title: "Ask HN: Who is hiring right now?" }],
    nbPages: 2,
  };
  const secondStoryPage = {
    hits: [
      {
        objectID: "234567",
        title: "Ask HN: Who is hiring? (July 2026)",
      },
    ],
    nbPages: 2,
  };
  const monthlyComments = {
    hits: [
      {
        objectID: "7",
        parent_id: 234567,
        comment_text:
          "<p>Company: Paginated Co<br><a href=\"https://jobs.ashbyhq.com/paginated-co/role\">Apply</a></p>",
      },
    ],
    nbPages: 1,
  };
  const discovery = testDiscovery(
    { ...config, storySearchHitsPerPage: 1, maxStories: 1, maxStoryPages: 2 },
    {
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("tags") === "story") {
          return new Response(
            JSON.stringify(
              url.searchParams.get("page") === "1"
                ? secondStoryPage
                : firstStoryPage,
            ),
          );
        }
        return new Response(JSON.stringify(monthlyComments));
      },
    },
  );

  const candidates = await discovery.discover();

  assert.deepEqual(candidates, [
    {
      name: "Paginated Co",
      atsType: "ashby",
      atsToken: "paginated-co",
      discoveredVia: "hn_hiring",
    },
  ]);
});

test("HN hiring discovery accepts an empty comment result", async () => {
  const discovery = testDiscovery(config, {
    fetchImpl: async () => new Response(JSON.stringify({ hits: [], nbPages: 0 })),
  });

  assert.deepEqual(await discovery.discover({ storyId: 49156683 }), []);
});

test("HN hiring discovery checks robots.txt before querying Algolia", async () => {
  const requestedUrls: string[] = [];
  const discovery = createHnHiringDiscovery(config, {
    fetchImpl: async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(comments));
    },
  });

  const candidates = await discovery.discover({ storyId: 49156683 });

  assert.equal(candidates.length, 2);
  assert.deepEqual(requestedUrls.map((url) => new URL(url).pathname), [
    "/robots.txt",
    "/api/v1/search_by_date",
  ]);
});

test("HN hiring parsing admits explicit or token-matched headings with an official ATS URL", () => {
  assert.deepEqual(
    parseHnHiringCandidate(
      '<p>Company: Gamma, Inc.<br><a href="https:&#x2F;&#x2F;boards.greenhouse.io&#x2F;gamma&#x2F;jobs&#x2F;1">Apply</a></p>',
    ),
    {
      name: "Gamma, Inc.",
      atsType: "greenhouse",
      atsToken: "gamma",
      discoveredVia: "hn_hiring",
    },
  );
  assert.equal(
    parseHnHiringComment(
      '<p>Data analyst | Chicago, IL | <a href="https://jobs.lever.co/example/role">Apply</a></p>',
    ),
    null,
  );
  assert.equal(
    parseHnHiringComment(
      '<p>Cologne, Germany | UMH | <a href="https://jobs.ashbyhq.com/umh/role">Apply</a></p>',
    ),
    null,
  );
  assert.equal(
    parseHnHiringComment(
      '<p>Dave Evans | Founding Engineer | <a href="https://jobs.lever.co/example/role">Apply</a></p>',
    ),
    null,
  );
  assert.equal(
    parseHnHiringComment("<p>Company: No Link Inc.<br>Location: Remote</p>"),
    null,
  );
  assert.deepEqual(
    parseHnHiringCandidate(
      '<p>LiveKit | Voice AI | Remote<br><a href="https://jobs.ashbyhq.com/livekit/role">Apply</a></p>',
    ),
    {
      name: "LiveKit",
      atsType: "ashby",
      atsToken: "livekit",
      discoveredVia: "hn_hiring",
    },
  );
});
