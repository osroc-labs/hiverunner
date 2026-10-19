/**
 * What every tool is called and says it does. The docs page, `llms.txt` and
 * the server all read this list, so none of them can name a tool that is not
 * there. Kept apart from the registrations so a page can import it without
 * the operations behind them.
 */
export const HIVE_TOOLS = [
  {
    name: "get_hive",
    title: "Hive overview",
    scope: "hive:read",
    role: "Member",
    description:
      "Everything about the connected hive in one call: who you are in it (`you`: role, your machines, what you can change), balance, whether a job can start now and what blocks it, machines, labels and prices, budget, settings, lifetime savings, and nextSteps to act on. Call this first.",
  },
  {
    name: "get_current_user",
    title: "Signed-in account",
    scope: "hive:read",
    role: "Member",
    description:
      "The person this connection acts as and their role in the hive. get_hive's `you` says which machines are theirs and what they can change.",
  },
  {
    name: "list_machines",
    title: "Machines",
    scope: "hive:read",
    role: "Member",
    description:
      "Every machine serving the hive: owner, cores, architecture, presence, daemon version and recent work. Use it when get_hive says no machine is online, or before remove_machine.",
  },
  {
    name: "list_jobs",
    title: "Jobs",
    scope: "hive:read",
    role: "Member",
    description:
      "Recent jobs, newest first, with result, duration, price, and why the runner stopped when it was killed. Filter by status or repository; call get_job for one job's receipt.",
  },
  {
    name: "get_job",
    title: "Job receipt",
    scope: "hive:read",
    role: "Member",
    description:
      "One job by id, with its price split, signed receipt, and why the runner stopped when it was killed. Ids come from list_jobs.",
  },
  {
    name: "get_usage",
    title: "Usage",
    scope: "hive:read",
    role: "Member",
    description:
      "The last fourteen days by day: jobs, failures, minutes, what was spent and what the same minutes list for on GitHub-hosted runners, plus the daily balance.",
  },
  {
    name: "get_leaderboard",
    title: "Leaderboard",
    scope: "hive:read",
    role: "Member",
    description:
      "Who and which machines carried the hive's jobs over the last week, month or all time.",
  },
  {
    name: "get_pricing",
    title: "Pricing",
    scope: "hive:read",
    role: "Member",
    description:
      "The per-minute price of every label beside GitHub-hosted and Blacksmith list prices. Pass minutes to compare a month. Use it to answer what moving a workflow would save.",
  },
  {
    name: "get_workflow",
    title: "Workflow YAML",
    scope: "hive:read",
    role: "Member",
    description:
      "The workflow YAML that runs a job on the hive, with a fallback runner for when no machine is free. Use it when editing a repository's .github/workflows files.",
  },
  {
    name: "update_settings",
    title: "Change hive settings",
    scope: "hive:write",
    role: "Owner",
    description:
      "Change who may add machines (allowedTeams), who is paid (earningsDestination), whether macOS jobs run, or how jobs are routed. Only what you pass changes. Pass the version from get_hive to refuse saving over someone else's change.",
  },
  {
    name: "set_budget",
    title: "Set the monthly budget",
    scope: "hive:write",
    role: "Admin or owner",
    description:
      "Set, change or remove the hive's monthly budget for jobs, and whether reaching it warns or pauses new jobs. Pass monthlyUsd: null to remove it.",
  },
  {
    name: "set_auto_top_up",
    title: "Automatic top-up",
    scope: "hive:write",
    role: "Admin or owner",
    description:
      "Turn automatic top-up on or off, or change the amount, the balance it acts below and its monthly limit. It charges the card saved by a payment made in the browser; a card cannot be added here.",
  },
  {
    name: "remove_machine",
    title: "Remove a machine",
    scope: "hive:write",
    role: "Machine owner or hive owner",
    description:
      "Stop a machine serving this hive. It keeps serving its other hives, and its owner can add it back with `hived link`. Ids come from list_machines.",
  },
  {
    name: "retire_machine",
    title: "Retire a machine",
    scope: "hive:write",
    role: "Machine owner",
    description:
      "Retire one of your own machines outright: it stops serving every hive and its token stops working, as `hived logout --revoke` does on the machine. Adding it back means enrolling again. To take a machine out of this hive only, use remove_machine.",
  },
  {
    name: "create_enroll_key",
    title: "Mint an enroll key",
    scope: "hive:write",
    role: "Admin or owner",
    description:
      "Mint a key that adds machines to this hive with no browser, for a fleet or an agent with a shell on them. It returns the key once, with the install and hived login commands that use it. Machines it enrolls are yours. It expires (expiresInHours, default 24) and can be limited to a number of machines (maxUses).",
  },
  {
    name: "list_enroll_keys",
    title: "Enroll keys",
    scope: "hive:read",
    role: "Admin or owner",
    description:
      "The hive's enroll keys, newest first: what each is for, whether it is live, expired, used up or revoked, and how many machines it has enrolled. Never the keys themselves.",
  },
  {
    name: "revoke_enroll_key",
    title: "Revoke an enroll key",
    scope: "hive:write",
    role: "Admin or owner",
    description:
      "Stop an enroll key adding machines. Machines it already enrolled stay; remove them with remove_machine. Ids come from list_enroll_keys.",
  },
] as const
