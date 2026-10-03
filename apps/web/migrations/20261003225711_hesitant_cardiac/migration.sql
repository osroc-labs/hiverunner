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
CREATE TABLE `machine` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
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
	`presence` text DEFAULT 'offline' NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_machine_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_machine_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_0_idx` ON `device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_1_idx` ON `device_code` (`user_code`);--> statement-breakpoint
CREATE INDEX `machine_org_idx` ON `machine` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `machine_user_idx` ON `machine` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `machine_token_idx` ON `machine` (`token_hash`);