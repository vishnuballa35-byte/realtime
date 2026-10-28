
// =====================================================
// VN — push-register.js
// Connects the Android Firebase Installation ID (FID)
// to the currently logged-in Supabase user.
// =====================================================

(function () {
  const client =
    typeof getClient === "function" ? getClient() : null;

  if (!client) {
    console.warn("VN Push: Supabase client not available");
    return;
  }

  let registering = false;

  async function registerDevice() {
    if (registering) return;

    // Native Android only
    if (!window.VNAndroid ||
        typeof window.VNAndroid.getFcmToken !== "function") {
      return;
    }

    registering = true;

    try {
      const { data, error } = await client.auth.getUser();

      if (error || !data.user) return;

      // This value must be the FID saved by onRegistered()
      const fid = window.VNAndroid.getFcmToken();

      if (!fid || !fid.trim()) {
        console.log("VN Push: Waiting for Firebase registration");
        return;
      }

      const { error: saveError } = await client
        .from("device_tokens")
        .upsert(
          {
            user_id: data.user.id,
            token: fid.trim(),
            updated_at: new Date().toISOString()
          },
          { onConflict: "token" }
        );

      if (saveError) {
        console.error("VN Push: Registration save failed", saveError);
        return;
      }

      console.log("VN Push: Device registered successfully");

    } catch (error) {
      console.error("VN Push: Registration error", error);
    } finally {
      registering = false;
    }
  }

  // Register after login and when the page becomes active.
  client.auth.onAuthStateChange(() => {
    setTimeout(registerDevice, 500);
  });

  registerDevice();

  // Retry while waiting for native Firebase registration.
  const retry = setInterval(registerDevice, 5000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) registerDevice();
  });

  // Stop retrying after 2 minutes.
  setTimeout(() => clearInterval(retry), 120000);

})();
