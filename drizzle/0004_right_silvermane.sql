CREATE TABLE `llm_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`cli_version` text,
	`prompt_hash` text NOT NULL,
	`prompt_version` text NOT NULL,
	`raw_output` text,
	`parsed` text,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_runs_cache_uq` ON `llm_runs` (`task`,`prompt_hash`,`provider`,`model`,`prompt_version`);--> statement-breakpoint
CREATE INDEX `llm_runs_task_created_idx` ON `llm_runs` (`task`,`created_at`);