# Security deployment checklist

1. Set `PLATFORM_OWNER_EMAIL` and `NEXT_PUBLIC_PLATFORM_OWNER_EMAIL` to the approved company administrator account. The email is no longer embedded in source code.
2. Set `API_KEY_ENCRYPTION_SECRET` to a randomly generated secret of at least 32 characters. Keep it in the deployment secret manager.
3. Deploy the updated application.
4. In Admin > API Key Vault, save the Intercom and OpenAI keys again. New saves are encrypted with AES-256-GCM before they are written to Supabase. Existing plaintext rows remain readable only to support this one-time migration.
5. Confirm both integrations work, then remove superseded plaintext key rows and database backups according to the approved retention procedure.
6. Rotate the Intercom and OpenAI keys after the migration.
7. Confirm Supabase Row Level Security and service-role access with IT. The service-role key must never be exposed to the browser.
8. Test an inactive user, a viewer, a supervisor and an administrator before release.

Do not change or lose `API_KEY_ENCRYPTION_SECRET` while encrypted keys are in use. Losing it makes the stored credentials unreadable; changing it requires saving the API keys again.
