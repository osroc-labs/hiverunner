CREATE TABLE `device_code` (
	`id` text PRIMARY KEY,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text
);
--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`machine_id` text NOT NULL,
	`label` text NOT NULL,
	`repository` text NOT NULL,
	`workflow_run_id` integer,
	`github_job_id` integer,
	`job_name` text DEFAULT '' NOT NULL,
	`vcpus` integer NOT NULL,
	`speed_score` real NOT NULL,
	`rate` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`result` text,
	`compute_units` real,
	`amount` integer,
	`tax` integer,
	`earning` integer,
	`payee_type` text,
	`payee_id` text,
	`receipt` text,
	`receipt_signature` text,
	`receipt_key_id` text,
	CONSTRAINT `fk_job_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_job_machine_id_machine_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machine`(`id`)
);
--> statement-breakpoint
CREATE TABLE `machine` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`os` text NOT NULL,
	`arch` text NOT NULL,
	`cores` integer NOT NULL,
	`memory_bytes` integer NOT NULL,
	`speed_score` real DEFAULT 1 NOT NULL,
	`daemon_version` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_machine_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `machine_pool` (
	`machine_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`presence` text DEFAULT 'offline' NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `machine_pool_pk` PRIMARY KEY(`machine_id`, `organization_id`),
	CONSTRAINT `fk_machine_pool_machine_id_machine_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machine`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_machine_pool_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_0_idx` ON `device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_1_idx` ON `device_code` (`user_code`);--> statement-breakpoint
CREATE INDEX `job_org_idx` ON `job` (`organization_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `job_machine_idx` ON `job` (`machine_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `machine_user_idx` ON `machine` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `machine_token_idx` ON `machine` (`token_hash`);--> statement-breakpoint
CREATE INDEX `machine_pool_org_idx` ON `machine_pool` (`organization_id`,`status`);