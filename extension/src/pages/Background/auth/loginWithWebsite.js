// Cloud features are disabled at build time (CLOUD_FEATURES_ENABLED is
// hardcoded false via webpack DefinePlugin). The Screenity-era cloud login
// flow that previously lived here returned the authenticated/subscribed/
// cached/transient/error/user payload after a verify-or-refresh round-trip
// to the Screenity API; that whole flow is unreachable in our build.
//
// This stub preserves the call shape so the 12 caller sites don't need to
// change in lockstep. The follow-up commit flattens them all (drops the
// dead `if (authenticated)` branches and the unused destructured fields)
// and then deletes this file.

export const loginWithWebsite = async () => ({
  authenticated: false,
  instantMode: false,
});
