import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";

window.MiBalanceAuth = createAuthClient({
  plugins: [passkeyClient()],
});
