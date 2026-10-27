// =====================================================
// ReelTime — otp-login.js
// Load LAST in index.html (after chat-security.js):
//   <script src="otp-login.js"></script>
//
// "Log in" tab:  email  ->  code is emailed  ->  type code  ->  logged in
// "Create account" tab: unchanged (name + email + password).
// Needs: Supabase email template that shows {{ .Token }} (see steps).
// =====================================================

(function otpLogin() {
  const client = getClient();
  const form = $("auth-form");

  if (!client || !form) return;

  const emailInput = $("auth-email");
  const passInput = $("auth-password");
  const submit = $("auth-submit");
  const message = $("auth-message");
  const loginTab = $("auth-login-tab");
  const signupTab = $("auth-signup-tab");
  const modal = $("auth-modal");
  const passLabel = document.querySelector('label[for="auth-password"]');

  let stage = "email"; // "email" = ask for email, "code" = ask for the code
  let busy = false;
  let cooldownTimer = null;

  // ----- extra fields added to the form -----

  const otpLabel = document.createElement("label");
  otpLabel.className = "auth-field";
  otpLabel.setAttribute("for", "auth-otp");
  otpLabel.textContent = "Login code";

  const otpInput = document.createElement("input");
  otpInput.className = "auth-input";
  otpInput.id = "auth-otp";
  otpInput.type = "text";
  otpInput.inputMode = "numeric";
  otpInput.autocomplete = "one-time-code";
  otpInput.maxLength = 10;
  otpInput.placeholder = "Enter the code from your email";

  const resendBtn = document.createElement("button");
  resendBtn.type = "button";
  resendBtn.className = "auth-logout";
  resendBtn.textContent = "Send a new code";

  [otpLabel, otpInput, resendBtn].forEach((el) => el.classList.add("hidden"));
  [otpLabel, otpInput, resendBtn].forEach((el) => el.style.display = "none");

  form.insertBefore(otpLabel, message);
  form.insertBefore(otpInput, message);
  form.insertBefore(resendBtn, message);

  // ----- helpers -----

  const isLogin = () => loginTab.classList.contains("active");

  function setMsg(text) {
    message.textContent = text || "";
  }

  function show(el, on) {
    el.style.display = on ? "" : "none";
    el.classList.toggle("hidden", !on);
  }

  function applyMode() {
    if (isLogin()) {
      // No password in login mode: the code replaces it.
      show(passInput, false);
      if (passLabel) show(passLabel, false);
      passInput.required = false;

      const inCode = stage === "code";
      show(otpLabel, inCode);
      show(otpInput, inCode);
      show(resendBtn, inCode);
      submit.textContent = inCode ? "Verify and log in" : "Send code";
    } else {
      show(passInput, true);
      if (passLabel) show(passLabel, true);
      passInput.required = true;

      show(otpLabel, false);
      show(otpInput, false);
      show(resendBtn, false);
    }
  }

  function resetStage() {
    stage = "email";
    otpInput.value = "";
    clearInterval(cooldownTimer);
    resendBtn.disabled = false;
    resendBtn.textContent = "Send a new code";
    applyMode();
  }

  function startCooldown(seconds = 60) {
    clearInterval(cooldownTimer);
    let left = seconds;
    resendBtn.disabled = true;
    resendBtn.textContent = `Send a new code (${left}s)`;

    cooldownTimer = setInterval(() => {
      left -= 1;

      if (left <= 0) {
        clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = "Send a new code";
        return;
      }

      resendBtn.textContent = `Send a new code (${left}s)`;
    }, 1000);
  }

  async function sendCode() {
    const email = emailInput.value.trim();

    if (!email) {
      setMsg("Enter your email address.");
      return false;
    }

    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    });

    if (error) {
      console.warn("Send code failed:", error);

      if (/signups not allowed|not found/i.test(error.message || "")) {
        setMsg("No account with this email. Use Create account first.");
      } else if (/rate|seconds|too many/i.test(error.message || "")) {
        setMsg("Too many tries. Please wait a minute and try again.");
      } else {
        setMsg("Could not send the code. Please try again.");
      }

      return false;
    }

    stage = "code";
    applyMode();
    startCooldown(60);
    setMsg(`We sent a code to ${email}. Type it below.`);
    otpInput.focus();
    return true;
  }

  async function verifyCode() {
    const email = emailInput.value.trim();
    const token = otpInput.value.replace(/\s/g, "");

    if (!token) {
      setMsg("Type the code from your email.");
      return;
    }

    const { error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email"
    });

    if (error) {
      console.warn("Verify code failed:", error);
      setMsg("That code is wrong or has expired. Try again or send a new code.");
      return;
    }

    setMsg("");
    resetStage();
    emailInput.value = "";

    if (typeof closeModal === "function") closeModal("auth-modal");
  }

  // ----- events -----

  // Capture on document so this runs before the old login code.
  document.addEventListener(
    "submit",
    async (event) => {
      if (event.target !== form || !isLogin()) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (busy) return;

      busy = true;
      submit.disabled = true;

      try {
        if (stage === "email") await sendCode();
        else await verifyCode();
      } finally {
        busy = false;
        submit.disabled = false;
      }
    },
    true
  );

  resendBtn.addEventListener("click", async () => {
    if (busy) return;

    busy = true;

    try {
      await sendCode();
    } finally {
      busy = false;
    }
  });

  // Changing the email while waiting for a code starts again.
  emailInput.addEventListener("input", () => {
    if (stage === "code") {
      resetStage();
      setMsg("");
    }
  });

  // Switching tabs or reopening the box starts again.
  [loginTab, signupTab].forEach((tab) =>
    tab.addEventListener("click", () => {
      resetStage();
      // The old tab code changes the button text first; run after it.
      setTimeout(applyMode, 0);
    })
  );

  if (modal) {
    new MutationObserver(() => {
      if (!modal.classList.contains("hidden")) setTimeout(resetStage, 0);
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  }

  // Keep the button text right if other code rewrites it.
  new MutationObserver(() => {
    const wanted =
      isLogin() ? (stage === "code" ? "Verify and log in" : "Send code") : null;

    if (wanted && submit.textContent !== wanted) submit.textContent = wanted;
  }).observe(submit, { childList: true, characterData: true, subtree: true });

  applyMode();
})();