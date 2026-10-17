CREATE TABLE `enroll_key` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`max_uses` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	CONSTRAINT `fk_enroll_key_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_enroll_key_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enroll_key_hash_idx` ON `enroll_key` (`key_hash`);--> statement-breakpoint
CREATE INDEX `enroll_key_org_idx` ON `enroll_key` (`organization_id`);