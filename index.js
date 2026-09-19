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
        <h2>السيرفرات</h2>
        <div id="servers">جاري تحميل السيرفرات...</div>
      </div>
      `,
      `
      <script>
        const token = localStorage.getItem("token");

        if (!token) {
          location.href = "/";
        }

        function logout() {
          localStorage.removeItem("token");
          location.href = "/";
        }

        async function loadDashboard() {
          const response = await fetch("/api/me", {
            headers: {
              Authorization: "Bearer " + token
            }
          });

          if (response.status === 401) {
            logout();
            return;
          }

          const user = await response.json();
          document.getElementById("userEmail").textContent =
            "الحساب: " + user.email;

          const serverResponse = await fetch("/api/servers", {
            headers: {
              Authorization: "Bearer " + token
            }
          });

          const data = await serverResponse.json();
          const container = document.getElementById("servers");

          if (!data.servers.length) {
            container.textContent = "لا توجد سيرفرات.";
            return;
          }

          container.innerHTML = data.servers.map(server => {
            const statusClass =
              server.status === "online"
                ? "online"
                : server.status === "error"
                  ? "error"
                  : "";

            const position = server.position
              ? "X " + server.position.x +
                " | Y " + server.position.y +
                " | Z " + server.position.z
              : "غير متوفر";

            return \`
              <div class="server">
                <h3>\${escapeHtml(server.name || server.id)}</h3>
                <p class="muted">
                  \${escapeHtml(server.host)}:\${server.port}
                </p>

                <p>
                  الحالة:
                  <span class="status \${statusClass}">
                    \${escapeHtml(server.status)}
                  </span>
                </p>

                <p>الموقع: \${position}</p>

                <div class="actions">
                  <button onclick="control('\${server.id}', 'start')">
                    تشغيل
                  </button>

                  <button class="danger" onclick="control('\${server.id}', 'stop')">
                    إيقاف
                  </button>

                  <button class="secondary" onclick="control('\${server.id}', 'restart')">
                    إعادة تشغيل
                  </button>
                </div>

                <input
                  id="command-\${server.id}"
                  placeholder="اكتب رسالة أو أمرًا مثل /list"
                >

                <button onclick="sendCommand('\${server.id}')">
                  إرسال إلى السيرفر
                </button>
              </div>
            \`;
          }).join("");
        }

        function escapeHtml(value) {
          return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
        }

        async function control(id, action) {
          const response = await fetch(
            "/api/servers/" + encodeURIComponent(id) + "/" + action,
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token
              }
            }
          );

          const data = await response.json();
          alert(data.message || "تم تنفيذ العملية");
          loadDashboard();
        }

        async function sendCommand(id) {
          const input = document.getElementById("command-" + id);
          const command = input.value.trim();

          if (!command) return;

          const response = await fetch(
            "/api/servers/" + encodeURIComponent(id) + "/command",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token
              },
              body: JSON.stringify({ command })
            }
          );

          const data = await response.json();
          alert(data.message);
          input.value = "";
        }

        loadDashboard();
        setInterval(loadDashboard, 5000);
      </script>
      `
    )
  );
});

app.post("/api/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !email.includes("@")) {
    return res.status(400).json({
      success: false,
      message: "أدخل }

 if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل"
    });
  }

  if (users.some((user) => user.email === email)) {
    return res.status(409).json({
      success: false,
      message: "هذا البريد مسجل مسبقًا"
    });
  }

  const passwordData(password);

  users.push({
    id: crypto.randomUUID(),
    email,
    passwordHash: passwordData.hash,
    salt: passwordData.salt,
    createdAt: new Date().toISOString()
  });

  saveUsers();

  res.json({
    success: true,
    message: "تم إنشاء الحساب"
  });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = users.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({
      success: false,
      message: "البريد الإلكتروني أو كلمة المرور غير صحيحة"
    });
  }

  const token = createSession(user);

  res.json({
    success: true,
    token
  });
});

app.get("/api/me", requireAuth, (req, res)Auth, (req, res) => {
  res.json({
    servers: manager.list()
  });
});

app.post("/api/servers/:id/start", requireAuth, (req, res) => {
  res.json(manager.start(req.params.id));
});

app.post("/api/servers/:id/stop", requireAuth, (req, res) => {
  res.json(manager.stop(req.params.id));
});

app.post("/api/servers/:id/restart", requireAuth, (req, res) => {
  res.json(manager.restart(req.params.id));
});

app.post("/api/servers/:id/command", requireAuth, (req, res) => {
  res.json(manager.command(req.params.id, req.body.command));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    servers: manager.list()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard running on port ${PORT}`);
  manager.startAutoServers();
});

process.on("SIGTERM", () => {
  حسابًا بالبريد الإلكتروني، ثم سجّل الدخول إلى لوحة التحكم.