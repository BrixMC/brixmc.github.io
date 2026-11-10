"use strict";
const API = "https://brix-api.brix-account.workers.dev";
const TOKEN_KEY = "brix_token";
const launcherMode = new URLSearchParams(location.search).get("launcher") === "1";
const qs = launcherMode ? "?launcher=1" : "";

const $ = (id) => document.getElementById(id);
const store = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
};

const ERRORS = {
  invalid_credentials: "Wrong username/email or password. Email login only works once the email is verified.",
  username_taken: "That username is already taken.",
  invalid_username: "Username must be 3-16 characters: letters, numbers, underscore.",
  invalid_password: "Password must be 8-128 characters.",
  invalid_email: "That email address does not look valid.",
  email_in_use: "That email is already verified on another account.",
  mail_failed: "We could not send the email. Try again later.",
  TooManyRequestsException: "Too many attempts. Try again in a few minutes.",
};

async function api(path, { method = "GET", body, token, contentType } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = contentType || "application/json";
    payload = contentType ? body : JSON.stringify(body);
  }
  try {
    const res = await fetch(API + path, { method, headers, body: payload });
    let data = null;
    if ((res.headers.get("Content-Type") || "").includes("json"))
      data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
}

function say(el, text, kind) {
  el.textContent = text;
  el.className = "msg" + (kind ? " " + kind : "");
}

function errText(r) {
  if (r.status === 0) return "Could not reach the Brix server.";
  return ERRORS[r.data && r.data.error] || "Something went wrong (" + ((r.data && r.data.error) || r.status) + ").";
}

function drawFace(img, canvas) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, canvas.width, canvas.height);
  if (img.naturalHeight === 64)
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, canvas.width, canvas.height);
}

async function finishLogin(token) {
  store.set(token);
  if (launcherMode) {
    const r = await api("/launcher/code", { method: "POST", token });
    if (r.ok && r.data && r.data.code) {
      location.href = "brix://auth?code=" + encodeURIComponent(r.data.code);
      return;
    }
  }
  location.href = "account.html" + qs;
}


async function initLogin() {
  const msg = $("msg");
  let mode = "login";

  function setMode(m) {
    mode = m;
    $("tab-login").classList.toggle("active", m === "login");
    $("tab-register").classList.toggle("active", m === "register");
    $("submit").textContent = m === "login" ? "Login" : "Create account";
    $("username-label").textContent = m === "login" ? "Username or email" : "Username";
    $("username").maxLength = m === "login" ? 254 : 16;
    $("email-row").hidden = m === "login";
    $("email").required = m === "register";
    $("forgot-link").hidden = m === "register";
    $("password").autocomplete = m === "login" ? "current-password" : "new-password";
    say(msg, "");
  }
  $("tab-login").addEventListener("click", () => setMode("login"));
  $("tab-register").addEventListener("click", () => setMode("register"));
  setMode("login");

  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("submit").disabled = true;
    say(msg, "Please wait...");
    try {
      const username = $("username").value.trim();
      const password = $("password").value;
      if (mode === "register") {
        const email = $("email").value.trim();
        const reg = await api("/register", { method: "POST", body: { username, email, password } });
        if (!reg.ok) return say(msg, errText(reg), "err");
      }
      const r = await api("/login", { method: "POST", body: { username, password } });
      if (!r.ok) return say(msg, errText(r), "err");
      await finishLogin(r.data.accessToken);
    } finally {
      $("submit").disabled = false;
    }
  });

  const token = store.get();
  if (!token) return;
  const v = await api("/validate", { token });
  if (!(v.ok && v.data && v.data.valid)) { store.clear(); return; }

  if (!launcherMode) { location.href = "account.html"; return; }
  $("resume-name").textContent = v.data.username;
  $("resume").hidden = false;
  $("auth-box").hidden = true;
  $("resume-btn").addEventListener("click", () => finishLogin(token));
  $("switch-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST", token });
    store.clear();
    location.reload();
  });
}

function takeToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(null, "", location.pathname);
  return token;
}

async function initVerify() {
  const msg = $("msg");
  const token = takeToken();
  if (!token) return say(msg, "This verification link is not valid.", "err");
  const r = await api("/email/verify", { method: "POST", body: { token } });
  if (r.ok) say(msg, "Your email is verified. You can now log in with it.", "ok");
  else if (r.data && r.data.error === "email_in_use") say(msg, errText(r), "err");
  else say(msg, "This link is invalid or has expired. Request a new one from your account page.", "err");
}

function initForgot() {
  $("forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("submit").disabled = true;
    const r = await api("/password/forgot", { method: "POST", body: { email: $("email").value.trim() } });
    if (r.ok) say($("msg"), "If that email belongs to a verified account, we sent a reset link.", "ok");
    else say($("msg"), errText(r), "err");
    $("submit").disabled = false;
  });
}

function initReset() {
  const msg = $("msg");
  const token = takeToken();
  if (!token) {
    $("reset-form").hidden = true;
    return say(msg, "This reset link is not valid.", "err");
  }
  $("reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("submit").disabled = true;
    const r = await api("/password/reset", { method: "POST", body: { token, newPassword: $("password").value } });
    if (r.ok) {
      $("reset-form").hidden = true;
      $("to-login").hidden = false;
      say(msg, "Password changed. You can log in now.", "ok");
    } else {
      say(msg, r.data && r.data.error === "invalid_token"
        ? "This link is invalid or has expired. Request a new one."
        : errText(r), "err");
      $("submit").disabled = false;
    }
  });
}

async function initAccount() {
  const token = store.get();
  const v = token ? await api("/validate", { token }) : null;
  if (!v || !v.ok || !v.data || !v.data.valid) {
    store.clear();
    location.href = "login.html" + qs;
    return;
  }
  const { username, uuid } = v.data;
  const id = uuid.replaceAll("-", "");
  const msg = $("msg");
  $("name").textContent = username;
  $("uuid").textContent = uuid;

  async function loadSkin() {
    const r = await api("/sessionserver/session/minecraft/profile/" + id);
    let url = null;
    try {
      const prop = r.data.properties.find((p) => p.name === "textures");
      url = JSON.parse(atob(prop.value)).textures.SKIN.url || null;
    } catch {}
    const img = $("skin-img");
    if (!url) {
      $("skin-state").textContent = "No skin uploaded. The game uses its default skin.";
      img.hidden = true;
      $("face").getContext("2d").clearRect(0, 0, 64, 64);
      return;
    }
    $("skin-state").textContent = "Current skin:";
    img.onload = () => drawFace(img, $("face"));
    img.src = url;
    img.hidden = false;
  }

  $("upload-btn").addEventListener("click", async () => {
    const file = $("skin-file").files[0];
    if (!file) return say(msg, "Choose a PNG file first.", "err");
    if (file.size > 24 * 1024) return say(msg, "Skin is too large (max 24 KB).", "err");
    say(msg, "Uploading...");
    const r = await api("/api/user/profile/" + id + "/skin?model=" + $("skin-model").value, {
      method: "PUT", token, body: file, contentType: "image/png",
    });
    if (r.status === 204) { say(msg, "Skin updated.", "ok"); loadSkin(); }
    else say(msg, (r.data && r.data.errorMessage) || errText(r), "err");
  });

  $("delete-btn").addEventListener("click", async () => {
    const r = await api("/api/user/profile/" + id + "/skin", { method: "DELETE", token });
    if (r.status === 204) { say(msg, "Skin removed.", "ok"); loadSkin(); }
    else say(msg, errText(r), "err");
  });

  const when = (t) => new Date(t * 1000).toLocaleString();

  async function loadSessions() {
    const r = await api("/account/sessions", { token });
    const list = $("session-list");
    list.replaceChildren();
    if (!r.ok) return say($("sess-msg"), errText(r), "err");
    for (const s of r.data.sessions) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = (s.current ? "This browser - " : "") + "signed in " + when(s.createdAt);
      li.append(label);
      if (!s.current) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary";
        b.textContent = "Log out";
        b.addEventListener("click", async () => {
          await api("/account/sessions/revoke", { method: "POST", token, body: { id: s.id } });
          loadSessions();
        });
        li.append(b);
      }
      list.append(li);
    }
  }

  $("pw-btn").addEventListener("click", async () => {
    const m = $("pw-msg");
    say(m, "Please wait...");
    const r = await api("/account/password", {
      method: "POST", token,
      body: { currentPassword: $("pw-current").value, newPassword: $("pw-new").value },
    });
    if (r.ok) {
      say(m, "Password changed. Other devices were logged out.", "ok");
      $("pw-current").value = "";
      $("pw-new").value = "";
      loadSessions();
    } else {
      say(m, r.status === 401 ? "Current password is wrong." : errText(r), "err");
    }
  });

  $("revoke-others-btn").addEventListener("click", async () => {
    const r = await api("/account/sessions/revoke-others", { method: "POST", token });
    say($("sess-msg"), r.ok ? "Other devices logged out." : errText(r), r.ok ? "ok" : "err");
    if (r.ok) loadSessions();
  });

  let armed = false;
  $("del-btn").addEventListener("click", async () => {
    const btn = $("del-btn");
    if (!armed) {
      armed = true;
      btn.textContent = "Tap again to confirm";
      setTimeout(() => { armed = false; btn.textContent = "Delete my account"; }, 5000);
      return;
    }
    armed = false;
    btn.textContent = "Delete my account";
    const r = await api("/account/delete", { method: "POST", token, body: { password: $("del-pw").value } });
    if (r.ok) { store.clear(); location.href = "index.html"; }
    else say($("del-msg"), r.status === 401 ? "Password is wrong." : errText(r), "err");
  });

  loadSessions();

  async function loadEmail() {
    const r = await api("/account/me", { token });
    if (!r.ok) return;
    const { email, emailVerified } = r.data;
    $("email-state").textContent = email
      ? email + (emailVerified ? " (verified)" : " (not verified yet)")
      : "No email on this account yet.";
    $("email-resend-btn").hidden = !(email && !emailVerified);
  }

  $("email-btn").addEventListener("click", async () => {
    const m = $("email-msg");
    say(m, "Please wait...");
    const r = await api("/account/email", {
      method: "POST", token,
      body: { email: $("email-new").value.trim(), password: $("email-pw").value },
    });
    if (r.ok) {
      say(m, "Check your inbox for the verification link.", "ok");
      $("email-pw").value = "";
    } else {
      say(m, r.status === 401 ? "Password is wrong." : errText(r), "err");
    }
  });

  $("email-resend-btn").addEventListener("click", async () => {
    const r = await api("/account/email/resend", { method: "POST", token });
    say($("email-msg"), r.ok ? "Verification email sent." : errText(r), r.ok ? "ok" : "err");
  });

  loadEmail();

  $("logout-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST", token });
    store.clear();
    location.href = "login.html" + qs;
  });

  loadSkin();
}

const page = document.body.dataset.page;
if (page === "login") initLogin();
if (page === "account") initAccount();
if (page === "verify") initVerify();
if (page === "forgot") initForgot();
if (page === "reset") initReset();
