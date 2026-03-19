// CLI entrypoint for the auth module. It exposes the Supabase OTP helpers from
// `auth` as terminal-friendly commands for manual testing and local workflows.
import { auth, type SupabaseEmailOtpType } from "./index";

// Keep the file portable for environments where `process` may not be typed.
declare const process:
  | {
      argv?: string[];
      exit: (code?: number) => never;
    }
  | undefined;

// Supported commands for the auth CLI.
type CommandName = "request" | "verify" | "session" | "user" | "signout" | "help";

// Shows the available auth commands, examples, and a few usage notes.
function printUsage(): void {
  console.log(`
Supabase Auth CLI

Usage:
  npm run auth:otp -- request <email>
  npm run auth:otp -- verify <email> <token> [type]
  npm run auth:otp -- session
  npm run auth:otp -- user
  npm run auth:otp -- signout

Examples:
  npm run auth:otp -- request user@example.com
  npm run auth:otp -- verify user@example.com 123456
  npm run auth:otp -- verify user@example.com 123456 email

Notes:
  - "request" sends an email OTP through Supabase.
  - "verify" stores the returned session locally in SQLite app_state.
  - [type] is optional. If omitted, verification will try the supported email OTP types automatically.
`.trim());
}

// Returns only the user-supplied arguments after the script name.
function getArgs(): string[] {
  return process?.argv?.slice(2) ?? [];
}

// Normalizes the command token and falls back to `help` when it is unknown.
function getCommand(raw: string | undefined): CommandName {
  const normalized = (raw ?? "help").toLowerCase();

  switch (normalized) {
    case "request":
    case "verify":
    case "session":
    case "user":
    case "signout":
      return normalized as CommandName;
    default:
      return "help";
  }
}

// Pretty-prints returned auth data so sessions and users are easy to inspect.
function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

// Prints an error and exits immediately so invalid CLI usage does not continue.
function fail(message: string): never {
  console.error(message);
  if (process) {
    process.exit(1);
  }

  throw new Error(message);
}

// Requests an email OTP from Supabase and echoes the response payload.
async function handleRequest(email: string | undefined): Promise<void> {
  if (!email?.trim()) {
    fail('Missing email. Usage: npm run auth:otp -- request <email>');
  }

  const result = await auth.sendEmailOtp({
    email
  });

  console.log(`OTP requested for ${email.trim().toLowerCase()}.`);
  printJson(result);
}

// Verifies an OTP token and optionally forces a specific Supabase verification type.
async function handleVerify(
  email: string | undefined,
  token: string | undefined,
  type: string | undefined
): Promise<void> {
  if (!email?.trim() || !token?.trim()) {
    fail('Missing email or token. Usage: npm run auth:otp -- verify <email> <token> [type]');
  }

  const payload: {
    email: string;
    token: string;
    type?: SupabaseEmailOtpType;
  } = {
    email,
    token
  };

  if (type?.trim()) {
    payload.type = type as SupabaseEmailOtpType;
  }

  const result = await auth.verifyEmailOtp(payload);

  console.log(`OTP verified for ${email.trim().toLowerCase()}.`);
  printJson(result);
}

// Prints the currently stored session, refreshing it first if it has expired.
async function handleSession(): Promise<void> {
  const session = await auth.getAuthenticatedSession({
    refreshIfExpired: true
  });
  printJson(session);
}

// Loads the authenticated user profile using the current session.
async function handleUser(): Promise<void> {
  const user = await auth.getAuthenticatedUser();
  printJson(user);
}

// Signs out remotely when possible and always clears the local stored session.
async function handleSignout(): Promise<void> {
  await auth.signOutAuth();
  console.log("Signed out.");
}

// Central dispatcher that maps parsed CLI input to the correct auth operation.
async function main(): Promise<void> {
  const [rawCommand, arg1, arg2, arg3] = getArgs();
  const command = getCommand(rawCommand);

  switch (command) {
    case "request":
      await handleRequest(arg1);
      return;
    case "verify":
      await handleVerify(arg1, arg2, arg3);
      return;
    case "session":
      await handleSession();
      return;
    case "user":
      await handleUser();
      return;
    case "signout":
      await handleSignout();
      return;
    case "help":
    default:
      printUsage();
  }
}

// Final safety net so unexpected errors still exit as a clean CLI failure.
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Auth CLI failed: ${message}`);
  if (process) {
    process.exit(1);
  }
});
