"use strict";

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { ServerManager } = require("./serverManager");

const app = express();
const PORT = Number(process.env.PORT || 5000);

const serversPath = path.join(__dirname, "servers.json");
const usersPath = path.join(__dirname, "users.json");

const serverConfig = JSON.parse(
  fs.readFileSync(serversPath, "utf8")
);

const users = fs.existsSync(usersPath)
  ? JSON.parse(fs.readFileSync(usersPath, "utf8"))
  : [];

const manager = new ServerManager(serverConfig.servers || []);
const sessions = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function saveUsers() {
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .scryptSync(String(password), salt, 64)
    .toString("hex");

  return {
    salt,
    hash
  };
}

function verifyPassword(password, user) {
  const hash = crypto
    .scryptSync(String(password), user.salt, 64)
    .toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(user.passwordHash, "hex")
  );
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    userId: user.id,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  });

  return token;
}

function getCurrentUser(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length);
  const session = sessions.get(token);

  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return users.find((user) => user.id === session.userId) || null;
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "يجب تسجيل الدخول أولًا"
    });
  }

  req.user = user;
  next();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pageTemplate(title, body, script = "") {
  return `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 24px;
    }

    main {
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
    }

    h1, h2, p {
      margin-top: 0;
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }

    input, button {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #30363d;
      font-size: 15px;
      margin-top: 8px;
    }

    input {
      background: #0d1117;
      color: #e6edf3;
    }

    button {
      cursor: pointer;
      background: #238636;
      color: white;
      border: 0;
      font-weight: bold;
    }

    button.danger {
      background: #da3633;
    }

    button.secondary {
      background: #30363d;
    }

    .actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 15px;
    }

    .server {
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 16px;
      margin-top: 12px;
    }

    .status {
      display: inline-block;
      padding: 5px 10px;
      border-radius: 15px;
      font-size: 13px;
      background: #30363d;
    }

    .status.online {
      background: #238636;
    }

    .status.error {
      background: #da3633;
    }

    .muted {
      color: #8b949e;
    }

    .message {
      margin-top: 12px;
      color: #f2cc60;
    }

    @media (max-width: 650px) {
      .actions {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
  ${script}
</body>
</html>
`;
}

app.get("/", (req, res) => {
  res.send(
    pageTemplate(
      "تسجيل الدخول",
      `
      <div class="card">
        <h1>لوحة تحكم البوت</h1>
        <p class="muted">تسجيل الدخول بالبريد الإلكتروني</p>

        <form id="loginForm">
          <label>البريد الإلكتروني</label>
          <input id="email" type="email" required>

          <label>كلمة المرور</label>
          <input id="password" type="password" required>

          <button type="submit">تسجيل الدخول</button>
        </form>

        <button class="secondary" onclick="location.href='/register'">
          إنشاء حساب جديد
        </button>

        <div id="message" class="message"></div>
      </div>
      `,
      `
      <script>
        document.getElementById("loginForm").addEventListener("submit", async (event) => {
          event.preventDefault();

          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email: document.getElementById("email").value,
              password: document.getElementById("password").value
            })
          });

          const data = await response.json();

          if (!data.success) {
            document.getElementById("message").textContent = data.message;
            return;
          }

          localStorage.setItem("token", data.token);
          location.href = "/dashboard";
        });
      </script>
      `
    )
  );
});

app.get("/register", (req, res) => {
  res.send(
    pageTemplate(
      "إنشاء حساب",
      `
      <div class="card">
        <h1>إنشاء حساب جديد</h1>
        <p class="muted">استخدم بريدًا إلكترونيًا صالحًا وكلمة مرور قوية.</p>

        <form id="registerForm">
          <label>البريد الإلكتروني</label>
          <input id="email" type="email" required>

          <label>كلمة المرور</label>
          <input id="password" type="password" minlength="8" required>

          <button type="submit">إنشاء الحساب</button>
        </form>

        <button class="secondary" onclick="location.href='/'">
          العودة لتسجيل الدخول
        </button>

        <div id="message" class="message"></div>
      </div>
      `,
      `
      <script>
        document.getElementById("registerForm").addEventListener("submit", async (event) => {
          event.preventDefault();

          const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email: document.getElementById("email").value,
              password: document.getElementById("password").value
            })
          });

          const data = await response.json();

          if (!data.success) {
            document.getElementById("message").textContent = data.message;
            return;
          }

          alert("تم إنشاء الحساب بنجاح");
          location.href = "/";
        });
      </script>
      `
    )
  );
});

app.get("/dashboard", (req, res) => {
  res.send(
    pageTemplate(
      "لوحة التحكم",
      `
      <div class="card">
        <h1>لوحة التحكم</h1>
        <p id="userEmail" class="muted"></p>
        <button class="secondary" onclick="logout()">تسجيل الخروج</button>
      </div>

      <div class="card">
        <h2>السيرفرات</h